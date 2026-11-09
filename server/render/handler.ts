import { createHash } from 'node:crypto';
import { pageNames, type PageName } from '../../shared/schema';
import type { Snapshot } from '../../shared/types';
import { loadConfig, type Config } from '../config';
import { createStore } from '../store';
import type { Store } from '../store/types';
import { tagContent } from './cdn';
import { html, escape } from './html';
import { SnapshotView, DocumentView } from './snapshot-view';
import { richtext } from './richtext';
import { icon, iconHash } from './icons';
import { layout } from './templates/layout';
import { home } from './templates/home';
import { recreational } from './templates/recreational';
import { competitive } from './templates/competitive';
import { referees } from './templates/referees';
import { sponsors } from './templates/sponsors';
import { board } from './templates/board';
import { resources } from './templates/resources';
import { about } from './templates/about';
import { notfound } from './templates/notfound';
import * as fragments from './templates/shared';

const templates = { home, recreational, competitive, referees, sponsors, board, resources, about };
const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
export const templateHash = hash([...Object.values(templates), layout, notfound, ...Object.values(fragments), html, escape, richtext, icon, SnapshotView, DocumentView].map(value => value.toString()).join('\n') + iconHash);
const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Content-Security-Policy': "frame-ancestors 'self'" };

export function renderPage(snapshot: Snapshot, page: PageName, options: { now?: Date; edit?: boolean; timeZone?: string } = {}): string {
  const view = new SnapshotView(snapshot, options.now, options.edit, options.timeZone);
  return layout(view, page, templates[page](view)).toString();
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
    if (url.searchParams.has('preview') || url.searchParams.has('edit')) {
      // Session-backed draft selection is introduced with the Phase 5 preview flow.
      return new Response('Preview requires authentication', { status: 401, headers: { ...headers, 'Cache-Control': 'no-store' } });
    }
    const redirect = /^\/(index|home|recreational|competitive|referees|sponsors|board|resources|about)\.html$/.exec(url.pathname);
    if (redirect) {
      const target = ['index', 'home'].includes(redirect[1]) ? '/' : `/${redirect[1]}`;
      return new Response(null, { status: 308, headers: { ...headers, Location: target + url.search } });
    }
    const snapshot = await store.getSnapshot();
    if (!snapshot) return new Response('Content is not initialized. Run npm run seed.', { status: 503, headers: { ...headers, 'Cache-Control': 'no-store' } });
    if (!cached || cached.siteVersion !== snapshot.siteVersion) cached = snapshot;
    const view = new SnapshotView(cached, now(), false, config.tzName);
    const site = view.doc('site', 'site');
    const requested = url.pathname === '/api/render' || url.pathname === '/'
      ? url.searchParams.get('page') ?? 'home'
      : url.pathname.slice(1);
    const page = requested === 'index' ? 'home' : requested;
    let body: string;
    let status = 200;
    let contentType = 'text/html; charset=utf-8';
    if (page === 'robots.txt') {
      contentType = 'text/plain; charset=utf-8';
      body = site.boolean('seo.indexable') ? `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${config.publicBaseUrl}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n';
    } else if (page === 'sitemap.xml') {
      contentType = 'application/xml; charset=utf-8';
      body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + (site.boolean('seo.indexable') ? pageNames.map(name => `<url><loc>${escape(config.publicBaseUrl + (name === 'home' ? '/' : '/' + name))}</loc></url>`).join('') : '') + '</urlset>';
    } else if (pageNames.includes(page as PageName)) body = renderPage(cached, page as PageName, { now: view.now, timeZone: config.tzName });
    else {
      status = 404;
      body = layout(view, 'home', notfound(), { title: 'Page not found · ' + site.text('name'), description: 'Find your way back to Prospector Soccer Club.' }).toString();
    }
    // The representation hash also changes when a callout expires or an event ages out.
    const etag = `W/"${cached.siteVersion}-${templateHash}-${hash(body)}"`;
    const responseHeaders = { ...headers, 'Content-Type': contentType, ETag: etag,
      'Cache-Control': `public, max-age=0, s-maxage=${cacheSeconds(view, config.cacheSmaxage)}, stale-while-revalidate=${config.cacheSwr}` };
    tagContent();
    const matches = (request.headers.get('If-None-Match') ?? '').split(',').map(value => value.trim().replace(/^W\//, ''));
    if (status === 200 && (matches.includes(etag.replace(/^W\//, '')) || matches.includes('*'))) return new Response(null, { status: 304, headers: responseHeaders });
    return new Response(request.method === 'HEAD' ? null : body, { status, headers: responseHeaders });
  };
}
let handler: ReturnType<typeof createRenderHandler> | undefined;
export function renderPublic(request: Request): Promise<Response> {
  if (!handler) { const config = loadConfig(); handler = createRenderHandler(createStore(config), config); }
  return handler(request);
}
