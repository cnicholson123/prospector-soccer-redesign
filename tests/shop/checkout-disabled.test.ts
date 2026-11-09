import type { Context } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../server/config.js';
import { createShopApp } from '../../server/shop/http/app.js';
import { createAdminApp } from '../../server/http/hono-app.js';
import { bootstrapEnvironment } from '../helpers/password.js';

// All planned operational route families, including routes not implemented yet.
const publicPaths = ['/checkout', '/checkout/session', '/checkout/%ZZ', '/%63heckout', '/orders', '/orders/lookup', '/order/PSC-1001', '/payments/status', '/payments/settle', '/payment/refund', '/webhooks/stripe'];
const adminPaths = ['/checkout', '/orders', '/orders/ord_test', '/orders/ord_test/transition', '/orders/ord_test/payment', '/orders/ord_test/refund', '/orders/ord_test/notes', '/orders/ord_test/notify', '/orders/ord_test/redact', '/orders/bulk-transition', '/orders/export.csv', '/payments/status', '/payments/refund', '/webhooks/stripe'];
for (const setting of [undefined, 'disabled']) describe(`checkout guard with SHOP_CHECKOUT=${setting ?? 'unset'}`, () => {
  const config = loadConfig({ SHOP_CHECKOUT: setting, SESSION_SECRET: 'x'.repeat(32) }, () => {});
  for (const [kind, paths] of [['public', publicPaths], ['admin', adminPaths]] as const) {
    it.each(paths)(`${kind} %s returns 403 before any work for all methods`, async path => {
      const factory = vi.fn(() => { throw new Error('Storage must not be opened'); });
      const prefix = kind === 'public' ? '/api/shop' : '/api/admin/shop';
      const reached = vi.fn((c: Context) => c.json({ unsafe: true }));
      const app = kind === 'public' ? createShopApp(factory, { config }).all(prefix + path, reached) : createAdminApp(factory, { config }).all(prefix + path, reached);
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        // No session/origin, invalid JSON, and an oversized body must still get
        // the deployment refusal, never validation/auth/body-limit processing.
        const response = await app.request(prefix + path + '?preview=1', { method, ...(method === 'GET' ? {} : { body: '{' + 'x'.repeat(1024 * 1024 + 1) }) });
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'checkout_disabled' });
        expect(response.headers.get('cache-control')).toBe('no-store');
      }
      expect(factory).not.toHaveBeenCalled(); expect(reached).not.toHaveBeenCalled();
    });
  }
});
it('rejects production opt-in at configuration load, even before other required production settings', () => {
  expect(() => loadConfig({ NODE_ENV: 'production', SHOP_CHECKOUT: 'enabled' })).toThrow(/SHOP_CHECKOUT=enabled.*production/);
});
it('defaults to disabled in production with valid filesystem configuration', async () => {
  const config = loadConfig({ NODE_ENV: 'production', STORE_DRIVER: 'fs', SESSION_SECRET: 'x'.repeat(32), PUBLIC_BASE_URL: 'https://example.com', ...await bootstrapEnvironment() });
  expect(config.shopCheckout).toBe('disabled');
});
it.each(['development', 'test'])('permits explicit opt-in only for %s', NODE_ENV => {
  expect(loadConfig({ NODE_ENV, SHOP_CHECKOUT: 'enabled' }, () => {}).shopCheckout).toBe('enabled');
});
it.each([undefined, 'staging'])('refuses opt-in with NODE_ENV=%s', NODE_ENV => {
  expect(() => loadConfig({ NODE_ENV, SHOP_CHECKOUT: 'enabled' })).toThrow('SHOP_CHECKOUT');
});
it.each(['', 'true', 'Enabled', 'other'])('rejects unknown SHOP_CHECKOUT=%s', SHOP_CHECKOUT => {
  expect(() => loadConfig({ SHOP_CHECKOUT })).toThrow('SHOP_CHECKOUT');
});

it.each([undefined, 'development', 'test', 'staging'])('defaults to disabled with NODE_ENV=%s', NODE_ENV => {
  expect(loadConfig({NODE_ENV}, () => {}).shopCheckout).toBe('disabled');
});
