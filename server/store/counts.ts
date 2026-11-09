import { isDeepStrictEqual } from 'node:util';
import { collectionNames, collections } from '../../shared/schema.js';
import type { Doc } from '../../shared/types.js';
import type { AdminCounts } from './types.js';
export function completeCounts(value: AdminCounts): AdminCounts {
  value.counts = { ...Object.fromEntries(collectionNames.map(name => [name, 0])), ...value.counts,
    pages: collectionNames.filter(name => collections[name].kind === 'singleton' && !['site', 'storeSettings'].includes(name)).length };
  return value;
}
export function countsFromDocs(docs: Doc[]): AdminCounts {
  const counts: Record<string, number> = {};
  let pendingCount = 0, reviewCount = 0, scheduledCount = 0;
  for (const d of docs) {
    if (!d.trashedAt) counts[d.collection] = (counts[d.collection] ?? 0) + 1;
    if (d.trashedAt ? d.published !== undefined : d.published === undefined || d.version !== d.publishedVersion || !isDeepStrictEqual(d.draft, d.published)) pendingCount++;
    if (d.reviewRequestedBy) reviewCount++;
    if (d.scheduledAt) scheduledCount++;
  }
  return completeCounts({ counts, pendingCount, reviewCount, scheduledCount });
}
