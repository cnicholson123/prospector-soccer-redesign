import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { collections } from '../../shared/schema.js';
import { EditorState } from '../../admin/src/state/autosave.js';
import { duplicateItem, moveItem, docTitle, editorPath, previewPath } from '../../admin/src/state/content.js';
import { localDateTime, pacificDateTime } from '../../admin/src/components/Form/index.js';
import { activityText, groupActivity, relativeTime } from '../../admin/src/state/activity.js';
import type { AuditEntry } from '../../shared/types.js';
import { isNonContentMedia } from '../../server/content/health.js';
import { diff } from '../../shared/content-diff.js';
beforeEach(() => { vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} }); });
afterEach(() => vi.unstubAllGlobals());
it('uses the right API and recovery namespace for every editable collection and singleton', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  for (const definition of Object.values(collections).filter(d => !d.systemManaged)) {
    const doc = { id: definition.kind === 'singleton' ? definition.name : 'sample', collection: definition.name, version: 1, draft: {} };
    fetch.mockResolvedValue(new Response(JSON.stringify({ doc })));
    const state = new EditorState(doc.id, definition.name); await state.load();
    expect(fetch.mock.lastCall?.[0]).toBe(`/api/admin/docs/${definition.name}/${doc.id}`);
    expect(state.doc.value?.collection).toBe(definition.name); state.dispose();
  }
});
it('saves nested page copy and link documents through the shared autosave engine', async () => {
  const original = { id: 'about', collection: 'about', version: 1, draft: { hero: { lead: 'Before' } } };
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ doc: original }))).mockResolvedValueOnce(new Response(JSON.stringify({ doc: { ...original, version: 2, draft: { hero: { lead: 'After' } } } })));
  vi.stubGlobal('fetch', fetch); const state = new EditorState('about', 'about'); await state.load(); state.update('hero', { lead: 'After' }); expect(await state.save()).toBe(true);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ baseVersion: 1, draft: { hero: { lead: 'After' } } });
  state.dispose(); const document = new EditorState('new', 'documents'); expect(document.draft.value.source).toEqual({ mode: 'url' }); document.dispose();
});
it('duplicates nested rows with fresh stable keys and reorders without changing identity', () => {
  const row = { _key: 'original', title: 'Program', facts: [{ _key: 'factkey1', label: 'Fee' }] }, clone = duplicateItem(row);
  expect(clone._key).toHaveLength(8); expect(clone._key).not.toBe(row._key);
  expect((clone.facts as typeof row.facts)[0]._key).not.toBe(row.facts[0]._key);
  expect(moveItem([row, clone], 0, 1)).toEqual([clone, row]);
  expect(diff('home', { programs: [row] }, { programs: [row, clone] }).some(d => d.kind === 'added')).toBe(true);
  expect(diff('home', { hero: { lead: 'One' } }, { hero: { lead: 'Two' } })[0]).toMatchObject({ path: 'hero.lead', words: expect.any(Array) });
});
it('resolves singleton and collection editor/preview routes', () => {
  expect(editorPath('site')).toBe('/admin/settings'); expect(editorPath('sponsorsPage')).toBe('/admin/pages/sponsors');
  expect(editorPath('sponsors', 'spo_1')).toBe('/admin/sponsors/spo_1'); expect(previewPath('boardMembers')).toBe('/board');
  expect(previewPath('faqs', { page: 'recreational' })).toBe('/recreational');
});
it('uses Pacific time for callout windows in winter and summer', () => {
  expect(pacificDateTime('2030-01-03T09:30')).toBe('2030-01-03T17:30:00.000Z');
  expect(pacificDateTime('2030-07-03T09:30')).toBe('2030-07-03T16:30:00.000Z');
  expect(localDateTime('2030-07-03T16:30:00Z')).toBe('2030-07-03T09:30'); expect(pacificDateTime('')).toBeUndefined();
  expect(pacificDateTime('2030-03-10T02:30')).toBe('2030-03-10T02:30');
  expect(localDateTime('2030-03-10T02:30')).toBe('2030-03-10T02:30');
});
it('groups only consecutive migration/system activity and uses readable verbs and relative times', () => {
  const entry = (action: string, actorId = 'phil'): AuditEntry => ({ id: action, at: '2030-01-01T12:00:00Z', actorId, actorName: 'Phil', action });
  const entries = [entry('content.create', 'seed'), entry('system.bootstrap', 'system'), entry('auth.login'), entry('content.create', 'seed')];
  expect(groupActivity(entries).map(g => g.entries.length)).toEqual([2, 1, 1]);
  expect(activityText(entry('auth.login'))).toBe('Phil signed in');
  expect(activityText({ ...entry('content.publish'), meta: { items: [{}, {}, {}] } })).toBe('Phil published 3 changes');
  expect(relativeTime(entries[0].at, Date.parse('2030-01-01T12:02:00Z'))).toBe('2 min ago');
});
it('exempts only static chrome assets from missing-alt health', () => {
  for (const filename of ['favicon.png', 'apple-touch-icon.png', 'crest.png', 'crest-sm.png']) expect(isNonContentMedia({ source: 'static', filename })).toBe(true);
  expect(isNonContentMedia({ source: 'upload', filename: 'crest.png' })).toBe(false);
  expect(isNonContentMedia({ source: 'static', filename: 'hero.webp' })).toBe(false);
});

it('labels unnamed teams by age group, gender and level while preserving supplied names', () => {
  const team: Parameters<typeof docTitle>[0] = { id: 'tea_1', collection: 'teams', version: 1, status: 'draft', createdAt: '', createdBy: 'owner', updatedAt: '', updatedBy: 'owner', draft: { ageGroup: 'U9', gender: 'girls', level: 'Gold' } };
  expect(docTitle(team)).toBe('U9 · girls · Gold');
  expect(docTitle({ ...team, draft: { ...team.draft, name: 'Prospectors' } })).toBe('Prospectors');
});
