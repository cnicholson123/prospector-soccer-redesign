import { loadConfig, type Config } from '../config';
import { KvStore } from './kv-store';
import { FsPrimitives } from './primitives/fs';
import { FsBlobs } from './blobs/fs';
import type { MediaBlobs, Store } from './types';
export function createStore(config: Config = loadConfig()): Store {
  if (config.storeDriver !== 'fs') throw new Error(`STORE_DRIVER=${config.storeDriver} is not implemented until Phase 6; use fs locally`);
  const primitives = new FsPrimitives(config.dataDir);
  return new KvStore(primitives, { exclusive: primitives.exclusive });
}
export function createMediaBlobs(config: Config = loadConfig()): MediaBlobs {
  if (config.storeDriver !== 'fs') throw new Error('Hosted media storage is not implemented until Phase 6; use fs locally');
  const primitives = new FsPrimitives(config.dataDir);
  return new FsBlobs(config.dataDir, new KvStore(primitives, { exclusive: primitives.exclusive }), primitives.exclusive);
}
