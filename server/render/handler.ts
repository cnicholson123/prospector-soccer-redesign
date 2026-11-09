import { staticFile } from '../http/static';
const pages = new Set(['index', 'home', 'recreational', 'competitive', 'referees', 'sponsors', 'board', 'resources', 'about']);
/** Phase 0 bridge: keep legacy HTML byte-for-byte until the Phase 2 renderer. */
export async function renderPublic(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.has('preview') || url.searchParams.has('edit')) return new Response('Preview is not available yet', { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const name = url.searchParams.get('page') ?? (url.pathname === '/' ? 'index' : url.pathname.slice(1).replace(/\.html$/, ''));
  if (!pages.has(name)) return new Response('Not found', { status: 404 });
  return await staticFile('docs', `${name === 'home' ? 'index' : name}.html`) ?? new Response('Not found', { status: 404 });
}
