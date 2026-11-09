import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import type { Role } from '../shared/types.js';
import { isPasswordHash } from './auth/password.js';
export interface BootstrapUser { username: string; displayName: string; role: Role; passwordHash: string }

export interface Config {
  storeDriver: 'fs' | 'postgres'; dataDir: string;
  databaseUrl?: string; blobReadWriteToken?: string; sessionSecret: string;
  adminBootstrapUsers?: BootstrapUser[]; adminBootstrapUser: string; adminBootstrapPassword: string; publicBaseUrl: string;
  cookieSecure: boolean; cacheSmaxage: number; cacheSwr: number; cdnPurge: 'off' | 'tag';
  cronSecret?: string; tzName: string; maxImageBytes: number; maxFileBytes: number;
  production: boolean; adminForcePasswordChange: boolean; shopCheckout: 'disabled' | 'enabled';
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
  const shopCheckout = choice('SHOP_CHECKOUT', 'disabled', ['disabled', 'enabled']);
  if (shopCheckout === 'enabled' && !['development', 'test'].includes(env.NODE_ENV ?? '')) fail('SHOP_CHECKOUT=enabled is allowed only with NODE_ENV=development or test; production checkout is forbidden');
  const storeDriver = choice('STORE_DRIVER', production ? 'postgres' : 'fs', ['fs', 'postgres']);
  if (storeDriver === 'postgres' && !env.DATABASE_URL) fail('DATABASE_URL is required for STORE_DRIVER=postgres');
  let adminBootstrapUsers: BootstrapUser[] | undefined;
  if (env.ADMIN_BOOTSTRAP_USERS !== undefined) {
    let parsed: unknown;
    try { parsed = JSON.parse(env.ADMIN_BOOTSTRAP_USERS); } catch { fail('ADMIN_BOOTSTRAP_USERS must be a JSON array'); }
    if (!Array.isArray(parsed) || !parsed.length || parsed.length > 100) fail('ADMIN_BOOTSTRAP_USERS must contain 1–100 users');
    const names = new Set<string>();
    adminBootstrapUsers = (parsed as unknown[]).map(value => {
      const u = value as BootstrapUser | null;
      if (!u || typeof u !== 'object' || typeof u.username !== 'string' || !/^[A-Za-z0-9_.@-]{1,100}$/.test(u.username) || ['.', '..'].includes(u.username) ||
          typeof u.displayName !== 'string' || !u.displayName.trim() || u.displayName.length > 100 ||
          !['Owner', 'Admin', 'Editor', 'Contributor', 'Viewer'].includes(u.role) || !isPasswordHash(u.passwordHash)) fail('Invalid ADMIN_BOOTSTRAP_USERS entry');
      const user = u!;
      if (names.has(user.username.toLowerCase())) fail('ADMIN_BOOTSTRAP_USERS contains duplicate usernames');
      names.add(user.username.toLowerCase());
      return { username: user.username, displayName: user.displayName, role: user.role, passwordHash: user.passwordHash };
    });
    if (!adminBootstrapUsers.some(u => u.role === 'Owner')) fail('ADMIN_BOOTSTRAP_USERS requires an Owner');
  }
  if (production && !adminBootstrapUsers) fail('ADMIN_BOOTSTRAP_USERS is required in production');
  if (production && (!env.SESSION_SECRET || Buffer.byteLength(env.SESSION_SECRET) < 32)) fail('SESSION_SECRET must contain at least 32 bytes in production');
  if (env.SESSION_SECRET && Buffer.byteLength(env.SESSION_SECRET) < 32) fail('SESSION_SECRET must contain at least 32 bytes');
  const sessionSecret = env.SESSION_SECRET ?? randomBytes(32).toString('base64url');
  if (!env.SESSION_SECRET) warn('SESSION_SECRET is ephemeral; set a persistent value before enabling signed upload tokens.');
  const publicBaseUrl = env.PUBLIC_BASE_URL ?? 'http://localhost:3000';
  let base: URL;
  try { base = new URL(publicBaseUrl); } catch { return fail('PUBLIC_BASE_URL must be an absolute HTTP(S) origin'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) fail('PUBLIC_BASE_URL must be an HTTP(S) origin without a path or credentials');
  if (production && base.protocol !== 'https:') fail('PUBLIC_BASE_URL must use HTTPS in production');
  const cookieSecure = bool('COOKIE_SECURE', production);
  if (production && !cookieSecure) fail('COOKIE_SECURE must be true in production');
  const tzName = env.TZ_NAME ?? 'America/Los_Angeles';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tzName }); } catch { fail('TZ_NAME must be a valid IANA timezone'); }
  return { production, shopCheckout, adminForcePasswordChange: bool('ADMIN_FORCE_PASSWORD_CHANGE', false), storeDriver, dataDir: resolve(env.DATA_DIR ?? '.data'),
    databaseUrl: env.DATABASE_URL, blobReadWriteToken: env.BLOB_READ_WRITE_TOKEN, sessionSecret,
    adminBootstrapUsers, adminBootstrapUser: env.ADMIN_BOOTSTRAP_USERNAME || env.ADMIN_BOOTSTRAP_USER || 'Phil', adminBootstrapPassword: env.ADMIN_BOOTSTRAP_PASSWORD || 'Phil',
    publicBaseUrl: base.origin, cookieSecure, cacheSmaxage: integer('CACHE_SMAXAGE', production ? 15 : 0),
    cacheSwr: integer('CACHE_SWR', production ? 300 : 0), cdnPurge: choice('CDN_PURGE', 'off', ['off', 'tag']),
    cronSecret: env.CRON_SECRET, tzName, maxImageBytes: integer('MAX_IMAGE_BYTES', 8 * 1024 ** 2, 1), maxFileBytes: integer('MAX_FILE_BYTES', 15 * 1024 ** 2, 1) };
}
