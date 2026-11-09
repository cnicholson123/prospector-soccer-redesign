import { addCacheTag, dangerouslyDeleteByTag } from '@vercel/functions';
/** Vercel's cache APIs need request context. Never invoke them in local dev. */
export async function tagContent(): Promise<void> {
  if (process.env.VERCEL === '1') await addCacheTag('content');
}
export async function purgeContent(): Promise<boolean> {
  if (process.env.VERCEL !== '1' || process.env.CDN_PURGE !== 'tag') return false;
  try { await dangerouslyDeleteByTag('content'); return true; }
  catch (error) { console.warn('Content cache purge failed', error); return false; }
}

export function tagShop(): void { if (process.env.VERCEL === '1') addCacheTag('shop'); }
export async function purgeShop(): Promise<boolean> {
  if (process.env.VERCEL !== '1' || process.env.CDN_PURGE !== 'tag') return false;
  try { await dangerouslyDeleteByTag('shop'); return true; }
  catch { console.warn('Shop cache purge failed'); return false; }
}
