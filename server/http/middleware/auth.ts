import type { Context, MiddlewareHandler } from 'hono';
import type { Config } from '../../config.js';
import type { MediaStorage, Store, AdminCounts } from '../../store/types.js';
import type { Session, User } from '../../../shared/types.js';
import { readSession, cookie } from '../../auth/session.js';
import { instanceWork } from './instance-work.js';
import { stage } from '../../store/metrics.js';
import { checkCsrf } from '../../auth/csrf.js';
import { can } from '../../permissions.js';
import { ApiError } from './errors.js';
export type AdminEnv = { Variables: { blobs: MediaStorage; user: User; session: Session; store: Store; config: Config; now: Date; counts: AdminCounts | undefined } };
export type AdminContext = Context<AdminEnv>;
export const actor = (c: AdminContext) => ({ id: c.get('user').id, displayName: c.get('user').displayName, ip: c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown', userAgent: c.req.header('user-agent') ?? '' });
export function createAuthenticate(): MiddlewareHandler<AdminEnv> {
  const work = instanceWork();
  return async (c, next) => {
    const auth = await stage('auth', () => readSession(c.get('store'), c.req.raw, c.get('now'), c.get('config').production));
    if (!auth) throw new ApiError(401, 'unauthenticated', 'Sign in to continue');
    c.set('counts', auth.counts);
    c.set('user', auth.user); c.set('session', auth.session);
    await stage('ratelimit', async () => work.rateLimit(auth.session.hash, c.get('now').getTime()));
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) checkCsrf(c.req.raw, auth.session.csrfToken, c.get('config'));
    if (auth.refreshed) c.header('Set-Cookie', cookie(auth.token, c.get('config'), Math.floor((Date.parse(auth.session.expiresAt) - c.get('now').getTime()) / 1000)));
    if (auth.user.mustChangePassword && !['/api/admin/auth/me', '/api/admin/auth/password', '/api/admin/auth/logout'].includes(c.req.path)) throw new ApiError(403, 'password_change_required', 'Change your password to continue');
    if (can(auth.user, 'content.publish') && !c.req.path.startsWith('/api/admin/auth/') && !c.req.path.startsWith('/api/admin/schedule/') && !c.req.path.endsWith('/untrash')) {
      const due = await stage('settle', () => work.settle(c.get('store'), c.get('now'), auth));
      if (due) c.set('counts', undefined); // The aggregate captured at authentication predates settlement.
    }
    await stage('handler', next);
  };
}
export const authenticate = createAuthenticate();
