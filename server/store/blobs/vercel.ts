import { put, get, del, list } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import type { MediaStorage, Store } from '../types.js';
import { mediaPath, retained } from './common.js';
/** Blob holds binaries only. Metadata, access decisions and history live in Store. */
export class VercelBlobs implements MediaStorage {
  constructor(private token: string, private store: Store) {}
  url(path: string) { return '/media/' + mediaPath(path); }
  async put(path: string, body: Uint8Array | ReadableStream<Uint8Array>, opts: { contentType: string }) {
    mediaPath(path);
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].includes(opts.contentType)) throw new Error('Invalid content type');
    // Never overwrite: even concurrent finalization cannot change a retained binary.
    await put(path, body instanceof Uint8Array ? Buffer.from(body) : body, { token: this.token, access: 'private', contentType: opts.contentType, addRandomSuffix: false, allowOverwrite: false });
    return { url: '/media/' + path };
  }
  async read(path: string) {
    mediaPath(path);
    const blob = await get(path, { token: this.token, access: 'private', useCache: false });
    if (!blob || blob.statusCode !== 200) return null;
    return { stream: blob.stream, size: blob.blob.size, contentType: blob.blob.contentType };
  }
  async delete(url: string) {
    if (!url.startsWith('/media/media/')) throw new Error('Not a media URL');
    const path = mediaPath(url.slice('/media/'.length));
    if (!path.startsWith('media/incoming/')) {
      if (await retained(this.store, url)) throw new Error('Media is retained by publish history');
      // Verified objects are immutable; only quarantine is garbage collected.
      throw new Error('Verified media binaries cannot be deleted');
    }
    await del(path, { token: this.token });
  }
  async incoming() {
    const result: { path: string; uploadedAt: string }[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ token: this.token, prefix: 'media/incoming/', cursor, limit: 1000 });
      result.push(...page.blobs.map(blob => ({ path: blob.pathname, uploadedAt: blob.uploadedAt.toISOString() })));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return result;
  }
  async clientUpload(request: Request, body: unknown, grant?: { path: string; mime: string; size: number; expires: number }) {
    return handleUpload({ token: this.token, request, body: body as HandleUploadBody,
      onBeforeGenerateToken: async pathname => {
        if (!grant || mediaPath(pathname) !== grant.path || !pathname.startsWith('media/incoming/')) throw new Error('Invalid upload grant');
        return { allowedContentTypes: [grant.mime], maximumSizeInBytes: grant.size, validUntil: grant.expires,
          addRandomSuffix: false, allowOverwrite: false, callbackUrl: new URL('/api/admin/cron/blob-upload', request.url).href };
      },
      // SDK verifies completion signatures. A callback never creates trusted metadata.
      onUploadCompleted: async () => {},
    });
  }
}
