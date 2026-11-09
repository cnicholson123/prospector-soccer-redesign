import { collections, type CollectionName, type Field } from '../../shared/schema.js';
import type { Doc, ScheduledItem } from '../../shared/types.js';

export interface Reference { collection: CollectionName; id: string; path: string; kind: 'reference' | 'image' | 'file' }
/** Shared schema traversal for publish validation, snapshots and trash checks. */
export function references(collection: CollectionName, data: unknown): Reference[] {
  const result: Reference[] = [];
  function walk(fields: Record<string, Field>, value: unknown, prefix: string) {
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    for (const [name, field] of Object.entries(fields)) {
      const current = object[name];
      const path = prefix ? `${prefix}.${name}` : name;
      if (field.type === 'object') walk(field.fields, current, path);
      else if (field.type === 'list' && Array.isArray(current)) current.forEach((item, index) => walk(field.of, item, `${path}[${index}]`));
      else if (field.type === 'reference') {
        for (const id of Array.isArray(current) ? current : [current]) if (typeof id === 'string' && id) result.push({ collection: field.to, id, path, kind: 'reference' });
      } else if ((field.type === 'image' || field.type === 'file') && current && typeof current === 'object') {
        const id = (current as Record<string, unknown>).mediaId;
        if (typeof id === 'string') result.push({ collection: 'media', id, path, kind: field.type });
      }
    }
  }
  walk(collections[collection].fields, data, '');
  return result;
}
export function referenceUsage(docs: Doc[], collection: CollectionName, id: string, scheduled: ScheduledItem[] = []) {
  return docs.flatMap(doc => {
    const self = doc.id === id && doc.collection === collection;
    const paths = new Set([...(self ? [] : [...references(doc.collection, doc.draft), ...references(doc.collection, doc.published)]), ...scheduled.filter(s => s.id === doc.id && s.collection === doc.collection).flatMap(s => self ? [{ collection, id, path: 'scheduled', kind: 'reference' as const }] : references(s.collection, s.data).map(r => ({ ...r, path: `scheduled.${r.path}` })))]
      .filter(ref => ref.collection === collection && ref.id === id).map(ref => ref.path));
    const titlePath = collections[doc.collection].titleField;
    const title = titlePath.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, doc.draft);
    return [...paths].map(path => ({ collection: doc.collection, id: doc.id, title: typeof title === 'string' ? title : doc.id, path }));
  });
}
