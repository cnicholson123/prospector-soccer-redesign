import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.js';
import type { MediaStorage, Store, Doc } from './store/types.js';
import { ApiError } from './http/middleware/errors.js';
import { revision } from './content/revisions.js';
import { audit, type Actor } from './audit.js';
import { validate, ValidationError } from './content/validate.js';
import { readSession } from './auth/session.js';
import { can } from './permissions.js';
import { retained } from './store/blobs/common.js';

const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
interface Grant { id: string; owner: string; filename: string; mime: string; size: number; path: string; expires: number; year: string }
const invalid = (message: string): never => { throw new ApiError(422, 'validation', message); };
export function uploadGrant(input: Record<string, unknown>, owner: string, config: Config, now: Date) {
  if (typeof input.mime !== 'string' || !extensions[input.mime]) invalid('Upload JPEG, PNG, WebP, GIF or PDF; SVG is not allowed');
  const mime = input.mime as string, size = input.size;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > (mime === 'application/pdf' ? config.maxFileBytes : config.maxImageBytes)) invalid('File exceeds the upload size limit');
  if (typeof input.filename !== 'string' || input.filename.length > 255) invalid('Invalid filename');
  const filename = (input.filename as string).split(/[\\/]/).at(-1)!.replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/^\.+/, '').trim() || 'upload.' + extensions[mime];
  const id = 'media_' + randomBytes(16).toString('hex');
  const grant: Grant = { id, owner, filename, mime, size: size as number, path: `media/incoming/${id}/original.${extensions[mime]}`, expires: now.getTime() + 15*60000, year: String(now.getUTCFullYear()) };
  const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
  return { grant, ticket: payload + '.' + createHmac('sha256', config.sessionSecret).update(payload).digest('base64url') };
}
export function readGrant(ticket: string, owner: string, config: Config, now: Date): Grant {
  const [payload, signature, extra] = ticket.split('.');
  const expected = createHmac('sha256', config.sessionSecret).update(payload ?? '').digest();
  const received = Buffer.from(signature ?? '', 'base64url');
  if (extra || received.length !== expected.length || !timingSafeEqual(received, expected)) invalid('Invalid upload ticket');
  let grant: Grant; try { grant = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Grant; } catch { return invalid('Invalid upload ticket'); }
  if (grant.owner !== owner || grant.expires <= now.getTime()) invalid('Upload ticket expired or belongs to another user');
  return grant;
}
export async function readBounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<Buffer> {
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) { await reader.cancel(); invalid('File exceeds the upload size limit'); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
/** Magic bytes and intrinsic dimensions, never client-supplied MIME or dimensions. */
export function verifyMedia(bytes: Buffer, declared: string): { width: number; height: number } {
  let mime = '', width = 0, height = 0;
  if (bytes.length >= 24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii',12,16)==='IHDR') {
    mime = 'image/png'; width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (bytes.length >= 13 && /^GIF8[79]a$/.test(bytes.toString('ascii',0,6))) {
    mime = 'image/gif'; width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8);
  } else if (bytes.length >= 30 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') {
    mime = 'image/webp'; const kind = bytes.toString('ascii',12,16);
    if (kind==='VP8X') { width=1+bytes.readUIntLE(24,3); height=1+bytes.readUIntLE(27,3); }
    else if (kind==='VP8 ' && bytes[23]===0x9d && bytes[24]===0x01 && bytes[25]===0x2a) { width=bytes.readUInt16LE(26)&0x3fff; height=bytes.readUInt16LE(28)&0x3fff; }
    else if (kind==='VP8L' && bytes[20]===0x2f) { const bits=bytes.readUInt32LE(21); width=(bits&0x3fff)+1; height=((bits>>>14)&0x3fff)+1; }
  } else if (bytes.length >= 4 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) {
    mime = 'image/jpeg'; let offset=2;
    while (offset+4<=bytes.length) {
      if (bytes[offset++]!==255) break;
      while (bytes[offset]===255) offset++;
      const marker=bytes[offset++];
      if (marker===0xd9 || marker===0xda) break;
      if (marker===0x01 || marker>=0xd0 && marker<=0xd7) continue;
      if (offset+2>bytes.length) break;
      const length=bytes.readUInt16BE(offset); if (length<2 || offset+length>bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length>=8) { height=bytes.readUInt16BE(offset+3); width=bytes.readUInt16BE(offset+5); break; }
      offset+=length;
    }
  } else if (bytes.length >= 8 && /^%PDF-1\.[0-7]|^%PDF-2\.0/.test(bytes.toString('ascii',0,8))) { mime='application/pdf'; }
  if (!mime || mime!==declared) invalid('File signature does not match the declared MIME type');
  if (mime!=='application/pdf' && (!width || !height || width>30000 || height>30000 || width*height>100_000_000)) invalid('Invalid or excessive image dimensions');
  return { width, height };
}
/** Verify every variant independently before creating any trusted metadata. */
export async function prepareMedia(blobs: MediaStorage, grant: Grant, webGrant?: Grant) {
  async function verify(grant: Grant) {
    const incoming = await blobs.read(grant.path);
    if (!incoming) return invalid('Upload is missing');
    const bytes = await readBounded(incoming.stream, grant.size);
    if (bytes.length !== grant.size || incoming.size !== grant.size || incoming.contentType !== grant.mime) invalid('Uploaded size or MIME type differs from the ticket');
    return { grant, bytes, dimensions: verifyMedia(bytes, grant.mime) };
  }
  const original = await verify(grant);
  const web = webGrant ? await verify(webGrant) : undefined;
  if (web && (grant.mime === 'application/pdf' || web.grant.mime !== 'image/webp' || web.grant.owner !== grant.owner || web.dimensions.width > 2000 || web.dimensions.height > 2000)) invalid('Web variant must be a WebP image no larger than 2000 pixels');
  async function copy(item: Awaited<ReturnType<typeof verify>>, name: string) {
    const path = `media/${grant.year}/${grant.id}/${name}.${extensions[item.grant.mime]}`;
    const copied = await blobs.read(path);
    if (copied) {
      const old = await readBounded(copied.stream, item.bytes.length);
      if (!old.equals(item.bytes)) invalid('Conflicting finalized binary');
      return blobs.url(path);
    }
    return (await blobs.put(path, item.bytes, { contentType: item.grant.mime })).url;
  }
  const originalUrl = await copy(original, 'original');
  const webUrl = web ? await copy(web, 'web') : originalUrl;
  return { data: { filename: grant.filename, mime: grant.mime, size: original.bytes.length,
    ...(grant.mime === 'application/pdf' ? {} : (web ?? original).dimensions),
    variants: { original: originalUrl, web: webUrl }, source: 'upload', uploadedBy: grant.owner },
    cleanup: async () => { await blobs.delete(blobs.url(grant.path)); if (webGrant) await blobs.delete(blobs.url(webGrant.path)); } };
}
export async function finalizeMedia(store: Store, blobs: MediaStorage, grant: Grant, input: Record<string, unknown>, actor: Actor, now: Date, webGrant?: Grant): Promise<Doc> {
  const existing = await store.getDoc('media', grant.id);
  if (existing) return existing;
  const prepared = await prepareMedia(blobs, grant, webGrant);
  const draft = { ...prepared.data, alt: typeof input.alt === 'string' ? input.alt : '', caption: typeof input.caption === 'string' ? input.caption : '',
    focal: { x: 0.5, y: 0.5 }, uploadedAt: now.toISOString() };
  const checked = validate('media', draft); if (!checked.valid) throw new ValidationError(checked.errors);
  const doc: Doc = { id: grant.id, collection: 'media', draft, version: 1, status: 'draft', createdAt: now.toISOString(), updatedAt: now.toISOString(), createdBy: actor.id, updatedBy: actor.id };
  try { await store.createDoc({ doc, revision: revision(doc, actor, 'created', now), audit: audit(actor, 'media.upload', { collection: 'media', docId: doc.id }, now) }); }
  catch (error) { const winner = await store.getDoc('media', doc.id); if (!winner) throw error; return winner; }
  await prepared.cleanup();
  return doc;
}
export async function collectIncoming(blobs: MediaStorage, now: Date): Promise<number> {
  let count=0;
  for (const blob of await blobs.incoming()) if (Date.parse(blob.uploadedAt) < now.getTime()-86400000) { await blobs.delete(blobs.url(blob.path)); count++; }
  return count;
}
/** Only verified, published files are public. Drafts require a content-reading session. */
export async function serveMedia(request: Request, store: Store, blobs: MediaStorage): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const path = new URL(request.url).pathname.slice(7);
  if (!/^media\/\d{4}\/media_[a-f0-9]{32}\/(?:original\.(?:jpg|png|webp|gif|pdf)|web\.webp)$/.test(path)) return new Response('Not found', { status: 404 });
  const url = blobs.url(path), id = path.split('/')[2];
  const snapshot = await store.getSnapshot();
  const published = Object.values(snapshot?.media ?? {}).some(media => media.url===url) || (snapshot?.docs.media ?? []).some(doc => Object.values((doc.data as { variants?: Record<string,string> }).variants ?? {}).includes(url));
  if (!published) {
    const session = await readSession(store, request);
    if (!session || !can(session.user,'content.read')) return new Response('Not found', { status: 404, headers: { 'Cache-Control':'no-store' } });
  }
  const doc = await store.getDoc('media', id);
  const data = doc?.draft as { variants?: Record<string,string>; mime?: string } | undefined;
  if (!published && !Object.values(data?.variants ?? {}).includes(url)) {
    const docs = await store.listDocs('media');
    const current = docs.some(item => Object.values((item.draft as { variants?: Record<string,string> }).variants ?? {}).includes(url));
    if (!current && !await retained(store, url)) return new Response('Not found', { status: 404 });
  }
  const blob = await blobs.read(path);
  if (!blob || !extensions[blob.contentType]) return new Response('Not found', { status: 404 });
  return new Response(request.method==='HEAD' ? null : blob.stream, { headers: { 'Content-Type':blob.contentType, 'Content-Length':String(blob.size), 'Content-Disposition':'inline', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"sandbox; default-src 'none'", 'Cache-Control':published?'public, max-age=31536000, immutable':'private, no-store' } });
}
