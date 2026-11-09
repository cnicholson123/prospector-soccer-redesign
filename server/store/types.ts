import type { CollectionName } from '../../shared/schema';
import type { AuditEntry, Doc, PublishRecord, Revision, Session, Snapshot, User } from '../../shared/types';
export type { AuditEntry, Doc, PublishRecord, Revision, Session, Snapshot, User } from '../../shared/types';
export interface AuditQuery {
  actorId?: string; action?: string; collection?: CollectionName; docId?: string;
  from?: string; to?: string; text?: string; limit: number; cursor?: string;
}
export interface CreateDoc {
  doc: Doc; revision: Revision; audit: AuditEntry;
}
export interface DocMutation {
  collection: CollectionName; id: string; expectedVersion: number; patch: Partial<Doc>;
  revision?: { upsert: Revision } | { append: Revision };
  seal?: string[]; audit: AuditEntry;
  /** Atomic, metadata-only reorder siblings; share the primary mutation audit. */
  guardVersions?: { id: string; expectedVersion: number }[];
  relatedOrder?: { id: string; expectedVersion: number; order: number }[];
}
export interface PublishTx {
  docs: { expectedVersion: number; nextDoc: Doc }[];
  snapshot: Snapshot; record: PublishRecord; revisions?: Revision[]; audit?: AuditEntry[];
}
export interface Store {
  getDoc(collection: CollectionName, id: string): Promise<Doc | null>;
  listDocs(collection: CollectionName, opts?: { includeTrashed?: boolean }): Promise<Doc[]>;
  createDoc(input: CreateDoc): Promise<Doc>;
  mutateDoc(mutation: DocMutation): Promise<Doc | 'conflict'>;
  getSnapshot(): Promise<Snapshot | null>;
  publish(tx: PublishTx): Promise<{ siteVersion: number }>;
  recoverPublish(): Promise<{ repaired: boolean; siteVersion: number }>;
  listPublishes(limit: number, before?: number): Promise<PublishRecord[]>;
  getPublish(siteVersion: number): Promise<PublishRecord | null>;
  listRevisions(collection: CollectionName, id: string, limit: number, before?: string): Promise<Revision[]>;
  getRevision(docId: string, revId: string): Promise<Revision | null>;
  queryAudit(q: AuditQuery): Promise<{ items: AuditEntry[]; cursor?: string }>;
  claimMaintenance(key: string, intervalMs: number, now: string): Promise<boolean>;
  recordLogin(userId: string, expectedHash: string, weak: boolean, audit: AuditEntry): Promise<User | null>;
  changePassword(userId: string, expectedHash: string, hash: string, audit: AuditEntry): Promise<User | null>;
  loginFailure(key: string, now: string): Promise<{ failures: number; locks: number; until?: string }>;
  recordAudit(entry: AuditEntry): Promise<void>;
  bootstrapOwner(user: User, audit: AuditEntry): Promise<boolean>;
  changeUser(user: User, actorId: string, audit: AuditEntry, expected: User | null): Promise<void>;
  sealWorkingRevisions(authorId: string, before: string, audit: AuditEntry): Promise<void>;
  listUsers(): Promise<User[]>;
  getUser(id: string): Promise<User | null>;
  getUserByUsername(username: string): Promise<User | null>;
  putUser(user: User): Promise<void>;
  refreshSession(hash: string, now: string): Promise<{ session: Session; refreshed: boolean } | null>;
  getSession(hash: string): Promise<Session | null>;
  putSession(session: Session): Promise<void>;
  deleteSession(hash: string): Promise<void>;
  listSessions(userId: string): Promise<Session[]>;
  deleteExpiredSessions(now: string): Promise<number>;
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

export interface MediaStorage extends MediaBlobs {
  url(path: string): string;
  read(path: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number; contentType: string } | null>;
  /** Only incoming quarantine objects; verified assets have no binary GC. */
  incoming(): Promise<{ path: string; uploadedAt: string }[]>;
  clientUpload(request: Request, body: unknown, grant?: { path: string; mime: string; size: number; expires: number }): Promise<unknown>;
}
