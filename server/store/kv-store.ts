import type { CollectionName } from '../../shared/schema';
import type { AuditEntry, AuditQuery, Doc, KvPrimitives, PublishRecord, PublishTx, Revision, RunExclusive, Session, Snapshot, Store, User } from './types';

const part = (value: string): string => {
  if (!value || value === '.' || value === '..') throw new Error('Empty or invalid storage identifier');
  return encodeURIComponent(value).replace(/\./g, '%2E');
};
const docKey = (collection: CollectionName, id: string) => `docs/${part(collection)}/${part(id)}.json`;
const revKey = (rev: Revision) => `revisions/${part(rev.docId)}/${part(rev.at)}-${part(rev.id)}.json`;
const auditKey = (entry: AuditEntry) => `audit/${entry.at.slice(0, 7)}/${part(entry.at)}-${part(entry.id)}.json`;
const publishKey = (version: number) => {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid site version');
  return `publishes/${String(version).padStart(8, '0')}.json`;
};
const pageLimit = (limit: number) => { if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Limit must be 1–1000'); return limit; };
/** Blob primitives have no CAS. The default queue only serializes this instance.
 * FS supplies a cross-process lock; Postgres will supply native transactions.
 * Multi-key KV publish is intentionally snapshot-last, not crash-atomic.
 */
export class KvStore implements Store {
  private queue: Promise<unknown> = Promise.resolve();
  private exclusive: RunExclusive;
  constructor(private kv: KvPrimitives, options: { exclusive?: RunExclusive; now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
    this.exclusive = options.exclusive ?? (async <T>(operation: () => Promise<T>): Promise<T> => {
      const next = this.queue.then(operation, operation);
      this.queue = next.catch(() => undefined);
      return next;
    });
  }
  private now: () => Date;
  private async read<T>(key: string): Promise<T | null> { return await this.kv.get(key) as T | null; }
  private async all<T>(prefix: string): Promise<T[]> {
    const values = await Promise.all((await this.kv.list(prefix)).map(key => this.read<T>(key)));
    return values.filter((value): value is Awaited<T> => value !== null);
  }
  getDoc(collection: CollectionName, id: string) { return this.read<Doc>(docKey(collection, id)); }
  async listDocs(collection: CollectionName, opts: { includeTrashed?: boolean } = {}): Promise<Doc[]> {
    const docs = await this.all<Doc>(`docs/${part(collection)}/`);
    return docs.filter(doc => opts.includeTrashed || (!doc.trashedAt && doc.status !== 'trashed'))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  }
  createDoc(doc: Doc): Promise<Doc> {
    return this.exclusive(async () => {
      const key = docKey(doc.collection, doc.id);
      // Match the global docs(id) primary key of the future Postgres adapter.
      if ((await this.all<Doc>('docs/')).some(existing => existing.id === doc.id)) throw new Error('Document already exists');
      if (doc.version !== 1) throw new Error('New document version must be 1');
      await this.kv.put(key, doc); return structuredClone(doc);
    });
  }
  updateDoc(collection: CollectionName, id: string, expectedVersion: number, patch: Partial<Doc>): Promise<Doc | 'conflict'> {
    return this.exclusive(async () => {
      const current = await this.getDoc(collection, id);
      if (!current || current.version !== expectedVersion) return 'conflict';
      const doc = { ...current, ...patch, id: current.id, collection: current.collection,
        createdAt: current.createdAt, createdBy: current.createdBy, version: expectedVersion + 1 };
      await this.kv.put(docKey(collection, id), doc); return structuredClone(doc);
    });
  }
  getSnapshot() { return this.read<Snapshot>('snapshot/published.json'); }
  publish(tx: PublishTx): Promise<{ siteVersion: number }> {
    return this.exclusive(async () => {
      const current = await this.getSnapshot();
      const siteVersion = (current?.siteVersion ?? 0) + 1;
      if (tx.snapshot.siteVersion !== siteVersion || tx.record.siteVersion !== siteVersion) throw new Error('Publish version conflict');
      if (await this.getPublish(siteVersion)) throw new Error('Publish record already exists; rebuild snapshot before retrying');
      const seen = new Set<string>();
      for (const doc of tx.docs) {
        const key = docKey(doc.collection, doc.id);
        if (seen.has(key)) throw new Error('Duplicate publish document');
        seen.add(key);
        const stored = await this.getDoc(doc.collection, doc.id);
        if (!stored || stored.version !== doc.version) throw new Error('Document version conflict');
      }
      const revisionIds = new Set<string>();
      for (const rev of tx.revisions ?? []) {
        if (revisionIds.has(rev.id) || await this.getRevision(rev.id)) throw new Error('Revision already exists');
        revisionIds.add(rev.id);
      }
      const auditIds = new Set<string>();
      for (const entry of tx.audit ?? []) {
        if (auditIds.has(entry.id)) throw new Error('Audit entry already exists');
        auditIds.add(entry.id);
        await this.assertNewAudit(entry);
      }
      for (const doc of tx.docs) await this.kv.put(docKey(doc.collection, doc.id), doc);
      for (const rev of tx.revisions ?? []) await this.kv.put(revKey(rev), rev);
      for (const entry of tx.audit ?? []) await this.kv.put(auditKey(entry), entry);
      await this.kv.put(publishKey(siteVersion), tx.record);
      await this.kv.put('snapshot/published.json', tx.snapshot);
      return { siteVersion };
    });
  }
  async listPublishes(limit: number, before?: number): Promise<PublishRecord[]> {
    return (await this.all<PublishRecord>('publishes/')).filter(p => before === undefined || p.siteVersion < before)
      .sort((a, b) => b.siteVersion - a.siteVersion).slice(0, pageLimit(limit));
  }
  getPublish(siteVersion: number) { return this.read<PublishRecord>(publishKey(siteVersion)); }
  appendRevision(rev: Revision): Promise<void> {
    return this.exclusive(async () => { if (await this.getRevision(rev.id)) throw new Error('Revision already exists'); await this.kv.put(revKey(rev), rev); });
  }
  upsertWorkingRevision(rev: Revision): Promise<void> {
    return this.exclusive(async () => {
      const old = await this.getRevision(rev.id);
      if (old && (old.sealedAt || old.docId !== rev.docId || old.collection !== rev.collection || old.authorId !== rev.authorId)) throw new Error('Cannot modify sealed revision or revision identity');
      await this.kv.put(revKey(rev), rev);
      if (old && revKey(old) !== revKey(rev)) await this.kv.delete(revKey(old));
    });
  }
  sealRevision(revId: string): Promise<void> {
    return this.exclusive(async () => {
      const rev = await this.getRevision(revId);
      if (!rev) throw new Error('Revision not found');
      if (!rev.sealedAt) await this.kv.put(revKey(rev), { ...rev, sealedAt: this.now().toISOString() });
    });
  }
  async listRevisions(collection: CollectionName, id: string, limit: number, before?: string): Promise<Revision[]> {
    const revisions = await this.all<Revision>(`revisions/${part(id)}/`);
    // before may be an ID (stable tie-breaking) or an ISO timestamp.
    const boundary = before ? revisions.find(rev => rev.id === before) : undefined;
    return revisions.filter(rev => rev.collection === collection && (!before || (boundary ? rev.at < boundary.at || (rev.at === boundary.at && rev.id < boundary.id) : rev.at < before)))
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).slice(0, pageLimit(limit));
  }
  async getRevision(revId: string): Promise<Revision | null> {
    return (await this.all<Revision>('revisions/')).find(rev => rev.id === revId) ?? null;
  }
  private async assertNewAudit(entry: AuditEntry): Promise<void> {
    if ((await this.all<AuditEntry>('audit/')).some(old => old.id === entry.id)) throw new Error('Audit entry already exists');
    if (!/^\d{4}-\d{2}-\d{2}T/.test(entry.at)) throw new Error('Audit timestamp must be ISO');
  }
  appendAudit(entry: AuditEntry): Promise<void> {
    return this.exclusive(async () => { await this.assertNewAudit(entry); await this.kv.put(auditKey(entry), entry); });
  }
  async queryAudit(q: AuditQuery): Promise<{ items: AuditEntry[]; cursor?: string }> {
    const limit = pageLimit(q.limit);
    const text = q.text?.toLocaleLowerCase();
    const rows = (await this.all<AuditEntry>('audit/')).filter(row =>
      (!q.actorId || row.actorId === q.actorId) && (!q.action || row.action === q.action) &&
      (!q.collection || row.collection === q.collection) && (!q.docId || row.docId === q.docId) &&
      (!q.from || row.at >= q.from) && (!q.to || row.at <= q.to) &&
      (!text || JSON.stringify(row).toLocaleLowerCase().includes(text)))
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
    const start = q.cursor ? rows.findIndex(row => row.id === q.cursor) + 1 : 0;
    if (q.cursor && start === 0) throw new Error('Invalid audit cursor');
    const items = rows.slice(start, start + limit);
    return { items, ...(start + limit < rows.length ? { cursor: items.at(-1)?.id } : {}) };
  }
  listUsers() { return this.all<User>('users/'); }
  getUser(id: string) { return this.read<User>(`users/${part(id)}.json`); }
  async getUserByUsername(username: string): Promise<User | null> {
    const id = await this.read<string>(`users-by-name/${part(username.toLocaleLowerCase())}.json`);
    return id ? this.getUser(id) : null;
  }
  putUser(user: User): Promise<void> {
    return this.exclusive(async () => {
      const nameKey = `users-by-name/${part(user.username.toLocaleLowerCase())}.json`;
      const owner = await this.read<string>(nameKey);
      if (owner && owner !== user.id) throw new Error('Username already exists');
      const old = await this.getUser(user.id);
      await this.kv.put(`users/${part(user.id)}.json`, user);
      await this.kv.put(nameKey, user.id);
      if (old && old.username.toLocaleLowerCase() !== user.username.toLocaleLowerCase()) await this.kv.delete(`users-by-name/${part(old.username.toLocaleLowerCase())}.json`);
    });
  }
  getSession(hash: string) { return this.read<Session>(`sessions/${part(hash)}.json`); }
  async putSession(session: Session) { await this.kv.put(`sessions/${part(session.hash)}.json`, session); }
  async deleteSession(hash: string) { await this.kv.delete(`sessions/${part(hash)}.json`); }
  async listSessions(userId: string) { return (await this.all<Session>('sessions/')).filter(session => session.userId === userId); }
  rateLimitHit(key: string, windowSec: number): Promise<{ count: number; resetAt: string }> {
    if (!Number.isFinite(windowSec) || windowSec <= 0) return Promise.reject(new Error('Window must be positive'));
    return this.exclusive(async () => {
      const storageKey = `ratelimit/${part(key)}.json`;
      const current = await this.read<{ count: number; resetAt: string }>(storageKey);
      const now = this.now().getTime();
      const next = current && Date.parse(current.resetAt) > now ? { ...current, count: current.count + 1 } : { count: 1, resetAt: new Date(now + windowSec * 1000).toISOString() };
      await this.kv.put(storageKey, next); return next;
    });
  }
  async rateLimitReset(key: string) { await this.exclusive(() => this.kv.delete(`ratelimit/${part(key)}.json`)); }
  async getMeta(key: string) { return this.kv.get(`meta/${part(key)}.json`); }
  async setMeta(key: string, value: unknown) { await this.kv.put(`meta/${part(key)}.json`, value); }
}
