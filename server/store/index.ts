import { loadConfig, type Config } from '../config.js';
import { KvStore } from './kv-store.js';
import { FsPrimitives } from './primitives/fs.js';
import { FsBlobs } from './blobs/fs.js';
import { PostgresStore } from './postgres-store.js';
import { postgresPool, postgresRead } from './postgres.js';
import { VercelBlobs } from './blobs/vercel.js';
import type { MediaStorage, Store } from './types.js';
export function createStore(config: Config = loadConfig()): Store {
  if (config.storeDriver === 'postgres') {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
    return new PostgresStore(postgresPool(config.databaseUrl, true), { readQuery: postgresRead(config.databaseUrl) });
  }
  const primitives = new FsPrimitives(config.dataDir);
  return new KvStore(primitives, { exclusive: primitives.exclusive });
}
export function createMediaBlobs(config: Config = loadConfig(), store: Store = createStore(config)): MediaStorage {
  if (config.storeDriver === 'postgres') {
    if (!config.blobReadWriteToken) throw new Error('BLOB_READ_WRITE_TOKEN is required for hosted media');
    return new VercelBlobs(config.blobReadWriteToken, store);
  }
  const primitives = new FsPrimitives(config.dataDir);
  return new FsBlobs(config.dataDir, store, primitives.exclusive);
}
