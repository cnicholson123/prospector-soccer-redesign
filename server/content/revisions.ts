import type { Doc, Revision } from '../../shared/types';
import type { Store } from '../store/types';
import { audit, type Actor } from '../audit';
import { documentTitle } from './documents';
import { createHistoryId } from './ids';
import { validate, ValidationError } from './validate';
import { ApiError } from '../http/middleware/errors';
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
  const coalesce = action === 'edited' && latest && !latest.sealedAt && latest.authorId === actor.id && now.getTime() - Date.parse(latest.at) < 600000 && now.getTime() >= Date.parse(latest.at);
  const next = { ...doc, ...options.patch, draft, version: doc.version + 1 };
  const rev = revision(next, actor, action, now, { ...(coalesce ? { id: latest.id } : {}), summary: options.summary, baseRevId: options.baseRevId, ...((action !== 'edited' && action !== 'created') ? { sealedAt: now.toISOString() } : {}) });
  const changed = await store.mutateDoc({ collection: doc.collection, id: doc.id, expectedVersion: baseVersion,
    patch: { ...options.patch, draft, status: options.patch?.status ?? (doc.trashedAt ? 'trashed' : doc.scheduledAt ? 'scheduled' : doc.published === undefined ? 'draft' : 'changed'), updatedAt: now.toISOString(), updatedBy: actor.id },
    revision: coalesce ? { upsert: rev } : { append: rev }, seal: latest && !latest.sealedAt && !coalesce ? [latest.id] : [], audit: audit(actor, options.auditAction ?? `content.${action}`, { collection: doc.collection, docId: doc.id, targetTitle: documentTitle(next), meta: { summary: options.summary } }, now) });
  if (changed === 'conflict') conflict(await store.getDoc(doc.collection, doc.id));
  return changed;
}
