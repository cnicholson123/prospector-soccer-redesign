import { signal } from '@preact/signals';
import { collections, type CollectionName, type Field } from '../../../shared/schema.js';
import type { Doc } from '../../../shared/types.js';
export type ContentDoc = Doc<Record<string, unknown>>;
export const contentChanged = signal(0);
export const changed = () => { contentChanged.value++; };
export const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const getPath = (value: unknown, path: string): unknown => path.split('.').reduce<unknown>((v, key) => record(v)[key], value);
export function docTitle(doc: ContentDoc): string {
  const title = getPath(doc.draft, collections[doc.collection].titleField) || doc.draft.name;
  if (title) return String(title);
  if (doc.collection === 'teams') return [doc.draft.ageGroup, doc.draft.gender, doc.draft.level].filter(Boolean).join(' · ') || collections.teams.label;
  return collections[doc.collection].label;
}
export const editorPath = (collection: CollectionName, id = collection as string) => collection === 'storeSettings' ? '/admin/store/settings' : collection === 'site' ? '/admin/settings' : collections[collection].kind === 'singleton' ? `/admin/pages/${collection === 'sponsorsPage' ? 'sponsors' : collection === 'shopPage' ? 'shop' : collection}` : `/admin/${collection}/${id}`;
export function previewPath(collection: CollectionName, draft: Record<string, unknown> = {}) {
  const definition = collections[collection];
  const page = collection === 'faqs' ? String(draft.page || 'competitive') : definition.preview?.page || 'home';
  const anchor = typeof definition.preview?.anchor === 'function' ? definition.preview.anchor(draft) : definition.preview?.anchor || (collection === 'events' ? 'events' : '');
  if (page === 'shop' && ['products', 'bundles', 'categories'].includes(collection) && draft.slug) return `/shop/${collection === 'products' ? 'p' : collection === 'bundles' ? 'b' : 'c'}/${String(draft.slug)}`;
  return `${page === 'home' ? '/' : `/${page}`}${anchor ? `#${anchor}` : ''}`;
}
export function defaults(fields: Record<string, Field>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).flatMap(([name, field]) => field.default !== undefined ? [[name, structuredClone(field.default)]] : field.type === 'object' ? [[name, defaults(field.fields)]] : []));
}
export function freshKey() { return crypto.randomUUID().replaceAll('-', '').slice(0, 8); }
export function duplicateItem(value: Record<string, unknown>): Record<string, unknown> {
  const clone = (v: unknown): unknown => Array.isArray(v) ? v.map(clone) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([key, item]) => [key, key === '_key' ? freshKey() : clone(item)])) : v;
  return { ...record(clone(value)), _key: freshKey() };
}
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return items;
  const next = [...items]; next.splice(to, 0, next.splice(from, 1)[0]); return next;
}

/** Shared list ordering for collection screens and `[`/`]` navigation: the chosen key, then stable tie-breakers. */
export function compareDocs(sort: string) {
  return (a: ContentDoc, b: ContentDoc) => {
    const primary = sort === 'order' ? (a.order ?? 0) - (b.order ?? 0)
      : sort === 'updatedAt' ? b.updatedAt.localeCompare(a.updatedAt)
      : sort === 'title' ? docTitle(a).localeCompare(docTitle(b))
      : String(getPath(a.draft, sort) ?? '').localeCompare(String(getPath(b.draft, sort) ?? ''));
    return primary || docTitle(a).localeCompare(docTitle(b)) || a.id.localeCompare(b.id);
  };
}
