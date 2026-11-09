import { createHash } from 'node:crypto';
import { diff } from './diff.js';
import type { SiteComparison } from '../../shared/history.js';
import type { Store } from '../store/types.js';
import type { Actor } from '../audit.js';
import { saveDraft } from './revisions.js';
import { allDocs, commitSnapshot, publishDocuments, title } from './publish.js';
import { ApiError } from '../http/middleware/errors.js';
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
  if (!publish) return { doc };
  // These are sequential actions; keep their audit order even with a frozen
  // request clock (history IDs have random suffixes within a millisecond).
  try { const result = await publishDocuments(store, [{ collection: doc.collection, id: doc.id, expectedVersion: doc.version }], actor, new Date(now.getTime() + 1)); return { ...result, doc: (await store.getDoc(doc.collection, doc.id))!, published: true }; }
  catch (error) {
    // The draft is committed. Return it explicitly even if publication fails.
    return { doc, published: false, publishError: error instanceof ApiError ? { code: error.code, message: error.message, details: error.details } : { code: 'internal', message: 'Publication failed; restored draft was saved' } };
  }
}
const comparisonToken = (capture: Awaited<ReturnType<Store['capturePublication']>>) => createHash('sha256').update(JSON.stringify({ snapshot: capture.snapshot, docs: [...capture.docs].sort((a, b) => a.id.localeCompare(b.id)) })).digest('hex');
export async function compareSite(store: Store, siteVersion: number): Promise<SiteComparison> {
  const publish = await store.getPublish(siteVersion);
  if (!publish) throw new ApiError(404, 'not_found', 'Site version not found');
  const capture = await store.capturePublication();
  const changes: SiteComparison['changes'] = [];
  for (const doc of capture.docs) {
    const entry = publish.manifest.find(e => e.id === doc.id && e.collection === doc.collection);
    const rev = entry ? await store.getRevision(doc.id, entry.revId) : null;
    if (entry && !rev) throw new ApiError(409, 'conflict', 'Historical revision is missing');
    const current = capture.snapshot?.docs[doc.collection]?.find(d => d.id === doc.id);
    const effects: string[] = [];
    if (entry) {
      if (doc.trashedAt) effects.push('Restore from trash');
      if (doc.reviewRequestedBy) effects.push('Clear review request');
      if (doc.order !== entry.order) effects.push(`Draft order: ${doc.order ?? 0} → ${entry.order}`);
      if (current?.order !== entry.order) effects.push(`Live order: ${current?.order ?? 'not live'} → ${entry.order}`);
    }
    if (doc.scheduledAt || capture.snapshot?.scheduled.some(s => s.id === doc.id && s.collection === doc.collection)) effects.push('Cancel scheduled publication');
    if (!entry) effects.push(doc.published !== undefined || current ? 'Remove from live site; keep draft' : 'Keep unpublished draft; record a new revision');
    const draftDiff = entry ? diff(doc.collection, doc.draft, rev!.data) : [];
    const liveDiff = diff(doc.collection, current?.data, entry ? rev!.data : undefined);
    if (entry || effects.length || liveDiff.length) changes.push({ collection: doc.collection, id: doc.id, title: entry?.title ?? title(doc), operation: entry ? 'restore' : current || doc.published !== undefined ? 'unpublish' : 'keep', draftDiff, liveDiff, effects, diff: diff(doc.collection, entry ? rev!.data : undefined, current?.data), order: { before: entry?.order, after: current?.order } });
  }
  if (publish.manifest.some(e => !capture.docs.some(d => d.id === e.id && d.collection === e.collection))) throw new ApiError(409, 'conflict', 'Historical document is missing');
  return { publish, currentSiteVersion: capture.snapshot?.siteVersion ?? 0, token: comparisonToken(capture), changes };
}
export async function restoreSite(store: Store, siteVersion: number, actor: Actor, now: Date, summary?: string, token?: string) {
  await store.recoverPublish();
  const record = await store.getPublish(siteVersion);
  if (!record) throw new ApiError(404, 'not_found', 'Site version not found');
  const capture = await store.capturePublication(), { docs } = capture, changes = [];
  if (token !== undefined && token !== comparisonToken(capture)) throw new ApiError(409, 'conflict', 'The site changed after your comparison. Compare again before restoring.');
  for (const doc of docs) {
    const entry = record.manifest.find(e => e.collection === doc.collection && e.id === doc.id);
    if (!entry) { changes.push({ ...doc, published: undefined, publishedVersion: undefined, scheduledAt: undefined, status: doc.trashedAt ? 'trashed' as const : 'draft' as const }); continue; }
    const rev = await store.getRevision(doc.id, entry.revId);
    if (!rev) throw new ApiError(409, 'conflict', 'Historical revision is missing');
    changes.push({ ...doc, draft: structuredClone(rev.data), published: structuredClone(rev.data), version: doc.version + 1, publishedVersion: doc.version + 1, order: entry.order, publishedOrder: entry.order, status: 'published' as const, updatedAt: now.toISOString(), updatedBy: actor.id, trashedAt: undefined, trashedBy: undefined, scheduledAt: undefined, reviewRequestedBy: undefined, reviewNote: undefined });
  }
  if (record.manifest.some(e => !docs.some(d => d.id === e.id && d.collection === e.collection))) throw new ApiError(409, 'conflict', 'Historical document is missing');
  return commitSnapshot(store, capture, changes, actor, now, { kind: 'restore', restoredFrom: siteVersion, summary, scheduled: [], action: 'site.restore' });
}
