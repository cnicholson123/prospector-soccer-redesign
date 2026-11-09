import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { FsPrimitives } from '../server/store/primitives/fs';
import { FsBlobs } from '../server/store/blobs/fs';
import { KvStore } from '../server/store/kv-store';
import { createStore } from '../server/store';
import { loadConfig } from '../server/config';
import type { AuditEntry, Doc, PublishTx, Revision, Store, User } from '../server/store/types';

const at = '2026-11-09T18:00:00.000Z';
const doc = (id = 'evt_a', order = 0): Doc => ({ id, collection: 'events', draft: { title: id }, version: 1, order, status: 'draft', createdAt: at, updatedAt: at, createdBy: 'usr_a', updatedBy: 'usr_a' });
const revision = (id = 'rev_a'): Revision => ({ id, collection: 'events', docId: 'evt_a', docVersion: 1, authorId: 'usr_a', authorName: 'Phil', at, action: 'edited', data: { title: 'Event' } });
const audit = (id = 'audit_a'): AuditEntry => ({ id, at, actorId: 'usr_a', actorName: 'Phil', action: 'content.edit', collection: 'events', docId: 'evt_a', targetTitle: 'Board meeting' });
const user = (id = 'usr_a', username = 'Phil'): User => ({ id, username, displayName: username, role: 'Owner', active: true, passwordHash: 'test-placeholder', createdAt: at, createdBy: 'system' });
function publishTx(document: Doc, siteVersion = 1): PublishTx {
  return {
    docs: [{ ...document, published: document.draft, publishedVersion: document.version, status: 'published' }],
    snapshot: { siteVersion, publishedAt: at, docs: { events: [{ id: document.id, collection: 'events', data: document.draft, version: document.version }] }, scheduled: [], templateHash: 'test' },
    record: { siteVersion, at, actorId: 'usr_a', kind: 'publish', manifest: [{ collection: 'events', id: document.id, version: document.version, title: 'Event', revId: `rev_${siteVersion}` }] },
  };
}

/** Shared behavioral contract. Phase 6 adapters can invoke this same suite. */
export function storeContract(name: string, setup: () => Promise<{ store: Store; reopen: () => Store; cleanup: () => Promise<void>; advance: (ms: number) => void }>): void {
  describe(name, () => {
    let store: Store; let reopen: () => Store; let cleanup: () => Promise<void>; let advance: (ms: number) => void;
    beforeEach(async () => { ({ store, reopen, cleanup, advance } = await setup()); });
    afterEach(async () => { await cleanup(); });
    it('creates, reads, orders and excludes trashed documents', async () => {
      expect(await store.getDoc('events', 'missing')).toBeNull();
      await store.createDoc(doc('evt_b', 2)); await store.createDoc(doc('evt_a', 1));
      expect((await store.listDocs('events')).map(d => d.id)).toEqual(['evt_a', 'evt_b']);
      await expect(store.createDoc(doc())).rejects.toThrow('exists');
      await expect(store.createDoc({ ...doc(), collection: 'teams' })).rejects.toThrow('exists');
      await store.updateDoc('events', 'evt_a', 1, { status: 'trashed', trashedAt: at });
      expect((await store.listDocs('events')).map(d => d.id)).toEqual(['evt_b']);
      expect(await store.listDocs('events', { includeTrashed: true })).toHaveLength(2);
      expect(await reopen().getDoc('events', 'evt_b')).toEqual(doc('evt_b', 2));
      expect(await store.listDocs('teams')).toEqual([]);
    });
    it('enforces CAS and protects identity and creation metadata', async () => {
      await store.createDoc(doc());
      const updated = await store.updateDoc('events', 'evt_a', 1, { draft: { title: 'New' }, id: 'evil', collection: 'teams', version: 100, createdBy: 'evil' });
      expect(updated).toMatchObject({ id: 'evt_a', collection: 'events', version: 2, createdBy: 'usr_a', draft: { title: 'New' } });
      expect(await store.updateDoc('events', 'evt_a', 1, { draft: {} })).toBe('conflict');
      expect(await store.updateDoc('events', 'missing', 1, {})).toBe('conflict');
      expect(await reopen().getDoc('events', 'evt_a')).toEqual(updated);
    });
    it('allows exactly one concurrent creation and update across store instances', async () => {
      const other = reopen();
      const creates = await Promise.allSettled([store.createDoc(doc()), other.createDoc(doc())]);
      expect(creates.filter(x => x.status === 'fulfilled')).toHaveLength(1);
      const writes = await Promise.all([store.updateDoc('events', 'evt_a', 1, { draft: { title: 'A' } }), other.updateDoc('events', 'evt_a', 1, { draft: { title: 'B' } })]);
      expect(writes.filter(x => x === 'conflict')).toHaveLength(1);
      expect((await store.getDoc('events', 'evt_a'))?.version).toBe(2);
    });
    it('commits snapshots and forward-only publish records', async () => {
      expect(await store.getSnapshot()).toBeNull(); await store.createDoc(doc());
      const tx = publishTx(doc()); tx.revisions = [revision()]; tx.audit = [audit()];
      expect(await store.publish(tx)).toEqual({ siteVersion: 1 });
      expect(await reopen().getSnapshot()).toEqual(tx.snapshot);
      expect(await store.getPublish(1)).toEqual(tx.record);
      expect(await store.getRevision('rev_a')).toEqual(revision());
      expect((await store.queryAudit({ limit: 10 })).items).toEqual([audit()]);
      await expect(store.publish(tx)).rejects.toThrow('conflict');
      await store.publish(publishTx(doc(), 2));
      expect((await store.listPublishes(1)).map(p => p.siteVersion)).toEqual([2]);
      expect((await store.listPublishes(10, 2)).map(p => p.siteVersion)).toEqual([1]);
    });
    it('rejects duplicate IDs inside a publish before any writes', async () => {
      await store.createDoc(doc());
      const tx = publishTx(doc());
      tx.revisions = [revision(), revision()];
      await expect(store.publish(tx)).rejects.toThrow('Revision already exists');
      expect(await store.getRevision('rev_a')).toBeNull();
      tx.revisions = [];
      tx.audit = [audit(), audit()];
      await expect(store.publish(tx)).rejects.toThrow('Audit entry already exists');
      expect((await store.queryAudit({ limit: 10 })).items).toEqual([]);
      expect(await store.getSnapshot()).toBeNull();
    });
    it('rejects a stale publish before changing documents or snapshots', async () => {
      await store.createDoc(doc()); await store.updateDoc('events', 'evt_a', 1, { draft: 'Changed' });
      await expect(store.publish(publishTx(doc()))).rejects.toThrow('conflict');
      expect(await store.getSnapshot()).toBeNull(); expect(await store.getPublish(1)).toBeNull();
      expect((await store.getDoc('events', 'evt_a'))?.draft).toBe('Changed');
    });
    it('keeps revision IDs append-only and sealed revisions immutable', async () => {
      await store.appendRevision(revision());
      await expect(store.appendRevision(revision())).rejects.toThrow('exists');
      const latest = { ...revision(), at: '2026-11-09T18:01:00.000Z', docVersion: 2, data: 'Updated' };
      await store.upsertWorkingRevision(latest);
      expect(await store.listRevisions('events', 'evt_a', 10)).toEqual([latest]);
      await expect(store.upsertWorkingRevision({ ...latest, authorId: 'usr_other' })).rejects.toThrow('identity');
      await store.sealRevision('rev_a');
      const sealed = await store.getRevision('rev_a'); expect(sealed?.sealedAt).toBeDefined();
      await store.sealRevision('rev_a'); expect(await store.getRevision('rev_a')).toEqual(sealed);
      await expect(store.upsertWorkingRevision(latest)).rejects.toThrow('sealed');
      await store.upsertWorkingRevision(revision('rev_b'));
      expect(await store.listRevisions('events', 'evt_a', 1, 'rev_a')).toEqual([revision('rev_b')]);
      expect(await store.listRevisions('teams', 'evt_a', 10)).toEqual([]);
      await expect(store.sealRevision('missing')).rejects.toThrow('not found');
    });
    it('filters and paginates audit with identical timestamps and immutable IDs', async () => {
      for (const id of ['a', 'b', 'c']) await store.appendAudit(audit(id));
      await store.appendAudit({ ...audit('d'), actorId: 'usr_b', action: 'auth.login', collection: undefined, docId: undefined });
      await expect(store.appendAudit({ ...audit('a'), at: '2026-12-01T00:00:00Z' })).rejects.toThrow('exists');
      const first = await store.queryAudit({ actorId: 'usr_a', limit: 2 });
      expect(first.items.map(a => a.id)).toEqual(['c', 'b']); expect(first.cursor).toBe('b');
      expect((await store.queryAudit({ actorId: 'usr_a', limit: 2, cursor: first.cursor })).items.map(a => a.id)).toEqual(['a']);
      expect((await store.queryAudit({ collection: 'events', docId: 'evt_a', text: 'BOARD', action: 'content.edit', from: at, to: at, limit: 10 })).items).toHaveLength(3);
      await expect(store.queryAudit({ limit: 0 })).rejects.toThrow('Limit');
    });
    it('indexes usernames case-insensitively and updates the index on rename', async () => {
      await store.putUser(user()); expect(await reopen().getUserByUsername('PHIL')).toEqual(user());
      await expect(store.putUser(user('usr_b', 'phil'))).rejects.toThrow('exists');
      await store.putUser(user('usr_a', 'Philip'));
      expect(await store.getUserByUsername('Phil')).toBeNull();
      expect(await store.getUserByUsername('Philip')).toEqual(user('usr_a', 'Philip'));
      expect(await store.listUsers()).toHaveLength(1); expect(await store.getUser('missing')).toBeNull();
    });
    it('stores and deletes sessions by hash, filtering by user', async () => {
      const session = { hash: 'hashed', userId: 'usr_a', createdAt: at, lastSeenAt: at, expiresAt: '2026-12-01T00:00:00Z', csrfToken: 'csrf' };
      await store.putSession(session); await store.putSession({ ...session, hash: 'other', userId: 'usr_b' });
      expect(await reopen().getSession('hashed')).toEqual(session); expect(await store.listSessions('usr_a')).toEqual([session]);
      await store.deleteSession('hashed'); await store.deleteSession('missing'); expect(await store.getSession('hashed')).toBeNull();
    });
    it('counts concurrent rate-limit hits and expires and resets windows', async () => {
      const other = reopen();
      const hits = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? other : store).rateLimitHit('login:127.0.0.1', 60)));
      expect(hits.map(hit => hit.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
      advance(60_000); expect((await store.rateLimitHit('login:127.0.0.1', 60)).count).toBe(1);
      await store.rateLimitReset('login:127.0.0.1'); expect((await store.rateLimitHit('login:127.0.0.1', 60)).count).toBe(1);
      await expect(store.rateLimitHit('bad', 0)).rejects.toThrow('positive');
    });
    it('round-trips independent arbitrary JSON meta values', async () => {
      expect(await store.getMeta('missing')).toBeNull();
      await store.setMeta('link/check', { ok: [true, 2, 'text'] });
      expect(await reopen().getMeta('link/check')).toEqual({ ok: [true, 2, 'text'] });
      await store.setMeta('flag', false); expect(await store.getMeta('flag')).toBe(false);
    });
  });
}
storeContract('Store contract: filesystem', async () => {
  await mkdir('.cache', { recursive: true });
  const root = await mkdtemp(resolve('.cache', 'contract-'));
  let now = Date.parse(at);
  const reopen = () => { const primitives = new FsPrimitives(root); return new KvStore(primitives, { exclusive: primitives.exclusive, now: () => new Date(now) }); };
  return { store: reopen(), reopen, cleanup: () => rm(root, { recursive: true, force: true }), advance: ms => { now += ms; } };
});

describe('Filesystem primitives and media', () => {
  let root: string;
  beforeEach(async () => { await mkdir('.cache', { recursive: true }); root = await mkdtemp(resolve('.cache', 'primitives-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  it('lists prefixes and round-trips JSON using atomic replacement', async () => {
    const fs = new FsPrimitives(root); await fs.put('meta/a.json', { a: 1 }); await fs.put('meta/a.json', false); await fs.put('other/b.json', 3);
    expect(await fs.get('meta/a.json')).toBe(false); expect(await fs.list('meta/')).toEqual(['meta/a.json']);
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
    const blobs = new FsBlobs(root); const bytes = new Uint8Array([0, 1, 255]);
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
  it('selects only the supported local driver', async () => {
    const config = loadConfig({ STORE_DRIVER: 'fs', DATA_DIR: root }, () => undefined);
    await createStore(config).createDoc(doc()); expect(await createStore(config).getDoc('events', 'evt_a')).toEqual(doc());
    expect(() => createStore({ ...config, storeDriver: 'blob' })).toThrow('Phase 6');
    expect(() => createStore({ ...config, storeDriver: 'postgres' })).toThrow('Phase 6');
  });
  it('writes the publish snapshot last, leaving the prior snapshot readable on failure', async () => {
    const fs = new FsPrimitives(root); const store = new KvStore(fs, { exclusive: fs.exclusive });
    await store.createDoc(doc()); await store.publish(publishTx(doc()));
    const writes: string[] = [];
    const failing = new KvStore({ get: key => fs.get(key), list: key => fs.list(key), delete: key => fs.delete(key), put: async (key, value) => {
      writes.push(key); if (key === 'snapshot/published.json') throw new Error('simulated disk failure'); await fs.put(key, value);
    } }, { exclusive: fs.exclusive });
    await expect(failing.publish(publishTx(doc(), 2))).rejects.toThrow('disk failure');
    expect(writes.at(-1)).toBe('snapshot/published.json'); expect((await store.getSnapshot())?.siteVersion).toBe(1);
  });
});

// Hosted implementations belong to Phase 6. Never pretend an FS run tested a service.
for (const [name, env] of [['Neon', 'DATABASE_URL'], ['Blob', 'BLOB_READ_WRITE_TOKEN']] as const) {
  const reason = process.env[env] ? 'not run (adapter scheduled for Phase 6)' : 'not run (no env)';
  console.info(`${name} contract tests: ${reason}`);
  it.skip(`${name} contract tests: ${reason}`, () => {});
}
