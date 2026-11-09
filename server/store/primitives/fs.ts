import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
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
    await walk(this.root);
    return keys.sort();
  }
  /** Cooperating FS stores serialize mutations across instances/processes.
   * No stale-lock stealing: timeout rather than risking a lost CAS write.
   * After an ungraceful process death, remove .store-lock only when no server runs.
   */
  exclusive: RunExclusive = async (operation) => {
    await mkdir(this.root, { recursive: true });
    const lock = join(this.root, '.store-lock');
    const deadline = Date.now() + 10_000;
    while (true) {
      try { await mkdir(lock); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; if (Date.now() > deadline) throw new Error('Filesystem store lock timed out'); await delay(10); }
    }
    try { return await operation(); } finally { await rm(lock, { recursive: true, force: true }); }
  };
}
