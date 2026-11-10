import type { Store } from '../types.js';
export function mediaPath(path: string): string {
  if (!/^media\/(?:incoming\/[a-zA-Z0-9_-]+|\d{4}\/[a-zA-Z0-9_-]+)\/(?:original|web)\.(?:jpg|png|webp|gif|pdf)$/.test(path)) throw new Error('Invalid media path');
  return path;
}
export async function retained(store: Store, url: string): Promise<boolean> {
  const [docs, snapshot] = await Promise.all([store.listAllDocs(), store.getSnapshot()]);
  const hasUrl = (data: unknown) => Object.values((data as { variants?: Record<string, string> } | undefined)?.variants ?? {}).includes(url);
  if (docs.some(doc => doc.collection === 'media' && (hasUrl(doc.draft) || hasUrl(doc.published))) || snapshot?.scheduled.some(item => item.collection === 'media' && hasUrl(item.data))) return true;
  const seen = new Set<string>();
  let before: number | undefined;
  do {
    const records = await store.listPublishes(1000, before);
    for (const record of records) for (const entry of record.manifest.filter(e => e.collection === 'media')) {
      const key = JSON.stringify([entry.id, entry.revId]);
      if (seen.has(key)) continue;
      seen.add(key);
      const rev = await store.getRevision(entry.id, entry.revId);
      if (hasUrl(rev?.data)) return true;
    }
    if (records.length < 1000) break;
    before = records.at(-1)!.siteVersion;
  } while (before);
  // A replacement can supersede a file before it was ever published. Item
  // history still retains that verified file, including for trashed documents.
  let cursor: string | undefined;
  do {
    const page = await store.queryRevisions({ collection: 'media', limit: 1000, cursor });
    if (page.items.some(rev => hasUrl(rev.data))) return true;
    cursor = page.cursor;
  } while (cursor);
  return false;
}
