import { html } from '../html.js';
import type { DocumentView } from '../snapshot-view.js';
import { productCard, type ShopContext } from './shared.js';
export function category(ctx: ShopContext, doc: DocumentView) {
  return html`<section class="section"><div class="container"><nav class="shop-breadcrumb" aria-label="Breadcrumb"><a href="/shop">Shop</a> / ${doc.text('name')}</nav><p class="eyebrow">Club collection</p><h1>${doc.text('name')}</h1><p class="lead">${doc.text('description')}</p><div class="shop-grid">${ctx.view.collection('products').filter(p => p.text('categoryId') === doc.id).map(p => productCard(ctx, p))}</div></div></section>`;
}
