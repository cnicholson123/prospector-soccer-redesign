import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAdminApp } from '../../server/http/hono-app.js';
import { createRenderHandler } from '../../server/render/handler.js';
import { loadConfig } from '../../server/config.js';
import { KvStore } from '../../server/store/kv-store.js';
import { FsPrimitives } from '../../server/store/primitives/fs.js';
import { createMediaBlobs } from '../../server/store/index.js';
import { PostgresStore } from '../../server/store/postgres-store.js';
import { postgresRead } from '../../server/store/postgres.js';
import { postgresFixture } from '../helpers/postgres.js';
import { seedStore } from '../../scripts/seed.js';
import type { Doc, Store } from '../../server/store/types.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const initialTime = new Date('2030-01-01T12:00:00Z');
const dueAt = '2030-01-01T12:05:00Z';
const item = (doc: Doc) => ({ collection: doc.collection, id: doc.id, expectedVersion: doc.version });
async function json(response: Response, status = 200) {
  const data = await response.json();
  expect(response.status, JSON.stringify({ error: data.error?.message, currentVersion: data.error?.details?.current?.siteVersion })).toBe(status);
  return data;
}
async function fixture(driver: 'FS' | 'Postgres' | 'Postgres HTTP') {
  await mkdir('.cache', { recursive: true });
  const root = await mkdtemp(resolve('.cache/schedule-restore-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  let now = initialTime;
  const primitives = new FsPrimitives(root);
  const pg = driver !== 'FS' ? await postgresFixture({ now: () => now }) : undefined;
  if (pg) cleanups.push(pg.cleanup);
  let store: Store = pg?.store ?? new KvStore(primitives, { exclusive: primitives.exclusive, now: () => now });
  if (driver === 'Postgres HTTP') {
    // Exercise the actual Neon HTTP serializer against local PostgreSQL; this
    // is not a cloud-service test. Transactional writes still use the Pool.
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      const { query, params } = JSON.parse(String(init.body));
      const result = await pg!.pool.query({ text: query, values: params, rowMode: 'array' });
      return new Response(JSON.stringify({ fields: result.fields.map(field => ({ name: field.name, dataTypeID: field.dataTypeID })), rows: result.rows.map((row: unknown[]) => row.map((value, index) => value == null ? null : [114, 3802].includes(result.fields[index].dataTypeID) ? JSON.stringify(value) : String(value))), rowCount: result.rowCount, command: result.command }), { headers: { 'Content-Type': 'application/json' } });
    });
    store = new PostgresStore(pg!.pool, { now: () => now, readQuery: postgresRead(pg!.pool.options.connectionString!) });
  }
  const config = loadConfig({ DATA_DIR: root, SESSION_SECRET: 'x'.repeat(32) }, () => undefined);
  await seedStore(store);
  const app = createAdminApp(() => store, { config, now: () => now });
  const login = await app.request('/api/admin/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Phil', password: 'Phil' }) });
  const { csrfToken } = await json(login);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const request = (target: typeof app, path: string, method = 'GET', body?: unknown) => target.request('/api/admin' + path, { method, headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken, Origin: config.publicBaseUrl, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const req = (path: string, method = 'GET', body?: unknown) => request(app, path, method, body);
  const other = createAdminApp(() => store, { config, now: () => now });
  const render = createRenderHandler(store, config, () => now);
  return { store, req, other: (path: string) => request(other, path), render, clock: (date: string) => { now = new Date(date); },
    async upload() {
      const bytes = Buffer.from('%PDF-1.7\n%%EOF');
      const grant = await json(await req('/media/upload-url', 'POST', { filename: 'guide.pdf', mime: 'application/pdf', size: bytes.length }));
      await createMediaBlobs(config, store).put(grant.pathname, bytes, { contentType: 'application/pdf' });
      return (await json(await req('/media', 'POST', { ticket: grant.ticket }), 201)).doc as Doc;
    },
    async editHome(lead: string) {
      const { doc } = await json(await req('/docs/home/home'));
      return (await json(await req('/docs/home/home', 'PUT', { baseVersion: doc.version, draft: { ...doc.draft, hero: { ...doc.draft.hero, lead } } }))).doc as Doc;
    },
  };
}

for (const driver of ['FS', 'Postgres', 'Postgres HTTP'] as const) describe.skipIf(driver !== 'FS' && !process.env.DATABASE_URL)(`restore/schedule regression (${driver})`, () => {
  it('schedules the fresh home selection, then restored uploads and their referring drafts with one version increment', async () => {
    const f = await fixture(driver), media = await f.upload();
    const home = (await json(await f.req('/docs/home/home'))).doc as Doc;
    await json(await f.req('/publish', 'POST', { items: [item(home)] }));
    await json(await f.req('/publishes/1/restore', 'POST', {}));
    await f.editHome('Schedule only home after restore');
    let pending: Doc[] = (await json(await f.req('/pending'))).docs;
    expect(pending.find(doc => doc.id === media.id)?.published).toBeUndefined();
    const untouchedMedia = await f.store.getDoc('media', media.id);
    await json(await f.req('/schedule', 'POST', { items: [item(pending.find(doc => doc.id === 'home')!)], at: dueAt }));
    expect(await f.store.getDoc('media', media.id)).toEqual(untouchedMedia);

    // Real tray history: a document and its upload were published after seed,
    // so restoring seed keeps both as pending drafts. Select all includes both.
    const document = (await json(await f.req('/docs/documents', 'POST', { draft: { title: 'Uploaded guide', category: 'club', kind: 'pdf', source: { mode: 'upload', fileId: { mediaId: media.id } } } }), 201)).doc as Doc;
    await json(await f.req('/publish', 'POST', { items: [item(document)] }));
    await json(await f.req('/publishes/1/restore', 'POST', {}));
    await f.editHome('Schedule home with restored uploads');
    pending = (await json(await f.req('/pending'))).docs;
    expect(pending.map(doc => doc.id)).toEqual(expect.arrayContaining(['home', document.id, media.id]));
    const before = (await f.store.getSnapshot())!;
    const published = await json(await f.req('/schedule', 'POST', { items: pending.map(item), at: dueAt }));
    expect(published.siteVersion).toBe(before.siteVersion + 1);
    const snapshot = (await f.store.getSnapshot())!;
    for (const doc of pending) {
      const saved = (await f.store.getDoc(doc.collection, doc.id))!;
      expect(saved.version).toBe(doc.version + 1);
      expect(snapshot.scheduled.find(s => s.id === doc.id)).toMatchObject({ data: doc.draft, version: saved.version });
    }
    const savedMedia = (await f.store.getDoc('media', media.id))!;
    expect(savedMedia.publishedVersion).toBe(savedMedia.version);
    expect(savedMedia.status).toBe('scheduled');
    expect(snapshot.media[media.id]).toBeDefined();
    expect(snapshot.docs.home).toEqual(before.docs.home);
    const revisions = await f.store.listRevisions('media', media.id, 100);
    expect(revisions.filter(rev => rev.publishSiteVersion === snapshot.siteVersion).map(rev => rev.docVersion)).toEqual([savedMedia.version, savedMedia.version]);
    expect(revisions.every(rev => rev.sealedAt)).toBe(true);

    // Genuine stale selections still conflict; do not mask them with a retry.
    const stale = await f.req('/schedule', 'POST', { items: pending.map(item), at: dueAt });
    await json(stale, 409);
    expect((await f.store.getSnapshot())?.siteVersion).toBe(snapshot.siteVersion);
    f.clock(dueAt);
    await json(await f.other('/pending'));
    expect((await f.store.getSnapshot())?.scheduled).toHaveLength(0);
    expect((await f.store.getDoc('documents', document.id))?.published).toEqual(document.draft);
  }, 60000);

  it('refreshes warm render, schedule and health generations after publish, schedule, unpublish and restore', async () => {
    const f = await fixture(driver);
    await json(await f.other('/pending')); // Warm the other instance's no-schedule index.
    await json(await f.req('/dashboard?section=health'));
    let response = await f.render(new Request('http://localhost/'));
    const originalTag = response.headers.get('etag');
    const home = await f.editHome('Fresh published lead');
    await json(await f.req('/publish', 'POST', { items: [item(home)] }));
    expect(await f.store.getMeta('health-cache')).toBeNull();
    response = await f.render(new Request('http://localhost/', { headers: { 'If-None-Match': originalTag! } }));
    expect(response.status).toBe(200); expect(await response.text()).toContain('Fresh published lead');
    const scheduled = await f.editHome('Fresh scheduled lead');
    await json(await f.req('/dashboard?section=health'));
    await json(await f.req('/schedule', 'POST', { items: [item(scheduled)], at: dueAt }));
    expect(await f.store.getMeta('health-cache')).toBeNull();
    await json(await f.other('/pending')); // Observe the new due time in the warm instance.
    expect(await (await f.render(new Request('http://localhost/'))).text()).not.toContain('Fresh scheduled lead');
    await json(await f.req('/dashboard?section=health'));
    await json(await f.req('/unpublish', 'POST', { items: [item((await f.store.getDoc('home', 'home'))!)] }));
    expect(await f.store.getMeta('health-cache')).toBeNull();
    const unpublishTag = (await f.render(new Request('http://localhost/'))).headers.get('etag');
    await json(await f.other('/pending')); // Observe cancellation, with no overdue settlement later.
    await json(await f.req('/dashboard?section=health'));
    await json(await f.req('/publishes/1/restore', 'POST', {}));
    expect(await f.store.getMeta('health-cache')).toBeNull();
    response = await f.render(new Request('http://localhost/', { headers: { 'If-None-Match': unpublishTag! } }));
    expect(response.status).toBe(200); expect(await response.text()).not.toContain('Fresh published lead');
    const version = (await f.store.getSnapshot())!.siteVersion;
    f.clock(dueAt);
    await json(await f.other('/pending'));
    expect((await f.store.getSnapshot())!.siteVersion).toBe(version);
    expect(await f.store.getMeta('schedule-error')).toBeNull();
  }, 60000);
});
if (!process.env.DATABASE_URL) console.info('Postgres restore/schedule and HTTP transport regressions: not run (no env)');
