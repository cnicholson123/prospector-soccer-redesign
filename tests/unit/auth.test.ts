import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { hashPassword, verifyPassword, passwordWeak, checkPassword } from '../../server/auth/password.js';
import { checkCsrf, checkOrigin } from '../../server/auth/csrf.js';
import { newSession, readSession, DAY, cookie } from '../../server/auth/session.js';
import { failedLogin } from '../../server/auth/ratelimit.js';
import common from '../../server/auth/common-passwords.json' with { type: 'json' };
import { bootstrap } from '../../server/auth/bootstrap.js';
import { can } from '../../server/permissions.js';
import { roles, permissionTable, type Permission } from '../../shared/permissions-table.js';
import type { User } from '../../shared/types.js';
import { adminFixture } from '../helpers/admin.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const fixture = async () => { const f = await adminFixture(); roots.push(f.root); return f; };
const user = (role: User['role']): User => ({ id: 'user', username: 'user', displayName: 'User', role, active: true, passwordHash: '', createdAt: '', createdBy: 'test' });
describe('passwords and permission matrix', () => {
  it('uses salted scrypt, dummy verification and strict new-password policy', async () => {
    const a = await hashPassword('password test'), b = await hashPassword('password test');
    expect(a).toMatch(/^scrypt\$15\$8\$1\$/); expect(a).not.toBe(b);
    expect(await verifyPassword('password test', a)).toBe(true);
    expect(await verifyPassword('wrong', a)).toBe(false);
    expect(await verifyPassword('anything')).toBe(false);
    expect(await verifyPassword('anything', 'scrypt$30$8$1$x$x')).toBe(false);
    expect(passwordWeak('PHIL', 'Phil')).toBe(true);
    expect(common).toHaveLength(1000); expect(common.every(p => passwordWeak(p, 'unrelated'))).toBe(true);
    expect(() => checkPassword('password', 'Phil')).toThrow();
    expect(() => checkPassword('My long fieldside phrase', 'Phil')).not.toThrow();
  });
  for (const [action, level] of Object.entries(permissionTable)) for (const [index, role] of roles.entries()) it(`${role}: ${action}`, () => {
    expect(can(user(role), action as Permission, { uploadedBy: 'user' })).toBe(index >= level);
  });
  it('applies collection, ownership and role-target ceilings', () => {
    expect(can(user('Contributor'), 'content.edit', { collection: 'site' })).toBe(false);
    expect(can(user('Contributor'), 'media.edit', { uploadedBy: 'another' })).toBe(false);
    expect(can(user('Admin'), 'users.manage', { role: 'Owner' })).toBe(false);
    expect(can({ ...user('Owner'), active: false }, 'content.read')).toBe(false);
  });
});
describe('bootstrap, sessions and CSRF', () => {
  it('bootstraps exactly once across competing calls and ignores later credentials', async () => {
    const f = await fixture();
    const results = await Promise.all([bootstrap(f.store, f.config), bootstrap(f.store, f.config)]);
    expect(results.sort()).toEqual([false, true]);
    expect(await bootstrap(f.store, { ...f.config, adminBootstrapUser: 'other' })).toBe(false);
    const users = await f.store.listUsers(); expect(users).toHaveLength(1); expect(users[0].role).toBe('Owner');
    expect((await f.store.queryAudit({ action: 'system.bootstrap', limit: 100 })).items).toHaveLength(1);
  });
  it('hashes session IDs, refreshes at most hourly and enforces absolute expiry', async () => {
    const f = await fixture(); await bootstrap(f.store, f.config); const u = (await f.store.listUsers())[0];
    const now = new Date('2030-01-01T00:00:00Z'), { token, session } = await newSession(f.store, u, {}, now);
    expect(session.hash).not.toBe(token); expect(session.hash).toHaveLength(64);
    expect(cookie(token, { ...f.config, cookieSecure: true })).toContain('HttpOnly; SameSite=Lax');
    expect(cookie(token, { ...f.config, cookieSecure: true })).toContain('Secure');
    const request = new Request('http://localhost/?preview=1', { headers: { cookie: 'psc_session=' + token } });
    expect((await readSession(f.store, request, new Date(now.getTime() + 1000)))?.refreshed).toBe(false);
    const refreshed = await Promise.all(Array.from({ length: 5 }, () => readSession(f.store, request, new Date(now.getTime() + 3600000))));
    expect(refreshed.filter(result => result?.refreshed)).toHaveLength(1);
    for (let day = 1; day < 30; day++) expect(await readSession(f.store, request, new Date(now.getTime() + day * DAY))).not.toBeNull();
    expect(await readSession(f.store, request, new Date(now.getTime() + 30 * DAY))).toBeNull();
  });
  it('rejects cross-site or mismatched tokens and permits the dev Vite origin', async () => {
    const { config } = await fixture();
    expect(() => checkOrigin(new Request(config.publicBaseUrl, { headers: { Origin: 'http://localhost:5173' } }), config)).not.toThrow();
    for (const headers of [{ Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'X-CSRF-Token': 'wrong' }] as Record<string, string>[]) expect(() => checkCsrf(new Request(config.publicBaseUrl, { headers }), 'expected', config)).toThrow();
    expect(() => checkCsrf(new Request(config.publicBaseUrl, { headers: { Origin: config.publicBaseUrl, 'X-CSRF-Token': 'expected' } }), 'expected', config)).not.toThrow();
  });
  it('doubles lockouts through the 24-hour ceiling with concurrent failure safety', async () => {
    const f = await fixture(); let now = new Date('2030-01-01');
    for (let i = 0; i < 9; i++) {
      const states = await Promise.all(Array.from({ length: 5 }, () => failedLogin(f.store, 'test', now)));
      const until = states.find(s => s.until && Date.parse(s.until) > now.getTime())!.until!;
      expect(Date.parse(until) - now.getTime()).toBe(Math.min(86400, 900 * 2 ** i) * 1000);
      now = new Date(Date.parse(until) + 1);
    }
  });
});
describe('auth HTTP and user administration', () => {
  it('logs every success, failure and lockout with IP/UA and streams filtered exports', async () => {
    const f = await fixture();
    const { response, data } = await f.login();
    expect(response.status).toBe(200); expect(data.passwordWeak).toBe(true); expect(data.user.passwordHash).toBeUndefined();
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    for (let i = 0; i < 5; i++) expect((await f.req('/auth/login', 'POST', { username: 'Phil', password: 'bad' })).status).toBe(i === 4 ? 423 : 401);
    expect((await f.req('/auth/login', 'POST', { username: 'Phil', password: 'Phil' })).status).toBe(423);
    const failed = (await f.store.queryAudit({ action: 'auth.login_failed', limit: 100 })).items;
    expect(failed).toHaveLength(1); expect(failed.every(r => r.ip === '192.0.2.40' && r.userAgent === 'Admin test')).toBe(true);
    expect((await f.store.queryAudit({ action: 'auth.locked', limit: 100 })).items).toHaveLength(1);
    const csv = await f.req('/audit/export?format=csv&action=auth.login');
    expect(csv.status).toBe(200); expect(csv.headers.get('content-type')).toContain('text/csv'); expect(await csv.text()).toContain('auth.login');
    const json = await f.req('/audit/export?format=json&action=auth.login_failed'); expect(await json.json()).toHaveLength(1);
  });
  it('enforces route permissions, user ceilings, last Owner, and password/session rotation', async () => {
    const f = await fixture(); const owner = await f.login();
    const ownerId = owner.data.user.id;
    expect((await f.req('/users/' + ownerId, 'DELETE')).status).toBe(409);
    expect((await f.req('/users/' + ownerId, 'PATCH', { role: 'Admin' })).status).toBe(403);
    for (const role of ['Admin', 'Viewer', 'Contributor']) {
      expect((await f.req('/users', 'POST', { username: role, role, password: 'Fieldside secure phrase' })).status).toBe(201);
    }
    await f.login('Admin', 'Fieldside secure phrase');
    expect((await f.req('/users', 'POST', { username: 'badowner', role: 'Owner', password: 'Fieldside secure phrase' })).status).toBe(403);
    expect((await f.req('/users/' + ownerId, 'POST')).status).toBe(404);
    expect((await f.req('/users/' + ownerId + '/reset-password', 'POST')).status).toBe(403);
    await f.login('Viewer', 'Fieldside secure phrase');
    expect((await f.req('/docs/events', 'POST', { draft: {} })).status).toBe(403);
    expect((await f.req('/publish', 'POST', { items: [] })).status).toBe(403);
    expect((await f.req('/audit')).status).toBe(403);
    await f.login('Contributor', 'Fieldside secure phrase');
    expect((await f.req('/docs/site/site', 'PUT', { baseVersion: 1, draft: {} })).status).toBe(403);
    expect((await f.req('/docs/callouts/reorder', 'POST', { items: [] })).status).toBe(403);
    const before = f.getCookie();
    const changed = await f.req('/auth/password', 'POST', { current: 'Fieldside secure phrase', next: 'A different secure phrase' });
    expect(changed.status).toBe(200); expect(changed.headers.get('set-cookie')).not.toContain(before);
    expect((await f.req('/auth/me')).status).toBe(401);
    expect((await f.login('Contributor', 'A different secure phrase')).response.status).toBe(200);
    expect((await f.req('/auth/me', 'GET', undefined, { Cookie: '' })).status).toBe(401);
    expect((await f.req('/auth/logout', 'POST', {}, { 'X-CSRF-Token': 'invalid' })).status).toBe(403);
    expect((await f.req('/auth/logout', 'POST')).status).toBe(200);
    expect((await f.req('/auth/me')).status).toBe(401);
  });
  it('invalidates sessions after role changes and rejects stale credential updates', async () => {
    const f = await fixture(); await f.login();
    const created = await (await f.req('/users', 'POST', { username: 'editor', role: 'Editor', password: 'Fieldside secure phrase' })).json();
    const { token } = await newSession(f.store, await f.store.getUser(created.user.id) as User, {}, new Date('2030-01-01T12:00:00Z'));
    await f.req('/users/' + created.user.id, 'PATCH', { role: 'Viewer' });
    expect((await f.req('/auth/me', 'GET', undefined, { Cookie: 'psc_session=' + token })).status).toBe(401);
    expect(await f.store.recordLogin(created.user.id, 'stale hash', false, { id: 'not-written', at: '', actorId: '', actorName: '', action: '' })).toBeNull();
  });
});

it('rate-limits login attempts by IP with Retry-After and audits malformed attempts', async () => {
  const f = await fixture();
  for (let i = 0; i < 10; i++) expect((await f.req('/auth/login', 'POST', { username: `missing${i}`, password: 'incorrect' })).status).toBe(401);
  const limited = await f.req('/auth/login', 'POST', { username: 'next', password: 'incorrect' });
  expect(limited.status).toBe(429); expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  expect((await f.req('/auth/login', 'POST', {}, { 'X-Forwarded-For': '192.0.2.41' })).status).toBe(422);
  expect((await f.store.queryAudit({ action: 'auth.login_failed', limit: 100 })).items).toHaveLength(2);
});
