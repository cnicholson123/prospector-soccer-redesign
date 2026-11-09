import { api, session, invalidateCache } from '../api.js';
import { changed, record, type ContentDoc } from './content.js';
export type MediaDoc = ContentDoc;
export type MediaKind = 'all' | 'images' | 'documents';
export interface Usage { collection: ContentDoc['collection']; id: string; title: string; path: string }
export const mediaUrl = (doc: MediaDoc) => String(record(doc.draft.variants).web || record(doc.draft.variants).original || '');
export const isImage = (doc: MediaDoc) => String(doc.draft.mime).startsWith('image/');
export const focal = (doc: MediaDoc) => ({ x: Number(record(doc.draft.focal).x ?? 0.5), y: Number(record(doc.draft.focal).y ?? 0.5) });
export const position = (doc: MediaDoc) => `${focal(doc).x * 100}% ${focal(doc).y * 100}%`;
export function fitImage(width: number, height: number) {
  const scale = Math.min(1, 2000 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function filterMedia(docs: MediaDoc[], kind: MediaKind, query: string) {
  const needle = query.trim().toLowerCase();
  return docs.filter(doc => (kind === 'all' || (kind === 'images') === isImage(doc)) &&
    [doc.draft.filename, doc.draft.alt, doc.draft.caption].some(value => String(value ?? '').toLowerCase().includes(needle)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
export function checkFile(file: Pick<File, 'type' | 'size'>) {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].includes(file.type)) throw new Error('Choose a JPEG, PNG, WebP, GIF or PDF file. SVG is not supported.');
  if (!file.size || file.size > (file.type === 'application/pdf' ? 15 : 8) * 1024 * 1024) throw new Error(file.type === 'application/pdf' ? 'PDFs must be 15 MB or smaller.' : 'Images must be 8 MB or smaller.');
}
interface Grant { ticket: string; local: boolean; pathname: string; uploadUrl: string; handleUploadUrl: string }
export interface UploadProgress { percent: number; stage: string }
export async function uploadMedia(file: File, progress: (value: UploadProgress) => void, signal: AbortSignal, replace?: MediaDoc): Promise<MediaDoc> {
  checkFile(file);
  if (replace && isImage(replace) !== file.type.startsWith('image/')) throw new Error('Choose the same kind of media for replacement.');
  progress({ percent: 0, stage: 'Preparing file' });
  let web: Blob | undefined;
  if (file.type.startsWith('image/')) {
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > 100_000_000) throw new Error('This image has too many pixels. Choose a smaller image.');
      const size = fitImage(bitmap.width, bitmap.height), canvas = document.createElement('canvas');
      canvas.width = size.width; canvas.height = size.height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Image processing is unavailable in this browser.');
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      web = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob?.type === 'image/webp' ? resolve(blob) : reject(new Error('This browser cannot create WebP images.')), 'image/webp', 0.85));
    } finally { bitmap.close(); }
  }
  async function send(blob: Blob, filename: string, offset: number, share: number) {
    signal.throwIfAborted();
    const grant = await api<Grant>('/media/upload-url', 'POST', { filename, mime: blob.type, size: blob.size });
    signal.throwIfAborted();
    const onProgress = (percent: number) => progress({ percent: offset + percent * share, stage: blob === file ? 'Uploading original' : 'Uploading WebP image' });
    if (grant.local) {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort(); signal.addEventListener('abort', abort, { once: true });
        xhr.open('PUT', grant.uploadUrl); xhr.setRequestHeader('Content-Type', blob.type); xhr.setRequestHeader('X-CSRF-Token', session.value?.csrfToken ?? '');
        xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total * 100); };
        xhr.onload = () => { signal.removeEventListener('abort', abort); xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed. Please try again.')); };
        xhr.onerror = () => { signal.removeEventListener('abort', abort); reject(new Error('Connection lost. Please try again.')); };
        xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
        xhr.send(blob);
      });
    } else {
      const { upload } = await import('@vercel/blob/client');
      await upload(grant.pathname, blob, { access: 'private', handleUploadUrl: grant.handleUploadUrl,
        contentType: blob.type, headers: { 'X-CSRF-Token': session.value?.csrfToken ?? '' }, abortSignal: signal,
        onUploadProgress: event => onProgress(event.percentage) });
    }
    onProgress(100); return grant.ticket;
  }
  const ticket = await send(file, file.name, 5, web ? 0.45 : 0.85);
  const webTicket = web ? await send(web, file.name.replace(/\.[^.]*$/, '') + '.webp', 50, 0.4) : undefined;
  signal.throwIfAborted(); progress({ percent: 95, stage: 'Finishing upload' });
  const result = await api<{ doc: MediaDoc }>(replace ? `/media/${replace.id}/replace` : '/media', 'POST', { ticket, webTicket, ...(replace ? { baseVersion: replace.version } : {}) });
  invalidateCache(); changed(); progress({ percent: 100, stage: 'Uploaded' }); return result.doc;
}
