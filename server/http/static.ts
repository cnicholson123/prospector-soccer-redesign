import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.woff2': 'font/woff2',
};
export async function staticFile(root: string, name: string): Promise<Response | null> {
  try {
    const base = await realpath(root);
    const file = await realpath(resolve(base, name));
    if (!file.startsWith(base + sep) || !(await stat(file)).isFile()) return null;
    const body = await readFile(file);
    return new Response(body, { headers: { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) return null;
    throw error;
  }
}
