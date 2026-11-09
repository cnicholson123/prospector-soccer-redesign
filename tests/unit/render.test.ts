import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collections, pageNames, type CollectionName, type Field } from '../../shared/schema.js';
import type { Snapshot } from '../../shared/types.js';
import { loadSeed, seedSnapshot, seedStore } from '../../scripts/seed.js';
import { verifyFacts, checkFacts } from '../../scripts/check-facts.js';
import { createStore } from '../../server/store/index.js';
import { loadConfig } from '../../server/config.js';
import { createRenderHandler, renderPage } from '../../server/render/handler.js';
import { SnapshotView } from '../../server/render/snapshot-view.js';
import { normalizeHtml } from '../normalize.js';

const date = new Date('2026-11-09T12:00:00Z');
let seed: Snapshot;
beforeAll(async () => { seed = seedSnapshot(await loadSeed()); });
function update(snapshot: Snapshot, collection: CollectionName, id: string, patch: Record<string, unknown>): void {
  const doc = snapshot.docs[collection]!.find(doc => doc.id === id)!;
  doc.data = { ...(doc.data as Record<string, unknown>), ...patch };
}
describe('content-backed rendering', () => {
  it.each(pageNames.filter(p => p !== 'shop'))('responds to a %s page edit', page => {
    const copy = structuredClone(seed);
    const collection = page === 'sponsors' ? 'sponsorsPage' : page;
    const doc = copy.docs[collection]![0].data as { hero: Record<string, unknown> };
    doc.hero.lead = 'Updated lead <script>evil</script>';
    const rendered = renderPage(copy, page, { now: date });
    expect(rendered).toContain('Updated lead &lt;script&gt;evil&lt;/script&gt;');
  });
  it('uses ordered shared collection data, references and per-use image alts', () => {
    const copy = structuredClone(seed);
    update(copy, 'results', 'res_1', { teamName: 'Updated champions' });
    for (const page of ['home', 'competitive'] as const) expect(renderPage(copy, page, { now: date })).toContain('Updated champions');
    update(copy, 'sponsors', 'spo_1', { name: 'New gold sponsor' });
    for (const page of ['home', 'sponsors'] as const) expect(renderPage(copy, page, { now: date })).toContain('New gold sponsor');
    update(copy, 'boardMembers', 'mem_7', { name: 'New Referee', email: 'new@example.com' });
    for (const page of ['board', 'referees'] as const) expect(renderPage(copy, page, { now: date })).toContain('new@example.com');
    update(copy, 'documents', 'doc_4', { title: 'Updated laws' });
    for (const page of ['resources', 'referees'] as const) expect(renderPage(copy, page, { now: date })).toContain('Updated laws');
    update(copy, 'teams', 'tea_1', { coaches: [{ _key: 'newcoach', name: 'New Coach' }] });
    expect(renderPage(copy, 'competitive', { now: date })).toContain('New Coach');
    update(copy, 'faqs', 'faq_1', { answer: 'A **new** answer' });
    expect(renderPage(copy, 'competitive', { now: date })).toContain('A <strong>new</strong> answer');
    update(copy, 'media', 'med_rec', { variants: { original: '/assets/new.webp', web: '/assets/new.webp' } });
    expect(renderPage(copy, 'recreational', { now: date })).toContain('src="/assets/new.webp" alt="Young soccer players practicing');
    expect(renderPage(copy, 'home', { now: date })).toContain('src="/assets/new.webp" alt="Young players dribbling');
  });
  it('omits expired events, hidden home events and inactive/out-of-window callouts', () => {
    const copy = structuredClone(seed);
    update(copy, 'events', 'evt_1', { date: '2026-08-01' });
    update(copy, 'events', 'evt_2', { showOnHome: false });
    update(copy, 'callouts', 'cal_1', { startsAt: '2027-01-01T00:00:00Z' });
    update(copy, 'callouts', 'cal_2', { endsAt: date.toISOString() });
    const rendered = renderPage(copy, 'home', { now: date });
    expect(rendered).not.toContain('Yoga Berry fundraiser');
    expect(rendered).not.toContain('U12 Allstars');
    expect(rendered).not.toContain('New age group guidelines');
    expect(rendered).not.toContain('Referees needed — age 13+');
    expect(rendered).toContain('Pizza Factory fundraiser');
  });
  it('retains recent events for client-side dimming and uses the site timezone', () => {
    expect(renderPage(seed, 'home', { now: date })).toContain('Yoga Berry fundraiser');
    expect(new SnapshotView(seed, new Date('2027-01-06T07:30:00Z')).events().some(event => event.id === 'evt_1')).toBe(true);
    expect(new SnapshotView(seed, new Date('2027-01-06T08:30:00Z')).events().some(event => event.id === 'evt_1')).toBe(false);
  });
  it('renders new rows, reordered rows and optional empty lists', () => {
    const copy = structuredClone(seed);
    copy.docs.teams = [{ ...copy.docs.teams![0], id: 'tea_new', order: -1, data: { ageGroup: 'U8', gender: 'coed', level: 'Gold', coaches: [] } }, ...copy.docs.teams!];
    const rendered = renderPage(copy, 'competitive', { now: date });
    expect(rendered.indexOf('data-age="U8"')).toBeLessThan(rendered.indexOf('data-age="U9"'));
    copy.docs.results = [];
    expect(renderPage(copy, 'home', { now: date })).not.toContain('Sharks');
  });
  it.each(pageNames.filter(p => p !== 'shop'))('only annotates %s in edit renders', page => {
    expect(renderPage(seed, page, { now: date })).not.toContain('data-edit=');
    const output = renderPage(seed, page, { now: date, edit: true });
    expect(output).toContain('data-edit=');
    expect(output).not.toMatch(/data-edit="[^"]+"[^>]*data-edit=/);
    for (const match of output.matchAll(/data-edit="([^"]+)"/g)) {
      const address = JSON.parse(match[1].replace(/&quot;/g, '"')) as { collection: CollectionName; id: string; path: string };
      expect(seed.docs[address.collection]?.some(doc => doc.id === address.id)).toBe(true);
      let field: Field | undefined;
      let fields = collections[address.collection].fields;
      for (const part of address.path.split('.')) {
        field = fields[part.replace(/\[.*?\]/, '')];
        expect(field, address.path).toBeDefined();
        if (field?.type === 'object') fields = field.fields;
        if (field?.type === 'list') fields = field.of;
      }
    }
  });
  it('retains every URL, email, price and name in the inventory', async () => {
    const result = await verifyFacts(); expect(result.count).toBeGreaterThan(120); expect(result.missing).toEqual([]);
    expect(checkFacts('- Cost $999', '<p>Cost $10</p>').missing).toContain('$999');
  });
});

describe('filesystem seed and HTTP entry point', () => {
  let root: string;
  let store: ReturnType<typeof createStore>;
  const config = loadConfig({ CACHE_SMAXAGE: '15', CACHE_SWR: '300' }, () => undefined);
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'psc-render-'));
    store = createStore({ ...config, dataDir: root });
    expect(await seedStore(store)).toEqual({ changed: true, count: 145 });
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });
  it('seeds published=draft, sealed revisions and a restorable initial manifest, then does nothing on a rerun', async () => {
    const snapshot = await store.getSnapshot();
    expect(snapshot?.siteVersion).toBe(1);
    const publish = await store.getPublish(1);
    expect(publish?.manifest).toHaveLength(123);
    for (const entry of publish!.manifest) {
      const doc = await store.getDoc(entry.collection, entry.id);
      expect(doc?.published).toEqual(doc?.draft);
      expect((await store.getRevision(entry.id, entry.revId))?.data).toEqual(doc?.published);
    }
    expect(await seedStore(store)).toEqual({ changed: false, count: 145 });
    expect((await store.getSnapshot())?.siteVersion).toBe(1);
  });
  it('returns cache headers, validates weak ETags, handles HEAD and ignores public cookies', async () => {
    const handler = createRenderHandler(store, config, () => date);
    const response = await handler(new Request('http://localhost/'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=15, stale-while-revalidate=300');
    const etag = response.headers.get('ETag')!;
    expect(etag).toMatch(/^W\/"1-[a-f0-9]+-[a-f0-9]+"$/);
    expect((await handler(new Request('http://localhost/', { headers: { 'If-None-Match': '"other", ' + etag.slice(2) } }))).status).toBe(304);
    expect((await handler(new Request('http://localhost/', { method: 'HEAD' }))).headers.get('ETag')).toBe(etag);
    expect(await (await handler(new Request('http://localhost/', { method: 'HEAD' }))).text()).toBe('');
    const cookieResponse = await handler(new Request('http://localhost/', { headers: { Cookie: 'psc_session=unused' } }));
    expect(cookieResponse.headers.get('ETag')).toBe(etag);
    expect(cookieResponse.headers.has('Set-Cookie')).toBe(false);
  });
  it('routes all pages, legacy 308 redirects and a branded 404 without the legacy directory', async () => {
    const handler = createRenderHandler(store, config, () => date);
    for (const page of pageNames.filter(p => p !== 'shop')) {
      const path = page === 'home' ? '' : page;
      const response = await handler(new Request('http://localhost/' + path));
      expect(normalizeHtml(await response.text())).toBe(normalizeHtml(await readFile(`tests/golden/${page === 'home' ? 'index' : page}.html`, 'utf8')));
      const redirect = await handler(new Request(`http://localhost/${page === 'home' ? 'index' : page}.html?v=1`));
      expect(redirect.status).toBe(308); expect(redirect.headers.get('Location')).toBe('/' + path + '?v=1');
    }
    const unknown = await handler(new Request('http://localhost/missing/deep/path'));
    expect(unknown.status).toBe(404); const body = await unknown.text();
    expect(body).toContain('class="site-header"'); expect(body).toContain('class="site-footer"'); expect(body).toContain('Page not found');
    expect(body).toContain('href="/assets/css/styles.css"');
  });
  it('denies preview/edit without caching and rejects mutation methods', async () => {
    const handler = createRenderHandler(store, config, () => date);
    for (const query of ['preview=1', 'edit=1', 'preview=1&edit=1']) {
      const response = await handler(new Request('http://localhost/?' + query));
      expect(response.status).toBe(401); expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.text()).not.toContain('data-edit=');
    }
    expect((await handler(new Request('http://localhost/', { method: 'POST' }))).status).toBe(405);
  });
  it('handles the Vercel function page parameter and noindex robots/sitemap', async () => {
    const handler = createRenderHandler(store, config, () => date);
    expect((await handler(new Request('http://localhost/api/render?page=recreational'))).status).toBe(200);
    expect(await (await handler(new Request('http://localhost/robots.txt'))).text()).toContain('Disallow: /');
    expect(await (await handler(new Request('http://localhost/sitemap.xml'))).text()).not.toContain('<url>');
  });
  it('caps TTL at callout windows and changes ETags when time changes the representation', async () => {
    const snapshot = structuredClone(seed);
    update(snapshot, 'callouts', 'cal_1', { startsAt: '2026-11-09T12:00:05Z' });
    const read = vi.spyOn(store, 'getSnapshot').mockResolvedValue(snapshot);
    try {
      let clock = date;
      const handler = createRenderHandler(store, config, () => clock);
      const first = await handler(new Request('http://localhost/'));
      expect(first.headers.get('Cache-Control')).toContain('s-maxage=5');
      expect(await first.text()).not.toContain('New age group guidelines');
      clock = new Date('2026-11-09T12:00:06Z');
      const next = await handler(new Request('http://localhost/', { headers: { 'If-None-Match': first.headers.get('ETag')! } }));
      expect(next.status).toBe(200);
      expect(await next.text()).toContain('New age group guidelines');
    } finally { read.mockRestore(); }
  });
  it('renders opt-in crawler URLs and caps cache at local midnight', async () => {
    const snapshot = structuredClone(seed);
    const site = snapshot.docs.site![0].data as { seo: { indexable: boolean } };
    site.seo.indexable = true;
    const read = vi.spyOn(store, 'getSnapshot').mockResolvedValue(snapshot);
    try {
      const handler = createRenderHandler(store, config, () => new Date('2026-11-10T07:59:55Z'));
      const response = await handler(new Request('http://localhost/'));
      expect(response.headers.get('Cache-Control')).toMatch(/s-maxage=[0-5],/);
      const robots = await (await handler(new Request('http://localhost/robots.txt'))).text();
      expect(robots).toContain('Disallow: /admin');
      const sitemap = await (await handler(new Request('http://localhost/sitemap.xml'))).text();
      expect(sitemap.match(/<url>/g)).toHaveLength(8);
      expect(sitemap).toContain('http://localhost:3000/recreational');
      expect(await (await handler(new Request('http://localhost/?page=about'))).text()).toContain('About Prospector');
    } finally { read.mockRestore(); }
  });
  it('refuses all seed writes before overwriting edited content, supports explicit force', async () => {
    await store.mutateDoc({ collection: 'home', id: 'home', expectedVersion: 1, patch: { draft: { note: 'Edited' } },
      audit: { id: 'aud_test_edit', at: '2026-11-09T00:00:00.000Z', actorId: 'test', actorName: 'Test', action: 'content.edit' } });
    await expect(seedStore(store)).rejects.toThrow('Refusing to overwrite edited home/home');
    expect((await store.getSnapshot())?.siteVersion).toBe(1);
    expect((await store.getDoc('home', 'home'))?.draft).toEqual({ note: 'Edited' });
    await seedStore(store, true);
    expect((await store.getSnapshot())?.siteVersion).toBe(2);
    expect((await store.getDoc('home', 'home'))?.draft).toEqual(seed.docs.home![0].data);
    expect((await store.getPublish(2))?.manifest.every(entry => !!entry.revId)).toBe(true);
  });
});
