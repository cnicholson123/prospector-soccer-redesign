import type { Store } from '../store/types';
import type { Actor } from '../audit';
import { saveDraft } from './revisions';
import { allDocs, commitSnapshot, publishDocuments } from './publish';
import { ApiError } from '../http/middleware/errors';
export async function findRevision(store: Store, id: string, docId?: string) {
  if (docId) return store.getRevision(docId, id);
  // Compatibility for the plan's unscoped URL; clients should send ?docId=.
  for (const doc of await allDocs(store)) { const rev = await store.getRevision(doc.id, id); if (rev) return rev; }
  return null;
}
export async function restoreRevision(store: Store, revId: string, baseVersion: number, actor: Actor, now: Date, publish = false, docId?: string) {
  const rev = await findRevision(store, revId, docId);
  if (!rev) throw new ApiError(404, 'not_found', 'Revision not found');
  const current = await store.getDoc(rev.collection, rev.docId);
  if (!current) throw new ApiError(404, 'not_found', 'Document not found');
  const doc = await saveDraft(store, current, baseVersion, rev.data, actor, now, { action: 'restored', baseRevId: rev.id });
  return publish ? { doc, ...await publishDocuments(store, [{ collection: doc.collection, id: doc.id, expectedVersion: doc.version }], actor, now) } : { doc };
}
export async function restoreSite(store: Store, siteVersion: number, actor: Actor, now: Date, summary?: string) {
  await store.recoverPublish();
  const record = await store.getPublish(siteVersion);
  if (!record) throw new ApiError(404, 'not_found', 'Site version not found');
  const docs = await allDocs(store), changes = [];
  for (const doc of docs) {
    const entry = record.manifest.find(e => e.collection === doc.collection && e.id === doc.id);
    if (!entry) { changes.push({ ...doc, published: undefined, publishedVersion: undefined, scheduledAt: undefined, status: doc.trashedAt ? 'trashed' as const : 'draft' as const }); continue; }
    const rev = await store.getRevision(doc.id, entry.revId);
    if (!rev) throw new ApiError(409, 'conflict', 'Historical revision is missing');
    changes.push({ ...doc, draft: structuredClone(rev.data), published: structuredClone(rev.data), version: doc.version + 1, publishedVersion: doc.version + 1, order: entry.order, publishedOrder: entry.order, status: 'published' as const, updatedAt: now.toISOString(), updatedBy: actor.id, trashedAt: undefined, trashedBy: undefined, scheduledAt: undefined, reviewRequestedBy: undefined, reviewNote: undefined });
  }
  if (record.manifest.some(e => !docs.some(d => d.id === e.id && d.collection === e.collection))) throw new ApiError(409, 'conflict', 'Historical document is missing');
  return commitSnapshot(store, docs, changes, actor, now, { kind: 'restore', restoredFrom: siteVersion, summary, scheduled: [], action: 'site.restore' });
}
