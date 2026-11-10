import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { loadSeed } from './seed.js';
import { seedAdditive } from './seed-store.js';
import { createStore } from '../server/store/index.js';
import type { Store } from '../server/store/types.js';
/** Register shipped static images, preserving production edits, users and history. */
export async function seedStaticMedia(store: Store) {
  const seeds = (await loadSeed()).filter(doc => doc.collection === 'media' && (doc.draft as { source?: string }).source === 'static');
  return seedAdditive(store, seeds, 'seed:media', 'Register missing static media', 'Static media seed');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 2) throw new Error('seed:media accepts no arguments; existing records cannot be forced or reset');
  const store = createStore();
  try {
    const result = await seedStaticMedia(store);
    console.log(`Static media: ${result.created} created, ${result.published} published, ${result.preserved} preserved; site version ${result.siteVersion}`);
  } finally { await store.close(); }
}
