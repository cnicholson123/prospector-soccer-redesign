import { randomBytes } from 'node:crypto';
import type { Hono } from 'hono';
import type { User, Role } from '../../../shared/types.js';
import { roles } from '../../../shared/permissions-table.js';
import { profileEmail as email, userChanges } from '../../auth/profile.js';
import { audit, publicUser } from '../../audit.js';
import { hashPassword } from '../../auth/password.js';
import { username } from '../../store/identifiers.js';
import { requirePermission } from '../middleware/permission.js';
import { actor, type AdminEnv } from '../middleware/auth.js';
import { ApiError, object, string } from '../middleware/errors.js';
function role(value: unknown): Role {
  if (!roles.includes(value as Role)) throw new ApiError(422, 'validation', 'Invalid role');
  return value as Role;
}
export function userRoutes(app: Hono<AdminEnv>) {
  app.use('/api/admin/users*', requirePermission('users.manage'));
  app.get('/api/admin/users', async c => c.json({ users: (await c.get('store').listUsers()).map(publicUser) }));
  app.post('/api/admin/users', async c => {
    const input = object(await c.req.json());
    if ('password' in input) throw new ApiError(422, 'validation', 'Passwords are generated automatically');
    const name = username(input.username), password = randomBytes(18).toString('base64url');
    const user: User = { id: `usr_${randomBytes(12).toString('base64url')}`, username: name, displayName: string(input.displayName ?? name, 'displayName', 100), email: email(input.email), role: role(input.role), passwordHash: await hashPassword(password), active: true, passwordWeak: false, mustChangePassword: true, createdAt: c.get('now').toISOString(), createdBy: c.get('user').id };
    await c.get('store').changeUser(user, c.get('user').id, audit(actor(c), 'users.create', { meta: { userId: user.id, role: user.role } }, c.get('now')), null);
    return c.json({ user: publicUser(user), temporaryPassword: password }, 201);
  });
  app.patch('/api/admin/users/:id', async c => {
    const user = await c.get('store').getUser(c.req.param('id'));
    if (!user) throw new ApiError(404, 'not_found', 'User not found');
    const input = object(await c.req.json());
    if (input.active !== undefined && typeof input.active !== 'boolean') throw new ApiError(422, 'validation', 'Invalid active flag');
    const next = { ...user, ...(input.email === undefined ? {} : { email: email(input.email) }), ...(input.role === undefined ? {} : { role: role(input.role) }), ...(input.displayName === undefined ? {} : { displayName: string(input.displayName, 'displayName', 100) }), ...(input.username === undefined ? {} : { username: username(input.username) }), ...(input.active === undefined ? {} : { active: input.active as boolean }) };
    if (next.username !== user.username) next.passwordWeak = true;
    const revoke = next.role !== user.role || next.active !== user.active;
    if (revoke) next.authVersion = (user.authVersion ?? 0) + 1;
    await c.get('store').changeUser(next, c.get('user').id, audit(actor(c), 'users.update', { meta: { userId: user.id, changes: userChanges(user, next) } }, c.get('now')), user);
    return c.json({ user: publicUser(next) });
  });
  app.post('/api/admin/users/:id/reset-password', async c => {
    const user = await c.get('store').getUser(c.req.param('id'));
    if (!user) throw new ApiError(404, 'not_found', 'User not found');
    const password = randomBytes(18).toString('base64url');
    const next = { ...user, passwordHash: await hashPassword(password), passwordChangedAt: c.get('now').toISOString(), passwordWeak: false, mustChangePassword: true, authVersion: (user.authVersion ?? 0) + 1 };
    await c.get('store').changeUser(next, c.get('user').id, audit(actor(c), 'users.reset_password', { meta: { userId: user.id } }, c.get('now')), user);
    return c.json({ temporaryPassword: password });
  });
  app.post('/api/admin/users/:id/revoke-sessions', async c => {
    const user = await c.get('store').getUser(c.req.param('id'));
    if (!user) throw new ApiError(404, 'not_found', 'User not found');
    await c.get('store').changeUser({ ...user, authVersion: (user.authVersion ?? 0) + 1 }, c.get('user').id, audit(actor(c), 'users.revoke_sessions', { meta: { userId: user.id } }, c.get('now')), user);
    return c.json({ ok: true });
  });
  app.delete('/api/admin/users/:id', async c => {
    const user = await c.get('store').getUser(c.req.param('id'));
    if (!user) throw new ApiError(404, 'not_found', 'User not found');
    await c.get('store').changeUser({ ...user, active: false, authVersion: (user.authVersion ?? 0) + 1 }, c.get('user').id, audit(actor(c), 'users.deactivate', { meta: { userId: user.id } }, c.get('now')), user);
    return c.json({ ok: true });
  });
}
