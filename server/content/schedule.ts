import type { Store } from '../store/types';
import type { Actor } from '../audit';
import { allDocs, commitSnapshot, select, type Item } from './publish';
import { validateFields } from './validate';
import { ApiError } from '../http/middleware/errors';
export async function scheduleDocuments(store: Store, items: Item[], at: string | null, actor: Actor, now: Date) {
  if (at !== null && (!validateFields({ at: { type: 'datetime', required: true } }, { at }).valid || Date.parse(at) <= now.getTime())) throw new ApiError(422, 'validation', 'Choose a future datetime with timezone');
  await store.recoverPublish();
  const docs = await allDocs(store), selected = select(docs, items), current = await store.getSnapshot();
  if (selected.some(d => d.trashedAt)) throw new ApiError(422, 'validation', 'Cannot schedule trashed content');
  const scheduled = (current?.scheduled ?? []).filter(s => !selected.some(d => d.collection === s.collection && d.id === s.id));
  if (at) scheduled.push(...selected.map(d => ({ collection: d.collection, id: d.id, at: new Date(at).toISOString(), data: structuredClone(d.draft), version: d.version, order: d.order ?? 0 })));
  const changes = selected.map(d => ({ ...d, scheduledAt: at ?? undefined, status: at ? 'scheduled' as const : d.published === undefined ? 'draft' as const : d.publishedVersion === d.version ? 'published' as const : 'changed' as const }));
  return commitSnapshot(store, docs, changes, actor, now, { kind: 'schedule', action: at ? 'content.schedule' : 'content.schedule_cancel', scheduled });
}
export async function settleSchedules(store: Store, now: Date, actor: Actor = { id: 'system', displayName: 'Scheduler' }) {
  await store.recoverPublish();
  const snapshot = await store.getSnapshot(), due = snapshot?.scheduled.filter(s => Date.parse(s.at) <= now.getTime()) ?? [];
  if (!due.length) return { settled: 0, siteVersion: snapshot?.siteVersion ?? 0 };
  const docs = await allDocs(store);
  const changes = due.map(item => {
    const doc = docs.find(d => d.collection === item.collection && d.id === item.id);
    if (!doc) throw new ApiError(409, 'conflict', 'Scheduled document is missing');
    return { ...doc, published: item.data, publishedVersion: item.version, publishedOrder: item.order, scheduledAt: undefined, reviewRequestedBy: undefined, reviewNote: undefined, status: doc.trashedAt ? 'trashed' as const : doc.version === item.version ? 'published' as const : 'changed' as const };
  });
  const result = await commitSnapshot(store, docs, changes, actor, now, { kind: 'publish', action: 'content.schedule_settle', scheduled: snapshot!.scheduled.filter(s => !due.includes(s)), effectiveAt: due.map(s => s.at).sort().at(-1) });
  return { ...result, settled: due.length };
}
