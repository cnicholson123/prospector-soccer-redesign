import type { Hono } from 'hono';
import { profileEmail, userChanges } from '../../auth/profile.js';
import { audit, publicUser } from '../../audit.js';
import { checkOrigin } from '../../auth/csrf.js';
import { verifyPassword, passwordWeak, checkPassword, hashPassword } from '../../auth/password.js';
import { failedLogin, lockKey, loginGenerationKey, usernameRateKey, rateLimit, type LockState } from '../../auth/ratelimit.js';
import { newSession, cookie, DAY } from '../../auth/session.js';
import { actor, type AdminEnv } from '../middleware/auth.js';
import { ApiError, object, string } from '../middleware/errors.js';
import { username as validUsername } from '../../store/identifiers.js';
import { permissionsFor } from '../../permissions.js';
export function authRoutes(app: Hono<AdminEnv>) {
  app.post('/api/admin/auth/login', async c => {
    const store = c.get('store'), now = c.get('now');
    const context = { id: 'anonymous', displayName: 'Unknown user', ip: c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown', userAgent: c.req.header('user-agent') ?? '' };
    const failure = async (reason: string) => {
      const repeat = await store.rateLimitHit(`login-audit-${context.ip}`, 900);
      if (repeat.count === 1) await store.recordAudit(audit(context, 'auth.login_failed', { meta: { reason } }, now));
    };
    try { await rateLimit(store, `login-ip-${context.ip}`, 10, 900, now); }
    catch (error) { await failure('rate_limited'); throw error; }
    let username: string, password: string;
    try {
      checkOrigin(c.req.raw, c.get('config'));
      const input = object(await c.req.json());
      username = validUsername(input.username);
      context.displayName = username;
      password = string(input.password, 'password', 1024);
    } catch (error) {
      await failure('invalid_request');
      throw error;
    }
    if (await store.claimMaintenance('session-gc-at', 3600000, now.toISOString())) await store.deleteExpiredSessions(now.toISOString());
    const generation = Number(await store.getMeta(loginGenerationKey(username)) ?? 0);
    const key = lockKey(username, context.ip, generation);
    const lock = await store.getMeta(key) as LockState | null;
    if (lock?.until && Date.parse(lock.until) > now.getTime()) {
      await failure('locked');
      throw new ApiError(423, 'locked', 'Account temporarily locked', { until: lock.until }, Math.ceil((Date.parse(lock.until) - now.getTime()) / 1000));
    }
    const user = await store.getUserByUsername(username);
    if (!await verifyPassword(password, user?.passwordHash) || !user?.active) {
      await failure('invalid_credentials');
      await rateLimit(store, usernameRateKey(username), 100, 900, now);
      const state = await failedLogin(store, username, now, context.ip, generation);
      if (state.until && Date.parse(state.until) > now.getTime()) {
        await store.recordAudit(audit(context, 'auth.locked', {}, now));
        throw new ApiError(423, 'locked', 'Account temporarily locked', { until: state.until }, Math.ceil((Date.parse(state.until) - now.getTime()) / 1000));
      }
      throw new ApiError(401, 'unauthenticated', 'Invalid username or password');
    }
    await store.setMeta(key, { failures: 0, locks: 0 });
    const updated = await store.recordLogin(user.id, user.passwordHash, passwordWeak(password, user.username), audit({ ...context, ...user }, 'auth.login', {}, now));
    if (!updated) {
      await failure('credentials_changed');
      throw new ApiError(401, 'unauthenticated', 'Credentials changed; sign in again');
    }
    const { token, session } = await newSession(store, updated, context, now);
    c.header('Set-Cookie', cookie(token, c.get('config')));
    return c.json({ user: publicUser(updated), csrfToken: session.csrfToken, passwordWeak: updated.passwordWeak, permissions: permissionsFor(updated) });
  });
  app.get('/api/admin/auth/me', c => c.json({ user: publicUser(c.get('user')), csrfToken: c.get('session').csrfToken, passwordWeak: c.get('user').passwordWeak ?? true, permissions: permissionsFor(c.get('user')) }));
  app.post('/api/admin/auth/logout', async c => {
    await c.get('store').revokeSessions(c.get('user').id, audit(actor(c), 'auth.logout', {}, c.get('now')), { hash: c.get('session').hash, seal: true });
    c.header('Set-Cookie', cookie('', c.get('config'), 0)); return c.json({ ok: true });
  });
  app.patch('/api/admin/auth/profile', async c => {
    const input = object(await c.req.json()), user = c.get('user');
    if (Object.keys(input).some(key => !['displayName', 'email'].includes(key))) throw new ApiError(422, 'validation', 'Only display name and email can be edited');
    const next = { ...user, ...(input.displayName === undefined ? {} : { displayName: string(input.displayName, 'displayName', 100) }),
      ...(input.email === undefined ? {} : { email: profileEmail(input.email) }) };
    await c.get('store').changeUser(next, user.id, audit(actor(c), 'users.update', { meta: { userId: user.id, changes: userChanges(user, next) } }, c.get('now')), user);
    return c.json({ user: publicUser(next) });
  });
  app.post('/api/admin/auth/password', async c => {
    const input = object(await c.req.json()), user = c.get('user'), store = c.get('store');
    const current = string(input.current, 'current', 1024), next = string(input.next, 'next', 1024);
    await rateLimit(store, `password-${user.id}`, 10, 900, c.get('now'));
    if (!await verifyPassword(current, user.passwordHash)) throw new ApiError(401, 'unauthenticated', 'Current password is incorrect');
    checkPassword(next, user.username);
    const updated = await store.changePassword(user.id, user.passwordHash, await hashPassword(next), audit(actor(c), 'auth.password', {}, c.get('now')));
    if (!updated) throw new ApiError(409, 'conflict', 'Credentials changed; sign in again');
    const { token, session } = await newSession(store, updated, actor(c), c.get('now'));
    c.header('Set-Cookie', cookie(token, c.get('config')));
    return c.json({ user: publicUser(updated), csrfToken: session.csrfToken, passwordWeak: false });
  });
  app.get('/api/admin/auth/sessions', async c => c.json({ sessions: (await c.get('store').listSessions(c.get('user').id)).filter(s => (s.authVersion ?? 0) === (c.get('user').authVersion ?? 0) && Date.parse(s.expiresAt) > c.get('now').getTime() && Date.parse(s.createdAt) + 30 * DAY > c.get('now').getTime()).map(({ csrfToken: _csrf, ...s }) => ({ ...s, current: s.hash === c.get('session').hash })) }));
  app.delete('/api/admin/auth/sessions/:hash', async c => {
    const s = await c.get('store').getSession(c.req.param('hash'));
    if (!s || s.userId !== c.get('user').id) throw new ApiError(404, 'not_found', 'Session not found');
    if (!await c.get('store').revokeSessions(c.get('user').id, audit(actor(c), 'auth.session_revoke', {}, c.get('now')), { hash: s.hash })) throw new ApiError(404, 'not_found', 'Session not found');
    if (s.hash === c.get('session').hash) c.header('Set-Cookie', cookie('', c.get('config'), 0));
    return c.json({ ok: true });
  });
  app.post('/api/admin/auth/sessions/revoke-others', async c => {
    await c.get('store').revokeSessions(c.get('user').id, audit(actor(c), 'auth.sessions_revoke', {}, c.get('now')), { except: c.get('session').hash }); return c.json({ ok: true });
  });
}
