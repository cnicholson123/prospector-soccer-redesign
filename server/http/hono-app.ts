import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createStore } from '../store';
import type { Store } from '../store/types';

export function createAdminApp(storeFactory: () => Store = createStore) {
  const adminApp = new Hono();
  let needsRecovery = true;
  let store: Store | undefined;
  const recover: MiddlewareHandler = async (c, next) => {
    if (needsRecovery) {
      store ??= storeFactory();
      await store.recoverPublish();
      needsRecovery = false;
    }
    await next();
    if (c.res.status >= 500) needsRecovery = true;
  };
  adminApp.use('/api/admin/*', async (c, next) => {
    // Force the limiter to count actual bytes, including a misdeclared length.
    if (c.req.raw.body && c.req.raw.headers.has('content-length')) {
      const headers = new Headers(c.req.raw.headers);
      headers.delete('content-length');
      c.req.raw = new Request(c.req.raw, { headers });
    }
    await next();
  });
  adminApp.use('/api/admin/*', bodyLimit({ maxSize: 1024 * 1024, onError: c => c.json({ error: { code: 'payload_too_large', message: 'JSON body exceeds 1 MB' } }, 413) }));
  // Only replays an already-authorized, durable transaction. The content routes
  // added in Phase 5 still require their normal auth and permission middleware.
  adminApp.use('/api/admin/publish', recover);
  adminApp.use('/api/admin/dashboard', recover);
  adminApp.onError((error, c) => {
    needsRecovery = true;
    if ('code' in error && error.code === 'validation' && 'details' in error) return c.json({ error: { code: 'validation', message: error.message, details: error.details } }, 422);
    if ('code' in error && error.code === 'in_use' && 'details' in error) return c.json({ error: { code: 'in_use', message: error.message, details: error.details } }, 409);
    console.error(error);
    return c.json({ error: { code: 'internal', message: 'Internal server error' } }, 500);
  });
  adminApp.get('/api/admin/healthz', (c) => c.json({ ok: true }));
  adminApp.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));
  return adminApp;
}
export const adminApp = createAdminApp();
