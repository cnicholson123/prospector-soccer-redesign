import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { Doc, PublishRecord, Revision } from '../shared/types.js';
import type { Store } from '../server/store/types.js';
import { createStore } from '../server/store/index.js';
import { audit } from '../server/audit.js';
import { createHistoryId } from '../server/content/ids.js';
import { documentTitle } from '../server/content/documents.js';
import { buildSnapshot } from '../server/content/snapshot.js';
import { validate } from '../server/content/validate.js';
import { purgeContent } from '../server/render/cdn.js';
import { loadSeed } from './seed.js';

const actor = { id: 'seed', displayName: 'Store showcase seed' };
const marker = 'seed:store';
/** Deliberately excludes every legacy site document, FAQ and media record. */
export function isStoreSeed(doc: Doc): boolean {
  return ['products', 'bundles', 'categories', 'shopPage', 'storeSettings'].includes(doc.collection)
    || (doc.collection === 'faqs' && (doc.draft as { page?: string }).page === 'shop')
    || (doc.collection === 'media' && doc.id.startsWith('media_shop_'));
}
const creation = (seed: Doc, now: Date): Doc => ({ ...seed, published: undefined, publishedVersion: undefined,
  status: 'draft', createdAt: now.toISOString(), updatedAt: now.toISOString(), createdBy: actor.id, updatedBy: actor.id });
const publication = (doc: Doc, now: Date): Doc => ({ ...doc, version: doc.version + 1,
  published: structuredClone(doc.draft), publishedVersion: doc.version + 1, publishedOrder: doc.order ?? 0,
  status: 'published', updatedAt: now.toISOString(), updatedBy: actor.id });

/** Add missing showcase content to an initialized store; never reset existing content. */
export async function seedStoreShowcase(store: Store): Promise<{ created: number; published: number; preserved: number; siteVersion: number }> {
  await store.recoverPublish();
  const seeds = (await loadSeed()).filter(isStoreSeed);
  const initial = await store.capturePublication();
  const previous = initial.snapshot && await store.getPublish(initial.snapshot.siteVersion);
  if (!initial.snapshot || !previous) throw new Error('seed:store requires an initialized store with publication history; use seed only for a new empty store');
  const now = new Date();
  // Only this command's untouched, unpublished creations can resume after interruption.
  const eligible = async (doc: Doc, seed: Doc) => {
    if (doc.version !== 1 || doc.status !== 'draft' || doc.published !== undefined || doc.trashedAt
      || doc.scheduledAt || doc.createdBy !== actor.id || doc.updatedBy !== actor.id
      || !isDeepStrictEqual(doc.draft, seed.draft) || doc.order !== seed.order) return false;
    return (await store.listRevisions(doc.collection, doc.id, 10)).some(rev => rev.action === 'created'
      && rev.docVersion === 1 && rev.authorId === actor.id && rev.summary === marker && isDeepStrictEqual(rev.data, doc.draft));
  };
  const pending = new Set<string>();
  const missing: Doc[] = [];
  for (const seed of seeds) {
    const current = initial.docs.find(doc => doc.id === seed.id);
    if (current && current.collection !== seed.collection) throw new Error(`Seed ID collision: ${seed.id}`);
    if (!current) { missing.push(seed); pending.add(seed.id); }
    else if (await eligible(current, seed)) pending.add(seed.id);
  }
  // Validate the intended combined publication before creating anything. Existing
  // drafts, trash, schedules, media and published copy are never made live here.
  const proposed = [...initial.docs, ...missing.map(seed => creation(seed, now))]
    .map(doc => pending.has(doc.id) ? publication(doc, now) : doc);
  for (const doc of proposed.filter(doc => pending.has(doc.id))) {
    const result = validate(doc.collection, doc.published, { mode: 'publish', id: doc.id, documents: proposed,
      resolve: (collection, id) => proposed.find(target => target.collection === collection && target.id === id) ?? null });
    if (!result.valid) throw new Error(`Invalid store seed ${doc.collection}/${doc.id}: ${JSON.stringify(result.errors)}`);
  }
  let created = 0;
  for (const seed of missing) {
    const doc = creation(seed, now);
    // createDoc is atomic and rejects duplicate IDs; a concurrent writer is never overwritten.
    await store.createDoc({ doc,
      revision: { id: createHistoryId('rev', now), collection: doc.collection, docId: doc.id, docVersion: 1,
        authorId: actor.id, authorName: actor.displayName, at: now.toISOString(), sealedAt: now.toISOString(),
        action: 'created', summary: marker, data: doc.draft },
      audit: audit(actor, 'content.create', { collection: doc.collection, docId: doc.id,
        targetTitle: documentTitle(doc), meta: { source: marker } }, now) });
    created++;
  }
  const capture = await store.capturePublication();
  const publish: Doc[] = [];
  for (const seed of seeds) {
    const doc = capture.docs.find(doc => doc.id === seed.id && doc.collection === seed.collection);
    if (doc && pending.has(doc.id) && await eligible(doc, seed)) publish.push(publication(doc, now));
  }
  const siteVersion = capture.snapshot!.siteVersion;
  if (!publish.length) return { created, published: 0, preserved: seeds.length, siteVersion };
  const record = await store.getPublish(siteVersion);
  if (!record) throw new Error('Missing publication history; store seed stopped');
  const next = capture.docs.map(doc => publish.find(change => change.id === doc.id) ?? doc);
  const revisions: Revision[] = publish.map(doc => ({ id: createHistoryId('rev', now), collection: doc.collection,
    docId: doc.id, docVersion: doc.version, authorId: actor.id, authorName: actor.displayName,
    at: now.toISOString(), sealedAt: now.toISOString(), action: 'published', summary: marker,
    data: doc.published, publishSiteVersion: siteVersion + 1 }));
  const manifest: PublishRecord['manifest'] = [...record.manifest];
  for (const doc of publish) manifest.push({ collection: doc.collection, id: doc.id, version: doc.version,
    order: doc.publishedOrder!, title: documentTitle(doc), revId: revisions.find(rev => rev.docId === doc.id)!.id });
  const snapshot = buildSnapshot(next, { ...capture.snapshot!, siteVersion: siteVersion + 1,
    publishedAt: now.toISOString() }, manifest);
  await store.publish({
    // Only seed-owned new documents are written. The Store checks their CAS
    // versions and reconstructs/compares the snapshot under its writer lock,
    // rejecting concurrent publication changes without reverting other edits.
    docs: publish.map(nextDoc => ({ expectedVersion: nextDoc.version - 1, nextDoc })),
    snapshot, revisions,
    record: { siteVersion: siteVersion + 1, at: now.toISOString(), actorId: actor.id,
      kind: 'publish', summary: 'Add missing store showcase content', manifest },
    audit: [audit(actor, 'content.publish', { meta: { source: marker, siteVersion: siteVersion + 1,
      items: publish.map(doc => ({ collection: doc.collection, id: doc.id })) } }, now)],
  });
  await purgeContent();
  return { created, published: publish.length, preserved: seeds.length - publish.length, siteVersion: siteVersion + 1 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 2) throw new Error('seed:store accepts no arguments; existing documents cannot be forced or reset');
  const result = await seedStoreShowcase(createStore());
  console.log(`Store showcase: ${result.created} created, ${result.published} published, ${result.preserved} preserved; site version ${result.siteVersion}`);
}
