import type { Hono } from 'hono';
import { audit, publicUser } from '../../audit';
import { checkOrigin } from '../../auth/csrf';
import { verifyPassword, passwordWeak, checkPassword, hashPassword } from '../../auth/password';
import { failedLogin, lockKey, rateLimit, type LockState } from '../../auth/ratelimit';
import { newSession, cookie, revokeSessions } from '../../auth/session';
import { actor, authenticate, type AdminEnv } from '../middleware/auth';
import { ApiError, object, string } from '../middleware/errors';
import { permissionsFor } from '../../permissions';
export function authRoutes(app: Hono<AdminEnv>) {
  app.post('/api/admin/auth/login', async c => {
    const store = c.get('store'), now = c.get('now');
    const context = { id: 'anonymous', displayName: 'Unknown user', ip: c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown', userAgent: c.req.header('user-agent') ?? '' };
    try { await rateLimit(store, `login-ip-${context.ip}`, 10, 900, now); }
    catch (error) { await store.recordAudit(audit(context, 'auth.login_failed', { meta: { reason: 'rate_limited' } }, now)); throw error; }
    let username: string, password: string;
    try {
      checkOrigin(c.req.raw, c.get('config'));
      const input = object(await c.req.json());
      username = string(input.username, 'username', 100);
      context.displayName = username;
      password = string(input.password, 'password', 1024);
    } catch (error) {
      await store.recordAudit(audit(context, 'auth.login_failed', { meta: { reason: 'invalid_request' } }, now));
      throw error;
    }
    if (await store.claimMaintenance('session-gc-at', 3600000, now.toISOString())) await store.deleteExpiredSessions(now.toISOString());
    const lock = await store.getMeta(lockKey(username)) as LockState | null;
    if (lock?.until && Date.parse(lock.until) > now.getTime()) {
      await store.recordAudit(audit(context, 'auth.locked', {}, now));
      throw new ApiError(423, 'locked', 'Account temporarily locked', { until: lock.until }, Math.ceil((Date.parse(lock.until) - now.getTime()) / 1000));
    }
    const user = await store.getUserByUsername(username);
    if (!await verifyPassword(password, user?.passwordHash) || !user?.active) {
      const state = await failedLogin(store, username, now);
      await store.recordAudit(audit(context, 'auth.login_failed', {}, now));
      if (state.until && Date.parse(state.until) > now.getTime()) {
        await store.recordAudit(audit(context, 'auth.locked', {}, now));
        throw new ApiError(423, 'locked', 'Account temporarily locked', { until: state.until }, Math.ceil((Date.parse(state.until) - now.getTime()) / 1000));
      }
      throw new ApiError(401, 'unauthenticated', 'Invalid username or password');
    }
    await store.setMeta(lockKey(username), { failures: 0, locks: 0 });
    const updated = await store.recordLogin(user.id, user.passwordHash, passwordWeak(password, user.username), audit({ ...context, ...user }, 'auth.login', {}, now));
    if (!updated) {
      await store.recordAudit(audit(context, 'auth.login_failed', { meta: { reason: 'credentials_changed' } }, now));
      throw new ApiError(401, 'unauthenticated', 'Credentials changed; sign in again');
    }
    const { token, session } = await newSession(store, updated, context, now);
    c.header('Set-Cookie', cookie(token, c.get('config')));
    return c.json({ user: publicUser(updated), csrfToken: session.csrfToken, passwordWeak: updated.passwordWeak, permissions: permissionsFor(updated) });
  });
  app.use('/api/admin/auth/*', authenticate);
  app.get('/api/admin/auth/me', c => c.json({ user: publicUser(c.get('user')), csrfToken: c.get('session').csrfToken, passwordWeak: c.get('user').passwordWeak ?? true, permissions: permissionsFor(c.get('user')) }));
  app.post('/api/admin/auth/logout', async c => {
    await c.get('store').sealWorkingRevisions(c.get('user').id, c.get('now').toISOString(), audit(actor(c), 'auth.logout', {}, c.get('now')));
    await c.get('store').deleteSession(c.get('session').hash);
    c.header('Set-Cookie', cookie('', c.get('config'), 0)); return c.json({ ok: true });
  });
  app.post('/api/admin/auth/password', async c => {
    const input = object(await c.req.json()), user = c.get('user'), store = c.get('store');
    const current = string(input.current, 'current', 1024), next = string(input.next, 'next', 1024);
    if (!await verifyPassword(current, user.passwordHash)) throw new ApiError(401, 'unauthenticated', 'Current password is incorrect');
    checkPassword(next, user.username);
    const updated = await store.changePassword(user.id, user.passwordHash, await hashPassword(next), audit(actor(c), 'auth.password', {}, c.get('now')));
    if (!updated) throw new ApiError(409, 'conflict', 'Credentials changed; sign in again');
    await revokeSessions(store, user.id);
    const { token, session } = await newSession(store, updated, actor(c), c.get('now'));
    c.header('Set-Cookie', cookie(token, c.get('config')));
    return c.json({ user: publicUser(updated), csrfToken: session.csrfToken, passwordWeak: false });
  });
  app.get('/api/admin/auth/sessions', async c => c.json({ sessions: (await c.get('store').listSessions(c.get('user').id)).map(({ csrfToken: _csrf, ...s }) => ({ ...s, current: s.hash === c.get('session').hash })) }));
  app.delete('/api/admin/auth/sessions/:hash', async c => {
    const s = await c.get('store').getSession(c.req.param('hash'));
    if (!s || s.userId !== c.get('user').id) throw new ApiError(404, 'not_found', 'Session not found');
    await c.get('store').deleteSession(s.hash); await c.get('store').recordAudit(audit(actor(c), 'auth.session_revoke', {}, c.get('now')));
    return c.json({ ok: true });
  });
  app.post('/api/admin/auth/sessions/revoke-others', async c => {
    await revokeSessions(c.get('store'), c.get('user').id, c.get('session').hash);
    await c.get('store').recordAudit(audit(actor(c), 'auth.sessions_revoke', {}, c.get('now'))); return c.json({ ok: true });
  });
}
