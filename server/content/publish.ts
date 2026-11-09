import { isDeepStrictEqual } from 'node:util';
import { collectionNames, type CollectionName } from '../../shared/schema';
import type { Doc, PublishRecord, Revision, ScheduledItem } from '../../shared/types';
import type { Store } from '../store/types';
import { audit, type Actor } from '../audit';
import { buildSnapshot } from './snapshot';
import { revision, conflict } from './revisions';
import { purgeContent } from '../render/cdn';
import { ApiError } from '../http/middleware/errors';
import { references } from './references';
import { documentTitle as title } from './documents';
export { documentTitle as title } from './documents';
export interface Item { collection: CollectionName; id: string; expectedVersion: number }
export const allDocs = async (store: Store) => (await Promise.all(collectionNames.map(c => store.listDocs(c, { includeTrashed: true })))).flat();
export const pending = (docs: Doc[]) => docs.filter(doc => doc.trashedAt ? doc.published !== undefined : doc.published === undefined || !isDeepStrictEqual(doc.draft, doc.published) || doc.version !== doc.publishedVersion);
export function select(docs: Doc[], items: Item[]) {
  const seen = new Set<string>();
  return items.map(item => {
    const key = item.collection + '/' + item.id;
    if (seen.has(key)) throw new ApiError(422, 'validation', 'Duplicate item');
    seen.add(key);
    const doc = docs.find(d => d.collection === item.collection && d.id === item.id);
    if (!doc) throw new ApiError(404, 'not_found', 'Document not found');
    if (doc.version !== item.expectedVersion) conflict(doc);
    return doc;
  });
}
export async function commitSnapshot(store: Store, original: Doc[], changes: Doc[], actor: Actor, now: Date, options: { kind: PublishRecord['kind']; summary?: string; scheduled?: ScheduledItem[]; restoredFrom?: number; effectiveAt?: string; action?: string }) {
  const current = await store.getSnapshot();
  const siteVersion = (current?.siteVersion ?? 0) + 1;
  const next = original.map(doc => changes.find(d => d.id === doc.id && d.collection === doc.collection) ?? { ...doc });
  // Newly referenced media metadata participates in the versioned snapshot too.
  for (const ref of next.filter(d => d.published !== undefined && !d.trashedAt).flatMap(d => references(d.collection, d.published)).concat((options.scheduled ?? current?.scheduled ?? []).flatMap(d => references(d.collection, d.data)))) {
    if (ref.collection !== 'media') continue;
    const media = next.find(d => d.collection === 'media' && d.id === ref.id);
    if (media && media.published === undefined && !media.trashedAt) Object.assign(media, { published: structuredClone(media.draft), publishedVersion: media.version, status: 'published' });
  }
  const revisions: Revision[] = [], manifest: PublishRecord['manifest'] = [];
  const previous = current ? await store.getPublish(current.siteVersion) : null;
  for (const doc of next) {
    const changed = changes.some(d => d.id === doc.id && d.collection === doc.collection);
    if (changed) {
      for (const old of await store.listRevisions(doc.collection, doc.id, 1000)) if (!old.sealedAt) revisions.push({ ...old, sealedAt: now.toISOString() });
      if (options.kind === 'schedule') revisions.push(revision(doc, actor, 'scheduled', now, { sealedAt: now.toISOString(), publishSiteVersion: siteVersion }));
      else if (doc.published === undefined) revisions.push(revision(doc, actor, 'unpublished', now, { sealedAt: now.toISOString(), publishSiteVersion: siteVersion, summary: options.summary }));
    }
    if (doc.published === undefined || doc.trashedAt || doc.status === 'trashed') continue;
    const prior = previous?.manifest.find(e => e.collection === doc.collection && e.id === doc.id && e.version === doc.publishedVersion);
    let revId = prior?.revId;
    if (!revId || changed) {
      const rev = revision({ ...doc, draft: doc.published, version: doc.publishedVersion ?? doc.version }, actor, options.kind === 'restore' ? 'site_restored' : 'published', now, { sealedAt: now.toISOString(), publishSiteVersion: siteVersion, summary: options.summary });
      revisions.push(rev); revId = rev.id;
    }
    manifest.push({ collection: doc.collection, id: doc.id, version: doc.publishedVersion ?? doc.version, order: doc.publishedOrder ?? doc.order ?? 0, title: title(doc, doc.published), revId });
  }
  const snapshot = buildSnapshot(next, { siteVersion, publishedAt: now.toISOString(), templateHash: current?.templateHash ?? '', scheduled: options.scheduled ?? current?.scheduled ?? [], effectiveAt: options.effectiveAt ?? current?.effectiveAt }, manifest);
  try {
    // Guard every input used to assemble the snapshot, including unchanged docs.
    await store.publish({ docs: next.map(doc => ({ expectedVersion: original.find(d => d.id === doc.id && d.collection === doc.collection)!.version, nextDoc: doc })), snapshot, revisions,
      record: { siteVersion, at: now.toISOString(), actorId: actor.id, summary: options.summary, kind: options.kind, manifest, restoredFrom: options.restoredFrom },
      audit: [audit(actor, options.action ?? `content.${options.kind}`, { meta: { siteVersion, items: changes.map(d => ({ collection: d.collection, id: d.id })) } }, now)] });
  } catch (error) {
    if (error instanceof Error && /version conflict|pending publish/i.test(error.message)) throw new ApiError(409, 'conflict', 'Someone else saved this. Reload and compare', { current: await store.getSnapshot() });
    throw error;
  }
  const purged = await purgeContent();
  return { siteVersion, purged, message: purged ? 'Live now' : 'Live within about 5 minutes' };
}
export async function publishDocuments(store: Store, items: Item[], actor: Actor, now: Date, summary?: string, unpublish = false) {
  await store.recoverPublish();
  const docs = await allDocs(store), selected = select(docs, items);
  const snapshot = await store.getSnapshot();
  const changes = selected.map(doc => ({ ...doc, published: unpublish || doc.trashedAt ? undefined : structuredClone(doc.draft), publishedVersion: unpublish || doc.trashedAt ? undefined : doc.version, publishedOrder: unpublish || doc.trashedAt ? undefined : doc.order ?? 0, scheduledAt: undefined, reviewRequestedBy: undefined, reviewNote: undefined, status: doc.trashedAt ? 'trashed' as const : unpublish ? 'draft' as const : 'published' as const }));
  return commitSnapshot(store, docs, changes, actor, now, { kind: unpublish ? 'unpublish' : 'publish', summary, scheduled: (snapshot?.scheduled ?? []).filter(s => !selected.some(d => d.id === s.id && d.collection === s.collection)) });
}
