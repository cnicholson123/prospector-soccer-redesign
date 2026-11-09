import { loadSeed, seedSnapshot } from '../../scripts/seed.js';
import type { Doc, Snapshot } from '../../shared/types.js';
import type { Bundle, Product, Settings } from '../../server/shop/types.js';
export async function catalogFixture() {
  const docs = (await loadSeed()).map(d => ({ ...d, published: structuredClone(d.draft), publishedVersion: d.version, status: 'published' as const }));
  const snapshot = seedSnapshot(docs);
  const settings = snapshot.docs.storeSettings![0].data as Settings;
  settings.enabled = true;
  const product = snapshot.docs.products!.find(d => d.id === 'prod_hoodie')!.data as Product;
  const bundle = snapshot.docs.bundles!.find(d => d.id === 'bundle_coach-kit')!.data as Bundle;
  return { docs, snapshot, settings, product, bundle };
}
export function doc(snapshot: Snapshot, id: string): Doc {
  const entry = Object.values(snapshot.docs).flatMap(d => d ?? []).find(d => d.id === id)!;
  return { id, collection: entry.collection, draft: entry.data, published: entry.data, version: 1, status: 'published', createdAt: '', updatedAt: '', createdBy: '', updatedBy: '' };
}
