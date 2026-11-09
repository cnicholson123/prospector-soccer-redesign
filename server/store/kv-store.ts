import { ApiError } from '../http/middleware/errors';
import { can } from '../permissions';
import { isDeepStrictEqual } from 'node:util';
import { collectionNames, type CollectionName } from '../../shared/schema';
import { validate, ValidationError } from '../content/validate';
import { buildSnapshot } from '../content/snapshot';
import { referenceUsage } from '../content/references';
import type { AuditEntry, AuditQuery, CreateDoc, Doc, DocMutation, KvPrimitives, PublishRecord, PublishTx, Revision, RunExclusive, Session, Snapshot, Store, User } from './types';

const part = (value: string): string => {
  if (!value || value === '.' || value === '..') throw new Error('Empty or invalid storage identifier');
  return encodeURIComponent(value).replace(/\./g, '%2E');
};
const equal = (a: unknown, b: unknown) => isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
const docKey = (collection: CollectionName, id: string) => `docs/${part(collection)}/${part(id)}.json`;
const revKey = (rev: Pick<Revision, 'docId' | 'id'>) => `revisions/${part(rev.docId)}/${part(rev.id)}.json`;
const auditKey = (entry: AuditEntry) => `audit/${entry.at.slice(0, 7)}/${part(entry.id)}.json`;
const publishKey = (version: number) => {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid site version');
  return `publishes/${String(version).padStart(8, '0')}.json`;
};
const pageLimit = (limit: number) => { if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Limit must be 1–1000'); return limit; };
interface MutationJournal { writes: { key: string; value: unknown }[]; doc?: Doc; docs?: Doc[] }
const mutationKey = 'meta/pending-mutation.json';
const pendingPublishKey = 'meta/pending-publish.json';
/** FS serializes across processes. Journals make interrupted multi-file writes
 * replayable. The content document and public snapshot are commit points.
 */
export class KvStore implements Store {
  private queue: Promise<unknown> = Promise.resolve();
  private exclusive: RunExclusive;
  private now: () => Date;
  constructor(private kv: KvPrimitives, options: { exclusive?: RunExclusive; now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
    this.exclusive = options.exclusive ?? (async <T>(operation: () => Promise<T>): Promise<T> => {
      const next = this.queue.then(operation, operation);
      this.queue = next.catch(() => undefined);
      return next;
    });
  }
  private async read<T>(key: string): Promise<T | null> { return await this.kv.get(key) as T | null; }
  private async all<T>(prefix: string): Promise<T[]> {
    const values = await Promise.all((await this.kv.list(prefix)).map(key => this.read<T>(key)));
    return values.filter((value): value is Awaited<T> => value !== null);
  }
  private async allDocs(): Promise<Doc[]> { return (await Promise.all(collectionNames.map(name => this.listDocs(name, { includeTrashed: true })))).flat(); }
  getDoc(collection: CollectionName, id: string) { return this.read<Doc>(docKey(collection, id)); }
  async listDocs(collection: CollectionName, opts: { includeTrashed?: boolean } = {}): Promise<Doc[]> {
    const docs = await this.all<Doc>(`docs/${part(collection)}/`);
    return docs.filter(doc => opts.includeTrashed || (!doc.trashedAt && doc.status !== 'trashed'))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  }
  private async resumeMutation(): Promise<void> {
    const pending = await this.read<MutationJournal>(mutationKey);
    if (!pending) return;
    for (const write of pending.writes) await this.kv.put(write.key, write.value);
    for (const doc of pending.docs ?? (pending.doc ? [pending.doc] : [])) await this.kv.put(docKey(doc.collection, doc.id), doc);
    await this.kv.delete(mutationKey);
  }
  private async readyToMutate(): Promise<void> {
    if (await this.kv.get(pendingPublishKey)) throw new Error('Pending publish; call recoverPublish before editing');
    await this.resumeMutation();
  }
  private checkRevision(rev: Revision, doc: Doc): void {
    if (rev.docId !== doc.id || rev.collection !== doc.collection || rev.docVersion !== doc.version || !equal(rev.data, doc.draft)) throw new Error('Revision identity, docVersion or data does not match document');
  }
  private async assertIdentical(key: string, value: unknown): Promise<void> {
    const old = await this.kv.get(key);
    if (old !== null && !equal(old, value)) throw new Error(`Different content under existing id: ${key}`);
  }
  private async checkAudit(entry: AuditEntry): Promise<void> {
    if (!entry || !entry.id || !Number.isFinite(Date.parse(entry.at))) throw new Error('Audit entry with ISO timestamp is required');
    await this.assertIdentical(auditKey(entry), entry);
    // Legacy audit keys contained a timestamp. Preserve their immutability.
    if (!/^aud_[0-9a-v]{10}_[0-9a-v]{6}$/.test(entry.id)) {
      const old = (await this.all<AuditEntry>('audit/')).find(item => item.id === entry.id);
      if (old && !equal(old, entry)) throw new Error('Different content under existing audit id');
    } else {
      const time = parseInt(entry.id.split('_')[1], 32);
      if (new Date(time).toISOString().slice(0, 7) !== entry.at.slice(0, 7)) throw new Error('Audit id timestamp must match its month');
    }
  }
  private async commitMutation(doc: Doc, revisions: Revision[], audit: AuditEntry): Promise<Doc> {
    await this.checkAudit(audit);
    if (await this.kv.get(auditKey(audit))) throw new Error('Audit entry already exists');
    const writes = [...revisions.map(value => ({ key: revKey(value), value })), { key: auditKey(audit), value: audit }];
    await this.kv.put(mutationKey, { writes, doc } satisfies MutationJournal);
    await this.resumeMutation();
    return structuredClone(doc);
  }
  createDoc({ doc, revision, audit }: CreateDoc): Promise<Doc> {
    return this.exclusive(async () => {
      await this.readyToMutate();
      if (await this.getDoc(doc.collection, doc.id)) throw new Error('Document already exists');
      if (doc.version !== 1) throw new Error('New document version must be 1');
      this.checkRevision(revision, doc);
      await this.assertIdentical(revKey(revision), revision);
      return this.commitMutation(doc, [revision], audit);
    });
  }
  mutateDoc(mutation: DocMutation): Promise<Doc | 'conflict'> {
    return this.exclusive(async () => {
      await this.readyToMutate();
      const { collection, id, expectedVersion, patch, audit } = mutation;
      const current = await this.getDoc(collection, id);
      if (!current || current.version !== expectedVersion) return 'conflict';
      for (const guard of mutation.guardVersions ?? []) if ((await this.getDoc(collection, guard.id))?.version !== guard.expectedVersion) return 'conflict';
      const doc = { ...current, ...patch, id: current.id, collection: current.collection,
        createdAt: current.createdAt, createdBy: current.createdBy, version: expectedVersion + 1 };
      if (patch.order !== undefined && current.status === 'published') doc.status = 'changed';
      if (patch.order !== undefined && current.published !== undefined && current.publishedOrder === undefined) doc.publishedOrder = current.order ?? 0;
      if ((doc.trashedAt || doc.status === 'trashed') && !current.trashedAt && current.status !== 'trashed') {
        const usage = referenceUsage(await this.allDocs(), collection, id);
        if (usage.length) throw Object.assign(new Error('Document is in use'), { code: 'in_use', status: 409, details: { usage } });
      }
      const revisions: Revision[] = [];
      for (const revId of new Set(mutation.seal ?? [])) {
        const rev = await this.getRevision(id, revId);
        if (!rev || rev.collection !== collection) throw new Error('Revision not found');
        if (!rev.sealedAt) revisions.push({ ...rev, sealedAt: this.now().toISOString() });
      }
      if (mutation.revision) {
        const rev = 'upsert' in mutation.revision ? mutation.revision.upsert : mutation.revision.append;
        this.checkRevision(rev, doc);
        const old = await this.getRevision(id, rev.id);
        if (old) {
          if ('append' in mutation.revision) throw new Error('Revision already exists');
          if (old.sealedAt || mutation.seal?.includes(rev.id)) throw new Error('Cannot modify sealed revision');
          if (old.authorId !== rev.authorId || old.collection !== collection) throw new Error('Cannot change revision identity');
          if (rev.docVersion <= old.docVersion) throw new Error('Revision docVersion must increase');
        }
        revisions.push(rev);
      }
      if (mutation.relatedOrder) {
        if (mutation.revision || mutation.seal?.length || Object.keys(patch).some(key => !['order', 'updatedAt', 'updatedBy'].includes(key))) throw new Error('Reorder is metadata only');
        const siblings: Doc[] = [doc];
        for (const item of mutation.relatedOrder) {
          if (siblings.some(d => d.id === item.id) || !Number.isSafeInteger(item.order) || item.order < 0) throw new Error('Invalid reorder');
          const sibling = await this.getDoc(collection, item.id);
          if (!sibling || sibling.version !== item.expectedVersion) return 'conflict';
          siblings.push({ ...sibling, status: sibling.status === 'published' ? 'changed' : sibling.status, publishedOrder: sibling.publishedOrder ?? (sibling.published !== undefined ? sibling.order ?? 0 : undefined), order: item.order, version: sibling.version + 1, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy });
        }
        await this.checkAudit(audit);
        await this.kv.put(mutationKey, { writes: [{ key: auditKey(audit), value: audit }], docs: siblings } satisfies MutationJournal);
        await this.resumeMutation();
        return structuredClone(doc);
      }
      return this.commitMutation(doc, revisions, audit);
    });
  }
  async getSnapshot(): Promise<Snapshot | null> {
    const snapshot = await this.read<Snapshot>('snapshot/published.json');
    if (!snapshot) return null;
    if (snapshot.schemaVersion !== undefined && snapshot.media !== undefined) return snapshot;
    // Additive upgrade of pre-1b persisted snapshots without changing their data.
    const docs = Object.values(snapshot.docs).flatMap(items => (items ?? []).map(item => ({ ...item, published: item.data, publishedVersion: item.version, draft: item.data, status: 'published' as const, createdAt: snapshot.publishedAt, updatedAt: snapshot.publishedAt, createdBy: 'legacy', updatedBy: 'legacy' })));
    return buildSnapshot(docs, snapshot);
  }
  private async writePublish(tx: PublishTx): Promise<void> {
    for (const { nextDoc } of tx.docs) await this.kv.put(docKey(nextDoc.collection, nextDoc.id), nextDoc);
    for (const rev of tx.revisions ?? []) await this.kv.put(revKey(rev), rev);
    for (const entry of tx.audit ?? []) await this.kv.put(auditKey(entry), entry);
    await this.kv.put(publishKey(tx.record.siteVersion), tx.record);
    await this.kv.put('snapshot/published.json', tx.snapshot);
    await this.kv.delete(pendingPublishKey);
  }
  publish(tx: PublishTx): Promise<{ siteVersion: number }> {
    return this.exclusive(async () => {
      await this.resumeMutation();
      const pending = await this.read<PublishTx>(pendingPublishKey);
      if (pending) {
        if (!equal(pending, tx)) throw new Error('Different content from pending publish; recoverPublish first');
        await this.writePublish(pending);
        return { siteVersion: tx.record.siteVersion };
      }
      const current = await this.getSnapshot();
      const existingRecord = await this.getPublish(tx.record.siteVersion);
      if (existingRecord) {
        if (!equal(existingRecord, tx.record) || !equal(current, tx.snapshot)) throw new Error('Publish version conflict');
        for (const { nextDoc } of tx.docs) await this.assertIdentical(docKey(nextDoc.collection, nextDoc.id), nextDoc);
        for (const rev of tx.revisions ?? []) {
          const stored = await this.getRevision(rev.docId, rev.id);
          if (!stored || !equal(stored, rev)) throw new Error('Different content under existing revision id');
        }
        for (const entry of tx.audit ?? []) {
          const stored = await this.kv.get(auditKey(entry));
          if (!stored || !equal(stored, entry)) throw new Error('Different content under existing audit id');
        }
        return { siteVersion: tx.record.siteVersion };
      }
      const siteVersion = (current?.siteVersion ?? 0) + 1;
      if (tx.snapshot.siteVersion !== siteVersion || tx.record.siteVersion !== siteVersion) throw new Error('Publish version conflict');
      const docs = await this.allDocs();
      const seen = new Set<string>();
      for (const { expectedVersion, nextDoc } of tx.docs) {
        const key = docKey(nextDoc.collection, nextDoc.id);
        if (seen.has(key)) throw new Error('Duplicate publish document');
        seen.add(key);
        const index = docs.findIndex(doc => doc.id === nextDoc.id && doc.collection === nextDoc.collection);
        const stored = docs[index];
        if (!stored || stored.version !== expectedVersion) throw new Error('Document version conflict');
        if (![expectedVersion, expectedVersion + 1].includes(nextDoc.version)) throw new Error('Invalid next document version');
        if (stored.createdAt !== nextDoc.createdAt || stored.createdBy !== nextDoc.createdBy) throw new Error('Cannot change document creation metadata');
        docs[index] = nextDoc;
      }
      const revisionIds = new Set<string>();
      for (const rev of tx.revisions ?? []) {
        const key = revKey(rev);
        if (revisionIds.has(key)) throw new Error('Revision already exists');
        revisionIds.add(key);
        const old = await this.getRevision(rev.docId, rev.id);
        if (old && !equal(old, rev) && !(rev.sealedAt && !old.sealedAt && equal({ ...old, sealedAt: rev.sealedAt }, rev))) throw new Error('Different content under existing revision id');
      }
      const auditIds = new Set<string>();
      for (const entry of tx.audit ?? []) {
        if (auditIds.has(entry.id)) throw new Error('Audit entry already exists');
        auditIds.add(entry.id);
        await this.checkAudit(entry);
      }
      const manifestIds = new Set<string>();
      for (const entry of tx.record.manifest) {
        const key = docKey(entry.collection, entry.id);
        const doc = docs.find(doc => doc.collection === entry.collection && doc.id === entry.id);
        if (manifestIds.has(key) || !doc || doc.status === 'trashed' || doc.trashedAt || doc.published === undefined || entry.version !== doc.publishedVersion || entry.order !== (doc.publishedOrder ?? doc.order ?? 0)) throw new Error('Invalid publish manifest');
        manifestIds.add(key);
        const rev = tx.revisions?.find(rev => rev.id === entry.revId && rev.docId === entry.id) ?? await this.getRevision(entry.id, entry.revId);
        if (!rev || rev.collection !== entry.collection || rev.docVersion !== entry.version || !equal(rev.data, doc.published)) throw new Error('Manifest revision does not match published document');
      }
      for (const doc of docs.filter(doc => doc.published !== undefined && doc.status !== 'trashed' && !doc.trashedAt)) {
        if (!manifestIds.has(docKey(doc.collection, doc.id))) throw new Error('Published document missing from manifest');
        const result = validate(doc.collection, doc.published, { mode: 'publish', resolve: (collection, id) => docs.find(target => target.collection === collection && target.id === id) ?? null });
        if (!result.valid) throw new ValidationError(result.errors.map(error => ({ ...error, path: `${doc.collection}.${doc.id}.${error.path}` })));
      }
      for (const item of tx.snapshot.scheduled) {
        const target = docs.find(doc => doc.collection === item.collection && doc.id === item.id);
        if (!target || target.trashedAt || target.status === 'trashed' || !Number.isFinite(Date.parse(item.at))) throw new Error('Invalid scheduled document');
        const result = validate(item.collection, item.data, { mode: 'publish', resolve: (collection, id) => docs.find(doc => doc.collection === collection && doc.id === id) ?? null });
        if (!result.valid) throw new ValidationError(result.errors.map(error => ({ ...error, path: `${item.collection}.${item.id}.${error.path}` })));
      }
      for (const mediaId of Object.keys(tx.snapshot.media)) {
        if (!manifestIds.has(docKey('media', mediaId))) throw new Error('Referenced media must have a versioned publish manifest entry');
      }
      const built = buildSnapshot(docs, tx.snapshot, tx.record.manifest);
      if (!equal(built, tx.snapshot)) throw new Error('Snapshot does not match published documents and manifest');
      await this.kv.put(pendingPublishKey, tx);
      await this.writePublish(tx);
      return { siteVersion };
    });
  }
  recoverPublish(): Promise<{ repaired: boolean; siteVersion: number }> {
    return this.exclusive(async () => {
      await this.resumeMutation();
      const pending = await this.read<PublishTx>(pendingPublishKey);
      if (pending) {
        await this.writePublish(pending);
        return { repaired: true, siteVersion: pending.record.siteVersion };
      }
      const current = await this.getSnapshot();
      const siteVersion = (current?.siteVersion ?? 0) + 1;
      const record = await this.getPublish(siteVersion);
      if (!record) return { repaired: false, siteVersion: current?.siteVersion ?? 0 };
      const docs = await this.allDocs();
      for (const entry of record.manifest) {
        const doc = docs.find(doc => doc.collection === entry.collection && doc.id === entry.id);
        if (!doc || doc.publishedVersion !== entry.version) throw new Error('Cannot recover inconsistent publish manifest');
      }
      const snapshot = buildSnapshot(docs, { siteVersion, publishedAt: record.at, templateHash: current?.templateHash ?? '', scheduled: current?.scheduled ?? [], effectiveAt: current?.effectiveAt }, record.manifest);
      await this.kv.put('snapshot/published.json', snapshot);
      return { repaired: true, siteVersion };
    });
  }
  async listPublishes(limit: number, before?: number): Promise<PublishRecord[]> {
    const records = (await this.all<PublishRecord>('publishes/')).filter(record => before === undefined || record.siteVersion < before)
      .sort((a, b) => b.siteVersion - a.siteVersion).slice(0, pageLimit(limit));
    return Promise.all(records.map(record => this.normalizePublish(record)));
  }
  private async normalizePublish(record: PublishRecord): Promise<PublishRecord> {
    if (record.manifest.every(entry => entry.order !== undefined)) return record;
    const snapshot = await this.read<Snapshot>('snapshot/published.json');
    return { ...record, manifest: record.manifest.map(entry => ({ ...entry,
      // Earlier manifests never stored order. Only their matching snapshot can
      // recover it exactly; older unavailable values get a stable zero fallback.
      order: entry.order ?? (snapshot?.siteVersion === record.siteVersion ? snapshot.docs[entry.collection]?.find(doc => doc.id === entry.id)?.order : undefined) ?? 0,
    })) };
  }
  async getPublish(siteVersion: number): Promise<PublishRecord | null> {
    const record = await this.read<PublishRecord>(publishKey(siteVersion));
    return record ? this.normalizePublish(record) : null;
  }
  async listRevisions(collection: CollectionName, id: string, limit: number, before?: string): Promise<Revision[]> {
    const values = await this.all<Revision>(`revisions/${part(id)}/`);
    const revisions = [...new Map(values.map(rev => [rev.id, rev])).values()];
    const boundary = before ? revisions.find(rev => rev.id === before) : undefined;
    return revisions.filter(rev => rev.collection === collection && (!before || (boundary ? rev.at < boundary.at || (rev.at === boundary.at && (rev.docVersion < boundary.docVersion || rev.docVersion === boundary.docVersion && rev.id < boundary.id)) : rev.at < before)))
      .sort((a, b) => b.at.localeCompare(a.at) || b.docVersion - a.docVersion || b.id.localeCompare(a.id)).slice(0, pageLimit(limit));
  }
  async getRevision(docId: string, revId: string): Promise<Revision | null> {
    const rev = await this.read<Revision>(revKey({ docId, id: revId }));
    if (rev) return rev;
    const legacy = (await this.kv.list(`revisions/${part(docId)}/`)).find(key => key.endsWith(`-${part(revId)}.json`));
    return legacy ? this.read<Revision>(legacy) : null;
  }
  async queryAudit(q: AuditQuery): Promise<{ items: AuditEntry[]; cursor?: string }> {
    const limit = pageLimit(q.limit);
    const text = q.text?.toLowerCase();
    const keys = await this.kv.list('audit/');
    const months = [...new Set(keys.map(key => key.split('/')[1]))].sort().reverse();
    const rows: AuditEntry[] = [];
    let afterCursor = !q.cursor;
    for (const month of months) {
      if ((q.from && month < q.from.slice(0, 7)) || (q.to && month > q.to.slice(0, 7))) continue;
      const entries = await Promise.all(keys.filter(key => key.startsWith(`audit/${month}/`)).map(key => this.read<AuditEntry>(key)));
      for (const row of entries.filter((row): row is AuditEntry => row !== null).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))) {
        if (!afterCursor) { if (row.id === q.cursor) afterCursor = true; continue; }
        if ((!q.actorId || row.actorId === q.actorId) && (!q.action || row.action === q.action) &&
          (!q.collection || row.collection === q.collection) && (!q.docId || row.docId === q.docId) &&
          (!q.from || row.at >= q.from) && (!q.to || row.at <= q.to) && (!text || JSON.stringify(row).toLowerCase().includes(text))) rows.push(row);
        if (rows.length > limit) return { items: rows.slice(0, limit), cursor: rows[limit - 1].id };
      }
    }
    if (!afterCursor) throw new Error('Invalid audit cursor');
    return { items: rows };
  }
  claimMaintenance(key: string, intervalMs: number, now: string): Promise<boolean> {
    return this.exclusive(async () => {
      const at = await this.getMeta(key);
      if (typeof at === 'string' && Date.parse(now) - Date.parse(at) < intervalMs) return false;
      await this.setMeta(key, now); return true;
    });
  }
  recordLogin(userId: string, expectedHash: string, weak: boolean, entry: AuditEntry): Promise<User | null> {
    return this.exclusive(async () => {
      const user = await this.getUser(userId);
      if (!user?.active || user.passwordHash !== expectedHash) return null;
      const next = { ...user, lastLoginAt: entry.at, passwordWeak: weak };
      await this.checkAudit(entry); await this.kv.put(auditKey(entry), entry);
      await this.saveUser(next); return next;
    });
  }
  changePassword(userId: string, expectedHash: string, hash: string, entry: AuditEntry): Promise<User | null> {
    return this.exclusive(async () => {
      const user = await this.getUser(userId);
      if (!user?.active || user.passwordHash !== expectedHash) return null;
      const next = { ...user, passwordHash: hash, passwordWeak: false, mustChangePassword: false, passwordChangedAt: entry.at, authVersion: (user.authVersion ?? 0) + 1 };
      await this.checkAudit(entry); await this.kv.put(auditKey(entry), entry);
      await this.saveUser(next); return next;
    });
  }
  loginFailure(key: string, now: string): Promise<{ failures: number; locks: number; until?: string }> {
    return this.exclusive(async () => {
      const state = await this.getMeta(key) as { failures: number; locks: number; until?: string } | null ?? { failures: 0, locks: 0 };
      if (state.until && Date.parse(state.until) > Date.parse(now)) return state;
      state.failures++;
      if (state.failures >= 5) { state.failures = 0; state.until = new Date(Date.parse(now) + Math.min(86400, 900 * 2 ** state.locks) * 1000).toISOString(); state.locks++; }
      await this.setMeta(key, state); return state;
    });
  }
  recordAudit(entry: AuditEntry): Promise<void> {
    return this.exclusive(async () => { await this.checkAudit(entry); await this.kv.put(auditKey(entry), entry); });
  }
  bootstrapOwner(user: User, entry: AuditEntry): Promise<boolean> {
    return this.exclusive(async () => {
      if ((await this.listUsers()).length) return false;
      if (user.role !== 'Owner' || !user.active) throw new Error('Bootstrap requires an active Owner');
      await this.checkAudit(entry);
      await this.kv.put(auditKey(entry), entry);
      await this.saveUser(user);
      return true;
    });
  }
  changeUser(user: User, actorId: string, entry: AuditEntry, expected: User | null): Promise<void> {
    return this.exclusive(async () => {
      const actor = await this.getUser(actorId);
      const old = await this.getUser(user.id);
      if (!equal(old, expected)) throw new ApiError(409, 'conflict', 'User changed. Reload and compare');
      if (!actor || !can(actor, 'users.manage', { role: user.role }) || (old && !can(actor, 'users.manage', { role: old.role }))) throw new ApiError(403, 'forbidden', 'Role exceeds your permission');
      if (old && old.id === actorId && old.role !== user.role) throw new ApiError(403, 'forbidden', 'You cannot change your own role');
      if (old?.active && old.role === 'Owner' && (!user.active || user.role !== 'Owner') && (await this.listUsers()).filter(u => u.active && u.role === 'Owner').length === 1) throw new ApiError(409, 'last_owner', 'The last active Owner cannot be removed');
      await this.checkAudit(entry);
      // Check name collision before any audit or user writes.
      const named = await this.getUserByUsername(user.username);
      if (named && named.id !== user.id) throw new ApiError(409, 'conflict', 'Username already exists');
      await this.kv.put(auditKey(entry), entry);
      await this.saveUser(user);
    });
  }
  sealWorkingRevisions(authorId: string, before: string, entry: AuditEntry): Promise<void> {
    return this.exclusive(async () => {
      await this.readyToMutate();
      await this.checkAudit(entry);
      let changed = false;
      for (const rev of await this.all<Revision>('revisions/')) if (!rev.sealedAt && (authorId === '*' || rev.authorId === authorId) && rev.at <= before) { await this.kv.put(revKey(rev), { ...rev, sealedAt: entry.at }); changed = true; }
      if (changed || authorId !== '*') await this.kv.put(auditKey(entry), entry);
    });
  }
  listUsers() { return this.all<User>('users/'); }
  getUser(id: string) { return this.read<User>(`users/${part(id)}.json`); }
  async getUserByUsername(username: string): Promise<User | null> {
    const id = await this.read<string>(`users-by-name/${part(username.toLowerCase())}.json`);
    return id ? this.getUser(id) : null;
  }
  putUser(user: User): Promise<void> { return this.exclusive(() => this.saveUser(user)); }
  private async saveUser(user: User): Promise<void> {
    const nameKey = `users-by-name/${part(user.username.toLowerCase())}.json`;
    const owner = await this.read<string>(nameKey);
    if (owner && owner !== user.id) throw new Error('Username already exists');
    const old = await this.getUser(user.id);
    await this.kv.put(`users/${part(user.id)}.json`, user);
    await this.kv.put(nameKey, user.id);
    if (old && old.username.toLowerCase() !== user.username.toLowerCase()) await this.kv.delete(`users-by-name/${part(old.username.toLowerCase())}.json`);
  }
  refreshSession(hash: string, now: string): Promise<{ session: Session; refreshed: boolean } | null> {
    return this.exclusive(async () => {
      const session = await this.getSession(hash), time = Date.parse(now);
      if (!session || Date.parse(session.expiresAt) <= time || Date.parse(session.createdAt) + 30 * 86400000 <= time) return null;
      if (time - Date.parse(session.lastSeenAt) < 3600000) return { session, refreshed: false };
      const next = { ...session, lastSeenAt: now, expiresAt: new Date(Math.min(time + 14 * 86400000, Date.parse(session.createdAt) + 30 * 86400000)).toISOString() };
      await this.kv.put(`sessions/${part(hash)}.json`, next);
      return { session: next, refreshed: true };
    });
  }
  getSession(hash: string) { return this.read<Session>(`sessions/${part(hash)}.json`); }
  async putSession(session: Session) { await this.exclusive(() => this.kv.put(`sessions/${part(session.hash)}.json`, session)); }
  async deleteSession(hash: string) { await this.exclusive(() => this.kv.delete(`sessions/${part(hash)}.json`)); }
  async listSessions(userId: string) { return (await this.all<Session>('sessions/')).filter(session => session.userId === userId); }
  deleteExpiredSessions(now: string): Promise<number> {
    const cutoff = Date.parse(now);
    if (!Number.isFinite(cutoff)) return Promise.reject(new Error('Invalid session expiry cutoff'));
    return this.exclusive(async () => {
      const expired = (await this.all<Session>('sessions/')).filter(session => Date.parse(session.expiresAt) <= cutoff || Date.parse(session.createdAt) + 30 * 86400000 <= cutoff);
      for (const session of expired) await this.kv.delete(`sessions/${part(session.hash)}.json`);
      return expired.length;
    });
  }
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
  async setMeta(key: string, value: unknown) {
    if (key === 'pending-mutation' || key === 'pending-publish') throw new Error('Reserved transaction metadata key');
    await this.kv.put(`meta/${part(key)}.json`, value);
  }
}
