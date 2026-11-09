import { createHash } from 'node:crypto';
import type { Snapshot } from '../../shared/types';
export function scheduleStateHash(snapshot: Snapshot, now: Date, representation = '') {
  const due = snapshot.scheduled.filter(s => Date.parse(s.at) <= now.getTime()).map(s => [s.collection, s.id, s.at, s.version]).sort();
  // Retain the existing callout/event representation invalidation as well.
  return createHash('sha256').update(JSON.stringify(due) + representation).digest('hex').slice(0, 16);
}
export function effectiveSnapshot(snapshot: Snapshot, now: Date): Snapshot {
  const due = snapshot.scheduled.filter(s => Date.parse(s.at) <= now.getTime());
  if (!due.length) return snapshot;
  const copy = structuredClone(snapshot);
  for (const item of due) {
    const docs = copy.docs[item.collection] ??= [];
    const index = docs.findIndex(d => d.id === item.id);
    const doc = { collection: item.collection, id: item.id, data: item.data, version: item.version, order: item.order };
    if (index < 0) docs.push(doc); else docs[index] = doc;
  }
  return copy;
}
