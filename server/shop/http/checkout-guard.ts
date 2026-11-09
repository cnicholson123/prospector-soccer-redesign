import type { MiddlewareHandler } from 'hono';
import type { Config } from '../../config.js';

/** Fail closed before body parsing, authentication, storage or provider work.
 * Reserve complete route families so adding a future order/payment action
 * cannot accidentally enable it in a showcase deployment.
 */
export function checkoutGuard(config: () => Config): MiddlewareHandler {
  return async (c, next) => {
    let path = c.req.path;
    try { path = decodeURIComponent(path); } catch { /* Gate a known raw prefix even when a later identifier is malformed. */ }
    if (/^\/api\/(?:admin\/)?shop\/(?:checkout|orders?|payments?|webhooks?)(?:\/|$)/.test(path) && config().shopCheckout !== 'enabled') {
      c.header('Cache-Control', 'no-store');
      c.header('X-Content-Type-Options', 'nosniff');
      return c.json({ error: 'checkout_disabled' }, 403);
    }
    await next();
  };
}
