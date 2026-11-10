import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import http from 'node:http';
import https from 'node:https';
export function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && c === 0 || b === 0 && c === 2) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (family !== 6 || address.includes('%')) return false;
  // Restrict IPv6 to global unicast (2000::/3), excluding special-use,
  // documentation, 6to4 and Teredo prefixes. Mapped IPv4 is never dialed.
  const first = parseInt(address.split(':')[0], 16);
  return first >= 0x2000 && first <= 0x3fff && !/^2001:(?:0:|db8:|2:|10:|20:)/i.test(address) && !/^2002:/i.test(address);
}
/** Answer Node's single-address and autoSelectFamily lookups with the same pinned IP. */
export function pinnedLookup(pinned: { address: string; family: number }): LookupFunction {
  return (_name, options, callback) => {
    if (options.all) callback(null, [pinned]);
    else callback(null, pinned.address, pinned.family);
  };
}
async function request(url: URL, method: 'HEAD' | 'GET', signal: AbortSignal) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only credential-free HTTP(S) links are allowed');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Private or reserved address refused');
  signal.throwIfAborted();
  const pinned = addresses[0];
  return new Promise<{ status: number; location?: string }>((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, { method, signal, headers: { 'User-Agent': 'ProspectorLinkChecker/1.0' }, lookup: pinnedLookup(pinned) }, res => {
      let bytes = 0;
      if (Number(res.headers['content-length'] ?? 0) > 1024 * 1024) { reject(new Error('Response exceeds 1 MB')); res.destroy(); return; }
      res.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024 * 1024) { reject(new Error('Response exceeds 1 MB')); res.destroy(); } });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location }));
      res.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
}
export async function checkLink(input: string) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
  try {
    return await Promise.race([
      (async () => {
        let url = new URL(input), redirects = 0, method: 'HEAD' | 'GET' = 'HEAD';
        for (;;) {
          const result = await request(url, method, controller.signal);
          if ([301, 302, 303, 307, 308].includes(result.status) && result.location) {
            if (++redirects > 3) throw new Error('Too many redirects');
            url = new URL(result.location, url); continue;
          }
          if (method === 'HEAD' && [403, 405, 501].includes(result.status)) { method = 'GET'; continue; }
          return { url: input, finalUrl: url.href, ok: result.status >= 200 && result.status < 400, status: result.status };
        }
      })(),
      new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Link check timed out')), { once: true })),
    ]);
  } catch (error) { return { url: input, ok: false, error: error instanceof Error ? error.message : 'Link check failed' }; }
  finally { clearTimeout(timer); controller.abort(); }
}
export async function checkLinks(urls: string[]) {
  const queue = [...new Set(urls)], results: Awaited<ReturnType<typeof checkLink>>[] = [];
  await Promise.all(Array.from({ length: Math.min(5, queue.length) }, async () => { let url; while ((url = queue.shift()) !== undefined) results.push(await checkLink(url)); }));
  return results;
}
