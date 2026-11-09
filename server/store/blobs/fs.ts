import { readFile, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, safePath } from '../primitives/fs.js';
import { mediaPath, retained } from './common.js';
import type { MediaStorage, RunExclusive, Store } from '../types.js';
export class FsBlobs implements MediaStorage {
  private root: string;
  constructor(dataDir: string, private store: Store, private exclusive: RunExclusive) { this.root = join(dataDir, 'blobs'); }
  private async retained(url: string): Promise<boolean> {
    return retained(this.store, url);
  }
  async put(path: string, body: Uint8Array | ReadableStream<Uint8Array>, opts: { contentType: string }): Promise<{ url: string }> {
    if (!opts.contentType || /[\r\n]/.test(opts.contentType)) throw new Error('Invalid content type');
    const file = await safePath(this.root, path);
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
    const url = '/blobs/' + path.split('/').map(encodeURIComponent).join('/');
    return this.exclusive(async () => {
      if (await this.retained(url)) throw new Error('Media is retained by publish history');
      if (path.startsWith('media/')) {
        try { await stat(file); throw Object.assign(new Error('Media object already exists'), { code: 'conflict', status: 409 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      await atomicWrite(file, bytes);
      return { url };
    });
  }
  async delete(url: string): Promise<void> {
    if (!url.startsWith('/blobs/')) throw new Error('Not a local blob URL');
    const path = decodeURIComponent(url.slice(7));
    const file = await safePath(this.root, path);
    const canonicalUrl = '/blobs/' + path.split('/').map(encodeURIComponent).join('/');
    await this.exclusive(async () => {
      if (await this.retained(canonicalUrl)) throw new Error('Media is retained by publish history');
      await rm(file, { force: true });
    });
  }
  url(path: string) { return '/blobs/' + mediaPath(path); }
  async read(path: string) {
    mediaPath(path);
    try {
      const bytes = await readFile(await safePath(this.root, path));
      const types: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' };
      return { stream: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }), size: bytes.length, contentType: types[path.split('.').at(-1)!] };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async incoming() {
    const result: { path: string; uploadedAt: string }[] = [];
    const walk = async (path: string): Promise<void> => {
      let entries; try { entries = await readdir(await safePath(this.root, path), { withFileTypes: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const child = path + '/' + entry.name;
        if (entry.isDirectory()) await walk(child);
        else if (entry.isFile()) result.push({ path: child, uploadedAt: (await stat(await safePath(this.root, child))).mtime.toISOString() });
      }
    };
    await walk('media/incoming'); return result;
  }
  async clientUpload() { return { local: true }; }

}
