import { keyPart, documentId, username } from './identifiers';
import { loginGenerationKey, usernameRateKey } from '../auth/ratelimit';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient } from '@neondatabase/serverless';
import { ApiError } from '../http/middleware/errors';
import { can } from '../permissions';
import { isDeepStrictEqual } from 'node:util';
import { type CollectionName } from '../../shared/schema';
import { validate, ValidationError } from '../content/validate';
import { buildSnapshot } from '../content/snapshot';
import { referenceUsage } from '../content/references';
import type { AuditEntry, AuditQuery, CreateDoc, Doc, DocMutation, PublishRecord, PublishTx, Revision, Session, Snapshot, Store, User } from './types';

const equal = (a: unknown, b: unknown) => isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
const pageLimit = (limit: number) => { if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Limit must be 1–1000'); return limit; };
type Table = 'docs' | 'revisions' | 'publishes' | 'snapshots' | 'audit' | 'users' | 'sessions' | 'rate_limits' | 'meta';
export interface PostgresOptions { now?: () => Date; afterWrite?: (table: Table) => void }
/** Relational storage. One transaction-scoped advisory lock serializes CMS
 * writers across processes, including reference and last-Owner checks.
 * Readers use MVCC and never observe a partially committed transaction. */
export class PostgresStore implements Store {
  private transaction = new AsyncLocalStorage<PoolClient>();
  private now: () => Date;
  constructor(readonly pool: Pool, private options: PostgresOptions = {}) { this.now = options.now ?? (() => new Date()); }
  private async rows<T>(sql: string, values: unknown[] = []): Promise<T[]> {
    const result = await (this.transaction.getStore() ?? this.pool).query(sql, values);
    return result.rows as T[];
  }
  private async read<T>(table: Table, id: string): Promise<T | null> {
    keyPart(id);
    return (await this.rows<{ body: T }>(`SELECT body FROM ${table} WHERE id=$1`, [id]))[0]?.body ?? null;
  }
  private async all<T>(table: Table, where = '', values: unknown[] = []): Promise<T[]> {
    return (await this.rows<{ body: T }>(`SELECT body FROM ${table} ${where}`, values)).map(row => row.body);
  }
  private async write(table: Table, id: string, value: unknown, expectedVersion?: number): Promise<void> {
    if (!this.transaction.getStore()) throw new Error('Write requires a transaction');
    keyPart(id);
    if (table === 'docs') documentId(id);
    const body = JSON.stringify(value);
    if (table === 'users') {
      await this.rows('INSERT INTO users(id,body,username_key) VALUES($1,$2::jsonb,$3) ON CONFLICT(id) DO UPDATE SET body=excluded.body, username_key=excluded.username_key', [id, body, (value as User).username.toLowerCase()]);
      this.options.afterWrite?.(table); return;
    }
    const result = expectedVersion === undefined
      ? await this.rows(`INSERT INTO ${table}(id,body) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET body=excluded.body RETURNING id`, [id, body])
      : await this.rows('UPDATE docs SET body=$2::jsonb WHERE id=$1 AND version=$3 RETURNING id', [id, body, expectedVersion]);
    if (!result.length) throw new Error('Document version conflict');
    this.options.afterWrite?.(table);
  }
  private async remove(table: Table, id: string): Promise<void> {
    await this.rows(`DELETE FROM ${table} WHERE id=$1`, [id]); this.options.afterWrite?.(table);
  }
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.transaction.getStore()) return operation();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(734215906)');
      const result = await this.transaction.run(client, operation);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private allDocs() { return this.all<Doc>('docs'); }
  async getDoc(collection: CollectionName, id: string): Promise<Doc | null> {
    documentId(id);
    const doc = await this.read<Doc>('docs', id); return doc?.collection === collection ? doc : null;
  }
  listDocs(collection: CollectionName, opts: { includeTrashed?: boolean } = {}): Promise<Doc[]> {
    return this.all<Doc>('docs', `WHERE collection=$1 ${opts.includeTrashed ? '' : "AND body->>'trashedAt' IS NULL AND body->>'status'<>'trashed'"} ORDER BY COALESCE("order",0), id COLLATE "C"`, [collection]);
  }
  private checkRevision(rev: Revision, doc: Doc): void {
    if (rev.docId !== doc.id || rev.collection !== doc.collection || rev.docVersion !== doc.version || !equal(rev.data, doc.draft)) throw new Error('Revision identity, docVersion or data does not match document');
  }
  private async checkAudit(entry: AuditEntry): Promise<void> {
    if (!entry || !entry.id || !Number.isFinite(Date.parse(entry.at))) throw new Error('Audit entry with ISO timestamp is required');
    const old = await this.read<AuditEntry>('audit', entry.id);
    if (old && !equal(old, entry)) throw new Error('Different content under existing audit id');
    if (/^aud_[0-9a-v]{10}_[0-9a-v]{6}$/.test(entry.id)) {
      const time = parseInt(entry.id.split('_')[1], 32);
      if (new Date(time).toISOString().slice(0, 7) !== entry.at.slice(0, 7)) throw new Error('Audit id timestamp must match its month');
    }
  }
  private async commitMutation(doc: Doc, revisions: Revision[], audit: AuditEntry, expectedVersion?: number): Promise<Doc> {
    await this.checkAudit(audit);
    if (await this.read('audit', audit.id)) throw new Error('Audit entry already exists');
    for (const rev of revisions) await this.write('revisions', rev.id, rev);
    await this.write('audit', audit.id, audit);
    await this.write('docs', doc.id, doc, expectedVersion);
    return structuredClone(doc);
  }
  createDoc({ doc, revision, audit }: CreateDoc): Promise<Doc> {
    return this.exclusive(async () => {
      if (await this.read('docs', doc.id)) throw new Error('Document already exists');
      if (doc.version !== 1) throw new Error('New document version must be 1');
      this.checkRevision(revision, doc);
      if (await this.read('revisions', revision.id)) throw new Error('Revision already exists');
      return this.commitMutation(doc, [revision], audit);
    });
  }
  mutateDoc(mutation: DocMutation): Promise<Doc | 'conflict'> {
    return this.exclusive(async () => {
      const { collection, id, expectedVersion, patch, audit } = mutation;
      const current = await this.getDoc(collection, id);
      if (!current || current.version !== expectedVersion) return 'conflict';
      for (const guard of mutation.guardVersions ?? []) if ((await this.getDoc(collection, guard.id))?.version !== guard.expectedVersion) return 'conflict';
      const doc = { ...current, ...patch, id: current.id, collection: current.collection,
        createdAt: current.createdAt, createdBy: current.createdBy, version: expectedVersion + 1 };
      if (patch.order !== undefined && current.status === 'published') doc.status = 'changed';
      if (patch.order !== undefined && current.published !== undefined && current.publishedOrder === undefined) doc.publishedOrder = current.order ?? 0;
      if ((doc.trashedAt || doc.status === 'trashed') && !current.trashedAt && current.status !== 'trashed') {
        const usage = referenceUsage(await this.allDocs(), collection, id, (await this.getSnapshot())?.scheduled);
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
        if (await this.read('audit', audit.id)) throw new Error('Audit entry already exists');
        await this.write('audit', audit.id, audit);
        for (const sibling of siblings) await this.write('docs', sibling.id, sibling, sibling.version - 1);
        return structuredClone(doc);
      }
      return this.commitMutation(doc, revisions, audit, expectedVersion);
    });
  }
  getSnapshot() { return this.read<Snapshot>('snapshots', 'published'); }
  capturePublication(): Promise<{ docs: Doc[]; snapshot: Snapshot | null }> {
    return this.exclusive(async () => {
      return { docs: await this.allDocs(), snapshot: await this.getSnapshot() };
    });
  }
  publish(tx: PublishTx): Promise<{ siteVersion: number }> {
    return this.exclusive(async () => {
      const current = await this.getSnapshot();
      const existingRecord = await this.getPublish(tx.record.siteVersion);
      if (existingRecord) {
        if (!equal(existingRecord, tx.record) || !equal(current, tx.snapshot)) throw new Error('Publish version conflict');
        for (const { nextDoc } of tx.docs) if (!equal(await this.getDoc(nextDoc.collection, nextDoc.id), nextDoc)) throw new Error('Different content under existing doc id');
        for (const rev of tx.revisions ?? []) if (!equal(await this.getRevision(rev.docId, rev.id), rev)) throw new Error('Different content under existing revision id');
        for (const entry of tx.audit ?? []) if (!equal(await this.read('audit', entry.id), entry)) throw new Error('Different content under existing audit id');
        return { siteVersion: tx.record.siteVersion };
      }
      const siteVersion = (current?.siteVersion ?? 0) + 1;
      if (tx.snapshot.siteVersion !== siteVersion || tx.record.siteVersion !== siteVersion) throw new Error('Publish version conflict');
      const docs = await this.allDocs();
      const seen = new Set<string>();
      for (const { expectedVersion, nextDoc } of tx.docs) {
        const key = nextDoc.id;
        if (seen.has(key)) throw new Error('Duplicate publish document');
        seen.add(key);
        const index = docs.findIndex(doc => doc.id === nextDoc.id && doc.collection === nextDoc.collection);
        const stored = docs[index];
        if (!stored || stored.version !== expectedVersion) throw new Error('Document version conflict');
        if (!equal(stored, nextDoc) && nextDoc.version !== expectedVersion + 1) throw new Error('Document version conflict: envelope change requires a new version');
        if (![expectedVersion, expectedVersion + 1].includes(nextDoc.version)) throw new Error('Invalid next document version');
        if (stored.createdAt !== nextDoc.createdAt || stored.createdBy !== nextDoc.createdBy) throw new Error('Cannot change document creation metadata');
        docs[index] = nextDoc;
      }
      const revisionIds = new Set<string>();
      for (const rev of tx.revisions ?? []) {
        const key = rev.id;
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
        const key = entry.id;
        const doc = docs.find(doc => doc.collection === entry.collection && doc.id === entry.id);
        if (manifestIds.has(key) || !doc || doc.published === undefined || entry.version !== doc.publishedVersion || entry.order !== (doc.publishedOrder ?? doc.order ?? 0)) throw new Error('Invalid publish manifest');
        manifestIds.add(key);
        const rev = tx.revisions?.find(rev => rev.id === entry.revId && rev.docId === entry.id) ?? await this.getRevision(entry.id, entry.revId);
        if (!rev || rev.collection !== entry.collection || rev.docVersion !== entry.version || !equal(rev.data, doc.published)) throw new Error('Manifest revision does not match published document');
      }
      for (const doc of docs.filter(doc => doc.published !== undefined)) {
        if (!manifestIds.has(doc.id)) throw new Error('Published document missing from manifest');
        const result = validate(doc.collection, doc.published, { mode: 'publish', resolve: (collection, id) => docs.map(target => target.published === undefined ? target : { ...target, trashedAt: undefined, status: 'published' as const }).find(target => target.collection === collection && target.id === id) ?? null });
        if (!result.valid) throw new ValidationError(result.errors.map(error => ({ ...error, path: `${doc.collection}.${doc.id}.${error.path}` })));
      }
      for (const item of tx.snapshot.scheduled) {
        const target = docs.find(doc => doc.collection === item.collection && doc.id === item.id);
        if (!target || target.trashedAt || target.status === 'trashed' || !Number.isFinite(Date.parse(item.at))) throw new Error('Invalid scheduled document');
        const result = validate(item.collection, item.data, { mode: 'publish', resolve: (collection, id) => docs.find(doc => doc.collection === collection && doc.id === id) ?? null });
        if (!result.valid) throw new ValidationError(result.errors.map(error => ({ ...error, path: `${item.collection}.${item.id}.${error.path}` })));
      }
      for (const mediaId of Object.keys(tx.snapshot.media)) {
        if (!manifestIds.has(mediaId)) throw new Error('Referenced media must have a versioned publish manifest entry');
      }
      const built = buildSnapshot(docs, tx.snapshot, tx.record.manifest);
      if (!equal(built, tx.snapshot)) throw new Error('Snapshot does not match published documents and manifest');
      if (!['publish', 'unpublish', 'schedule', 'restore', 'rebuild'].includes(tx.record.kind)) throw new Error('Invalid publish kind');
      for (const { expectedVersion, nextDoc } of tx.docs) await this.write('docs', nextDoc.id, nextDoc, expectedVersion);
      for (const rev of tx.revisions ?? []) await this.write('revisions', rev.id, rev);
      for (const entry of tx.audit ?? []) await this.write('audit', entry.id, entry);
      await this.write('publishes', String(siteVersion), tx.record);
      await this.write('snapshots', 'published', tx.snapshot);
      return { siteVersion };
    });
  }
  /** PostgreSQL rolls back interrupted transactions; committed retries are checked above. */
  async recoverPublish(): Promise<{ repaired: boolean; siteVersion: number }> {
    return { repaired: false, siteVersion: (await this.getSnapshot())?.siteVersion ?? 0 };
  }
  listPublishes(limit: number, before?: number) {
    return this.all<PublishRecord>('publishes', 'WHERE ($1::int IS NULL OR site_version<$1) ORDER BY site_version DESC LIMIT $2', [before ?? null, pageLimit(limit)]);
  }
  getPublish(siteVersion: number) {
    if (!Number.isSafeInteger(siteVersion) || siteVersion < 1) throw new Error('Invalid site version');
    return this.read<PublishRecord>('publishes', String(siteVersion));
  }
  async listRevisions(collection: CollectionName, id: string, limit: number, before?: string): Promise<Revision[]> {
    const boundary = before ? await this.getRevision(id, before) : null;
    if (before && !boundary && !Number.isFinite(Date.parse(before))) throw new ApiError(422, 'validation', 'Invalid revision cursor');
    const values: unknown[] = [collection, id, pageLimit(limit)]; let clause = '';
    if (boundary) { clause = 'AND (at,doc_version,id COLLATE "C") < ($4,$5,$6)'; values.push(boundary.at, boundary.docVersion, boundary.id); }
    else if (before) { clause = 'AND at<$4'; values.push(before); }
    return this.all<Revision>('revisions', `WHERE collection=$1 AND doc_id=$2 ${clause} ORDER BY at DESC, doc_version DESC, id COLLATE "C" DESC LIMIT $3`, values);
  }
  async getRevision(docId: string, revId: string): Promise<Revision | null> {
    documentId(docId); keyPart(revId);
    return (await this.all<Revision>('revisions', 'WHERE doc_id=$1 AND id=$2', [docId, revId]))[0] ?? null;
  }
  async queryAudit(q: AuditQuery): Promise<{ items: AuditEntry[]; cursor?: string }> {
    const limit = pageLimit(q.limit), values: unknown[] = [], clauses: string[] = [];
    function filter(column: string, value: string | undefined, operator = '=') {
      if (value !== undefined) { values.push(value); clauses.push(`${column}${operator}$${values.length}`); }
    }
    filter('actor_id', q.actorId); filter('action', q.action); filter('collection', q.collection); filter('doc_id', q.docId);
    filter('at', q.from, '>='); filter('at', q.to, '<=');
    if (q.text) { values.push(q.text.toLowerCase()); clauses.push(`strpos(lower(body::text),$${values.length})>0`); }
    if (q.cursor) {
      const cursor = await this.read<AuditEntry>('audit', q.cursor);
      if (!cursor) throw new ApiError(422, 'validation', 'Invalid audit cursor');
      values.push(cursor.at, cursor.id); clauses.push(`(at,id COLLATE "C") < ($${values.length-1},$${values.length})`);
    }
    values.push(limit+1);
    const rows = await this.all<AuditEntry>('audit', `${clauses.length ? 'WHERE '+clauses.join(' AND ') : ''} ORDER BY at DESC,id COLLATE "C" DESC LIMIT $${values.length}`, values);
    return { items: rows.slice(0,limit), ...(rows.length>limit ? {cursor:rows[limit-1].id} : {}) };
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
      await this.checkAudit(entry); await this.write('audit', entry.id, entry);
      await this.saveUser(next); return next;
    });
  }
  changePassword(userId: string, expectedHash: string, hash: string, entry: AuditEntry): Promise<User | null> {
    return this.exclusive(async () => {
      const user = await this.getUser(userId);
      if (!user?.active || user.passwordHash !== expectedHash) return null;
      const next = { ...user, passwordHash: hash, passwordWeak: false, mustChangePassword: false, passwordChangedAt: entry.at, authVersion: (user.authVersion ?? 0) + 1 };
      await this.checkAudit(entry); await this.write('audit', entry.id, entry);
      await this.saveUser(next); return next;
    });
  }
  unlockLogin(name: string, entry: AuditEntry): Promise<void> {
    return this.exclusive(async () => {
      const key = loginGenerationKey(username(name));
      const generation = Number(await this.getMeta(key) ?? 0) + 1;
      await this.checkAudit(entry);
      await this.write('audit', entry.id, entry);
      await this.setMeta(key, generation);
      await this.remove('rate_limits', usernameRateKey(name));
    });
  }
  revokeSessions(userId: string, entry: AuditEntry, options: { hash?: string; except?: string; seal?: boolean } = {}): Promise<boolean> {
    return this.exclusive(async () => {
      const sessions = (await this.listSessions(userId)).filter(s => s.hash !== options.except && (!options.hash || s.hash === options.hash));
      if (options.hash && !sessions.length) return false;
      await this.checkAudit(entry);
      await this.write('audit', entry.id, entry);
      if (options.seal) for (const rev of await this.all<Revision>('revisions')) if (!rev.sealedAt && rev.authorId === userId) await this.write('revisions', rev.id, { ...rev, sealedAt: entry.at });
      for (const session of sessions) await this.remove('sessions', session.hash);
      return true;
    });
  }
  loginFailure(key: string, now: string): Promise<{ failures: number; locks: number; until?: string }> {
    return this.exclusive(async () => {
      const state = await this.getMeta(key) as { failures: number; locks: number; until?: string } | null ?? { failures: 0, locks: 0 };
      if (state.until && Date.parse(state.until) > Date.parse(now)) return state;
      const window = state as typeof state & { windowStart?: string; count?: number };
      if (!window.windowStart || Date.parse(now) - Date.parse(window.windowStart) >= 900000) { state.failures = 0; window.windowStart = now; window.count = 0; }
      window.count = (window.count ?? 0) + 1;
      state.failures++;
      if (state.failures >= 5) { state.failures = 0; state.until = new Date(Date.parse(now) + Math.min(86400, 900 * 2 ** state.locks) * 1000).toISOString(); state.locks++; }
      await this.setMeta(key, state); return state;
    });
  }
  recordAudit(entry: AuditEntry): Promise<void> {
    return this.exclusive(async () => { await this.checkAudit(entry); await this.write('audit', entry.id, entry); });
  }
  bootstrapOwner(user: User, entry: AuditEntry): Promise<boolean> {
    return this.exclusive(async () => {
      if ((await this.listUsers()).length) return false;
      if (user.role !== 'Owner' || !user.active) throw new Error('Bootstrap requires an active Owner');
      await this.checkAudit(entry);
      await this.write('audit', entry.id, entry);
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
      await this.write('audit', entry.id, entry);
      await this.saveUser(user);
    });
  }
  sealWorkingRevisions(authorId: string, before: string, entry: AuditEntry): Promise<void> {
    return this.exclusive(async () => {
      await this.checkAudit(entry);
      let changed = false;
      for (const rev of await this.all<Revision>('revisions')) if (!rev.sealedAt && (authorId === '*' || rev.authorId === authorId) && rev.at <= before) { await this.write('revisions', rev.id, { ...rev, sealedAt: entry.at }); changed = true; }
      if (changed || authorId !== '*') await this.write('audit', entry.id, entry);
    });
  }
  listUsers() { return this.all<User>('users'); }
  getUser(id: string) { return this.read<User>('users', id); }
  async getUserByUsername(username: string): Promise<User | null> {
    keyPart(username);
    return (await this.all<User>('users', 'WHERE username_key=$1', [username.toLowerCase()]))[0] ?? null;
  }
  putUser(user: User): Promise<void> { return this.exclusive(() => this.saveUser(user)); }
  private async saveUser(user: User): Promise<void> {
    username(user.username);
    const old = await this.getUser(user.id);
    if (old && (old.authVersion ?? 0) !== (user.authVersion ?? 0)) for (const session of await this.listSessions(user.id)) await this.remove('sessions', session.hash);
    const owner = await this.getUserByUsername(user.username);
    if (owner && owner.id !== user.id) throw new Error('Username already exists');
    await this.write('users', user.id, user);
  }
  refreshSession(hash: string, now: string): Promise<{ session: Session; refreshed: boolean } | null> {
    return this.exclusive(async () => {
      const session = await this.getSession(hash), time = Date.parse(now);
      if (!session || Date.parse(session.expiresAt) <= time || Date.parse(session.createdAt) + 30 * 86400000 <= time) return null;
      if (time - Date.parse(session.lastSeenAt) < 3600000) return { session, refreshed: false };
      const next = { ...session, lastSeenAt: now, expiresAt: new Date(Math.min(time + 14 * 86400000, Date.parse(session.createdAt) + 30 * 86400000)).toISOString() };
      await this.write('sessions', hash, next);
      return { session: next, refreshed: true };
    });
  }
  getSession(hash: string) { return this.read<Session>('sessions', hash); }
  async putSession(session: Session) { await this.exclusive(() => this.write('sessions', session.hash, session)); }
  async deleteSession(hash: string) { await this.exclusive(() => this.remove('sessions', hash)); }
  async listSessions(userId: string) { return (await this.all<Session>('sessions')).filter(session => session.userId === userId); }
  deleteExpiredSessions(now: string): Promise<number> {
    const cutoff = Date.parse(now);
    if (!Number.isFinite(cutoff)) return Promise.reject(new Error('Invalid session expiry cutoff'));
    return this.exclusive(async () => {
      const expired = (await this.all<Session>('sessions')).filter(session => Date.parse(session.expiresAt) <= cutoff || Date.parse(session.createdAt) + 30 * 86400000 <= cutoff);
      for (const session of expired) await this.remove('sessions', session.hash);
      return expired.length;
    });
  }
  rateLimitHit(key: string, windowSec: number): Promise<{ count: number; resetAt: string }> {
    if (!Number.isFinite(windowSec) || windowSec <= 0) return Promise.reject(new Error('Window must be positive'));
    return this.exclusive(async () => {
      const current = await this.read<{ count: number; resetAt: string }>('rate_limits', key);
      const now = this.now().getTime();
      const next = current && Date.parse(current.resetAt) > now ? { ...current, count: current.count + 1 } : { count: 1, resetAt: new Date(now + windowSec * 1000).toISOString() };
      await this.write('rate_limits', key, next); return next;
    });
  }
  async rateLimitReset(key: string) { await this.exclusive(() => this.remove('rate_limits', key)); }
  async getMeta(key: string) { return this.read('meta', key); }
  async setMeta(key: string, value: unknown) {
    if (key === 'pending-mutation' || key === 'pending-publish') throw new Error('Reserved transaction metadata key');
    await this.exclusive(() => this.write('meta', key, value));
  }
}
