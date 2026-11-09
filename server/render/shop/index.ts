import { html } from '../html.js';
import { layout } from '../templates/layout.js';
import { notfound } from '../templates/notfound.js';
import { landing } from './landing.js';
import { product } from './product.js';
import { bundle } from './bundle.js';
import { category } from './category.js';
import { cart } from './cart.js';
import { checkout } from './checkout.js';
import { lookup } from './lookup.js';
import { drawer, pocNote, settings, type ShopContext } from './shared.js';
export function renderShop(ctx: ShopContext, path: string, options: { preview?: boolean; secret: string; error?: boolean }) {
  const s = settings(ctx);
  const missing = () => ({ status: 404, private: true, body: layout(ctx.view, 'shop', html`${notfound()}<div class="container">${pocNote()}</div>${drawer(ctx.checkoutEnabled)}`, { title: 'Page not found', description: 'Find your way back to the club.' }, { styles: ['/assets/css/shop.css'], noindex: true }).toString() });
  if (!s.boolean('enabled') && !options.preview) {
    if (!s.boolean('comingSoon.enabled')) return missing();
    return { status: 200, private: false, body: layout(ctx.view, 'shop', html`<section class="section"><div class="container shop-lookup"><p class="eyebrow">Club shop</p><h1>${s.text('comingSoon.title')}</h1><p class="lead">${s.text('comingSoon.text')}</p>${pocNote()}</div></section>${drawer(ctx.checkoutEnabled)}`, undefined, { styles: ['/assets/css/shop.css'] }).toString() };
  }
  const segments = path.split('/').filter(Boolean);
  let content, isPrivate = false;
  if (!segments.length) content = landing(ctx);
  else if (segments.length === 2 && ['p', 'b', 'c'].includes(segments[0])) {
    const collection = segments[0] === 'p' ? 'products' : segments[0] === 'b' ? 'bundles' : 'categories';
    const doc = ctx.view.collection(collection).find(d => d.text('slug') === segments[1]);
    if (!doc) return missing();
    content = segments[0] === 'p' ? product(ctx, doc) : segments[0] === 'b' ? bundle(ctx, doc) : category(ctx, doc);
  } else if (path === 'cart') { content = cart(ctx.checkoutEnabled); isPrivate = true; }
  else if (path === 'checkout') { content = checkout(ctx, options.secret); isPrivate = true; }
  else if (path === 'orders') { content = lookup(options.error, ctx.checkoutEnabled); isPrivate = true; }
  else return missing(); // Status URLs stay uniformly 404 until Phase 3 verifies tokens.
  const titleDoc = segments.length === 2 ? ctx.view.collection(segments[0] === 'p' ? 'products' : segments[0] === 'b' ? 'bundles' : 'categories').find(d => d.text('slug') === segments[1]) : undefined;
  const firstImage = titleDoc?.list('images')[0];
  const body = layout(ctx.view, 'shop', html`${s.text('announcement') ? html`<div class="note shop-announcement"><div class="container">${s.text('announcement')}</div></div>` : html``}${content}${drawer(ctx.checkoutEnabled)}`, titleDoc ? { title: titleDoc.text('name') + ' · Club shop', description: titleDoc.text('tagline') || titleDoc.text('name') } : undefined, { styles: ['/assets/css/shop.css'], scripts: ['/assets/js/shop.js'], noindex: isPrivate || options.preview, preloadImage: firstImage?.image('image') }).toString();
  return { status: 200, private: isPrivate, body: options.preview ? body.replace(/(href|action)="(\/shop[^"?#]*)(#[^"]*)?"/g, '$1="$2?preview=1$3"') : body };
}
