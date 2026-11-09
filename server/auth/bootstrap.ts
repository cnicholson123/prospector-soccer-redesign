import { randomBytes } from 'node:crypto';
import type { Config } from '../config.js';
import type { Store } from '../store/types.js';
import { hashPassword, passwordWeak } from './password.js';
import { audit } from '../audit.js';
export async function bootstrap(store: Store, config: Config, now = new Date()) {
  if (config.adminBootstrapUsers) {
    const entries = config.adminBootstrapUsers.map(u => {
      const user = { ...u, id: `usr_${randomBytes(12).toString('base64url')}`, active: true, passwordWeak: false, mustChangePassword: false, createdAt: now.toISOString(), createdBy: 'system' };
      return { user, audit: audit({ id: 'system', displayName: 'System' }, 'system.bootstrap', { targetTitle: user.username, meta: { userId: user.id, role: user.role } }, now) };
    });
    return (await store.bootstrapUsers(entries)) > 0;
  }
  if ((await store.listUsers()).length) return false;
  const user = { id: `usr_${randomBytes(12).toString('base64url')}`, username: config.adminBootstrapUser, displayName: config.adminBootstrapUser, role: 'Owner' as const, passwordHash: await hashPassword(config.adminBootstrapPassword), passwordWeak: passwordWeak(config.adminBootstrapPassword, config.adminBootstrapUser), mustChangePassword: config.adminForcePasswordChange && passwordWeak(config.adminBootstrapPassword, config.adminBootstrapUser), active: true, createdAt: now.toISOString(), createdBy: 'system' };
  return store.bootstrapOwner(user, audit({ id: 'system', displayName: 'System' }, 'system.bootstrap', {}, now));
}
