import { collections, type CollectionName, type Field } from './schema.js';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** Resolve only declared schema fields. List addresses use stable keys, never eval. */
export function editPath(collection: CollectionName, data: unknown, path: string): { field: Field; value: unknown; keys: (string | number)[]; formPath: string } | null {
  if (!path || path.length > 500) return null;
  let fields = collections[collection].fields, value = data;
  const keys: (string | number)[] = [], names: string[] = [];
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) {
    const match = /^([a-zA-Z][a-zA-Z0-9]*)(?:\[([a-zA-Z0-9_-]+)\])?$/.exec(parts[i]);
    if (!match || !Object.hasOwn(fields, match[1])) return null;
    const name = match[1], field = fields[name];
    keys.push(name); value = record(value)[name]; names.push(name);
    if (match[2] !== undefined) {
      if (field.type !== 'list' || !Array.isArray(value)) return null;
      const address = match[2];
      const index = value.findIndex((row, j) => String(record(row)._key ?? j) === address);
      if (index < 0) return null;
      keys.push(index); names[names.length - 1] += `[${index}]`; value = value[index]; fields = field.of;
      if (i === parts.length - 1) return null;
    } else if (i === parts.length - 1) return { field, value, keys, formPath: names.join('.') };
    else if (field.type === 'object') fields = field.fields;
    else return null;
  }
  return null;
}
export function setEditValue(data: Record<string, unknown>, keys: (string | number)[], value: unknown): Record<string, unknown> {
  const next = structuredClone(data);
  let target: Record<string | number, unknown> = next;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string | number, unknown>;
  target[keys[keys.length - 1]] = value;
  return next;
}
