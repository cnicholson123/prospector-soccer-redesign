import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

export interface Config {
  storeDriver: 'fs' | 'postgres'; dataDir: string;
  databaseUrl?: string; blobReadWriteToken?: string; sessionSecret: string;
  adminBootstrapUser: string; adminBootstrapPassword: string; publicBaseUrl: string;
  cookieSecure: boolean; cacheSmaxage: number; cacheSwr: number; cdnPurge: 'off' | 'tag';
  cronSecret?: string; tzName: string; maxImageBytes: number; maxFileBytes: number;
  production: boolean;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env, warn = console.warn): Config {
  const production = env.NODE_ENV === 'production';
  const fail = (message: string): never => { throw new Error(`Configuration: ${message}`); };
  const choice = <T extends string>(key: string, fallback: T, choices: readonly T[]): T => {
    const value = env[key] ?? fallback;
    return choices.includes(value as T) ? value as T : fail(`${key} must be ${choices.join(' | ')}`);
  };
  const integer = (key: string, fallback: number, min = 0): number => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    return env[key] !== '' && Number.isSafeInteger(value) && value >= min ? value : fail(`${key} must be an integer >= ${min}`);
  };
  const bool = (key: string, fallback: boolean): boolean => {
    const value = env[key];
    return value === undefined ? fallback : value === 'true' ? true : value === 'false' ? false : fail(`${key} must be true or false`);
  };
  const storeDriver = choice('STORE_DRIVER', production ? 'postgres' : 'fs', ['fs', 'postgres']);
  if (storeDriver === 'postgres' && !env.DATABASE_URL) fail('DATABASE_URL is required for STORE_DRIVER=postgres');
  if (production && (!env.ADMIN_BOOTSTRAP_USER?.trim() || !env.ADMIN_BOOTSTRAP_PASSWORD?.trim())) fail('ADMIN_BOOTSTRAP_USER and ADMIN_BOOTSTRAP_PASSWORD are required in production');
  if (production && (!env.SESSION_SECRET || Buffer.byteLength(env.SESSION_SECRET) < 32)) fail('SESSION_SECRET must contain at least 32 bytes in production');
  if (env.SESSION_SECRET && Buffer.byteLength(env.SESSION_SECRET) < 32) fail('SESSION_SECRET must contain at least 32 bytes');
  const sessionSecret = env.SESSION_SECRET ?? randomBytes(32).toString('base64url');
  if (!env.SESSION_SECRET) warn('SESSION_SECRET is ephemeral; sessions will expire when the server restarts.');
  const publicBaseUrl = env.PUBLIC_BASE_URL ?? 'http://localhost:3000';
  let base: URL;
  try { base = new URL(publicBaseUrl); } catch { return fail('PUBLIC_BASE_URL must be an absolute HTTP(S) origin'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) fail('PUBLIC_BASE_URL must be an HTTP(S) origin without a path or credentials');
  if (production && base.protocol !== 'https:') fail('PUBLIC_BASE_URL must use HTTPS in production');
  const cookieSecure = bool('COOKIE_SECURE', production);
  if (production && !cookieSecure) fail('COOKIE_SECURE must be true in production');
  const tzName = env.TZ_NAME ?? 'America/Los_Angeles';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tzName }); } catch { fail('TZ_NAME must be a valid IANA timezone'); }
  return { production, storeDriver, dataDir: resolve(env.DATA_DIR ?? '.data'),
    databaseUrl: env.DATABASE_URL, blobReadWriteToken: env.BLOB_READ_WRITE_TOKEN, sessionSecret,
    adminBootstrapUser: env.ADMIN_BOOTSTRAP_USER || 'Phil', adminBootstrapPassword: env.ADMIN_BOOTSTRAP_PASSWORD || 'Phil',
    publicBaseUrl: base.origin, cookieSecure, cacheSmaxage: integer('CACHE_SMAXAGE', production ? 15 : 0),
    cacheSwr: integer('CACHE_SWR', production ? 300 : 0), cdnPurge: choice('CDN_PURGE', 'off', ['off', 'tag']),
    cronSecret: env.CRON_SECRET, tzName, maxImageBytes: integer('MAX_IMAGE_BYTES', 8 * 1024 ** 2, 1), maxFileBytes: integer('MAX_FILE_BYTES', 15 * 1024 ** 2, 1) };
}
