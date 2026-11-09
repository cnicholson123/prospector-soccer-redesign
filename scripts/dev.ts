import { createStore } from '../server/store';
import { seedStore } from './seed';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { loadConfig } from '../server/config';
import { adminApp } from '../server/http/hono-app';
import { staticFile } from '../server/http/static';
import { createRenderHandler } from '../server/render/handler';
import { join } from 'node:path';
import type { ViteDevServer } from 'vite';

const config = loadConfig();
const store = createStore(config);
if (!await store.getSnapshot()) await seedStore(store);
const renderPublic = createRenderHandler(store, config);
const built = process.argv.includes('--built');
let vite: ViteDevServer | undefined;
const server = createServer(async (req, res) => {
  try {
    const origin = config.publicBaseUrl;
    const url = new URL(req.url ?? '/', origin);
    const method = req.method ?? 'GET';
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
      else if (value !== undefined) headers.set(name, value);
    }
    // This local adapter knows the socket peer; ignore client-supplied proxy IPs.
    headers.set('x-forwarded-for', req.socket.remoteAddress ?? 'unknown');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk as Uint8Array); size += bytes.length;
      if (size > (url.pathname.startsWith('/api/admin') ? 1024 * 1024 : config.maxFileBytes)) { res.writeHead(413); res.end('Request too large'); return; }
      chunks.push(bytes);
    }
    const request = new Request(url, { method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }) });
    let response: Response | null;
    if (url.pathname.startsWith('/api/admin/')) response = await adminApp.fetch(request);
    else if (method !== 'GET' && method !== 'HEAD') response = new Response('Method not allowed', { status: 405 });
    else if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      response = built ? await staticFile('public', url.pathname.slice(1)) ?? await staticFile('public/admin', 'index.html') : Response.redirect('http://localhost:5173' + url.pathname + url.search, 307);
    } else if (url.pathname.startsWith('/blobs/')) response = await staticFile(join(config.dataDir, 'blobs'), decodeURIComponent(url.pathname.slice(7)));
    else if (url.pathname.startsWith('/assets/')) response = await staticFile('public', decodeURIComponent(url.pathname.slice(1)));
    else response = await renderPublic(request);
    response ??= new Response('Not found', { status: 404 });
    if ((url.pathname === '/admin' || url.pathname.startsWith('/admin/')) && !url.pathname.startsWith('/admin/assets/')) response.headers.set('Cache-Control', 'no-store');
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (method === 'HEAD' || !response.body) { res.end(); return; }
    const reader = response.body.getReader();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (!res.write(chunk.value)) await once(res, 'drain');
      }
      res.end();
    } finally { reader.releaseLock(); }
  } catch (error) { console.error(error); if (!res.headersSent) res.writeHead(500); res.end('Internal server error'); }
});
server.on('error', (error) => { console.error(error); process.exitCode = 1; void vite?.close(); });
server.listen(3000, async () => {
  console.log('Public site and API: http://localhost:3000');
  if (!built) {
    try { const { createServer: createViteServer } = await import('vite'); vite = await createViteServer({ configFile: 'admin/vite.config.ts' }); await vite.listen(); vite.printUrls(); }
    catch (error) { console.error(error); server.close(); process.exitCode = 1; }
  }
});
async function shutdown() { await vite?.close(); server.close(); }
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
