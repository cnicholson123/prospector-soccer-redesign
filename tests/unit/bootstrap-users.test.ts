import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { adminFixture } from '../helpers/admin';
import { generatedPassword } from '../helpers/password';
import { loadConfig } from '../../server/config';
import { bootstrap } from '../../server/auth/bootstrap';
import { hashPassword, isPasswordHash, verifyPassword } from '../../server/auth/password';

async function setupUsers() {
  const passwords = [generatedPassword(), generatedPassword()];
  const users = await Promise.all(['Phil', 'Chris'].map(async (username, i) => ({ username, displayName: username, role: 'Owner' as const, passwordHash: await hashPassword(passwords[i]) })));
  return { users, passwords };
}
describe('Section 19 hashed bootstrap', () => {
  it('adds missing users across concurrent runs, keeps existing credentials/roles and audits each creation once', async () => {
    const { users, passwords } = await setupUsers();
    const f = await adminFixture(false, { adminBootstrapUsers: users });
    const created = await Promise.all([bootstrap(f.store, f.config), bootstrap(f.store, f.config)]);
    expect(created.filter(Boolean)).toHaveLength(1);
    const phil = await f.store.getUserByUsername('Phil');
    expect(await verifyPassword(passwords[0], phil!.passwordHash)).toBe(true);
    const replacement = { ...users[0], role: 'Viewer' as const, passwordHash: await hashPassword(generatedPassword()) };
    expect(await bootstrap(f.store, { ...f.config, adminBootstrapUsers: [replacement, users[1]] })).toBe(false);
    expect(await f.store.getUserByUsername('Phil')).toEqual(phil);
    const extra = { ...users[1], username: 'AnotherOwner' };
    expect(await bootstrap(f.store, { ...f.config, adminBootstrapUsers: [...users, extra] })).toBe(true);
    expect((await f.store.queryAudit({ action: 'system.bootstrap', limit: 100 })).items).toHaveLength(3);
    const audit = JSON.stringify(await f.store.queryAudit({ limit: 100 }));
    for (const secret of [...passwords, ...users.map(u => u.passwordHash)]) expect(audit).not.toContain(secret);
    const login = await f.login('Chris', passwords[1]);
    expect(login.response.status).toBe(200); expect(login.data.user.mustChangePassword).toBe(false);
  });
  it('validates secret configuration without including its contents in errors', async () => {
    const { users } = await setupUsers();
    const env = { NODE_ENV: 'production', STORE_DRIVER: 'fs', SESSION_SECRET: randomBytes(32).toString('hex'), PUBLIC_BASE_URL: 'https://example.test' };
    const config = loadConfig({ ...env, ADMIN_BOOTSTRAP_USERS: JSON.stringify(users) });
    expect(config.adminBootstrapUsers).toEqual(users); expect(config.adminForcePasswordChange).toBe(false);
    const secret = generatedPassword();
    for (const value of ['[]', '{}', secret, JSON.stringify([{ ...users[0], passwordHash: secret }]), JSON.stringify([users[0], { ...users[1], username: 'PHIL' }]), JSON.stringify([{ ...users[0], role: 'Viewer' }]), JSON.stringify([{ ...users[0], username: '../escape' }])]) {
      let error: unknown; try { loadConfig({ ...env, ADMIN_BOOTSTRAP_USERS: value }); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain(secret);
    }
    expect(() => loadConfig(env)).toThrow('ADMIN_BOOTSTRAP_USERS');
    expect(isPasswordHash(users[0].passwordHash + '$extra')).toBe(false);
    expect(isPasswordHash(users[0].passwordHash.replace('$15$', '$99$'))).toBe(false);
    expect(isPasswordHash(null)).toBe(false);
    expect(loadConfig({ ADMIN_BOOTSTRAP_USERNAME: 'LocalOwner', ADMIN_BOOTSTRAP_PASSWORD: secret }, vi.fn()).adminBootstrapUser).toBe('LocalOwner');
  });
  it('hashes piped stdin without echoing it or accepting argv as a password', async () => {
    const password = generatedPassword();
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/hash-password.ts'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); }); child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.stdin.end(password + '\n');
    const code = await new Promise(resolve => child.on('close', resolve));
    expect(code).toBe(0); expect(isPasswordHash(stdout.trim())).toBe(true); expect(await verifyPassword(password, stdout.trim())).toBe(true);
    expect(stdout + stderr).not.toContain(password); expect(stderr).toBe('');
  });
});
