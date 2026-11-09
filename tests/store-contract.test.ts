import { generatedPassword } from './helpers/password.js';
import { hashPassword } from '../server/auth/password.js';
import { postgresFixture } from './helpers/postgres.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { FsPrimitives } from '../server/store/primitives/fs.js';
import { KvStore } from '../server/store/kv-store.js';
import { createStore, createMediaBlobs } from '../server/store/index.js';
import { loadConfig } from '../server/config.js';
import { createHistoryId } from '../server/content/ids.js';
import { buildSnapshot } from '../server/content/snapshot.js';
import type { AuditEntry, CreateDoc, Doc, DocMutation, KvPrimitives, PublishTx, Revision, Store, User } from '../server/store/types.js';

const at = '2026-11-09T18:00:00.000Z';
const doc = (id = 'evt_a', order = 0): Doc => ({ id, collection: 'events', draft: { title: id, date: '2026-11-09' }, version: 1, order, status: 'draft', createdAt: at, updatedAt: at, createdBy: 'usr_a', updatedBy: 'usr_a' });
const audit = (id = createHistoryId('aud', new Date(at))): AuditEntry => ({ id, at, actorId: 'usr_a', actorName: 'Phil', action: 'content.edit', collection: 'events', docId: 'evt_a', targetTitle: 'Board meeting' });
const revision = (document: Doc, id = createHistoryId('rev', new Date(at))): Revision => ({ id, collection: document.collection, docId: document.id, docVersion: document.version, authorId: 'usr_a', authorName: 'Phil', at, action: 'edited', data: document.draft });
const creation = (document = doc()): CreateDoc => ({ doc: document, revision: revision(document), audit: audit() });
const mutation = (expectedVersion = 1, title = 'Edited', id = 'evt_a'): DocMutation => ({ collection: 'events', id, expectedVersion, patch: { draft: { title, date: '2026-11-09' } },
  revision: { append: revision({ ...doc(id), version: expectedVersion + 1, draft: { title, date: '2026-11-09' } }) }, audit: audit() });
const user = (id = 'usr_a', username = 'Phil'): User => ({ id, username, displayName: username, role: 'Owner', active: true, passwordHash: 'test-placeholder', createdAt: at, createdBy: 'system' });
function publishTx(document: Doc, siteVersion = 1, increment = false): PublishTx {
  const nextDoc: Doc = { ...document, version: document.version + 1, published: document.draft, publishedVersion: document.version + 1, status: 'published' };
  const rev = { ...revision(nextDoc), sealedAt: at };
  return { docs: [{ expectedVersion: document.version, nextDoc }],
    snapshot: buildSnapshot([nextDoc], { siteVersion, publishedAt: at, templateHash: 'test' }),
    record: { siteVersion, at, actorId: 'usr_a', kind: increment ? 'restore' : 'publish', manifest: [{ collection: nextDoc.collection, id: nextDoc.id, version: nextDoc.version, order: nextDoc.order ?? 0, title: nextDoc.id, revId: rev.id }] },
    revisions: [rev], audit: [audit()] };
}

/** Run this same contract against Postgres when Phase 6 supplies the adapter. */
export function storeContract(name: string, setup: () => Promise<{ store: Store; reopen: () => Store; cleanup: () => Promise<void>; advance: (ms: number) => void }>): void {
  describe(name, () => {
    let store: Store; let reopen: () => Store; let cleanup: () => Promise<void>; let advance: (ms: number) => void;
    beforeEach(async () => { ({ store, reopen, cleanup, advance } = await setup()); });
    afterEach(async () => { await cleanup?.(); });
    it('bootstraps missing users once across instances without overwriting accounts', async () => {
      const passwordHash = await hashPassword(generatedPassword());
      const entries = ['Phil', 'Chris'].map((name, index) => ({ user: { ...user(`usr_boot${index}`, name), passwordHash }, audit: { ...audit(), action: 'system.bootstrap' } }));
      const counts = await Promise.all([store.bootstrapUsers(entries), reopen().bootstrapUsers(entries)]);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
      expect(await store.listUsers()).toHaveLength(2);
      expect(await store.bootstrapUsers(entries.map(entry => ({ ...entry, user: { ...entry.user, role: 'Viewer' }, audit: { ...audit(), action: 'system.bootstrap' } })))).toBe(0);
      expect((await store.listUsers()).every(u => u.role === 'Owner')).toBe(true);
      expect((await store.queryAudit({ action: 'system.bootstrap', limit: 10 })).items).toHaveLength(2);
    });
    it('preserves renamed bootstrap identities and rejects adding environment accounts later', async () => {
      const original = user('usr_boot', 'Initial');
      await store.bootstrapUsers([{ user: original, audit: audit() }]);
      await store.changeUser({ ...original, username: 'Renamed' }, original.id, audit(), original);
      expect(await reopen().bootstrapUsers([{ user: user('usr_new', 'Initial'), audit: audit() }])).toBe(0);
      expect((await store.listUsers()).map(u => u.username)).toEqual(['Renamed']);
    });
    it('atomically accumulates weighted byte reservations across instances and expires the window', async () => {
      const results = await Promise.all([store.rateLimitHit('bytes-user', 86400, 60), reopen().rateLimitHit('bytes-user', 86400, 60)]);
      expect(results.map(r => r.count).sort((a, b) => a - b)).toEqual([60, 120]);
      expect((await store.rateLimitHit('bytes-other', 86400, 25)).count).toBe(25);
      advance(86400001);
      expect((await store.rateLimitHit('bytes-user', 86400, 10)).count).toBe(10);
    });
    it('creates with history and audit, orders, trashes and persists documents', async () => {
      const first = creation(doc('evt_b', 2));
      await store.createDoc(first); await store.createDoc(creation(doc('evt_a', 1)));
      expect(await store.getRevision(first.doc.id, first.revision.id)).toEqual(first.revision);
      expect((await store.queryAudit({ limit: 10 })).items).toHaveLength(2);
      expect((await store.listDocs('events')).map(d => d.id)).toEqual(['evt_a', 'evt_b']);
      await expect(store.createDoc(creation())).rejects.toThrow('exists');
      await store.mutateDoc({ ...mutation(), patch: { status: 'trashed', trashedAt: at }, revision: undefined });
      expect((await store.listDocs('events')).map(d => d.id)).toEqual(['evt_b']);
      expect(await store.listDocs('events', { includeTrashed: true })).toHaveLength(2);
      expect(await reopen().getDoc('events', 'evt_b')).toEqual(first.doc);
    });
    it('paginates global revisions deterministically and includes publication targets in audit filters', async () => {
      const first = creation(doc('evt_one')), second = creation(doc('evt_two'));
      second.revision.authorId = 'usr_b';
      await store.createDoc(first); await store.createDoc(second);
      const all = await store.queryRevisions({ limit: 1 });
      expect(all.items).toHaveLength(1); expect(all.cursor).toBeTruthy();
      const next = await store.queryRevisions({ limit: 1, cursor: all.cursor });
      expect(next.items).toHaveLength(1); expect(next.items[0].id).not.toBe(all.items[0].id);
      expect((await store.queryRevisions({ limit: 10, authorId: 'usr_b', collection: 'events' })).items.map(r => r.docId)).toEqual(['evt_two']);
      expect((await store.queryRevisions({ limit: 10, collection: 'home' })).items).toEqual([]);
      await expect(store.queryRevisions({ limit: 10, cursor: 'rev_missing' })).rejects.toThrow('cursor');
      const entry = { ...audit(), action: 'content.publish', collection: undefined, docId: undefined, meta: { items: [{ collection: 'events', id: 'evt_one' }] } };
      await store.recordAudit(entry);
      expect((await store.queryAudit({ limit: 10, actionGroup: 'content', action: 'content.publish', collection: 'events', docId: 'evt_one' })).items).toEqual([entry]);
      expect((await store.queryAudit({ limit: 10, actionGroup: 'auth' })).items).toEqual([]);
    });
    it('requires audit and matching revision on creation', async () => {
      const input = creation();
      await expect(store.createDoc({ ...input, revision: { ...input.revision, docId: 'wrong' } })).rejects.toThrow('identity');
      await expect(store.createDoc({ ...input, audit: undefined as unknown as AuditEntry })).rejects.toThrow('Audit');
      expect(await store.getDoc('events', 'evt_a')).toBeNull();
    });
    it('enforces CAS and protects identity and creation metadata', async () => {
      await store.createDoc(creation());
      const request = mutation(); request.patch = { ...request.patch, id: 'evil', collection: 'teams', version: 100, createdBy: 'evil' };
      const updated = await store.mutateDoc(request);
      expect(updated).toMatchObject({ id: 'evt_a', collection: 'events', version: 2, createdBy: 'usr_a' });
      expect(await store.mutateDoc(mutation())).toBe('conflict');
      expect(await store.mutateDoc(mutation(1, 'Missing', 'evt_missing'))).toBe('conflict');
      expect(await reopen().getDoc('events', 'evt_a')).toEqual(updated);
    });
    it('serializes interleaved instances into monotonic history', async () => {
      const first = creation(); await store.createDoc(first);
      const other = reopen();
      const saves = await Promise.all([store.mutateDoc(mutation(1, 'A')), other.mutateDoc(mutation(1, 'B'))]);
      expect(saves.filter(x => x === 'conflict')).toHaveLength(1);
      await other.mutateDoc(mutation(2, 'C'));
      expect((await store.getDoc('events', 'evt_a'))?.version).toBe(3);
      expect((await store.listRevisions('events', 'evt_a', 10)).map(rev => rev.docVersion).sort()).toEqual([1, 2, 3]);
    });
    it('allows exactly one concurrent creation', async () => {
      const results = await Promise.allSettled([store.createDoc(creation()), reopen().createDoc(creation())]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    });
    it('rejects stale or decreasing working revision versions and sealed changes', async () => {
      const first = creation(); await store.createDoc(first);
      const save = mutation(); save.revision = { upsert: { ...first.revision, docVersion: 2, data: save.patch.draft } };
      await store.mutateDoc(save);
      await expect(store.mutateDoc({ ...mutation(2), revision: { upsert: first.revision } })).rejects.toThrow('docVersion');
      const checkpoint = mutation(2, 'Checkpoint'); checkpoint.seal = [first.revision.id];
      await store.mutateDoc(checkpoint);
      expect((await store.getRevision('evt_a', first.revision.id))?.sealedAt).toBeDefined();
      await expect(store.mutateDoc({ ...mutation(3), revision: { upsert: { ...first.revision, docVersion: 4, data: mutation(3).patch.draft } } })).rejects.toThrow('sealed');
      expect(await store.listRevisions('teams', 'evt_a', 10)).toEqual([]);
    });
    it('commits restore-style version increments, order, immutable snapshots and retryable records', async () => {
      await store.createDoc(creation());
      const tx = publishTx({ ...doc(), order: 7 }, 1, true);
      expect(await store.publish(tx)).toEqual({ siteVersion: 1 });
      expect(await reopen().getSnapshot()).toEqual(tx.snapshot);
      expect(await store.getPublish(1)).toEqual(tx.record);
      expect((await store.getDoc('events', 'evt_a'))?.version).toBe(2);
      expect(await store.publish(tx)).toEqual({ siteVersion: 1 });
      await expect(store.publish({ ...tx, record: { ...tx.record, summary: 'Different' } })).rejects.toThrow('conflict');
      const next = publishTx(tx.docs[0].nextDoc, 2);
      await store.publish(next);
      expect((await store.listPublishes(1)).map(p => p.siteVersion)).toEqual([2]);
      expect((await store.listPublishes(10, 2)).map(p => p.siteVersion)).toEqual([1]);
      expect(await store.recoverPublish()).toEqual({ repaired: false, siteVersion: 2 });
    });
    it('rejects stale expectedVersion before any publish changes', async () => {
      await store.createDoc(creation()); await store.mutateDoc(mutation());
      await expect(store.publish(publishTx(doc()))).rejects.toThrow('conflict');
      expect(await store.getSnapshot()).toBeNull(); expect(await store.getPublish(1)).toBeNull();
    });
    it('rejects duplicate and conflicting history before publish writes', async () => {
      const first = creation(); await store.createDoc(first);
      const tx = publishTx(doc()); tx.revisions!.push(tx.revisions![0]);
      await expect(store.publish(tx)).rejects.toThrow('Revision already exists');
      tx.revisions = [{ ...first.revision, data: 'Changed' }];
      await expect(store.publish(tx)).rejects.toThrow('Different content');
      expect(await store.getSnapshot()).toBeNull();
    });
    it('filters and paginates audit with identical timestamps', async () => {
      for (const id of ['a', 'b', 'c', 'd']) await store.createDoc({ ...creation(doc(`evt_${id}`)), audit: audit(`aud_${id}`) });
      const first = await store.queryAudit({ actorId: 'usr_a', limit: 2 });
      expect(first.items.map(a => a.id)).toEqual(['aud_d', 'aud_c']);
      expect((await store.queryAudit({ limit: 2, cursor: first.cursor })).items.map(a => a.id)).toEqual(['aud_b', 'aud_a']);
      expect((await store.queryAudit({ collection: 'events', text: 'BOARD', action: 'content.edit', from: at, to: at, limit: 10 })).items).toHaveLength(4);
      await expect(store.queryAudit({ limit: 0 })).rejects.toThrow('Limit');
    });
    it('indexes usernames case-insensitively and updates rename indexes', async () => {
      await store.putUser(user()); expect(await reopen().getUserByUsername('PHIL')).toEqual(user());
      await expect(store.putUser(user('usr_b', 'phil'))).rejects.toThrow('exists');
      await store.putUser(user('usr_a', 'Philip'));
      expect(await store.getUserByUsername('Phil')).toBeNull(); expect(await store.getUserByUsername('Philip')).toEqual(user('usr_a', 'Philip'));
      expect(await store.listUsers()).toHaveLength(1);
    });
    it('stores, filters and garbage-collects expired sessions', async () => {
      const session = { hash: 'hashed', userId: 'usr_a', createdAt: at, lastSeenAt: at, expiresAt: '2026-12-01T00:00:00Z', csrfToken: 'csrf' };
      await store.putSession(session); await store.putSession({ ...session, hash: 'expired', userId: 'usr_b', expiresAt: at });
      expect(await reopen().getSession('hashed')).toEqual(session); expect(await store.listSessions('usr_a')).toEqual([session]);
      expect(await store.deleteExpiredSessions(at)).toBe(1); expect(await store.deleteExpiredSessions(at)).toBe(0);
      expect(await store.getSession('expired')).toBeNull(); expect(await store.getSession('hashed')).toEqual(session);
      await store.deleteSession('hashed'); expect(await store.getSession('hashed')).toBeNull();
    });
    it('counts concurrent rate-limit hits and expires and resets windows', async () => {
      const other = reopen();
      const hits = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? other : store).rateLimitHit('login:127.0.0.1', 60)));
      expect(hits.map(hit => hit.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
      advance(60_000); expect((await store.rateLimitHit('login:127.0.0.1', 60)).count).toBe(1);
      await store.rateLimitReset('login:127.0.0.1'); expect((await store.rateLimitHit('login:127.0.0.1', 60)).count).toBe(1);
    });
    it('serializes maintenance claims, session refresh and account bookkeeping', async () => {
      expect((await Promise.all([store.claimMaintenance('gc', 3600000, at), reopen().claimMaintenance('gc', 3600000, at)])).filter(Boolean)).toHaveLength(1);
      expect(await store.claimMaintenance('gc', 3600000, '2026-11-09T19:00:00.000Z')).toBe(true);
      expect((await Promise.all([store.bootstrapOwner(user(),audit()),reopen().bootstrapOwner(user('other','Other'),audit())])).filter(Boolean)).toHaveLength(1);
      const owner=(await store.listUsers())[0];
      expect(await store.recordLogin(owner.id,'wrong',false,audit())).toBeNull();
      const logged=await store.recordLogin(owner.id,owner.passwordHash,true,audit());expect(logged?.passwordWeak).toBe(true);
      const changed=await store.changePassword(owner.id,owner.passwordHash,'new-hash',audit());expect(changed?.authVersion).toBe(1);
      expect(await store.changePassword(owner.id,owner.passwordHash,'stale',audit())).toBeNull();
      const session={hash:'refresh',userId:owner.id,createdAt:at,lastSeenAt:at,expiresAt:'2026-11-20T00:00:00.000Z',csrfToken:'csrf'};
      await store.putSession(session);
      const refreshes=await Promise.all([store.refreshSession('refresh','2026-11-09T19:00:00.000Z'),reopen().refreshSession('refresh','2026-11-09T19:00:00.000Z')]);
      expect(refreshes.filter(s=>s?.refreshed)).toHaveLength(1);
      const failures=await Promise.all(Array.from({length:5},()=>reopen().loginFailure('username',at)));
      expect(failures.some(f=>f.locks===1&&f.until==='2026-11-09T18:15:00.000Z')).toBe(true);
      await expect(store.changeUser({...changed!,active:false},owner.id,audit(),changed!)).rejects.toThrow('deactivate your own account');
    });
    it('reorders siblings atomically and seals working revisions without changing their data', async () => {
      const first=creation(doc('evt_a',0)),second=creation(doc('evt_b',1));await store.createDoc(first);await store.createDoc(second);
      const request:DocMutation={collection:'events',id:'evt_a',expectedVersion:1,patch:{order:1},guardVersions:[{id:'evt_b',expectedVersion:2}],relatedOrder:[{id:'evt_b',expectedVersion:1,order:0}],audit:audit()};
      expect(await store.mutateDoc(request)).toBe('conflict');expect((await store.getDoc('events','evt_a'))?.version).toBe(1);
      request.guardVersions=[{id:'evt_b',expectedVersion:1}];await store.mutateDoc(request);
      expect((await store.listDocs('events')).map(d=>[d.id,d.version])).toEqual([['evt_b',2],['evt_a',2]]);
      await store.sealWorkingRevisions('usr_a',at,audit());
      expect((await store.getRevision('evt_a',first.revision.id))?.sealedAt).toBeDefined();
      expect((await store.getRevision('evt_b',second.revision.id))?.data).toEqual(second.doc.draft);
    });
    it('round-trips JSON metadata', async () => {
      expect(await store.getMeta('missing')).toBeNull(); await store.setMeta('link/check', { ok: [true, 2] });
      expect(await reopen().getMeta('link/check')).toEqual({ ok: [true, 2] });
    });
  });
}
storeContract('Store contract: filesystem', async () => {
  await mkdir('.cache', { recursive: true });
  const root = await mkdtemp(resolve('.cache', 'contract-'));
  let now = Date.parse(at);
  const reopen = () => { const fs = new FsPrimitives(root); return new KvStore(fs, { exclusive: fs.exclusive, now: () => new Date(now) }); };
  return { store: reopen(), reopen, cleanup: () => rm(root, { recursive: true, force: true }), advance: ms => { now += ms; } };
});

describe('KV failure recovery, compatibility and bounded reads', () => {
  let root: string; let fs: FsPrimitives; let store: KvStore;
  beforeEach(async () => { root = await mkdtemp(resolve('.cache', 'recovery-')); fs = new FsPrimitives(root); store = new KvStore(fs, { exclusive: fs.exclusive }); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  function failOnce(predicate: (key: string) => boolean, afterWrite = false) {
    let failed = false;
    return new KvStore({ get: key => fs.get(key), list: key => fs.list(key), delete: key => fs.delete(key), put: async (key, value) => {
      if (!failed && predicate(key)) { failed = true; if (afterWrite) await fs.put(key, value); throw new Error('Injected write failure'); }
      await fs.put(key, value);
    } }, { exclusive: fs.exclusive });
  }
  for (const stage of ['meta/pending-mutation', 'revisions/', 'audit/', 'docs/']) for (const afterWrite of [false, true]) {
    it(`keeps history ahead of docs through mutation failure at ${stage}, afterWrite=${afterWrite}`, async () => {
      await store.createDoc(creation());
      const request = mutation();
      await expect(failOnce(key => key.startsWith(stage), afterWrite).mutateDoc(request)).rejects.toThrow('Injected');
      const current = await store.getDoc('events', 'evt_a');
      const revisions = await store.listRevisions('events', 'evt_a', 10);
      expect(Math.max(...revisions.map(rev => rev.docVersion))).toBeGreaterThanOrEqual(current!.version);
      // Replaying the journal first makes a stale retry a conflict, safely.
      const retry = await store.mutateDoc(request);
      expect(retry === 'conflict' || retry.version === 2).toBe(true);
      expect((await store.getDoc('events', 'evt_a'))?.version).toBe(2);
      expect(await store.getRevision('evt_a', 'append' in request.revision! ? request.revision.append.id : '')).toMatchObject({ docVersion: 2 });
    });
  }
  for (const stage of ['meta/pending-publish', 'docs/', 'revisions/', 'audit/', 'publishes/', 'snapshot/']) for (const afterWrite of [false, true]) {
    it(`retries publish at ${stage}, afterWrite=${afterWrite}`, async () => {
      await store.createDoc(creation()); const tx = publishTx(doc(), 1, true);
      await expect(failOnce(key => key.startsWith(stage), afterWrite).publish(tx)).rejects.toThrow('Injected');
      await store.publish(tx);
      expect(await store.getSnapshot()).toEqual(tx.snapshot); expect(await store.getPublish(1)).toEqual(tx.record);
      expect(await store.getDoc('events', 'evt_a')).toEqual(tx.docs[0].nextDoc);
      expect(await store.listPublishes(10)).toHaveLength(1);
    });
    it(`recovers publish at ${stage}, afterWrite=${afterWrite}`, async () => {
      await store.createDoc(creation()); const tx = publishTx(doc(), 1, true);
      await expect(failOnce(key => key.startsWith(stage), afterWrite).publish(tx)).rejects.toThrow('Injected');
      const recovered = await store.recoverPublish();
      if (stage === 'meta/pending-publish' && !afterWrite) { expect(recovered.repaired).toBe(false); await store.publish(tx); }
      else expect(recovered).toEqual({ repaired: true, siteVersion: 1 });
      expect(await store.getSnapshot()).toEqual(tx.snapshot); expect(await store.listPublishes(10)).toHaveLength(1);
      expect(await store.recoverPublish()).toEqual({ repaired: false, siteVersion: 1 });
    });
  }
  it('refuses changed content during a pending publish', async () => {
    await store.createDoc(creation()); const tx = publishTx(doc());
    await expect(failOnce(key => key.startsWith('snapshot/')).publish(tx)).rejects.toThrow();
    await expect(store.publish({ ...tx, record: { ...tx.record, summary: 'Changed' } })).rejects.toThrow('Different content');
    await store.recoverPublish();
  });
  it('rebuilds a pre-journal snapshot from the pending manifest and published fields', async () => {
    await store.createDoc(creation()); const tx = publishTx(doc());
    await store.publish(tx); await fs.delete('snapshot/published.json');
    expect(await store.recoverPublish()).toEqual({ repaired: true, siteVersion: 1 });
    expect((await store.getSnapshot())?.docs).toEqual(tx.snapshot.docs);
    expect((await store.getPublish(1))?.kind).toBe('publish');
  });
  it('looks up one of 500 revisions across 20 docs with at most two reads', async () => {
    const revisions: Revision[] = [];
    for (let index = 0; index < 500; index++) {
      const rev = revision({ ...doc(`evt_${index % 20}`), version: index + 1 }); revisions.push(rev);
      await fs.put(`revisions/${rev.docId}/${rev.id}.json`, rev);
    }
    let reads = 0;
    const measured: KvPrimitives = { get: key => { reads++; return fs.get(key); }, put: (key, value) => fs.put(key, value), list: key => fs.list(key), delete: key => fs.delete(key) };
    const target = revisions[432];
    expect(await new KvStore(measured).getRevision(target.docId, target.id)).toEqual(target);
    expect(reads).toBeLessThanOrEqual(2);
  });
  it('reads legacy revision paths and old snapshots without discarding history', async () => {
    const old = revision(doc(), 'rev_legacy'); await fs.put(`revisions/evt_a/${encodeURIComponent(at)}-rev_legacy.json`, old);
    expect(await store.getRevision('evt_a', 'rev_legacy')).toEqual(old);
    expect(await store.listRevisions('events', 'evt_a', 10)).toEqual([old]);
    const tx = publishTx(doc()); const { schemaVersion, media, ...legacy } = tx.snapshot;
    await fs.put('snapshot/published.json', legacy);
    expect((await store.getSnapshot())?.schemaVersion).toBe(schemaVersion);
    expect((await store.getSnapshot())?.docs).toEqual(tx.snapshot.docs);
  });
  it('replays all bootstrap accounts after a partial FS multi-user write', async () => {
    const original = fs.put.bind(fs);
    let fail = true;
    vi.spyOn(fs, 'put').mockImplementation(async (key, value) => {
      await original(key, value);
      if (fail && key.startsWith('users/')) { fail = false; throw new Error('Interrupted bootstrap'); }
    });
    const entries = ['Phil', 'Chris'].map((name, index) => ({ user: user(`usr_boot_${index}`, name), audit: audit() }));
    await expect(store.bootstrapUsers(entries)).rejects.toThrow('Interrupted bootstrap');
    expect(await store.bootstrapUsers(entries)).toBe(0);
    expect((await store.listUsers()).map(u => u.username).sort()).toEqual(['Chris', 'Phil']);
    expect((await store.queryAudit({ limit: 10 })).items).toHaveLength(2);
  });
  it('recovers legacy manifest order only when its matching snapshot still exists', async () => {
    const tx = publishTx(doc('evt_a', 7));
    const legacy = { ...tx.record, manifest: tx.record.manifest.map(({ order, ...entry }) => entry) };
    await fs.put('publishes/00000001.json', legacy);
    await fs.put('snapshot/published.json', tx.snapshot);
    expect((await store.getPublish(1))?.manifest[0].order).toBe(7);
    await fs.put('snapshot/published.json', { ...tx.snapshot, siteVersion: 2 });
    expect((await store.getPublish(1))?.manifest[0].order).toBe(0);
  });
  it('reads newest audit months without loading older months once the limit is met', async () => {
    for (const month of ['09', '10', '11']) for (let index = 0; index < 3; index++) {
      const entry = { ...audit(`aud_${month}_${index}`), at: `2026-${month}-09T18:00:00.000Z` };
      await fs.put(`audit/2026-${month}/${entry.id}.json`, entry);
    }
    const reads: string[] = [];
    const measured = new KvStore({ get: key => { reads.push(key); return fs.get(key); }, put: (key, value) => fs.put(key, value), list: key => fs.list(key), delete: key => fs.delete(key) });
    expect((await measured.queryAudit({ limit: 2 })).items).toHaveLength(2);
    expect(reads.every(key => key.startsWith('audit/2026-11/'))).toBe(true);
  });
  it('recovers a dead-pid stale lock within one second', async () => {
    await mkdir(join(root, '.store-lock')); await writeFile(join(root, '.store-lock/owner.json'), JSON.stringify({ pid: 2147483647, at: Date.now() - 60_000 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined); const start = Date.now();
    try { await store.createDoc(creation()); expect(Date.now() - start).toBeLessThan(1000); expect(warn).toHaveBeenCalled(); }
    finally { warn.mockRestore(); }
  });
  it('selects only fs locally and rejects the removed blob driver', () => {
    const config = loadConfig({ STORE_DRIVER: 'fs', DATA_DIR: root }, () => undefined);
    expect(createStore(config)).toBeInstanceOf(KvStore);
    expect(() => loadConfig({ STORE_DRIVER: 'blob' })).toThrow('fs | postgres');
    expect(() => createStore({ ...config, storeDriver: 'postgres' })).toThrow('DATABASE_URL');
  });
});
describe('Filesystem primitives and media', () => {
  let root: string;
  beforeEach(async () => { await mkdir('.cache', { recursive: true }); root = await mkdtemp(resolve('.cache', 'primitives-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  it('lists prefixes and round-trips JSON using atomic replacement', async () => {
    const fs = new FsPrimitives(root); await fs.put('meta/a.json', { a: 1 }); await fs.put('meta/a.json', false); await fs.put('other/b.json', 3);
    expect(await fs.get('meta/a.json')).toBe(false); expect(await fs.list('meta')).toEqual(['meta/a.json']); expect(await fs.list('meta/')).toEqual(['meta/a.json']);
    await fs.delete('meta/a.json'); expect(await fs.get('meta/a.json')).toBeNull();
    await expect(fs.put('undefined.json', undefined)).rejects.toThrow('JSON');
    await writeFile(join(root, 'broken.json'), 'not json'); await expect(fs.get('broken.json')).rejects.toThrow();
  });
  it('rejects traversal and symlink escapes for both reads and writes', async () => {
    const fs = new FsPrimitives(root);
    for (const key of ['../escape', '/absolute', 'a/../../escape', 'a\\b', '.hidden']) {
      await expect(fs.put(key, {})).rejects.toThrow(); await expect(fs.get(key)).rejects.toThrow();
    }
    await mkdir(join(root, 'target')); await symlink(join(root, 'target'), join(root, 'link'));
    await expect(fs.put('link/x.json', 1)).rejects.toThrow('symlink');
  });
  it('writes binary and streaming blobs, and deletes only its own URLs', async () => {
    const blobs = createMediaBlobs(loadConfig({ DATA_DIR: root }, () => undefined)); const bytes = new Uint8Array([0, 1, 255]);
    const result = await blobs.put('media/2026/media_a/original.jpg', bytes, { contentType: 'image/jpeg' });
    expect(result.url).toBe('/blobs/media/2026/media_a/original.jpg');
    expect(await readFile(join(root, 'blobs/media/2026/media_a/original.jpg'))).toEqual(Buffer.from(bytes));
    await blobs.put('stream.pdf', new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), { contentType: 'application/pdf' });
    expect(await readFile(join(root, 'blobs/stream.pdf'))).toEqual(Buffer.from(bytes));
    await blobs.delete(result.url); await blobs.delete(result.url);
    await expect(blobs.delete('https://evil.example/file')).rejects.toThrow();
    await expect(blobs.delete('/blobs/%2e%2e/outside')).rejects.toThrow();
    await expect(blobs.put('../escape', bytes, { contentType: 'image/jpeg' })).rejects.toThrow();
  });
});
if (process.env.DATABASE_URL) {
  storeContract('Store contract: Postgres', async () => {
    let now = Date.parse(at);
    const fixture = await postgresFixture({ now: () => new Date(now) });
    return { ...fixture, advance: ms => { now += ms; } };
  });
} else {
  console.info('Postgres contract tests: not run (no env)');
  it.skip('Postgres contract tests: not run (no env)', () => {});
}
