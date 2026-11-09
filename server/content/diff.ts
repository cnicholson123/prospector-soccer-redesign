import { diffWords } from 'diff';
import { collections, type CollectionName, type Field } from '../../shared/schema';
import { isDeepStrictEqual } from 'node:util';
export interface FieldDiff { path: string; label: string; kind: 'added' | 'removed' | 'moved' | 'changed'; before?: unknown; after?: unknown; words?: ReturnType<typeof diffWords> }
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function diff(collection: CollectionName, before: unknown, after: unknown): FieldDiff[] {
  const result: FieldDiff[] = [];
  function walk(fields: Record<string, Field>, a: unknown, b: unknown, prefix = '') {
    const left = record(a), right = record(b);
    for (const [name, field] of Object.entries(fields)) {
      const x = left[name], y = right[name], path = prefix + name, label = field.label ?? name;
      if (isDeepStrictEqual(x, y)) continue;
      if (field.type === 'object' && x && y) { walk(field.fields, x, y, path + '.'); continue; }
      if (field.type === 'list' && Array.isArray(x) && Array.isArray(y)) {
        const old = new Map(x.map((item, i) => [record(item)._key, { item, i }]));
        const next = new Map(y.map((item, i) => [record(item)._key, { item, i }]));
        for (const [key, value] of old) if (!next.has(key)) result.push({ path: `${path}[${String(key)}]`, label, kind: 'removed', before: value.item });
        for (const [key, value] of next) {
          const previous = old.get(key), itemPath = `${path}[${String(key)}]`;
          if (!previous) result.push({ path: itemPath, label, kind: 'added', after: value.item });
          else { if (previous.i !== value.i) result.push({ path: itemPath, label, kind: 'moved', before: previous.i, after: value.i }); walk(field.of, previous.item, value.item, itemPath + '.'); }
        }
      } else result.push({ path, label, kind: x === undefined ? 'added' : y === undefined ? 'removed' : 'changed', before: x, after: y, ...(typeof x === 'string' && typeof y === 'string' ? { words: diffWords(x, y) } : {}) });
    }
  }
  walk(collections[collection].fields, before, after); return result;
}
