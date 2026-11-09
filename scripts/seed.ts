import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { collectionNames, collections } from '../shared/schema';
import type { Doc, PublishedDoc, Revision, Snapshot } from '../shared/types';
import { validate } from '../server/content/validate';
import { createStore } from '../server/store';
import type { Store } from '../server/store/types';
import { templateHash } from '../server/render/handler';

export async function loadSeed(): Promise<Doc[]> {
  const docs: Doc[] = [];
  for (const collection of collectionNames) {
    const records: { id: string; data: unknown }[] = JSON.parse(await readFile(new URL(`../content/seed/${collection}.json`, import.meta.url), 'utf8'));
    for (const [order, record] of records.entries()) {
      const result = validate(collection, record.data);
      if (!result.valid) throw new Error(`Invalid seed ${collection}/${record.id}: ${JSON.stringify(result.errors)}`);
      docs.push({ id: record.id, collection, draft: record.data, published: structuredClone(record.data), version: 1,
        publishedVersion: 1, order, status: 'published', createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z', createdBy: 'seed', updatedBy: 'seed' });
    }
  }
  if (new Set(docs.map(doc => doc.id)).size !== docs.length) throw new Error('Seed document IDs must be globally unique');
  return docs;
}
export function seedSnapshot(docs: Doc[], siteVersion = 1, at = '2026-11-09T00:00:00.000Z'): Snapshot {
  const published: Snapshot['docs'] = {};
  for (const doc of docs) {
    if (doc.published === undefined || doc.status === 'trashed') continue;
    (published[doc.collection] ??= []).push({ id: doc.id, collection: doc.collection, data: doc.published,
      version: doc.publishedVersion ?? doc.version, order: doc.order } satisfies PublishedDoc);
  }
  return { siteVersion, publishedAt: at, docs: published, scheduled: [], templateHash };
}
/** Validate the entire migration and check edit protection before touching storage. */
export async function seedStore(store: Store, force = false): Promise<{ changed: boolean; count: number }> {
  const seeds = await loadSeed();
  const existing = await Promise.all(seeds.map(doc => store.getDoc(doc.collection, doc.id)));
  const protectedDoc = existing.find(doc => doc && doc.version > 1);
  const snapshot = await store.getSnapshot();
  const unchanged = existing.every((doc, index) => doc && JSON.stringify(doc.draft) === JSON.stringify(seeds[index].draft) && JSON.stringify(doc.published) === JSON.stringify(seeds[index].published));
  if (snapshot && unchanged) return { changed: false, count: seeds.length };
  if (protectedDoc && !force) throw new Error(`Refusing to overwrite edited ${protectedDoc.collection}/${protectedDoc.id} (version ${protectedDoc.version}); use --force deliberately`);
  const at = new Date().toISOString();
  const updated: Doc[] = [];
  for (const [index, seed] of seeds.entries()) {
    const current = existing[index];
    if (!current) updated.push(await store.createDoc({ ...seed, createdAt: at, updatedAt: at }));
    else if (JSON.stringify(current.draft) === JSON.stringify(seed.draft) && JSON.stringify(current.published) === JSON.stringify(seed.published)) updated.push(current);
    else {
      const doc = await store.updateDoc(seed.collection, seed.id, current.version, { draft: seed.draft, published: seed.published,
        publishedVersion: current.version + 1, status: 'published', order: seed.order, updatedAt: at, updatedBy: 'seed' });
      if (doc === 'conflict') throw new Error(`Seed conflict for ${seed.collection}/${seed.id}; retry after stopping other writers`);
      updated.push(doc);
    }
  }
  const allDocs = (await Promise.all(collectionNames.map(collection => store.listDocs(collection)))).flat();
  const siteVersion = (snapshot?.siteVersion ?? 0) + 1;
  const revisions: Revision[] = [];
  const manifest = [];
  for (const doc of allDocs.filter(doc => doc.published !== undefined && doc.status !== 'trashed')) {
    const revId = `rev_seed_${siteVersion}_${doc.id}`;
    revisions.push({ id: revId, collection: doc.collection, docId: doc.id, docVersion: doc.publishedVersion ?? doc.version,
      authorId: 'seed', authorName: 'Content migration', at, sealedAt: at, action: 'published', data: doc.published, publishSiteVersion: siteVersion });
    const titlePath = collections[doc.collection].titleField;
    const title = titlePath.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, doc.published);
    manifest.push({ collection: doc.collection, id: doc.id, version: doc.publishedVersion ?? doc.version, title: typeof title === 'string' ? title : doc.id, revId });
  }
  await store.publish({ docs: updated, snapshot: seedSnapshot(allDocs, siteVersion, at), revisions,
    record: { siteVersion, at, actorId: 'seed', summary: 'Seed content migration', kind: 'publish', manifest } });
  return { changed: true, count: seeds.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await seedStore(createStore(), process.argv.includes('--force'));
  console.log(`${result.changed ? 'Seeded' : 'Seed unchanged'}: ${result.count} documents`);
}
