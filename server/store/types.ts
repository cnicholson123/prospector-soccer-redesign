import type { CollectionName } from '../../shared/schema';
import type { AuditEntry, Doc, PublishRecord, Revision, Session, Snapshot, User } from '../../shared/types';
export type { AuditEntry, Doc, PublishRecord, Revision, Session, Snapshot, User } from '../../shared/types';
export interface AuditQuery {
  actorId?: string; action?: string; collection?: CollectionName; docId?: string;
  from?: string; to?: string; text?: string; limit: number; cursor?: string;
}
/** Final doc envelopes, CAS-checked against each doc.version, snapshot committed last. */
export interface PublishTx {
  docs: Doc[]; snapshot: Snapshot; record: PublishRecord; revisions?: Revision[]; audit?: AuditEntry[];
}
export interface Store {
  getDoc(collection: CollectionName, id: string): Promise<Doc | null>;
  listDocs(collection: CollectionName, opts?: { includeTrashed?: boolean }): Promise<Doc[]>;
  createDoc(doc: Doc): Promise<Doc>;
  updateDoc(collection: CollectionName, id: string, expectedVersion: number, patch: Partial<Doc>): Promise<Doc | 'conflict'>;
  getSnapshot(): Promise<Snapshot | null>;
  publish(tx: PublishTx): Promise<{ siteVersion: number }>;
  listPublishes(limit: number, before?: number): Promise<PublishRecord[]>;
  getPublish(siteVersion: number): Promise<PublishRecord | null>;
  appendRevision(rev: Revision): Promise<void>;
  upsertWorkingRevision(rev: Revision): Promise<void>;
  sealRevision(revId: string): Promise<void>;
  listRevisions(collection: CollectionName, id: string, limit: number, before?: string): Promise<Revision[]>;
  getRevision(revId: string): Promise<Revision | null>;
  appendAudit(entry: AuditEntry): Promise<void>;
  queryAudit(q: AuditQuery): Promise<{ items: AuditEntry[]; cursor?: string }>;
  listUsers(): Promise<User[]>;
  getUser(id: string): Promise<User | null>;
  getUserByUsername(username: string): Promise<User | null>;
  putUser(user: User): Promise<void>;
  getSession(hash: string): Promise<Session | null>;
  putSession(session: Session): Promise<void>;
  deleteSession(hash: string): Promise<void>;
  listSessions(userId: string): Promise<Session[]>;
  rateLimitHit(key: string, windowSec: number): Promise<{ count: number; resetAt: string }>;
  rateLimitReset(key: string): Promise<void>;
  getMeta(key: string): Promise<unknown>;
  setMeta(key: string, value: unknown): Promise<void>;
}
export interface MediaBlobs {
  put(path: string, body: Uint8Array | ReadableStream<Uint8Array>, opts: { contentType: string }): Promise<{ url: string }>;
  delete(url: string): Promise<void>;
}
export interface KvPrimitives {
  get(key: string): Promise<unknown | null>;
  put(key: string, value: unknown): Promise<void>;
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}
export type RunExclusive = <T>(operation: () => Promise<T>) => Promise<T>;
