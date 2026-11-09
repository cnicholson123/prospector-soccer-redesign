import { html } from '../html.js';
import { checkoutAction } from './shared.js';
export function cart(checkoutEnabled = false) {
  return html`<section class="section"><div class="container"><nav class="shop-breadcrumb" aria-label="Breadcrumb"><a href="/shop">Shop</a> / Your cart</nav><p class="eyebrow">Your club gear</p><h1>Your cart</h1><div role="alert" data-cart-problems hidden></div><div class="checkout-layout"><div data-cart-lines><p>Loading your cart…</p><noscript>Your cart needs JavaScript. You can still browse the concept collection.</noscript></div><aside class="card cart-summary"><h2>Order summary</h2><p>Subtotal <strong data-cart-subtotal>$0</strong></p><p>Illustrative total only. No payment will be taken.</p><p>Total <strong data-cart-total>$0</strong></p>${checkoutAction(checkoutEnabled)}<a href="/shop">Continue shopping</a></aside></div></div></section>`;
}
