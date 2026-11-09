import { loadConfig, type Config } from '../config';
import { KvStore } from './kv-store';
import { FsPrimitives } from './primitives/fs';
import { FsBlobs } from './blobs/fs';
import { PostgresStore } from './postgres-store';
import { postgresPool } from './postgres';
import { VercelBlobs } from './blobs/vercel';
import type { MediaStorage, Store } from './types';
export function createStore(config: Config = loadConfig()): Store {
  if (config.storeDriver === 'postgres') {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
    return new PostgresStore(postgresPool(config.databaseUrl));
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
  return new FsBlobs(config.dataDir, new KvStore(primitives, { exclusive: primitives.exclusive }), primitives.exclusive);
}
