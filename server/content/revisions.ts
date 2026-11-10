import type { Doc, Revision } from '../../shared/types.js';
import type { DocMutation, Store } from '../store/types.js';
import { audit, type Actor } from '../audit.js';
import { documentTitle } from './documents.js';
import { createHistoryId } from './ids.js';
import { validate, ValidationError } from './validate.js';
import { ApiError } from '../http/middleware/errors.js';
export function revision(doc: Doc, actor: Actor, action: Revision['action'], now: Date, extras: Partial<Revision> = {}): Revision {
  return { id: createHistoryId('rev', now), collection: doc.collection, docId: doc.id, docVersion: doc.version, authorId: actor.id, authorName: actor.displayName, at: now.toISOString(), data: structuredClone(doc.draft), action, ...extras };
}
export function conflict(current: Doc | null): never { throw new ApiError(409, 'conflict', 'Someone else saved this. Reload and compare', { current }); }
export async function saveDraft(store: Store, doc: Doc, baseVersion: number, draft: unknown, actor: Actor, now: Date, options: { auditAction?: string; checkpoint?: boolean; summary?: string; action?: Revision['action']; baseRevId?: string; patch?: Partial<Doc> } = {}) {
  if (doc.version !== baseVersion) conflict(doc);
  const result = validate(doc.collection, draft);
  if (!result.valid) throw new ValidationError(result.errors);
  const latest = (await store.listRevisions(doc.collection, doc.id, 1))[0];
  const action = options.action ?? (options.checkpoint ? 'checkpoint' : 'edited');
  const coalesce = action === 'edited' && latest?.action === 'edited' && !latest.sealedAt && latest.authorId === actor.id && now.getTime() - Date.parse(latest.at) < 600000 && now.getTime() >= Date.parse(latest.at);
  const next = { ...doc, ...options.patch, draft, version: doc.version + 1 };
  const rev = revision(next, actor, action, now, { ...(coalesce ? { id: latest.id } : {}), summary: options.summary, baseRevId: options.baseRevId, ...((action !== 'edited' && action !== 'created') ? { sealedAt: now.toISOString() } : {}) });
  const mutation: DocMutation = { collection: doc.collection, id: doc.id, expectedVersion: baseVersion,
    patch: { ...options.patch, draft, status: options.patch?.status ?? (doc.trashedAt ? 'trashed' : doc.scheduledAt ? 'scheduled' : doc.published === undefined ? 'draft' : 'changed'), updatedAt: now.toISOString(), updatedBy: actor.id },
    revision: coalesce ? { upsert: rev } : { append: rev }, seal: latest && !latest.sealedAt && !coalesce ? [latest.id] : [], audit: audit(actor, options.auditAction ?? `content.${action}`, { collection: doc.collection, docId: doc.id, targetTitle: documentTitle(next), meta: { summary: options.summary } }, now) };
  let changed: Doc | 'conflict';
  try { changed = await store.mutateDoc(mutation); }
  catch (error) {
    // Logout/maintenance can seal after the coalesce read. The failed mutation
    // is atomic, so retry once with a fresh revision and the same document CAS.
    if (!coalesce || !(error instanceof Error) || error.message !== 'Cannot modify sealed revision'
      || !(await store.getRevision(doc.id, latest.id))?.sealedAt) throw error;
    changed = await store.mutateDoc({ ...mutation, revision: { append: { ...rev, id: createHistoryId('rev', now) } }, seal: [] });
  }
  if (changed === 'conflict') conflict(await store.getDoc(doc.collection, doc.id));
  return changed;
}
