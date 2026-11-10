import { html } from '../html.js';
import type { DocumentView, SnapshotView } from '../snapshot-view.js';
import { availability, type Availability } from '../../shop/availability.js';
import { money, toCents } from '../../shop/pricing.js';
import { productReady, type Product, type Stock, type Settings, type Bundle } from '../../shop/types.js';
export interface ShopContext { view: SnapshotView; stock: Stock; checkoutEnabled?: boolean }
export const settings = (ctx: ShopContext) => ctx.view.doc('storeSettings', 'storeSettings');
export function productState(ctx: ShopContext, doc: DocumentView): Availability {
  const p = doc.value('') as Product;
  if (!productReady(p)) return { state: 'inactive', cap: 0, available: false, label: 'Finish this draft before ordering' };
  const states = (p.variants ?? []).map(v => availability(p, v, ctx.stock[`${doc.id}.${v._key}`], ctx.view.now, (settings(ctx).value('') as Settings).orders?.maxQuantityPerLine));
  return states.find(s => s.available) ?? states[0] ?? { state: 'inactive', available: false, cap: 0, label: 'Unavailable' };
}
export function shopImage(ctx: ShopContext, doc: DocumentView, path: string, primary = false) {
  const id = doc.text(path + '.mediaId'), asset = ctx.view.snapshot.media[id];
  if (!id) return html``;
  const src = asset?.url ?? doc.image(path), small = asset?.small;
  return html`<img src="${primary ? src : small || src}"${small ? html` srcset="${small} 480w, ${src} ${asset.width}w" sizes="${primary ? '(min-width: 900px) 50vw, 100vw' : '(min-width: 1100px) 33vw, (min-width: 600px) 50vw, 100vw'}"` : html``} alt="${doc.text(path + '.alt')}" width="${asset?.width || 1200}" height="${asset?.height || 1200}" loading="${primary ? 'eager' : 'lazy'}"${primary ? html` fetchpriority="high"` : html``}${doc.imageStyle(path)}>`;
}
export function displayPrice(doc: DocumentView, path = 'price'): string {
  const price = doc.value(path) as { amount: number; max?: number } | undefined;
  return price ? money(toCents(price)) + (typeof price.max === 'number' ? `–${money(toCents({ amount: price.max }))}` : '') : 'Price pending';
}
export function productCard(ctx: ShopContext, product: DocumentView) {
  const state = productState(ctx, product), first = product.list('images')[0];
  return html`<article class="product-card card"><a href="/shop/p/${product.text('slug')}">${first ? shopImage(ctx, first, 'image') : html``}<div class="product-card__body"><p class="eyebrow">${product.text('tagline')}</p><h3>${product.text('name')}</h3><p class="product-card__price">${displayPrice(product)}${product.value('youthPrice') ? html` <span>· youth ${money(toCents(product.value('youthPrice') as { amount: number }))}</span>` : html``}</p>${pocNote()}<span class="pill pill--soft-gold">${state.label}</span></div></a></article>`;
}
export function savings(ctx: ShopContext, bundle: DocumentView): number {
  const b = bundle.value('') as Bundle;
  if (!b.price || !Array.isArray(b.components)) return 0;
  return Math.max(0, b.components.reduce((total, c) => { const p = ctx.view.snapshot.docs.products?.find(p => p.id === c.productId)?.data as Product | undefined; return total + (p?.price ? toCents(p.price) * (c.quantity || 1) : 0); }, 0) - toCents(b.price));
}
export function bundleCapacity(ctx: ShopContext, bundle: DocumentView): number {
  const components = bundle.list('components');
  if (components.length < 2 || !bundle.value('price')) return 0;
  let cap = settings(ctx).number('orders.maxQuantityPerLine') || 10;
  const counts = new Map<string, { count: number; capacity: number }>();
  for (const component of components) {
    const doc = ctx.view.doc('products', component.text('productId')), p = doc.value('') as Product;
    if (!productReady(p)) return 0;
    const variant = p.variants.find(v => (!component.text('fixedVariantKey') || v._key === component.text('fixedVariantKey')) && availability(p, v, ctx.stock[`${doc.id}.${v._key}`], ctx.view.now, cap).available);
    if (!variant) return 0;
    const id = `${doc.id}.${variant._key}`, state = availability(p, variant, ctx.stock[id], ctx.view.now, cap), previous = counts.get(id);
    counts.set(id, { count: (previous?.count ?? 0) + (component.number('quantity') || 1), capacity: p.salesMode === 'preorder' && variant.limit === undefined ? Infinity : state.cap });
  }
  for (const entry of counts.values()) cap = Math.min(cap, Math.floor(entry.capacity / entry.count));
  return cap;
}
export const bundleAvailable = (ctx: ShopContext, bundle: DocumentView) => bundleCapacity(ctx, bundle) > 0;
export function variantPicker(ctx: ShopContext, product: DocumentView, name = 'variantKey', fixedKey = '') {
  const p = product.value('') as Product, variants = p.variants ?? [];
  if (!productReady(p)) return html`<p>Complete the product price and variants to preview the picker.</p>`;
  let checked = false;
  return html`${['youth', 'adult', 'one-size'].filter(g => variants.some(v => v.group === g && (!fixedKey || fixedKey === v._key))).map(group => html`<fieldset class="product-picker"><legend>${name === 'variantKey' ? group === 'youth' ? 'Youth sizes' : group === 'adult' ? 'Adult sizes' : 'Size' : product.text('name') + ' · ' + group}</legend><div class="product-picker__options">${variants.filter(v => v.group === group && (!fixedKey || fixedKey === v._key)).map(v => {
    const state = availability(p, v, ctx.stock[`${product.id}.${v._key}`], ctx.view.now, settings(ctx).number('orders.maxQuantityPerLine') || 10);
    const selected = state.available && !checked; if (selected) checked = true;
    const id = `${name}-${product.id}-${v._key}`;
    return html`<label class="product-option"><input type="radio" name="${name}" value="${v._key}" id="${id}" data-variant="${product.id}.${v._key}" data-cap="${state.cap}" data-label="${v.label}" aria-describedby="${id}-stock"${!state.available ? html` disabled` : html``}${selected ? html` checked` : html``} required><span>${v.label}${v.color ? html` · ${v.color}` : html``}</span><small id="${id}-stock">${state.label}</small></label>`;
  })}</div></fieldset>`)}`;
}
export const quantity = (cap = 10) => html`<div class="product-quantity"><label for="product-quantity">Quantity</label><div class="cart-stepper"><button type="button" data-step="-1" aria-label="Decrease quantity">−</button><input id="product-quantity" name="quantity" type="number" inputmode="numeric" min="1" max="${Math.max(1, cap)}" value="1" required><button type="button" data-step="1" aria-label="Increase quantity">+</button></div></div>`;
export const pocNote = () => html`<p class="shop-poc-note">Proof of concept only — no orders are accepted. Prices are illustrative.</p>`;
export const pocBanner = () => html`<aside class="shop-poc-banner" aria-label="Proof of concept only"><div class="container"><strong>Proof of concept only</strong><span>No orders are accepted. Prices are illustrative.</span></div></aside>`;
export const checkoutAction = (enabled = false) => enabled
  ? html`<a class="btn btn--gold" href="/shop/checkout">Continue to checkout</a>`
  : html`<button type="button" class="btn btn--gold shop-checkout-disabled" disabled>Checkout disabled — proof of concept</button>${pocNote()}`;
export const noScript = (ctx: ShopContext) => html`<noscript><p class="note">Adding to the cart needs JavaScript. <a href="${settings(ctx).email('contactEmail')}">Contact the club about this concept.</a></p></noscript>`;
export const drawer = (checkoutEnabled = false) => html`<dialog class="cart-drawer" id="cart-drawer" aria-labelledby="cart-drawer-title"><div class="cart-drawer__head"><h2 id="cart-drawer-title">Your club gear</h2><button type="button" class="btn btn--ghost" data-cart-close aria-label="Close cart">Close</button></div><div data-cart-problems role="alert" hidden></div><div data-cart-lines></div><div class="cart-summary"><p>Subtotal <strong data-cart-subtotal>$0</strong></p>${checkoutAction(checkoutEnabled)}<a class="btn btn--ghost" href="/shop/cart">View cart</a></div></dialog><p class="sr-only" data-cart-live aria-live="polite" role="status"></p>`;
