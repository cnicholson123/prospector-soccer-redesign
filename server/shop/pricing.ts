import type { Snapshot } from '../../shared/types.js';
import { availability } from './availability.js';
import { catalog, type Product, type Bundle, type CartLine, type PricedLine, type PricedComponent, type Problem, type Quote, type Settings, type Stock } from './types.js';
/** The only dollars-to-cents conversion in the shop. */
export function toCents(money: { amount: number }): number {
  const cents = Math.round(money.amount * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Invalid catalog price');
  return cents;
}
export const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
export function price(snapshot: Snapshot, stock: Stock, settings: Settings, cart: CartLine[], options: { now?: Date; discount?: { type: 'percent' | 'fixed'; value: number }; fulfillment?: { method: 'pickup' | 'shipping' } } = {}): Quote {
  const products = catalog<Product>(snapshot, 'products'), bundles = catalog<Bundle>(snapshot, 'bundles'), now = options.now ?? new Date();
  const max = settings.orders?.maxQuantityPerLine ?? 10;
  const merged = new Map<string, CartLine>();
  for (const line of cart) {
    const key = line.kind === 'product' ? JSON.stringify([line.kind, line.productId, line.variantKey]) : JSON.stringify([line.kind, line.bundleId, Object.entries(line.selections).sort(([a], [b]) => a.localeCompare(b))]);
    const previous = merged.get(key);
    merged.set(key, { ...line, quantity: Math.min(Number.MAX_SAFE_INTEGER, (previous?.quantity ?? 0) + line.quantity) });
  }
  const lines: PricedLine[] = [], problems: Problem[] = [], consumed: Record<string, number> = {};
  for (const [index, line] of [...merged.values()].entries()) {
    const local: Problem[] = [], add = (code: Problem['code'], message: string) => local.push({ code, message, line: index });
    let unitCents = 0, title = '', variantLabel = '', sku: string | undefined, shippable = true, salesMode: Product['salesMode'] = 'preorder', cap = max;
    let image: string | undefined;
    const components: PricedComponent[] = [];
    const addComponent = (productId: string, key: string, count: number) => {
      const product = products.get(productId), variant = product?.variants.find(v => v._key === key);
      if (!product || !variant) { add('unavailable', 'An item is no longer available. Please choose another.'); cap = 0; return; }
      const state = availability(product, variant, stock[`${productId}.${key}`], now, max);
      if (!state.available) add('unavailable', `${product.name}, ${variant.label}: ${state.label}`);
      components.push({ productId, variantKey: key, title: product.name, variantLabel: variant.label, sku: variant.sku, quantity: count, salesMode: product.salesMode });
      shippable &&= product.shippable !== false;
      if (product.salesMode === 'stock') salesMode = 'stock';
    };
    if (line.kind === 'product') {
      const product = products.get(line.productId), variant = product?.variants.find(v => v._key === line.variantKey);
      title = product?.name ?? 'Unavailable product'; variantLabel = variant?.label ?? '';
      addComponent(line.productId, line.variantKey, 1);
      if (product && variant) { unitCents = toCents(variant.priceOverride ?? (variant.group === 'youth' && product.youthPrice ? product.youthPrice : product.price)); sku = variant.sku; }
    } else {
      const bundle = bundles.get(line.bundleId);
      title = bundle?.name ?? 'Unavailable bundle';
      if (!bundle) { add('unavailable', 'This bundle is no longer available.'); cap = 0; }
      else {
        unitCents = toCents(bundle.price); shippable = bundle.shippable !== false;
        bundle.components.forEach((c, i) => addComponent(c.productId, c.fixedVariantKey ?? line.selections[String(i)], c.quantity));
        variantLabel = components.map(c => `${c.title}: ${c.variantLabel}`).join(' · ');
      }
    }
    // Aggregate repeated components before applying caps; also account for other cart lines.
    const required = new Map<string, number>();
    components.forEach(c => { const id = `${c.productId}.${c.variantKey}`; required.set(id, (required.get(id) ?? 0) + c.quantity); });
    for (const [id, count] of required) {
      const c = components.find(c => `${c.productId}.${c.variantKey}` === id)!, p = products.get(c.productId)!;
      const v = p.variants.find(v => v._key === c.variantKey)!;
      const available = p.salesMode === 'preorder' && v.limit === undefined && availability(p, v, stock[id], now, max).available ? Infinity : availability(p, v, stock[id], now, max).cap;
      cap = Math.min(cap, Math.floor(Math.max(0, available - (consumed[id] ?? 0)) / count));
    }
    const requested = Number.isFinite(line.quantity) ? Math.trunc(line.quantity) : 1;
    const quantity = cap <= 0 ? 0 : Math.max(1, Math.min(cap, requested));
    if (quantity !== line.quantity) add('qty_capped', `${title}: quantity updated to ${quantity}${quantity === 0 ? ' because it is unavailable' : ''}.`);
    if (options.fulfillment?.method === 'shipping' && !shippable) add('pickup_only', `${title} is available for pickup only.`);
    for (const [id, count] of required) consumed[id] = (consumed[id] ?? 0) + quantity * count;
    const doc = line.kind === 'product' ? snapshot.docs.products?.find(p => p.id === line.productId) : snapshot.docs.bundles?.find(b => b.id === line.bundleId);
    const data = doc?.data as { images?: { image: { mediaId: string } }[]; image?: { mediaId: string } } | undefined;
    const mediaId = data?.image?.mediaId ?? data?.images?.[0]?.image.mediaId;
    if (mediaId) image = snapshot.media[mediaId]?.small ?? snapshot.media[mediaId]?.url;
    lines.push({ ...line, quantity, title, variantLabel, sku, image, unitCents, lineCents: quantity * unitCents, salesMode, shippable, ...(line.kind === 'bundle' ? { components } : {}), problems: local });
    problems.push(...local);
  }
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineCents, 0);
  const discount = options.discount;
  const discountCents = Math.max(0, Math.min(subtotalCents, discount ? discount.type === 'fixed' ? Math.round(discount.value) : Math.round(subtotalCents * Math.max(0, discount.value) / 100) : 0));
  const shipping = settings.shipping;
  const shippingCents = options.fulfillment?.method === 'shipping' && shipping?.enabled && !(shipping.freeOver && subtotalCents - discountCents >= toCents(shipping.freeOver)) ? toCents(shipping.flatRate ?? { amount: 0 }) : 0;
  const taxMode = settings.tax?.mode ?? 'off', rate = settings.tax?.flatRatePercent ?? 0;
  const taxCents = taxMode === 'flat' ? Math.round((subtotalCents - discountCents + (settings.tax?.taxShipping ? shippingCents : 0)) * Math.round(rate * 1000) / 100000) : 0;
  const totalCents = subtotalCents - discountCents + shippingCents + taxCents;
  if (![subtotalCents, discountCents, shippingCents, taxCents, totalCents].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid price total');
  return { lines, problems, totals: { subtotalCents, discountCents, shippingCents, taxCents, totalCents, taxMode, ...(taxMode === 'flat' ? { taxRateBps: Math.round(rate * 1000) / 10 } : {}), currency: 'usd' } };
}
