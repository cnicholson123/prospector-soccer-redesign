import type { Store } from '../types.js';
export function mediaPath(path: string): string {
  if (!/^media\/(?:incoming\/[a-zA-Z0-9_-]+|\d{4}\/[a-zA-Z0-9_-]+)\/(?:original|web)\.(?:jpg|png|webp|gif|pdf)$/.test(path)) throw new Error('Invalid media path');
  return path;
}
export async function retained(store: Store, url: string): Promise<boolean> {
  let before: number | undefined;
  do {
    const records = await store.listPublishes(1000, before);
    for (const record of records) for (const entry of record.manifest.filter(e => e.collection === 'media')) {
      const rev = await store.getRevision(entry.id, entry.revId);
      const data = rev?.data as { variants?: Record<string, string> } | undefined;
      if (Object.values(data?.variants ?? {}).includes(url)) return true;
    }
    if (records.length < 1000) return false;
    before = records.at(-1)!.siteVersion;
  } while (before);
  return false;
}
