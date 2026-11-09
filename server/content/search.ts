import { allDocs, title } from './publish.js';
import type { Store } from '../store/types.js';
export async function search(store: Store, query: string, titleOnly = false) {
  const term = query.trim().toLowerCase().slice(0, 200);
  if (!term) return [];
  return (await allDocs(store)).filter(d => !d.trashedAt && (titleOnly ? title(d) : JSON.stringify(d.draft)).toLowerCase().includes(term)).slice(0, 20).map(d => ({ collection: d.collection, id: d.id, title: title(d), status: d.status }));
}
