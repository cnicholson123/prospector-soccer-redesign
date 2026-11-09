import { createHash } from 'node:crypto';
import { pageNames, type PageName } from '../../shared/schema.js';
import { readSession } from '../auth/session.js';
import { allDocs } from '../content/publish.js';
import { buildSnapshot } from '../content/snapshot.js';
import { scheduleStateHash } from '../content/scheduled-view.js';
import type { Snapshot } from '../../shared/types.js';
import { loadConfig, type Config } from '../config.js';
import { createStore } from '../store/index.js';
import type { Store } from '../store/types.js';
import { renderShop } from './shop/index.js';
import { landing } from './shop/landing.js';
import { temporaryShopStore } from '../shop/store/index.js';
import { tagShop, tagContent } from './cdn.js';
import { html, escape } from './html.js';
import { SnapshotView, DocumentView } from './snapshot-view.js';
import { richtext } from './richtext.js';
import { icon, iconHash } from './icons.js';
import { layout } from './templates/layout.js';
import { home } from './templates/home.js';
import { recreational } from './templates/recreational.js';
import { competitive } from './templates/competitive.js';
import { referees } from './templates/referees.js';
import { sponsors } from './templates/sponsors.js';
import { board } from './templates/board.js';
import { resources } from './templates/resources.js';
import { about } from './templates/about.js';
import { notfound } from './templates/notfound.js';
import * as fragments from './templates/shared.js';

const templates = { home, recreational, competitive, referees, sponsors, board, resources, about };
const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
export const templateHash = hash([...Object.values(templates), layout, notfound, ...Object.values(fragments), html, escape, richtext, icon, SnapshotView, DocumentView].map(value => value.toString()).join('\n') + iconHash);
const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Content-Security-Policy': "frame-ancestors 'self'" };

export function renderPage(snapshot: Snapshot, page: PageName, options: { now?: Date; edit?: boolean; timeZone?: string } = {}): string {
  const view = new SnapshotView(snapshot, options.now, options.edit, options.timeZone);
  return layout(view, page, (page === 'shop' ? landing({ view, stock: {} }) : templates[page](view))).toString();
}
/** Future-dated callouts and midnight event expiry must not outlive their cache entry. */
function cacheSeconds(view: SnapshotView, configured: number): number {
  const now = view.now.getTime();
  const boundaries = view.collection('callouts').flatMap(item => [item.text('startsAt'), item.text('endsAt')]).map(Date.parse).filter(time => time > now);
  // Locate midnight only when the requested TTL crosses the local date. This also
  // handles 23/25-hour days without assuming a fixed UTC offset.
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: view.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  let midnight = now + Math.min(configured, 27 * 3600) * 1000;
  if (view.collection('events').length && day.format(new Date(midnight)) !== day.format(view.now)) {
    let start = now;
    const today = day.format(view.now);
    while (midnight - start > 1000) {
      const middle = Math.floor((start + midnight) / 2);
      if (day.format(new Date(middle)) === today) start = middle;
      else midnight = middle;
    }
    boundaries.push(midnight);
  }
  const remaining = boundaries.length ? Math.floor((Math.min(...boundaries) - now) / 1000) : configured;
  return Math.max(0, Math.min(configured, remaining));
}
export function createRenderHandler(store: Store, config: Config, now: () => Date = () => new Date()) {
  let cached: Snapshot | null = null;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
    const preview = url.searchParams.has('preview') || url.searchParams.has('edit');
    const auth = preview ? await readSession(store, request, now(), config.production) : null;
    if (preview && !auth) return new Response('Preview requires authentication', { status: 401, headers: { ...headers, 'Cache-Control': 'no-store' } });
    if (preview && auth?.user.mustChangePassword) return new Response('Change your password to continue', { status: 403, headers: { ...headers, 'Cache-Control': 'no-store' } });
    const redirect = /^\/(index|home|recreational|competitive|referees|sponsors|board|resources|about)\.html$/.exec(url.pathname);
    if (redirect) {
      const target = ['index', 'home'].includes(redirect[1]) ? '/' : `/${redirect[1]}`;
      return new Response(null, { status: 308, headers: { ...headers, Location: target + url.search } });
    }
    const snapshot = await store.getSnapshot();
    if (!snapshot) return new Response('Content is not initialized. Run npm run seed.', { status: 503, headers: { ...headers, 'Cache-Control': 'no-store' } });
    if (!cached || cached.siteVersion !== snapshot.siteVersion) cached = snapshot;
    let selected = cached;
    if (preview) {
      const drafts = (await allDocs(store)).filter(d => !d.trashedAt).map(d => ({ ...d, published: d.draft, publishedVersion: d.version, publishedOrder: d.order }));
      selected = buildSnapshot(drafts, { siteVersion: cached.siteVersion, publishedAt: cached.publishedAt, templateHash });
    }
    const view = new SnapshotView(selected, now(), url.searchParams.has('edit'), config.tzName);
    const site = view.doc('site', 'site');
    const requested = url.pathname === '/api/render' || url.pathname === '/'
      ? url.searchParams.get('page') ?? 'home'
      : url.pathname.slice(1);
    const page = requested === 'index' ? 'home' : requested;
    const shopPath = requested === 'shop' ? url.searchParams.get('path') ?? '' : requested.startsWith('shop/') ? requested.slice(5) : null;
    if (shopPath !== null) {
      const ids = view.collection('products').flatMap(p => p.list('variants').map(v => `${p.id}.${v.text('_key')}`));
      const result = renderShop({ view, stock: await temporaryShopStore.getStock(ids) }, shopPath.replace(/^\/+|\/+$/g, ''), { preview, secret: config.sessionSecret, error: url.searchParams.has('error') });
      if (!preview && !result.private) { tagContent(); tagShop(); }
      const until = Math.min(...selected.scheduled.map(s => (Date.parse(s.at) - view.now.getTime()) / 1000).filter(n => n > 0));
      return new Response(request.method === 'HEAD' ? null : result.body, { status: result.status, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': result.private ? 'no-referrer' : headers['Referrer-Policy'], 'Cache-Control': preview || result.private ? 'no-store' : `public, max-age=0, s-maxage=${Math.min(15, Math.max(0, Math.floor(until)))}, stale-while-revalidate=${until <= 75 ? 0 : 60}` } });
    }
    let body: string;
    let status = 200;
    let contentType = 'text/html; charset=utf-8';
    if (page === 'robots.txt') {
      contentType = 'text/plain; charset=utf-8';
      body = site.boolean('seo.indexable') ? `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${config.publicBaseUrl}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n';
    } else if (page === 'sitemap.xml') {
      contentType = 'application/xml; charset=utf-8';
      body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + (site.boolean('seo.indexable') ? pageNames.filter(name => name !== 'shop').map(name => `<url><loc>${escape(config.publicBaseUrl + (name === 'home' ? '/' : '/' + name))}</loc></url>`).join('') + (view.doc('storeSettings', 'storeSettings').boolean('enabled') ? ['/shop', ...(['products', 'bundles', 'categories'] as const).flatMap((c, i) => view.collection(c).map(d => `/shop/${['p', 'b', 'c'][i]}/${d.text('slug')}`))].map(path => `<url><loc>${escape(config.publicBaseUrl + path)}</loc></url>`).join('') : '') : '') + '</urlset>';
    } else if (pageNames.includes(page as PageName)) body = renderPage(selected, page as PageName, { now: view.now, edit: view.edit, timeZone: config.tzName });
    else {
      status = 404;
      body = layout(view, 'home', notfound(), { title: 'Page not found · ' + site.text('name'), description: 'Find your way back to Prospector Soccer Club.' }).toString();
    }
    // The representation hash also changes when a callout expires or an event ages out.
    const etag = `W/"${cached.siteVersion}-${templateHash}-${scheduleStateHash(selected, view.now, body)}"`;
    const until = Math.min(...selected.scheduled.map(s => (Date.parse(s.at) - view.now.getTime()) / 1000).filter(seconds => seconds > 0));
    const scheduleNear = until <= config.cacheSmaxage + config.cacheSwr;
    const seconds = Math.min(cacheSeconds(view, config.cacheSmaxage), Math.max(0, Math.floor(until)));
    const responseHeaders = { ...headers, 'Content-Type': contentType, ETag: etag,
      ...(url.searchParams.has('edit') ? { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://*.public.blob.vercel-storage.com; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'none'", 'X-Frame-Options': 'SAMEORIGIN' } : {}),
      'Cache-Control': preview ? 'no-store' : `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${scheduleNear ? 0 : config.cacheSwr}` };
    if (!preview) tagContent();
    const matches = (request.headers.get('If-None-Match') ?? '').split(',').map(value => value.trim().replace(/^W\//, ''));
    if (!preview && status === 200 && (matches.includes(etag.replace(/^W\//, '')) || matches.includes('*'))) return new Response(null, { status: 304, headers: responseHeaders });
    return new Response(request.method === 'HEAD' ? null : body, { status, headers: responseHeaders });
  };
}
let handler: ReturnType<typeof createRenderHandler> | undefined;
export function renderPublic(request: Request): Promise<Response> {
  if (!handler) { const config = loadConfig(); handler = createRenderHandler(createStore(config), config); }
  return handler(request);
}
