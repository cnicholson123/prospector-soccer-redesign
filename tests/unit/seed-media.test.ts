import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSeed } from '../../scripts/seed.js';
import { seedStaticMedia } from '../../scripts/seed-media.js';
import { FsPrimitives } from '../../server/store/primitives/fs.js';
import { KvStore } from '../../server/store/kv-store.js';
import { postgresFixture } from '../helpers/postgres.js';
import type { Doc, Store } from '../../server/store/types.js';
import { revision } from '../../server/content/revisions.js';
import { audit } from '../../server/audit.js';
import { buildSnapshot } from '../../server/content/snapshot.js';
const actor = { id: 'existing', displayName: 'Existing owner' }, now = new Date('2026-11-09T12:00:00Z');
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const clean of cleanup.splice(0)) await clean(); });
async function fixture(driver: string) {
  if (driver === 'postgres') { const pg = await postgresFixture(); cleanup.push(pg.cleanup); return pg.store; }
  const root = await mkdtemp(resolve('.cache/media-seed-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const fs = new FsPrimitives(root); return new KvStore(fs, { exclusive: fs.exclusive });
}
async function add(store: Store, doc: Doc) {
  await store.createDoc({ doc, revision: revision(doc, actor, 'created', now, { sealedAt: now.toISOString() }), audit: audit(actor, 'content.create', { collection: doc.collection, docId: doc.id }, now) });
}
async function initialize(store: Store) {
  const seeds = await loadSeed();
  // Model an existing production store with all ten store media and edited site
  // content, but without the original sixteen site media records.
  const docs = seeds.filter(d => d.collection === 'media' && d.id.startsWith('media_shop_') || d.id === seeds.find(item => item.collection === 'events')!.id);
  const home = docs.find(d => d.collection === 'events')!;
  home.draft = { ...home.draft as object, title: 'Keep my draft' };
  for (const doc of docs) await add(store, doc);
  const manifest = await Promise.all(docs.map(async doc => ({ collection: doc.collection, id: doc.id, version: doc.version,
    order: doc.order ?? 0, title: doc.id, revId: (await store.listRevisions(doc.collection, doc.id, 10))[0].id })));
  // Use revisions for the original published copy when draft != published.
  home.draft = home.published;
  // The home draft stored above is deliberately not published by this operation.
  // Store publication requires manifest revision data to match, so its live
  // revision is included explicitly while its pending draft remains untouched.
  const liveRevision = revision(home, actor, 'published', now, { sealedAt: now.toISOString(), publishSiteVersion: 1 });
  manifest.find(entry => entry.id === home.id)!.revId = liveRevision.id;
  await store.publish({ docs: [], snapshot: buildSnapshot(docs, { siteVersion: 1, publishedAt: now.toISOString(), templateHash: 'existing' }, manifest),
    revisions: [liveRevision], record: { siteVersion: 1, at: now.toISOString(), actorId: actor.id, kind: 'publish', manifest }, audit: [audit(actor, 'content.publish', {}, now)] });
  await store.putUser({ id: actor.id, username: 'Existing', displayName: actor.displayName, role: 'Owner', active: true, passwordHash: 'unchanged', createdAt: now.toISOString(), createdBy: 'system' });
  await store.putSession({ hash: 'existing-session', userId: actor.id, createdAt: now.toISOString(), lastSeenAt: now.toISOString(), expiresAt: '2099-01-01T00:00:00Z', csrfToken: 'existing-csrf' });
  return docs;
}
async function state(store: Store) {
  const capture = await store.capturePublication();
  return { ...capture, users: await store.listUsers(), session: await store.getSession('existing-session'), publishes: await store.listPublishes(100),
    audits: (await store.queryAudit({ limit: 1000 })).items, revisions: await Promise.all(capture.docs.map(doc => store.listRevisions(doc.collection, doc.id, 100))) };
}
for (const driver of ['fs', 'postgres']) describe.skipIf(driver === 'postgres' && !process.env.DATABASE_URL)(`static media seed (${driver})`, () => {
  it('adds only missing records, publishes only those, preserves content/users/history and repeats without writes', async () => {
    const store = await fixture(driver); await initialize(store);
    const before = await state(store), publish = vi.spyOn(store, 'publish');
    expect(before.docs.filter(d => d.collection === 'media')).toHaveLength(10);
    expect(await seedStaticMedia(store)).toEqual({ created: 16, published: 16, preserved: 10, siteVersion: 2 });
    const after = await state(store);
    for (const [i, doc] of before.docs.entries()) {
      expect(after.docs.find(d => d.id === doc.id)).toEqual(doc);
      expect(await store.listRevisions(doc.collection, doc.id, 100)).toEqual(before.revisions[i]);
      expect(after.snapshot!.docs[doc.collection]?.find(d => d.id === doc.id)).toEqual(before.snapshot!.docs[doc.collection]?.find(d => d.id === doc.id));
    }
    expect(after.users).toEqual(before.users); expect(after.session).toEqual(before.session);
    expect(after.audits).toEqual(expect.arrayContaining(before.audits)); expect(after.publishes).toEqual(expect.arrayContaining(before.publishes));
    expect(publish.mock.calls[0][0].docs.every(item => item.nextDoc.collection === 'media' && !before.docs.some(d => d.id === item.nextDoc.id))).toBe(true);
    expect(after.audits.filter(a => !before.audits.some(b => a.id === b.id)).every(a => a.actorId === 'seed' && a.meta?.source === 'seed:media')).toBe(true);
    publish.mockClear(); expect(await seedStaticMedia(store)).toEqual({ created: 0, published: 0, preserved: 26, siteVersion: 2 });
    expect(publish).not.toHaveBeenCalled(); expect(await state(store)).toEqual(after);
  }, 30000);
  it('resumes interrupted creations but preserves existing edited, unpublished and trashed static media', async () => {
    const store = await fixture(driver); await initialize(store);
    const seed = (await loadSeed()).find(d => d.id === 'med_about')!;
    await add(store, { ...seed, draft: { ...seed.draft as object, alt: 'Keep this custom alt' }, published: undefined, publishedVersion: undefined, status: 'trashed', trashedAt: now.toISOString() });
    const preserved = await store.getDoc('media', seed.id), create = store.createDoc.bind(store); let count = 0;
    const spy = vi.spyOn(store, 'createDoc').mockImplementation(async input => { const doc = await create(input); if (++count === 3) throw new Error('Interrupted'); return doc; });
    await expect(seedStaticMedia(store)).rejects.toThrow('Interrupted'); spy.mockRestore();
    expect(await seedStaticMedia(store)).toMatchObject({ created: 12, published: 15, preserved: 11 });
    expect(await store.getDoc('media', seed.id)).toEqual(preserved);
    expect((await store.getSnapshot())!.docs.media!.some(d => d.id === seed.id)).toBe(false);
  }, 30000);
  it('refuses concurrent edits to new media instead of publishing them and retains the prior snapshot', async () => {
    const store = await fixture(driver); await initialize(store); const snapshot = await store.getSnapshot(), commit = store.publish.bind(store);
    vi.spyOn(store, 'publish').mockImplementationOnce(async tx => {
      const current = (await store.getDoc('media', 'med_about'))!, draft = { ...current.draft as object, alt: 'Concurrent editor' };
      await store.mutateDoc({ collection: 'media', id: current.id, expectedVersion: current.version, patch: { draft }, revision: { append: revision({ ...current, draft, version: current.version + 1 }, actor, 'edited', now) }, audit: audit(actor, 'media.edit', {}, now) });
      return commit(tx);
    });
    await expect(seedStaticMedia(store)).rejects.toThrow('version conflict');
    expect(await store.getSnapshot()).toEqual(snapshot);
    expect((await store.getDoc('media', 'med_about'))!.draft).toHaveProperty('alt', 'Concurrent editor');
  }, 30000);
  it('recovers a lost publication response without duplicate writes or publications', async () => {
    const store = await fixture(driver); await initialize(store);
    const commit = store.publish.bind(store);
    vi.spyOn(store, 'publish').mockImplementationOnce(async tx => { await commit(tx); throw new Error('Response lost'); });
    await expect(seedStaticMedia(store)).rejects.toThrow('Response lost');
    const after = await state(store);
    expect(await seedStaticMedia(store)).toEqual({ created: 0, published: 0, preserved: 26, siteVersion: 2 });
    expect(await state(store)).toEqual(after);
  }, 30000);
  it('requires initialized publication history', async () => {
    const store = await fixture(driver); await expect(seedStaticMedia(store)).rejects.toThrow('initialized store');
    expect(await store.listAllDocs()).toEqual([]);
  });
});
if (!process.env.DATABASE_URL) console.info('Postgres static media seed contract: not run (no env)');
