import { describe, expect, it, vi } from 'vitest';
import { adminApp } from '../../server/http/hono-app';
import { loadConfig } from '../../server/config';
import { tagContent, purgeContent } from '../../server/render/cdn';
import { renderPublic } from '../../server/render/handler';

describe('Phase 0 scaffold', () => {
  it('health endpoint responds with ok', async () => {
    const response = await adminApp.request('/api/admin/healthz');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect((await adminApp.request('/api/admin/missing')).status).toBe(401);
  });
  it('loads local defaults and warns for ephemeral secrets', () => {
    const warn = vi.fn(); const config = loadConfig({}, warn);
    expect(config.storeDriver).toBe('fs'); expect(config.cookieSecure).toBe(false);
    expect(config.sessionSecret.length).toBeGreaterThanOrEqual(32);
    expect(warn).toHaveBeenCalledOnce();
    expect(config.tzName).toBe('America/Los_Angeles');
  });
  it.each([
    { STORE_DRIVER: 'unknown' }, { STORE_DRIVER: 'postgres' }, { STORE_DRIVER: 'blob' },
    { CACHE_SMAXAGE: '-1' }, { CACHE_SWR: '' }, { COOKIE_SECURE: 'yes' },
    { PUBLIC_BASE_URL: 'javascript:alert(1)' }, { PUBLIC_BASE_URL: 'https://example.com/a' },
    { TZ_NAME: 'not-a-zone' }, { SESSION_SECRET: 'short' }, { MAX_FILE_BYTES: '0' },
    { NODE_ENV: 'production' },
  ])('rejects invalid environment %j', env => {
    expect(() => loadConfig(env, () => undefined)).toThrow('Configuration:');
  });
  it('accepts explicitly configured production and protects cookies', () => {
    const env = { NODE_ENV: 'production', STORE_DRIVER: 'fs', SESSION_SECRET: 'a'.repeat(32), PUBLIC_BASE_URL: 'https://example.com', ADMIN_BOOTSTRAP_USER: 'Phil', ADMIN_BOOTSTRAP_PASSWORD: 'configured-secret' };
    expect(loadConfig(env).cacheSmaxage).toBe(15);
    expect(() => loadConfig({ ...env, COOKIE_SECURE: 'false' })).toThrow('COOKIE_SECURE');
  });
  it('does not invoke remote cache operations locally', async () => {
    vi.stubEnv('VERCEL', ''); expect(() => tagContent()).not.toThrow();
    expect(await purgeContent()).toBe(false); vi.unstubAllEnvs();
  });
  it('keeps preview unavailable without a session', async () => {
    const response = await renderPublic(new Request('http://localhost/?preview=1'));
    expect(response.status).toBe(401); expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
