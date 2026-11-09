import { describe, expect, it } from 'vitest';
import { collections, type CollectionName, type Field } from '../../shared/schema';
import { validate, validateFields } from '../../server/content/validate';
import { createId, createListKey } from '../../server/content/ids';

const examples: { field: Field; good: unknown; bad: unknown[] }[] = [
  { field: { type: 'text', required: true, maxLength: 8 }, good: 'Prospect', bad: ['', '         ', 'Longer than 8', 1, null] },
  { field: { type: 'richtext', required: true }, good: '**Bold** and [club](/about)', bad: [[], '', '[bad](javascript:alert(1))', '[bad](data:text/html,hi)'] },
  { field: { type: 'url', allowMailto: true, allowRelative: true }, good: '/about#purpose', bad: ['javascript:alert(1)', '//evil.example', '/\\evil.example', 'https://a.com/\n', 'https://user:pass@example.org', '%2F%2Fevil.com', 'https://a.com/%0A', 'data:text/plain,x'] },
  { field: { type: 'email', required: true }, good: 'registrar@prospector.org', bad: ['@bad.com', 'x@x', 'a b@host.com', 'a@b@c.com'] },
  { field: { type: 'date' }, good: '2028-02-29', bad: ['2026-02-29', '2026-04-31', '11/09/2026', '0000-01-01'] },
  { field: { type: 'time' }, good: '18:30', bad: ['24:00', '12:60', '6:30 pm'] },
  { field: { type: 'datetime' }, good: '2026-11-09T18:30:00-08:00', bad: ['2026-11-09T18:30:00', '2026-02-30T18:30:00Z', '2026-11-09T25:00:00Z', 'garbage'] },
  { field: { type: 'number', integer: true, min: 1, max: 8 }, good: 3, bad: [0, 9, 1.5, '3', Infinity, NaN] },
  { field: { type: 'money' }, good: { amount: 100, max: 150 }, bad: [100, { amount: -1 }, { amount: 150, max: 100 }, { amount: NaN }, { amount: 10, currency: 'USD' }] },
  { field: { type: 'percent' }, good: 33.3, bad: [-1, 101, '40'] },
  { field: { type: 'month' }, good: 12, bad: [0, 13, 2.5] },
  { field: { type: 'boolean' }, good: false, bad: ['false', 0, null] },
  { field: { type: 'select', options: [{ label: 'Rec', value: 'rec' }] }, good: 'rec', bad: ['comp', true] },
  { field: { type: 'icon' }, good: 'calendar', bad: ['<svg/>', 'not-an-icon'] },
  { field: { type: 'image' }, good: { mediaId: 'media_abc', alt: 'Players' }, bad: [{ mediaId: 'media_abc' }, { mediaId: '../x', alt: '' }, { mediaId: 'media_abc', alt: 1 }] },
  { field: { type: 'file' }, good: { mediaId: 'media_abc' }, bad: ['media_abc', {}, { mediaId: 'media_abc', url: '/x' }] },
  { field: { type: 'reference', to: 'results' }, good: 'res_abc', bad: [3, [], '../x'] },
  { field: { type: 'reference', to: 'results', many: true }, good: ['res_a', 'res_b'], bad: ['res_a', ['../x'], ['res_a', 'res_a']] },
  { field: { type: 'link' }, good: { label: 'Email', href: 'mailto:club@prospector.org', external: true }, bad: [{ label: '', href: '/about' }, { label: 'Bad', href: 'javascript:x' }] },
  { field: { type: 'object', fields: { name: { type: 'text', required: true } } }, good: { name: 'Phil' }, bad: [[], {}, { name: 'Phil', extra: 1 }] },
  { field: { type: 'list', of: { text: { type: 'text' } }, itemLabel: 'text', minItems: 1, maxItems: 2 }, good: [{ _key: 'abcdefgh', text: 'Club' }], bad: [[], [{ text: 'Missing key' }], [{ _key: 'abcdefgh' }, { _key: 'abcdefgh' }], [{ _key: 'abcdefgh' }, { _key: 'ijklmnop' }, { _key: 'qrstuvwx' }]] },
];
describe('all field types', () => {
  for (const { field, good, bad } of examples) {
    it(`accepts ${field.type}${'many' in field ? ` (many=${field.many})` : ''}`, () => expect(validateFields({ value: field }, { value: good })).toEqual({ valid: true, errors: [] }));
    for (const [i, value] of bad.entries()) it(`rejects ${field.type} invalid sample ${i}`, () => expect(validateFields({ value: field }, { value }).valid).toBe(false));
  }
  it('respects URL field options', () => {
    expect(validateFields({ href: { type: 'url' } }, { href: '/about' }).valid).toBe(false);
    expect(validateFields({ href: { type: 'url' } }, { href: 'mailto:x@example.com' }).valid).toBe(false);
    expect(validateFields({ href: { type: 'url' } }, { href: 'https://prospector.org' }).valid).toBe(true);
  });
  it('reports nested paths without silently dropping fields', () => {
    const result = validateFields({ contacts: { type: 'list', of: { email: { type: 'email' } }, itemLabel: 'email' } }, { contacts: [{ _key: 'abcdefgh', email: 'bad' }] });
    expect(result.errors[0].path).toBe('contacts[0].email');
    expect(validateFields({}, JSON.parse('{"__proto__":1}')).valid).toBe(false);
  });
});

function sample(field: Field): unknown {
  switch (field.type) {
    case 'object': return Object.fromEntries(Object.entries(field.fields).map(([name, child]) => [name, sample(child)]));
    case 'list': return [{ _key: 'abcdefgh', ...Object.fromEntries(Object.entries(field.of).map(([name, child]) => [name, sample(child)])) }];
    case 'text': case 'richtext': return 'Prospector';
    case 'url': return 'https://prospector.org/';
    case 'email': return 'club@prospector.org';
    case 'date': return '2026-11-09';
    case 'time': return '18:30';
    case 'datetime': return '2026-11-09T18:30:00Z';
    case 'number': return field.min ?? 1;
    case 'month': return 5;
    case 'percent': return 50;
    case 'money': return { amount: 170 };
    case 'boolean': return true;
    case 'select': return field.options[0].value;
    case 'icon': return 'calendar';
    case 'file': return { mediaId: 'media_example' };
    case 'image': return { mediaId: 'media_example', alt: 'Players at practice' };
    case 'reference': return field.many ? ['doc_example'] : 'doc_example';
    case 'link': return { label: 'Join a team', href: '/recreational#register' };
  }
}
describe('complete schema and migration-shaped documents', () => {
  it('has distinct page singleton and sponsor collection, and only content types', () => {
    expect(Object.keys(collections)).toHaveLength(19);
    expect(collections.sponsorsPage.kind).toBe('singleton');
    expect(collections.sponsors.kind).toBe('collection');
    expect(collections.sponsors.fields.tier).toMatchObject({ to: 'sponsorTiers' });
    expect(collections.site.fields.seo).toMatchObject({ fields: { indexable: { default: false } } });
  });
  for (const name of Object.keys(collections) as CollectionName[]) it(`validates all fields of ${name}`, () => {
    const data = Object.fromEntries(Object.entries(collections[name].fields).map(([key, field]) => [key, sample(field)]));
    if (name === 'events') data.endTime = '20:00';
    if (name === 'callouts') data.endsAt = '2026-11-10T18:30:00Z';
    expect(validate(name, data)).toEqual({ valid: true, errors: [] });
  });
  it('accepts current event, sponsor and uploaded-document shapes', () => {
    expect(validate('events', { title: 'Board meeting', date: '2026-11-09', time: '18:30', location: 'Mountain Mike’s', notes: '**All welcome.**' }).valid).toBe(true);
    expect(validate('sponsors', { name: 'Marshall Hospital', tier: 'tier_gold', url: 'https://www.marshallmedical.org/', active: true }).valid).toBe(true);
    expect(validate('documents', { title: 'Club policies', category: 'policies', kind: 'pdf', source: { mode: 'upload', fileId: { mediaId: 'media_policy' } } }).valid).toBe(true);
  });
  it('enforces conditional source and navigation fields', () => {
    expect(validate('documents', { title: 'Policies', category: 'policies', source: { mode: 'url' } }).errors).toContainEqual({ path: 'source.url', message: 'Required for URL documents' });
    expect(validate('site', { nav: [{ _key: 'abcdefgh', label: 'About' }] }).valid).toBe(false);
    expect(validate('events', { title: 'Event', date: '2026-11-09', time: '18:30', endTime: '17:00' }).valid).toBe(false);
  });
  it('generates safe, stable-format IDs and list keys', () => {
    expect(createId('home')).toBe('home');
    const ids = Array.from({ length: 500 }, () => createId('events'));
    expect(new Set(ids).size).toBe(500); expect(ids.every(id => /^evt_[\w-]+$/.test(id))).toBe(true);
    expect(createListKey()).toMatch(/^[a-z0-9]{8}$/);
  });
});
