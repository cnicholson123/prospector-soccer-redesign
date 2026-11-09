import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.js';
import type { MediaStorage, Store, Doc, MediaCleanup, UploadFinalization } from './store/types.js';
import { ApiError } from './http/middleware/errors.js';
import { revision } from './content/revisions.js';
import { audit, type Actor } from './audit.js';
import { validate, ValidationError } from './content/validate.js';
import { readSession } from './auth/session.js';
import { can } from './permissions.js';
import { effectiveSnapshot } from './content/scheduled-view.js';
import { tagContent } from './render/cdn.js';
import { retained } from './store/blobs/common.js';

const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
interface Grant { version: 2; id: string; owner: string; filename: string; mime: string; size: number; path: string; expires: number; year: string }
const invalid = (message: string): never => { throw new ApiError(422, 'validation', message); };
export function uploadGrant(input: Record<string, unknown>, owner: string, config: Config, now: Date) {
  if (typeof input.mime !== 'string' || !extensions[input.mime]) invalid('Upload JPEG, PNG, WebP, GIF or PDF; SVG is not allowed');
  const mime = input.mime as string, size = input.size;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > (mime === 'application/pdf' ? config.maxFileBytes : config.maxImageBytes)) invalid('File exceeds the upload size limit');
  if (typeof input.filename !== 'string' || input.filename.length > 255) invalid('Invalid filename');
  const filename = (input.filename as string).split(/[\\/]/).at(-1)!.replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/^\.+/, '').trim() || 'upload.' + extensions[mime];
  const id = 'media_' + randomBytes(16).toString('hex');
  const grant: Grant = { version: 2, id, owner, filename, mime, size: size as number, path: `media/incoming/${id}/original.${extensions[mime]}`, expires: now.getTime() + 15*60000, year: String(now.getUTCFullYear()) };
  const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
  return { grant, ticket: payload + '.' + createHmac('sha256', config.sessionSecret).update(payload).digest('base64url') };
}
export function readGrant(ticket: string, owner: string, config: Config, now: Date): Grant {
  const [payload, signature, extra] = ticket.split('.');
  const expected = createHmac('sha256', config.sessionSecret).update(payload ?? '').digest();
  const received = Buffer.from(signature ?? '', 'base64url');
  if (extra || received.length !== expected.length || !timingSafeEqual(received, expected)) invalid('Invalid upload ticket');
  let grant: Grant; try { grant = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Grant; } catch { return invalid('Invalid upload ticket'); }
  if (grant.version !== 2) invalid('Upload ticket is from an older protocol; request a new upload');
  if (grant.owner !== owner || grant.expires <= now.getTime()) invalid('Upload ticket expired or belongs to another user');
  return grant;
}
/** Bind both grants to the exact logical operation, independent of copy paths/time. */
export function mediaFinalization(grant: Grant, web: Grant | undefined, operation: string, values: unknown[]): UploadFinalization {
  if (grant.id === web?.id) invalid('Original and web variants require separate upload tickets');
  return { grantIds: web ? [grant.id, web.id] : [grant.id],
    fingerprint: createHash('sha256').update(JSON.stringify([operation, grant.id, web?.id ?? null, ...values])).digest('hex') };
}
export async function requireUnusedUpload(store: Store, grant: Grant): Promise<void> {
  if (await store.isUploadConsumed(grant.id)) throw new ApiError(409, 'upload_consumed', 'Upload ticket has already been used');
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
/** Verify and validate the complete metadata before copying any binary. */
export async function prepareMedia(store: Store, blobs: MediaStorage, grant: Grant, webGrant?: Grant, metadata: Record<string, unknown> = {}) {
  if (grant.mime !== 'application/pdf' && !webGrant) invalid('Images require a WebP web variant no larger than 2000 pixels');
  async function verify(item: Grant) {
    const incoming = await blobs.read(item.path);
    if (!incoming) return invalid('Upload is missing');
    const bytes = await readBounded(incoming.stream, item.size);
    if (bytes.length !== item.size || incoming.size !== item.size || incoming.contentType !== item.mime) invalid('Uploaded size or MIME type differs from the ticket');
    return { grant: item, bytes, dimensions: verifyMedia(bytes, item.mime) };
  }
  const original = await verify(grant);
  const web = webGrant ? await verify(webGrant) : undefined;
  if (web && (grant.mime === 'application/pdf' || web.grant.mime !== 'image/webp' || web.grant.owner !== grant.owner || web.dimensions.width > 2000 || web.dimensions.height > 2000)) invalid('Web variant must be a WebP image no larger than 2000 pixels');
  // Each attempt owns its copies, so a losing finalization cannot remove the winner's binaries.
  const binaryId = 'media_' + randomBytes(16).toString('hex');
  const originalPath = `media/${grant.year}/${binaryId}/original.${extensions[grant.mime]}`;
  const webPath = web ? `media/${grant.year}/${binaryId}/web.webp` : originalPath;
  const urls = [...new Set([originalPath, webPath])].map(path => blobs.url(path));
  const data = { ...metadata, filename: grant.filename, mime: grant.mime, size: original.bytes.length,
    ...(grant.mime === 'application/pdf' ? {} : (web ?? original).dimensions),
    variants: { original: blobs.url(originalPath), web: blobs.url(webPath) }, source: 'upload', uploadedBy: metadata.uploadedBy ?? grant.owner };
  const checked = validate('media', data); if (!checked.valid) throw new ValidationError(checked.errors);
  const intent: MediaCleanup = { kind: 'media-finalization', id: binaryId, at: new Date(grant.expires - 900000).toISOString(), urls };
  await store.setMeta('media-cleanup-' + binaryId, intent);
  try {
    await blobs.put(originalPath, original.bytes, { contentType: grant.mime });
    if (web) await blobs.put(webPath, web.bytes, { contentType: web.grant.mime });
  } catch (error) { await cleanMediaAttempt(store, blobs, intent); throw error; }
  return { data, intent,
    cleanup: async () => { await blobs.delete(blobs.url(grant.path)); if (webGrant) await blobs.delete(blobs.url(webGrant.path)); } };
}
/** Recover an interrupted FS commit before deciding which attempt's copies are unreferenced. */
export async function commitMedia(store: Store, blobs: MediaStorage, prepared: Awaited<ReturnType<typeof prepareMedia>>, commit: () => Promise<Doc>): Promise<Doc> {
  try {
    const doc = await commit();
    await cleanMediaAttempt(store, blobs, prepared.intent);
    await prepared.cleanup();
    return doc;
  } catch (error) {
    await store.recoverPublish();
    await cleanMediaAttempt(store, blobs, prepared.intent);
    throw error;
  }
}
export async function finalizeMedia(store: Store, blobs: MediaStorage, grant: Grant, input: Record<string, unknown>, actor: Actor, now: Date, webGrant?: Grant): Promise<Doc> {
  const upload = mediaFinalization(grant, webGrant, 'create', [input.alt ?? '', input.caption ?? '']);
  const existing = await store.getUploadResult(upload);
  if (existing) return existing;
  try {
    const prepared = await prepareMedia(store, blobs, grant, webGrant, { alt: input.alt ?? '', caption: input.caption ?? '', focal: { x: 0.5, y: 0.5 }, uploadedAt: now.toISOString() });
    const doc: Doc = { id: grant.id, collection: 'media', draft: prepared.data, version: 1, status: 'draft', createdAt: now.toISOString(), updatedAt: now.toISOString(), createdBy: actor.id, updatedBy: actor.id };
    return await commitMedia(store, blobs, prepared, () => store.createDoc({ doc, revision: revision(doc, actor, 'created', now), audit: audit(actor, 'media.upload', { collection: 'media', docId: doc.id }, now), upload }));
  } catch (error) {
    // A concurrent identical request may have committed and removed quarantine.
    const completed = await store.getUploadResult(upload);
    if (completed) return completed;
    throw error;
  }
}
async function cleanMediaAttempt(store: Store, blobs: MediaStorage, intent: MediaCleanup) {
  for (const url of intent.urls) if (!await retained(store, url)) await blobs.delete(url);
  await store.deleteMediaCleanup(intent.id);
}
export async function collectIncoming(blobs: MediaStorage, now: Date, store?: Store): Promise<number> {
  let count=0;
  if (store) {
    await store.recoverPublish();
    const pending = await store.listMediaCleanups(new Date(now.getTime() - 86400000).toISOString(), 100);
    for (const intent of pending) await cleanMediaAttempt(store, blobs, intent);
  }
  for (const blob of await blobs.incoming()) if (Date.parse(blob.uploadedAt) < now.getTime()-86400000) { await blobs.delete(blobs.url(blob.path)); count++; }
  return count;
}
/** Only verified, published files are public. Drafts require a content-reading session. */
export async function serveMedia(request: Request, store: Store, blobs: MediaStorage, now = new Date()): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const path = new URL(request.url).pathname.slice(7);
  if (!/^media\/\d{4}\/media_[a-f0-9]{32}\/(?:original\.(?:jpg|png|webp|gif|pdf)|web\.webp)$/.test(path)) return new Response('Not found', { status: 404 });
  const url = blobs.url(path), id = path.split('/')[2];
  const stored = await store.getSnapshot();
  const snapshot = stored ? effectiveSnapshot(stored, now) : null;
  const published = Object.entries(snapshot?.media ?? {}).some(([mediaId, media]) => !snapshot?.docs.media?.some(doc => doc.id === mediaId) && media.url === url) || (snapshot?.docs.media ?? []).some(doc => Object.values((doc.data as { variants?: Record<string,string> }).variants ?? {}).includes(url));
  if (!published) {
    const session = await readSession(store, request, now);
    if (!session || session.user.mustChangePassword || !can(session.user,'content.read')) return new Response('Not found', { status: 404, headers: { 'Cache-Control':'no-store' } });
  }
  let doc = await store.getDoc('media', id);
  const data = doc?.draft as { variants?: Record<string,string>; mime?: string } | undefined;
  if (!published && !Object.values(data?.variants ?? {}).includes(url)) {
    const docs = await store.listDocs('media');
    doc = docs.find(item => Object.values((item.draft as { variants?: Record<string,string> }).variants ?? {}).includes(url)) ?? doc;
    if (!doc && !await retained(store, url)) return new Response('Not found', { status: 404 });
  }
  const blob = await blobs.read(path);
  if (!blob || !extensions[blob.contentType]) return new Response('Not found', { status: 404 });
  const publicData = snapshot?.docs.media?.find(item => Object.values((item.data as { variants?: Record<string, string> }).variants ?? {}).includes(url))?.data as { filename?: string } | undefined;
  const filename = (published ? publicData?.filename : (doc?.draft as { filename?: string } | undefined)?.filename) ?? path.split('/').at(-1)!;
  const safeFilename = filename.replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/^\.+/, '').trim() || 'download.pdf';
  if (published) await tagContent();
  return new Response(request.method==='HEAD' ? null : blob.stream, { headers: { 'Content-Type':blob.contentType, 'Content-Length':String(blob.size), 'Content-Disposition':blob.contentType === 'application/pdf' ? `inline; filename="${safeFilename}"` : 'inline', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"sandbox; default-src 'none'", 'Cache-Control':published?'public, max-age=0, s-maxage=300, stale-while-revalidate=60':'private, no-store' } });
}
