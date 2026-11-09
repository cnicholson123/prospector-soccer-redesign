import { collections, type CollectionName } from '../../../shared/schema.js';
import { prefetch } from '../api.js';
export function prefetchRoute(href: string) {
  const url = new URL(href, location.origin);
  if (url.origin !== location.origin) return;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'admin') return;
  const run = prefetch;
  if (!parts[1]) { run('/counts'); run('/dashboard?section=activity'); run('/dashboard?section=health'); return; }
  if (parts[1] === 'pages' && !parts[2]) {
    Object.values(collections).filter(d => d.kind === 'singleton' && !['site', 'storeSettings'].includes(d.name)).forEach(d => run(`/docs/${d.name}`));
    return;
  }
  const name = parts[1] === 'settings' ? 'site' : parts[1] === 'store' ? 'storeSettings' : parts[1] === 'pages' ? parts[2] === 'sponsors' ? 'sponsorsPage' : parts[2] === 'shop' ? 'shopPage' : parts[2] : parts[1];
  const definition = collections[name as CollectionName];
  if (!definition) return;
  if (definition.kind === 'singleton') run(`/docs/${name}/${name}`);
  else if (parts[2] && parts[2] !== 'new') run(`/docs/${name}/${parts[2]}`);
  else if (!parts[2]) run(`/docs/${name}?trashed=1`);
}
