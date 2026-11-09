import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, safePath } from '../primitives/fs';
import type { MediaBlobs, RunExclusive, Store } from '../types';
export class FsBlobs implements MediaBlobs {
  private root: string;
  constructor(dataDir: string, private store: Store, private exclusive: RunExclusive) { this.root = join(dataDir, 'blobs'); }
  private async retained(url: string): Promise<boolean> {
    let before: number | undefined;
    do {
      const records = await this.store.listPublishes(1000, before);
      for (const record of records) for (const entry of record.manifest.filter(entry => entry.collection === 'media')) {
        const revision = await this.store.getRevision(entry.id, entry.revId);
        const data = revision?.data as { variants?: Record<string, string> } | undefined;
        if (Object.values(data?.variants ?? {}).includes(url)) return true;
      }
      if (records.length < 1000) return false;
      before = records.at(-1)!.siteVersion;
    } while (before !== undefined);
    return false;
  }
  async put(path: string, body: Uint8Array | ReadableStream<Uint8Array>, opts: { contentType: string }): Promise<{ url: string }> {
    if (!opts.contentType || /[\r\n]/.test(opts.contentType)) throw new Error('Invalid content type');
    const file = await safePath(this.root, path);
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
    const url = '/blobs/' + path.split('/').map(encodeURIComponent).join('/');
    return this.exclusive(async () => {
      if (await this.retained(url)) throw new Error('Media is retained by publish history');
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
}
