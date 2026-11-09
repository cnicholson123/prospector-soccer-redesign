import { randomBytes } from 'node:crypto';
import type { Config } from '../config';
import type { Store } from '../store/types';
import { hashPassword, passwordWeak } from './password';
import { audit } from '../audit';
export async function bootstrap(store: Store, config: Config, now = new Date()) {
  if ((await store.listUsers()).length) return false;
  const user = { id: `usr_${randomBytes(12).toString('base64url')}`, username: config.adminBootstrapUser, displayName: config.adminBootstrapUser, role: 'Owner' as const, passwordHash: await hashPassword(config.adminBootstrapPassword), passwordWeak: passwordWeak(config.adminBootstrapPassword, config.adminBootstrapUser), active: true, createdAt: now.toISOString(), createdBy: 'system' };
  return store.bootstrapOwner(user, audit({ id: 'system', displayName: 'System' }, 'system.bootstrap', {}, now));
}
