import { mediaCallbacks, mediaRoutes } from './routes/media';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMediaBlobs, createStore } from '../store';
import type { MediaStorage, Store } from '../store/types';
import { loadConfig, type Config } from '../config';
import { bootstrap } from '../auth/bootstrap';
import { authenticate, type AdminEnv } from './middleware/auth';
import { ApiError } from './middleware/errors';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { auditRoutes } from './routes/audit';
import { docRoutes } from './routes/docs';
import { contentRoutes, cronRoutes } from './routes/content';
import { audit } from '../audit';

export function createAdminApp(storeFactory: () => Store = createStore, options: { config?: Config; now?: () => Date; media?: MediaStorage } = {}) {
  const app = new Hono<AdminEnv>();
  let needsRecovery = true, store: Store | undefined, config = options.config;
  let blobs = options.media;
  let initializing: Promise<unknown> | undefined;
  app.use('/api/admin/*', async (c, next) => {
    c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff');
    if (c.req.raw.body && c.req.raw.headers.has('content-length')) {
      const headers = new Headers(c.req.raw.headers); headers.delete('content-length');
      c.req.raw = new Request(c.req.raw, { headers });
    }
    try { await next(); } catch (error) { throw error instanceof Error ? error : new Error('Non-Error exception', { cause: error }); }
  });
  app.use('/api/admin/*', async (c, next) => {
    const maxSize = c.req.path === '/api/admin/media/local-upload' ? (config ?? loadConfig()).maxFileBytes : 1024 * 1024;
    return bodyLimit({ maxSize, onError: c => c.json({ error: { code: 'payload_too_large', message: 'Request exceeds size limit' } }, 413) })(c, next);
  });
  app.get('/api/admin/healthz', c => c.json({ ok: true }));
  app.use('/api/admin/*', async (c, next) => {
    config ??= loadConfig(); store ??= storeFactory();
    if (c.req.path.startsWith('/api/admin/media') || c.req.path.startsWith('/api/admin/cron')) { blobs ??= createMediaBlobs(config, store); c.set('blobs', blobs); }
    c.set('config', config); c.set('store', store); c.set('now', options.now?.() ?? new Date());
    if (!initializing) initializing = bootstrap(store, config, c.get('now')).catch(error => { initializing = undefined; throw error; });
    await initializing;
    if (needsRecovery) { await store.recoverPublish(); needsRecovery = false; }
    if (await store.claimMaintenance('revision-gc-at', 60000, c.get('now').toISOString())) {
      await store.sealWorkingRevisions('*', new Date(c.get('now').getTime() - 600000).toISOString(), audit({ id: 'system', displayName: 'System' }, 'history.seal_expired', {}, c.get('now')));
    }
    await next();
    if (c.res.status >= 500) needsRecovery = true;
  });
  app.use('/api/admin/*', async (c, next) => {
    for (const segment of c.req.path.split('/').filter(Boolean)) {
      let decoded: string;
      try { decoded = decodeURIComponent(segment); } catch { throw new ApiError(422, 'validation', 'Invalid path'); }
      if (Buffer.byteLength(encodeURIComponent(decoded)) > 200) throw new ApiError(422, 'validation', 'Identifier too long');
    }
    if (c.req.path === '/api/admin/auth/login' || c.req.path === '/api/admin/healthz' || c.req.path.startsWith('/api/admin/cron/')) return next();
    return authenticate(c, next);
  });
  mediaCallbacks(app);
  authRoutes(app);
  cronRoutes(app);
  app.use('/api/admin/docs/media', async (c, next) => {
    if (!['GET','HEAD'].includes(c.req.method)) throw new ApiError(403,'forbidden','Use the verified media upload routes');
    await next();
  });
  app.use('/api/admin/docs/media/*', async (c, next) => {
    if (!['GET','HEAD'].includes(c.req.method)) throw new ApiError(403,'forbidden','Use the media routes');
    await next();
  });
  mediaRoutes(app); userRoutes(app); auditRoutes(app); docRoutes(app); contentRoutes(app);
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      if (error.retryAfter) c.header('Retry-After', String(error.retryAfter));
      return c.json({ error: { code: error.code, message: error.message, details: error.details } }, error.status);
    }
    if (error instanceof SyntaxError) return c.json({ error: { code: 'validation', message: 'Invalid JSON' } }, 422);
    if (error && typeof error === 'object' && 'code' in error && error.code === 'validation' && 'details' in error) return c.json({ error: { code: 'validation', message: error.message, details: error.details } }, 422);
    if (error && typeof error === 'object' && 'code' in error && error.code === 'in_use' && 'details' in error) return c.json({ error: { code: 'in_use', message: error.message, details: error.details } }, 409);
    needsRecovery = true;
    console.error(error);
    return c.json({ error: { code: 'internal', message: 'Internal server error' } }, 500);
  });
  app.notFound(c => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));
  return app;
}
export const adminApp = createAdminApp();
