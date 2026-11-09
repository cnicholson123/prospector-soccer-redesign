import { checkoutGuard } from './checkout-guard.js';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createHmac } from 'node:crypto';
import { loadConfig, type Config } from '../../config.js';
import { createStore } from '../../store/index.js';
import type { Store } from '../../store/types.js';
import { readSession } from '../../auth/session.js';
import { allDocs } from '../../content/publish.js';
import { buildSnapshot } from '../../content/snapshot.js';
import { effectiveSnapshot } from '../../content/scheduled-view.js';
import { availability } from '../availability.js';
import { price } from '../pricing.js';
import { mintCheckoutToken } from './token.js';
import { temporaryShopStore, type ShopStockReader } from '../store/index.js';
import { catalog, type CartLine, type Product, type Settings } from '../types.js';
import type { Snapshot } from '../../../shared/types.js';
export function parseCart(value: unknown): CartLine[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const id = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(s);
  const lines: CartLine[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || !Number.isSafeInteger(item.quantity)) return null;
    if (item.kind === 'product' && id(item.productId) && id(item.variantKey)) lines.push({ kind: 'product', productId: item.productId, variantKey: item.variantKey, quantity: item.quantity });
    else if (item.kind === 'bundle' && id(item.bundleId) && item.selections && typeof item.selections === 'object' && !Array.isArray(item.selections) && Object.entries(item.selections).length <= 20 && Object.entries(item.selections).every(([k, v]) => /^\d{1,2}$/.test(k) && id(v))) lines.push({ kind: 'bundle', bundleId: item.bundleId, selections: { ...item.selections }, quantity: item.quantity });
    else return null;
  }
  return lines;
}
type Env = { Variables: { snapshot: Snapshot; settings: Settings } };
export function createShopApp(factory: () => Store = createStore, options: { config?: Config; now?: () => Date; shopStore?: ShopStockReader } = {}) {
  const app = new Hono<Env>();
  let config = options.config, store: Store | undefined;
  const now = () => options.now?.() ?? new Date(), stocks = options.shopStore ?? temporaryShopStore;
  app.use('/api/shop/*', checkoutGuard(() => config ??= loadConfig()));
  app.use('/api/shop/*', async (c, next) => {
    c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff');
    config ??= loadConfig(); store ??= factory();
    const preview = c.req.query('preview') === '1';
    let snapshot = await store.getSnapshot();
    if (preview) {
      const session = await readSession(store, c.req.raw, now(), config.production);
      if (!session || session.user.mustChangePassword) return c.json({ error: { code: 'forbidden', message: 'Preview requires authentication.' } }, 403);
      if (snapshot) snapshot = buildSnapshot((await allDocs(store)).filter(d => !d.trashedAt).map(d => ({ ...d, published: d.draft, publishedVersion: d.version })), snapshot);
    }
    if (!snapshot) return c.json({ error: { code: 'not_found', message: 'Shop not found.' } }, 404);
    snapshot = effectiveSnapshot(snapshot, now());
    const settings = snapshot.docs.storeSettings?.[0]?.data as Settings | undefined;
    if (!settings || !settings.enabled && !preview) return c.json({ error: { code: 'not_found', message: 'Shop not found.' } }, 404);
    c.set('snapshot', snapshot); c.set('settings', settings);
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      const origin = c.req.header('origin'), site = c.req.header('sec-fetch-site');
      const allowed = origin ? origin === config.publicBaseUrl || !config.production && origin === 'http://localhost:5173' : site === 'same-origin';
      if (!allowed || site === 'cross-site') return c.json({ error: { code: 'forbidden', message: 'Please submit from the club website.' } }, 403);
      if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('content-type') ?? '')) return c.json({ error: { code: 'validation', message: 'Send JSON content.' } }, 415);
    }
    if (['/api/shop/quote', '/api/shop/availability'].includes(c.req.path)) {
      const key = createHmac('sha256', config.sessionSecret).update(c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown').digest('hex');
      const hit = await store.rateLimitHit(`shop-${c.req.path.endsWith('quote') ? 'quote' : 'availability'}-${key}`, 60);
      if (hit.count > (c.req.path.endsWith('quote') ? 60 : 120)) { c.header('Retry-After', String(Math.max(1, Math.ceil((Date.parse(hit.resetAt) - now().getTime()) / 1000)))); return c.json({ error: { code: 'rate_limited', message: 'Please wait a moment before trying again.' } }, 429); }
    }
    await next();
  });
  app.use('/api/shop/*', async (c, next) => {
    if (c.req.raw.body && c.req.raw.headers.has('content-length')) { const headers = new Headers(c.req.raw.headers); headers.delete('content-length'); c.req.raw = new Request(c.req.raw, { headers }); }
    return bodyLimit({ maxSize: 65536, onError: c => c.json({ error: { code: 'payload_too_large', message: 'Your cart request is too large.' } }, 413) })(c, next);
  });
  app.post('/api/shop/quote', async c => {
    const body: unknown = await c.req.json();
    const data = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const lines = parseCart(data.lines);
    if (!lines) return c.json({ error: { code: 'validation', message: 'Use up to 20 cart lines with whole-number quantities.' } }, 422);
    const products = catalog<Product>(c.get('snapshot'), 'products');
    const ids = [...products].flatMap(([id, p]) => p.variants.map(v => `${id}.${v._key}`));
    const fulfillment = data.fulfillment && typeof data.fulfillment === 'object' && 'method' in data.fulfillment && data.fulfillment.method === 'shipping' ? { method: 'shipping' as const } : { method: 'pickup' as const };
    return c.json({ ...price(c.get('snapshot'), await stocks.getStock(ids), c.get('settings'), lines, { now: now(), fulfillment }), token: mintCheckoutToken(config!.sessionSecret, now()) });
  });
  app.get('/api/shop/availability', async c => {
    const ids = (c.req.query('ids') ?? '').split(',').filter(Boolean);
    if (ids.length > 200 || ids.some(id => !/^[A-Za-z0-9_-]{1,100}\.[A-Za-z0-9_-]{1,100}$/.test(id))) return c.json({ error: { code: 'validation', message: 'Invalid variant IDs.' } }, 422);
    const products = catalog<Product>(c.get('snapshot'), 'products'), stock = await stocks.getStock(ids);
    return c.json({ availability: Object.fromEntries(ids.map(id => { const [productId, key] = id.split('.'); const p = products.get(productId), v = p?.variants.find(v => v._key === key); return [id, p && v ? availability(p, v, stock[id], now(), c.get('settings').orders?.maxQuantityPerLine) : { available: false, cap: 0, state: 'inactive', label: 'Unavailable' }]; })) });
  });
  app.onError((error, c) => c.json({ error: { code: error instanceof SyntaxError ? 'validation' : 'internal', message: error instanceof SyntaxError ? 'Invalid JSON.' : 'The shop is temporarily unavailable. Please try again.' } }, error instanceof SyntaxError ? 422 : 500));
  app.notFound(c => c.json({ error: { code: 'not_found', message: 'This shop action is not available yet.' } }, 404));
  return app;
}
export const shopApp = createShopApp();
