import type { Context, MiddlewareHandler } from 'hono';
import type { Config } from '../../config';
import type { MediaStorage, Store } from '../../store/types';
import type { Session, User } from '../../../shared/types';
import { readSession, cookie } from '../../auth/session';
import { rateLimit } from '../../auth/ratelimit';
import { checkCsrf } from '../../auth/csrf';
import { can } from '../../permissions';
import { settleSchedules } from '../../content/schedule';
import { ApiError } from './errors';
export type AdminEnv = { Variables: { blobs: MediaStorage; user: User; session: Session; store: Store; config: Config; now: Date } };
export type AdminContext = Context<AdminEnv>;
export const actor = (c: AdminContext) => ({ id: c.get('user').id, displayName: c.get('user').displayName, ip: c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown', userAgent: c.req.header('user-agent') ?? '' });
export const authenticate: MiddlewareHandler<AdminEnv> = async (c, next) => {
  const auth = await readSession(c.get('store'), c.req.raw, c.get('now'), c.get('config').production);
  if (!auth) throw new ApiError(401, 'unauthenticated', 'Sign in to continue');
  c.set('user', auth.user); c.set('session', auth.session);
  await rateLimit(c.get('store'), `api-${auth.session.hash}`, 600, 300, c.get('now'));
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) checkCsrf(c.req.raw, auth.session.csrfToken, c.get('config'));
  if (auth.refreshed) c.header('Set-Cookie', cookie(auth.token, c.get('config'), Math.floor((Date.parse(auth.session.expiresAt) - c.get('now').getTime()) / 1000)));
  if (auth.user.mustChangePassword && !['/api/admin/auth/me', '/api/admin/auth/password', '/api/admin/auth/logout'].includes(c.req.path)) throw new ApiError(403, 'password_change_required', 'Change your password to continue');
  if (can(auth.user, 'content.publish') && !c.req.path.startsWith('/api/admin/auth/') && !c.req.path.startsWith('/api/admin/schedule/') && !c.req.path.endsWith('/untrash')) {
    try { await settleSchedules(c.get('store'), c.get('now')); await c.get('store').setMeta('schedule-error', null); }
    catch { await c.get('store').setMeta('schedule-error', { at: c.get('now').toISOString() }); }
  }
  await next();
};
