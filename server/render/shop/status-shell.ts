import { html } from '../html.js';
/** Only rendered after Phase 3 verifies an order access token. */
export function statusShell() {
  return html`<section class="section"><div class="container shop-lookup"><p class="eyebrow">Your club gear</p><h1>Order status</h1><p>Order details will appear here after your order is placed.</p><a class="btn btn--primary" href="/shop/orders">Find your order</a></div></section>`;
}
