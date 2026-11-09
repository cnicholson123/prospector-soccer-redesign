import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, safePath } from '../primitives/fs';
import type { MediaBlobs } from '../types';
export class FsBlobs implements MediaBlobs {
  private root: string;
  constructor(dataDir: string) { this.root = join(dataDir, 'blobs'); }
  async put(path: string, body: Uint8Array | ReadableStream<Uint8Array>, opts: { contentType: string }): Promise<{ url: string }> {
    if (!opts.contentType || /[\r\n]/.test(opts.contentType)) throw new Error('Invalid content type');
    const file = await safePath(this.root, path);
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
    await atomicWrite(file, bytes);
    return { url: '/blobs/' + path.split('/').map(encodeURIComponent).join('/') };
  }
  async delete(url: string): Promise<void> {
    if (!url.startsWith('/blobs/')) throw new Error('Not a local blob URL');
    await rm(await safePath(this.root, decodeURIComponent(url.slice(7))), { force: true });
  }
}
