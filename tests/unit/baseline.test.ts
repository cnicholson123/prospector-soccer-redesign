import { bootstrapEnvironment } from '../helpers/password.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { newSession } from '../../server/auth/session.js';
import { bootstrap } from '../../server/auth/bootstrap.js';
import { loadConfig } from '../../server/config.js';
import { createStore, createMediaBlobs } from '../../server/store/index.js';
import { createDocument } from '../../server/content/documents.js';
import { applyDefaults, validate, validateFields, ValidationError } from '../../server/content/validate.js';
import { references } from '../../server/content/references.js';
import { createHistoryId } from '../../server/content/ids.js';
import { buildSnapshot } from '../../server/content/snapshot.js';
import { seedStore, loadSeed, seedSnapshot } from '../../scripts/seed.js';
import { adminApp, createAdminApp } from '../../server/http/hono-app.js';
import type { Doc, PublishRecord } from '../../shared/types.js';
import type { PublishTx } from '../../server/store/types.js';
import type { CollectionName } from '../../shared/schema.js';

const at = '2026-11-09T12:00:00.000Z';
function makeDoc(collection: CollectionName, id: string, draft: unknown): Doc {
  return { collection, id, draft, version: 1, order: 0, status: 'draft', createdAt: at, updatedAt: at, createdBy: 'test', updatedBy: 'test' };
}
const audit = () => ({ id: createHistoryId('aud'), at: new Date().toISOString(), actorId: 'test', actorName: 'Test', action: 'test' });

const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function local() {
  const root = await mkdtemp(join(tmpdir(), 'psc-baseline-')); roots.push(root);
  const config = loadConfig({ DATA_DIR: root }, () => undefined);
  return { root, config, store: createStore(config) };
}

describe('Phase 1b config and runtime dispatch', () => {
  it('requires hashed production bootstrap credentials and preserves dev defaults', async () => {
    const env = { NODE_ENV: 'production', STORE_DRIVER: 'fs', SESSION_SECRET: 'x'.repeat(32), PUBLIC_BASE_URL: 'https://example.com' };
    for (const credentials of [{}, { ADMIN_BOOTSTRAP_USER: 'Phil' }, { ADMIN_BOOTSTRAP_PASSWORD: 'secret' }, { ADMIN_BOOTSTRAP_USER: ' ', ADMIN_BOOTSTRAP_PASSWORD: 'secret' }]) {
      expect(() => loadConfig({ ...env, ...credentials })).toThrow('ADMIN_BOOTSTRAP');
    }
    const prod = loadConfig({ ...env, ...await bootstrapEnvironment() });
    expect(prod.adminBootstrapUsers?.[0].username).toBe('Owner');
    const dev = loadConfig({ ADMIN_BOOTSTRAP_PASSWORD: '' }, () => undefined);
    expect(dev.adminBootstrapUser).toBe('Phil'); expect(dev.adminBootstrapPassword).toBe('Phil');
  });
  it('dispatches Request objects to both Vercel fetch entrypoints', async () => {
    const { root, store } = await local(); await seedStore(store);
    vi.stubEnv('DATA_DIR', root); vi.stubEnv('STORE_DRIVER', 'fs'); vi.stubEnv('SESSION_SECRET', 'x'.repeat(32));
    const [{ default: render }, { default: admin }] = await Promise.all([import('../../api/render.js'), import('../../api/admin.js')]);
    function fromNode(url: string) {
      const incoming = { url, headers: { host: 'localhost:3000', accept: 'text/html' }, method: 'GET' };
      return new Request(new URL(incoming.url, `http://${incoming.headers.host}`), { method: incoming.method, headers: incoming.headers });
    }
    expect(typeof render).toBe('object'); expect(typeof admin).toBe('object');
    const home = await render.fetch(fromNode('/')); expect(home.status).toBe(200); expect(home.headers.get('Content-Type')).toContain('text/html');
    expect(await home.text()).toContain('Prospector Soccer Club');
    const health = await admin.fetch(fromNode('/api/admin/healthz')); expect(health.status).toBe(200); expect(await health.json()).toEqual({ ok: true });
  });
  it('recovers on the first authenticated request and after unexpected errors', async () => {
    const { store, config } = await local();
    const recover = vi.spyOn(store, 'recoverPublish');
    const app = createAdminApp(() => store, { config });
    app.get('/api/admin/test-failure', () => { throw new Error('Injected error'); });
    app.get('/api/admin/test-read', c => c.json({ ok: true }));
    await app.request('/api/admin/healthz'); expect(recover).not.toHaveBeenCalled();
    const login = await app.request('/api/admin/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Phil', password: 'Phil' }) });
    const headers = { Cookie: login.headers.get('set-cookie')!.split(';')[0] };
    expect(recover).toHaveBeenCalledTimes(1);
    await app.request('/api/admin/test-read', { headers }); expect(recover).toHaveBeenCalledTimes(2);
    await app.request('/api/admin/test-failure', { headers });
    await app.request('/api/admin/test-read', { headers }); expect(recover).toHaveBeenCalledTimes(5);
  });
  it('caps actual streamed bytes as well as declared content-length', async () => {
    const large = 'a'.repeat(1024 * 1024 + 1);
    for (const headers of [new Headers(), new Headers({ 'Content-Length': String(large.length) }), new Headers({ 'Content-Length': '1' })]) {
      const response = await adminApp.request('/api/admin/missing', { method: 'POST', headers, body: large });
      expect(response.status).toBe(413);
    }
    const response = await adminApp.request('/api/admin/missing', { method: 'POST', body: 'a'.repeat(1024 * 1024) });
    expect(response.status).toBe(401);
  });
});

describe('draft defaults and publish validation', () => {
  it('applies defaults recursively on a copy only at creation', () => {
    const source = { title: 'Event', date: '2026-11-09', showOnHome: false };
    expect(applyDefaults('events', source)).toEqual(source);
    expect(applyDefaults('events', { title: 'Event' })).toEqual({ title: 'Event', showOnHome: true });
    const site = { nav: [{ _key: 'abcdefgh', label: 'Home', page: 'home' }] };
    expect(applyDefaults('site', site)).toMatchObject({ nav: [{ visible: true }], banner: { enabled: false }, seo: { indexable: false }, events: { hidePastAfterDays: 60 } });
    expect(site.nav[0]).not.toHaveProperty('visible');
    const resolve = (collection: CollectionName) => collection === 'competitive' ? makeDoc('competitive', 'competitive', { teamsSection: { seasonLabel: 'Fall 2027' } }) : null;
    expect(applyDefaults('teams', {}, resolve)).toEqual({ season: 'Fall 2027' });
    expect(validate('events', { title: 'Event', date: '2026-11-09' }).valid).toBe(true);
    expect(source).toEqual({ title: 'Event', date: '2026-11-09', showOnHome: false });
  });
  it.each([
    [{ type: 'text' as const }, 500], [{ type: 'text' as const, multiline: true }, 5000], [{ type: 'richtext' as const }, 20000], [{ type: 'text' as const, maxLength: 700 }, 700],
  ])('enforces the length bound for %j', (field, limit) => {
    expect(validateFields({ value: field }, { value: 'x'.repeat(limit) }).valid).toBe(true);
    expect(validateFields({ value: field }, { value: 'x'.repeat(limit + 1) }).errors[0].path).toBe('value');
  });
  it('requires singleton sections only on publish and validates all migrated seed content', async () => {
    expect(validate('home', {}).valid).toBe(true);
    expect(validate('home', {}, { mode: 'publish' }).errors).toContainEqual({ path: 'hero', message: 'Required section' });
    const docs = await loadSeed();
    const resolve = (collection: CollectionName, id: string) => docs.find(doc => doc.collection === collection && doc.id === id) ?? null;
    for (const doc of docs) expect(validate(doc.collection, doc.draft, { mode: 'publish', resolve }), doc.id).toEqual({ valid: true, errors: [] });
  });
  it('requires every reference to resolve in its declared collection, including nested arrays', () => {
    const sponsor = { name: 'Sponsor', tier: 'tier_a' };
    expect(validate('sponsors', sponsor).valid).toBe(true);
    for (const target of [null, makeDoc('events', 'tier_a', {}), { ...makeDoc('sponsorTiers', 'tier_a', {}), status: 'trashed' as const }, { ...makeDoc('sponsorTiers', 'tier_a', {}), trashedAt: at }]) {
      expect(validate('sponsors', sponsor, { mode: 'publish', resolve: () => target }).errors.map(issue => issue.path)).toContain('tier');
    }
    expect(validate('sponsors', sponsor, { mode: 'publish', resolve: () => makeDoc('sponsorTiers', 'tier_a', {}) }).valid).toBe(true);
    const refs = references('home', { programs: [{ _key: 'abcdefgh', image: { mediaId: 'med_a', alt: '' } }], resultsSection: { resultIds: ['res_a', 'res_b'] } });
    expect(refs.map(ref => ref.path)).toEqual(['programs[0].image', 'resultsSection.resultIds', 'resultsSection.resultIds']);
  });
  it('distinguishes image media from PDFs and rejects missing or trashed media', () => {
    const doc = { title: 'PDF', category: 'club', source: { mode: 'upload', fileId: { mediaId: 'med_a' } } };
    const target = (mime: string) => () => makeDoc('media', 'med_a', { mime });
    expect(validate('documents', doc, { mode: 'publish', resolve: target('application/pdf') }).valid).toBe(true);
    expect(validate('documents', doc, { mode: 'publish', resolve: target('image/jpeg') }).errors[0].path).toBe('source.fileId');
    const sponsor = { name: 'Sponsor', tier: 'tier_a', logo: { mediaId: 'med_a', alt: 'Logo' } };
    const resolve = (mime: string) => (collection: CollectionName, id: string) => makeDoc(collection, id, { mime });
    expect(validate('sponsors', sponsor, { mode: 'publish', resolve: resolve('image/webp') }).valid).toBe(true);
    expect(validate('sponsors', sponsor, { mode: 'publish', resolve: resolve('application/pdf') }).errors[0].path).toBe('logo');
    expect(validate('sponsors', sponsor, { mode: 'publish', resolve: () => null }).errors.map(error => error.path)).toContain('logo');
  });
  it('returns validation paths with 422 through the API error handler', async () => {
    // This test route exercises the error boundary until Phase 5 adds the authenticated publish route.
    const { store, config } = await local();
    await bootstrap(store, config);
    const { token, session } = await newSession(store, (await store.listUsers())[0], {});
    const app = createAdminApp(() => store, { config });
    app.post('/api/admin/test-validation', () => { throw new ValidationError([{ path: 'home.hero', message: 'Required section' }]); });
    const response = await app.request('/api/admin/test-validation', { method: 'POST', headers: { Cookie: 'psc_session=' + token, 'X-CSRF-Token': session.csrfToken } });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { code: 'validation', message: 'Content validation failed', details: [{ path: 'home.hero', message: 'Required section' }] } });
  });
});

describe('snapshot and reference integrity', () => {
  it('freezes schema, order, schedule bookkeeping and media at publication', async () => {
    const docs = await loadSeed();
    const snapshot = seedSnapshot(docs);
    expect(snapshot.schemaVersion).toBe(1); expect(Object.keys(snapshot.media).length).toBeGreaterThan(0);
    expect(Object.values(snapshot.docs).flat().every(doc => Number.isInteger(doc.order))).toBe(true);
    const frozen = structuredClone(snapshot);
    const mediaDoc = docs.find(doc => Object.hasOwn(snapshot.media, doc.id))!;
    (mediaDoc.published as Record<string, unknown>).variants = { web: '/new.webp' };
    expect(snapshot).toEqual(frozen);
    const rebuilt = buildSnapshot(docs, { ...snapshot, effectiveAt: at, scheduled: [{ collection: 'events', id: 'evt_future', at, version: 1, order: 5, data: { title: 'Scheduled' } }] });
    expect(rebuilt.effectiveAt).toBe(at); expect(rebuilt.scheduled[0].order).toBe(5);
  });
  it('applies defaults through the creation service and preserves explicit edits', async () => {
    const { store } = await local();
    const doc = makeDoc('events', 'evt_created', { title: 'Created', date: '2026-11-09' });
    const saved = await createDocument(store, { doc, revision: { id: createHistoryId('rev'), collection: 'events', docId: doc.id, docVersion: 1, at, authorId: 'test', authorName: 'Test', action: 'created', data: doc.draft }, audit: audit() });
    expect(saved.draft).toEqual({ title: 'Created', date: '2026-11-09', showOnHome: true });
    await store.mutateDoc({ collection: 'events', id: doc.id, expectedVersion: 1, patch: { draft: { title: 'Saved', date: '2026-11-09' } }, audit: audit() });
    expect((await store.getDoc('events', doc.id))?.draft).not.toHaveProperty('showOnHome');
  });
  it('retains media binaries referenced by historical publications after unpublishing', async () => {
    const { store, config } = await local();
    const blobs = createMediaBlobs(config);
    const { url } = await blobs.put('media/2026/med_a/original.pdf', new Uint8Array([1, 2, 3]), { contentType: 'application/pdf' });
    const draft = { filename: 'original.pdf', mime: 'application/pdf', variants: { original: url } };
    const mediaDoc = makeDoc('media', 'med_a', draft);
    const rev = { id: createHistoryId('rev'), collection: mediaDoc.collection, docId: mediaDoc.id, docVersion: 1, at, authorId: 'test', authorName: 'Test', action: 'created' as const, sealedAt: at, data: draft };
    await store.createDoc({ doc: mediaDoc, revision: rev, audit: audit() });
    const published = { ...mediaDoc, version: 2, published: draft, publishedVersion: 2, status: 'published' as const };
    const pubRev = { ...rev, id: createHistoryId('rev'), docVersion: 2 };
    await store.publish({ docs: [{ expectedVersion: 1, nextDoc: published }], revisions: [pubRev], snapshot: buildSnapshot([published], { siteVersion: 1, publishedAt: at, templateHash: 'test' }), record: { siteVersion: 1, at, actorId: 'test', kind: 'publish', manifest: [{ collection: 'media', id: 'med_a', version: 2, order: 0, title: 'original.pdf', revId: pubRev.id }] } });
    const unpublished = { ...published, version: 3, published: undefined, publishedVersion: undefined, status: 'draft' as const };
    await store.publish({ docs: [{ expectedVersion: 2, nextDoc: unpublished }], snapshot: buildSnapshot([unpublished], { siteVersion: 2, publishedAt: at, templateHash: 'test' }), record: { siteVersion: 2, at, actorId: 'test', kind: 'unpublish', manifest: [] } });
    await expect(blobs.delete(url)).rejects.toThrow('retained');
    await expect(blobs.delete(url.replace('/media/', '/%6Dedia/'))).rejects.toThrow('retained');
    await expect(blobs.put('media/2026/med_a/original.pdf', new Uint8Array([4]), { contentType: 'application/pdf' })).rejects.toThrow('retained');
  });
  it('refuses trash when referenced by a draft or a published document', async () => {
    const { store } = await local();
    const target = makeDoc('sponsorTiers', 'tier_a', { name: 'Gold' });
    const source = makeDoc('sponsors', 'spon_a', { name: 'Sponsor', tier: target.id });
    for (const doc of [target, source]) await store.createDoc({ doc, revision: { id: createHistoryId('rev'), collection: doc.collection, docId: doc.id, docVersion: 1, at, authorId: 'test', authorName: 'Test', action: 'created', data: doc.draft }, audit: audit() });
    await expect(store.mutateDoc({ collection: target.collection, id: target.id, expectedVersion: 1, patch: { status: 'trashed' }, audit: audit() })).rejects.toMatchObject({ code: 'in_use', status: 409, details: { usage: [{ collection: 'sponsors', id: 'spon_a', title: 'Sponsor', path: 'tier' }] } });
    await store.mutateDoc({ collection: source.collection, id: source.id, expectedVersion: 1, patch: { published: source.draft, draft: { name: 'Sponsor' } }, audit: audit() });
    await expect(store.mutateDoc({ collection: target.collection, id: target.id, expectedVersion: 1, patch: { trashedAt: at }, audit: audit() })).rejects.toMatchObject({ code: 'in_use' });
  });
  it('rejects invalid published data before mutating stored state', async () => {
    const { store } = await local();
    await seedStore(store);
    const home = (await store.getDoc('home', 'home'))!;
    const next = { ...home, published: {}, publishedVersion: home.version + 1, version: home.version + 1 };
    const rev = { id: createHistoryId('rev'), collection: home.collection, docId: home.id, docVersion: next.version, at, authorId: 'test', authorName: 'Test', action: 'published' as const, data: {} };
    const all = (await Promise.all((await loadSeed()).map(doc => store.getDoc(doc.collection, doc.id)))).filter((doc): doc is Doc => doc !== null).map(doc => doc.id === 'home' ? next : doc);
    const previous = (await store.getPublish(1))!;
    const manifest = previous.manifest.map(entry => entry.id === 'home' ? { ...entry, version: next.version, revId: rev.id } : entry);
    const tx: PublishTx = { docs: [{ expectedVersion: home.version, nextDoc: next }], snapshot: buildSnapshot(all, { siteVersion: 2, publishedAt: at, templateHash: 'test' }), record: { ...previous, siteVersion: 2, manifest }, revisions: [rev] };
    await expect(store.publish(tx)).rejects.toMatchObject({ code: 'validation', status: 422 });
    const config = loadConfig({}, () => undefined);
    await bootstrap(store, config);
    const { token, session } = await newSession(store, (await store.listUsers())[0], {});
    const app = createAdminApp(() => store, { config });
    app.post('/api/admin/test-publish-validation', async c => c.json(await store.publish(tx)));
    const response = await app.request('/api/admin/test-publish-validation', { method: 'POST', headers: { Cookie: 'psc_session=' + token, 'X-CSRF-Token': session.csrfToken } });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'validation', details: expect.arrayContaining([{ path: 'home.home.hero', message: 'Required section' }]) } });
    expect((await store.getSnapshot())?.siteVersion).toBe(1); expect(await store.getDoc('home', 'home')).toEqual(home);
  });
  it.each<PublishRecord['kind']>(['publish', 'unpublish', 'schedule', 'restore', 'rebuild'])('records %s snapshot changes', async kind => {
    const { store } = await local();
    const snapshot = buildSnapshot([], { siteVersion: 1, publishedAt: at, templateHash: 'test' });
    await store.publish({ docs: [], snapshot, record: { siteVersion: 1, at, actorId: 'test', kind, manifest: [] } });
    expect((await store.getPublish(1))?.kind).toBe(kind);
  });
  it('uses fixed-width sortable history ids and random suffixes', () => {
    const first = createHistoryId('rev', new Date(at)); const next = createHistoryId('rev', new Date(Date.parse(at) + 1));
    expect(first).toMatch(/^rev_[0-9a-v]{10}_[0-9a-v]{6}$/); expect(first < next).toBe(true);
    expect(createHistoryId('aud')).toMatch(/^aud_[0-9a-v]{10}_[0-9a-v]{6}$/);
    expect(new Set(Array.from({ length: 1000 }, () => createHistoryId('rev', new Date(at)))).size).toBe(1000);
  });
});
