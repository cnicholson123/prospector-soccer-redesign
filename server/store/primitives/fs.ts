import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { KvPrimitives, RunExclusive } from '../types';
export function safeKey(key: string): string {
  if (!key || key.includes('\\') || key.includes('\0') || key.startsWith('/') || key.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.'))) throw new Error('Invalid storage key');
  return key;
}
/** Reject symlink components, including missing-file writes below an existing symlink. */
export async function safePath(root: string, key: string): Promise<string> {
  safeKey(key);
  await mkdir(root, { recursive: true });
  let current = await realpath(root);
  for (const part of key.split('/')) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Storage symlinks are not allowed'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return current;
}
export async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, data, { flag: 'wx', mode: 0o600 }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
export class FsPrimitives implements KvPrimitives {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  async get(key: string): Promise<unknown | null> {
    const path = await safePath(this.root, key);
    try { return JSON.parse(await readFile(path, 'utf8')) as unknown; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async put(key: string, value: unknown): Promise<void> {
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error('Storage values must be JSON serializable');
    await atomicWrite(await safePath(this.root, key), json);
  }
  async delete(key: string): Promise<void> { await rm(await safePath(this.root, key), { force: true }); }
  async list(prefix: string): Promise<string[]> {
    if (prefix) safeKey(prefix.endsWith('/') ? prefix.slice(0, -1) : prefix);
    await mkdir(this.root, { recursive: true });
    const keys: string[] = [];
    const walk = async (directory: string, path = ''): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name.endsWith('.tmp') || entry.isSymbolicLink()) continue;
        const key = path + entry.name;
        if (entry.isDirectory()) await walk(join(directory, entry.name), key + '/');
        else if (entry.isFile() && key.startsWith(prefix)) keys.push(key);
      }
    };
    const base = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
    const directory = base ? await safePath(this.root, base) : this.root;
    try { await walk(directory, base ? base + '/' : ''); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return keys.sort();
  }
  /** Shared lock with a renewable lease and ownership-checked release. */
  exclusive: RunExclusive = async (operation) => {
    await mkdir(this.root, { recursive: true });
    const lock = join(this.root, '.store-lock');
    const ownerPath = join(lock, 'owner.json');
    const token = randomUUID();
    const deadline = Date.now() + 10_000;
    const owner = () => ({ pid: process.pid, at: Date.now(), token });
    while (true) {
      try {
        await mkdir(lock);
        await atomicWrite(ownerPath, JSON.stringify(owner()));
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const previous = JSON.parse(await readFile(ownerPath, 'utf8')) as { pid: number; at: number; token?: string };
          let alive = true;
          try { process.kill(previous.pid, 0); }
          catch (failure) { alive = (failure as NodeJS.ErrnoException).code !== 'ESRCH'; }
          if (!alive || Date.now() - previous.at > 30_000) {
            // Only one waiter may reclaim this particular lock directory.
            await mkdir(join(lock, '.reclaim'));
            const current = JSON.parse(await readFile(ownerPath, 'utf8')) as typeof previous;
            if (current.at === previous.at && current.token === previous.token) {
              const abandoned = join(this.root, `.abandoned-${token}`);
              await rename(lock, abandoned);
              console.warn('Recovering stale filesystem store lock', { pid: previous.pid });
              await rm(abandoned, { recursive: true, force: true });
            } else await rm(join(lock, '.reclaim'), { recursive: true, force: true });
            continue;
          }
        } catch (failure) {
          const code = (failure as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            // A process may die between mkdir and writing its owner file.
            try {
              if (Date.now() - (await stat(lock)).mtimeMs > 30_000) {
                const abandoned = join(this.root, `.abandoned-${token}`);
                await rename(lock, abandoned);
                console.warn('Recovering ownerless filesystem store lock');
                await rm(abandoned, { recursive: true, force: true });
              }
            } catch (missing) { if ((missing as NodeJS.ErrnoException).code !== 'ENOENT') throw missing; }
          } else if (code !== 'EEXIST') throw failure;
        }
        if (Date.now() > deadline) throw new Error('Filesystem store lock timed out');
        await delay(10);
      }
    }
    let heartbeat = Promise.resolve();
    const timer = setInterval(() => {
      heartbeat = heartbeat.then(async () => {
        const current = JSON.parse(await readFile(ownerPath, 'utf8')) as { token: string };
        if (current.token === token) await atomicWrite(ownerPath, JSON.stringify(owner()));
      }).catch(() => undefined);
    }, 5_000);
    timer.unref();
    try { return await operation(); }
    finally {
      clearInterval(timer);
      await heartbeat;
      try {
        const current = JSON.parse(await readFile(ownerPath, 'utf8')) as { token: string };
        if (current.token === token) await rm(lock, { recursive: true, force: true });
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  };
}
