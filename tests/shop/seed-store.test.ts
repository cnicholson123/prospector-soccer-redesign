import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSeed } from '../../scripts/seed.js';
import { isStoreSeed, seedStoreShowcase } from '../../scripts/seed-store.js';
import { FsPrimitives } from '../../server/store/primitives/fs.js';
import { KvStore } from '../../server/store/kv-store.js';
import type { Doc, Store } from '../../server/store/types.js';
import { postgresFixture } from '../helpers/postgres.js';
import { audit } from '../../server/audit.js';
import { revision } from '../../server/content/revisions.js';
import { buildSnapshot } from '../../server/content/snapshot.js';
import { publishDocuments } from '../../server/content/publish.js';
import { scheduleDocuments } from '../../server/content/schedule.js';
import { createRenderHandler } from '../../server/render/handler.js';
import { loadConfig } from '../../server/config.js';

const actor = { id: 'owner', displayName: 'Existing owner' };
const now = new Date('2026-11-09T12:00:00Z');
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture(driver: string) {
  let failPublish = false;
  const inject = () => { if (failPublish) { failPublish = false; throw new Error('Injected publication interruption'); } };
  let store: Store;
  if (driver === 'postgres') {
    const f = await postgresFixture({ afterWrite: table => { if (table === 'snapshots') inject(); } });
    store = f.store; cleanups.push(f.cleanup);
  } else {
    const root = await mkdtemp(join(tmpdir(), 'psc-store-seed-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const fs = new FsPrimitives(root), put = fs.put.bind(fs);
    fs.put = async (key, value) => { await put(key, value); if (key === 'snapshot/published.json') inject(); };
    store = new KvStore(fs, { exclusive: fs.exclusive });
  }
  return { store, interruptPublish: () => { failPublish = true; } };
}
async function add(store: Store, doc: Doc) {
  await store.createDoc({ doc, revision: revision(doc, actor, 'created', now, { sealedAt: now.toISOString() }),
    audit: audit(actor, 'content.create', { collection: doc.collection, docId: doc.id }, now) });
}
async function legacy(store: Store) {
  const docs = (await loadSeed()).filter(doc => !isStoreSeed(doc));
  expect(docs).toHaveLength(111);
  for (const doc of docs) await add(store, doc);
  const manifest = await Promise.all(docs.map(async doc => ({ collection: doc.collection, id: doc.id,
    version: doc.version, order: doc.order ?? 0, title: doc.id,
    revId: (await store.listRevisions(doc.collection, doc.id, 10))[0].id })));
  await store.publish({ docs: [], snapshot: buildSnapshot(docs, { siteVersion: 1, publishedAt: now.toISOString(), templateHash: 'legacy' }, manifest),
    record: { siteVersion: 1, at: now.toISOString(), actorId: actor.id, kind: 'publish', manifest },
    audit: [audit(actor, 'content.publish', {}, now)] });
}
async function state(store: Store) {
  const { docs, snapshot } = await store.capturePublication();
  return { docs, snapshot, revisions: await Promise.all(docs.map(doc => store.listRevisions(doc.collection, doc.id, 1000))),
    audits: (await store.queryAudit({ limit: 1000 })).items, publishes: await store.listPublishes(1000),
    users: await store.listUsers(), session: await store.getSession('existing-session'), meta: await store.getMeta('existing-meta') };
}
async function edit(store: Store, doc: Doc, patch: Partial<Doc>) {
  const next = { ...doc, ...patch, version: doc.version + 1 };
  const changed = await store.mutateDoc({ collection: doc.collection, id: doc.id, expectedVersion: doc.version, patch,
    revision: { append: revision(next, actor, 'edited', now, { sealedAt: now.toISOString() }) }, audit: audit(actor, 'content.edit', {}, now) });
  if (changed === 'conflict') throw new Error('Fixture conflict');
  return changed;
}
if (!process.env.DATABASE_URL) console.info('Store seed Postgres contract: not run (no env)');
for (const driver of ['fs', 'postgres']) describe.skipIf(driver === 'postgres' && !process.env.DATABASE_URL)(`Store-only seed contract (${driver})`, () => {
  it('adds and publishes 34 store docs to the original 111, preserves live edits and history, and repeats without writes', async () => {
    const { store } = await fixture(driver); await legacy(store);
    const home = (await store.getDoc('home', 'home'))!;
    const homeData = home.draft as { hero: Record<string, unknown> };
    const changed = await edit(store, home, { draft: { ...homeData, hero: { ...homeData.hero, lead: 'Retain this published edit' } } });
    await publishDocuments(store, [{ collection: 'home', id: home.id, expectedVersion: changed.version }], actor, now);
    await edit(store, (await store.getDoc('home', home.id))!, { draft: { ...homeData, hero: { ...homeData.hero, lead: 'Retain this pending draft' } } });
    const events = await store.listDocs('events');
    await edit(store, events[0], { status: 'trashed', trashedAt: now.toISOString(), trashedBy: actor.id });
    await scheduleDocuments(store, [{ collection: 'events', id: events[1].id, expectedVersion: events[1].version }], '2099-01-01T00:00:00.000Z', actor, now);
    await store.putUser({ id: actor.id, username: 'Owner', displayName: actor.displayName, role: 'Owner',
      active: true, passwordHash: 'unchanged-test-hash', createdAt: now.toISOString(), createdBy: 'system' });
    await store.putSession({ hash: 'existing-session', userId: actor.id, createdAt: now.toISOString(), lastSeenAt: now.toISOString(),
      expiresAt: '2099-01-01T00:00:00.000Z', csrfToken: 'unchanged-csrf' });
    await store.setMeta('existing-meta', { keep: true });
    const before = await state(store), publish = vi.spyOn(store, 'publish');
    await expect(seedStoreShowcase(store)).resolves.toEqual({ created: 34, published: 34, preserved: 0, siteVersion: before.snapshot!.siteVersion + 1 });
    const after = await state(store);
    expect(after.docs.filter(doc => !isStoreSeed(doc))).toEqual(before.docs);
    expect(after.snapshot!.scheduled).toEqual(before.snapshot!.scheduled);
    expect(after.snapshot!.effectiveAt).toEqual(before.snapshot!.effectiveAt);
    expect(after.snapshot!.templateHash).toBe(before.snapshot!.templateHash);
    expect(after.snapshot!.media).toMatchObject(before.snapshot!.media);
    for (const [index, doc] of before.docs.entries()) {
      expect(await store.listRevisions(doc.collection, doc.id, 1000)).toEqual(before.revisions[index]);
      expect(after.snapshot!.docs[doc.collection]?.find(item => item.id === doc.id)).toEqual(before.snapshot!.docs[doc.collection]?.find(item => item.id === doc.id));
    }
    expect(after.audits).toEqual(expect.arrayContaining(before.audits));
    expect(after.publishes).toEqual(expect.arrayContaining(before.publishes));
    expect(after.users).toEqual(before.users); expect(after.session).toEqual(before.session); expect(after.meta).toEqual(before.meta);
    const tx = publish.mock.calls[0][0];
    expect(tx.docs).toHaveLength(34); expect(tx.docs.every(item => isStoreSeed(item.nextDoc))).toBe(true);
    expect(tx.revisions).toHaveLength(34); expect(tx.revisions!.every(rev => rev.authorId === 'seed' && rev.sealedAt && rev.action === 'published')).toBe(true);
    expect(tx.audit![0]).toMatchObject({ actorId: 'seed', action: 'content.publish', meta: { source: 'seed:store' } });
    expect(tx.audit![0].meta!.items).toHaveLength(34);
    const prior = before.publishes[0].manifest;
    expect(tx.record.manifest.filter(item => prior.some(old => old.id === item.id))).toEqual(prior);
    const render = createRenderHandler(store, loadConfig({ SESSION_SECRET: 's'.repeat(32) }, () => {}));
    for (const path of ['/shop', '/shop/p/crest-hoodie', '/shop/b/coach-kit', '/shop/c/apparel']) expect((await render(new Request(`http://localhost:3000${path}`))).status).toBe(200);
    expect(await (await render(new Request('http://localhost:3000/shop/checkout'))).text()).not.toContain('<form');
    publish.mockClear();
    await expect(seedStoreShowcase(store)).resolves.toEqual({ created: 0, published: 0, preserved: 34, siteVersion: after.snapshot!.siteVersion });
    expect(publish).not.toHaveBeenCalled(); expect(await state(store)).toEqual(after);
  }, 60000);

  it('preserves existing store edits, disabled settings and trash as well as legacy content', async () => {
    const { store } = await fixture(driver); await legacy(store);
    const seeds = (await loadSeed()).filter(isStoreSeed);
    const settings = seeds.find(doc => doc.collection === 'storeSettings')!;
    const draft = { ...settings.draft as object, enabled: false, announcement: 'Keep this live choice' };
    await add(store, { ...settings, draft, published: undefined, publishedVersion: undefined, status: 'draft' });
    await publishDocuments(store, [{ collection: settings.collection, id: settings.id, expectedVersion: 1 }], actor, now);
    const faq = seeds.find(doc => doc.collection === 'faqs')!;
    await add(store, { ...faq, published: undefined, publishedVersion: undefined, status: 'trashed', trashedAt: now.toISOString() });
    const settingsBefore = await store.getDoc(settings.collection, settings.id), faqBefore = await store.getDoc(faq.collection, faq.id);
    await expect(seedStoreShowcase(store)).resolves.toMatchObject({ created: 32, published: 32, preserved: 2 });
    expect(await store.getDoc(settings.collection, settings.id)).toEqual(settingsBefore);
    expect(await store.getDoc(faq.collection, faq.id)).toEqual(faqBefore);
    expect((await store.getSnapshot())!.docs.storeSettings![0].data).toEqual(draft);
    expect((await store.getSnapshot())!.docs.faqs!.some(doc => doc.id === faq.id)).toBe(false);
  }, 60000);

  it('refuses incompatible existing draft dependencies before writing, without publishing them', async () => {
    const { store } = await fixture(driver); await legacy(store);
    const product = (await loadSeed()).find(doc => doc.id === 'prod_hoodie')!;
    await add(store, { ...product, published: undefined, publishedVersion: undefined, status: 'draft' });
    const before = await state(store);
    await expect(seedStoreShowcase(store)).rejects.toThrow('published, non-trashed products');
    expect(await state(store)).toEqual(before);
  }, 60000);

  it('resumes an interrupted creation using only its own untouched drafts', async () => {
    const { store } = await fixture(driver); await legacy(store);
    const create = store.createDoc.bind(store); let count = 0;
    const spy = vi.spyOn(store, 'createDoc').mockImplementation(async input => {
      const result = await create(input); if (++count === 3) throw new Error('Injected creation interruption'); return result;
    });
    await expect(seedStoreShowcase(store)).rejects.toThrow('Injected creation'); spy.mockRestore();
    await expect(seedStoreShowcase(store)).resolves.toMatchObject({ created: 31, published: 34, preserved: 0 });
    for (const doc of (await store.capturePublication()).docs.filter(isStoreSeed)) {
      const history = await store.listRevisions(doc.collection, doc.id, 10);
      expect(history.map(rev => rev.action).sort()).toEqual(['created', 'published']);
      expect(history.every(rev => rev.authorId === 'seed')).toBe(true);
    }
  }, 60000);

  it('retains a concurrent non-store draft edit without writing that document during publication', async () => {
    const { store } = await fixture(driver); await legacy(store);
    const commit = store.publish.bind(store);
    let changed: Doc | undefined;
    vi.spyOn(store, 'publish').mockImplementationOnce(async tx => {
      const home = (await store.getDoc('home', 'home'))!;
      const data = home.draft as { hero: Record<string, unknown> };
      changed = await edit(store, home, { draft: { ...data, hero: { ...data.hero, lead: 'Saved while store seed was running' } } });
      return commit(tx);
    });
    await expect(seedStoreShowcase(store)).resolves.toMatchObject({ created: 34, published: 34 });
    expect(await store.getDoc('home', 'home')).toEqual(changed);
    expect((await store.getSnapshot())!.docs.home![0].data).toEqual(changed!.published);
  }, 60000);

  it('refuses a concurrent edit to a new store draft instead of publishing or reverting it', async () => {
    const { store } = await fixture(driver); await legacy(store);
    const before = await store.getSnapshot(), commit = store.publish.bind(store);
    let changed: Doc | undefined;
    vi.spyOn(store, 'publish').mockImplementationOnce(async tx => {
      const product = (await store.getDoc('products', 'prod_hoodie'))!;
      changed = await edit(store, product, { draft: { ...product.draft as object, name: 'Editor changed this before publication' } });
      return commit(tx);
    });
    await expect(seedStoreShowcase(store)).rejects.toThrow('version conflict');
    expect(await store.getDoc('products', 'prod_hoodie')).toEqual(changed);
    expect(await store.getSnapshot()).toEqual(before);
    expect(changed!.published).toBeUndefined();
  }, 60000);

  it('recovers a publication interruption with no duplicate publication or legacy changes', async () => {
    const f = await fixture(driver); await legacy(f.store);
    const before = await state(f.store); f.interruptPublish();
    await expect(seedStoreShowcase(f.store)).rejects.toThrow('Injected publication');
    await seedStoreShowcase(f.store);
    const after = await state(f.store);
    expect(after.docs.filter(doc => !isStoreSeed(doc))).toEqual(before.docs);
    expect(after.snapshot!.siteVersion).toBe(2); expect(after.publishes).toHaveLength(2);
    expect(after.docs.filter(isStoreSeed)).toHaveLength(34);
    expect(after.audits.filter(entry => entry.actorId === 'seed' && entry.action === 'content.publish')).toHaveLength(1);
    expect(after.docs.filter(isStoreSeed).every(doc => doc.status === 'published')).toBe(true);
  }, 60000);

  it('requires initialization instead of implicitly seeding the rest of the site', async () => {
    const { store } = await fixture(driver);
    await expect(seedStoreShowcase(store)).rejects.toThrow('initialized store');
    expect((await store.capturePublication()).docs).toEqual([]);
  });
});
