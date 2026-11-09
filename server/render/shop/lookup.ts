import { html } from '../html.js';
import { pocNote } from './shared.js';
export function lookup(error = false, checkoutEnabled = false) {
  if (!checkoutEnabled) return html`<section class="section"><div class="container shop-lookup card"><h1>Order lookup is disabled</h1>${pocNote()}<a href="/shop">Explore the concept collection</a></div></section>`;
  return html`<section class="section"><div class="container shop-lookup card"><p class="eyebrow">Your club gear</p><h1>Find your order</h1>${error ? html`<p role="alert">We couldn't find an order with those details.</p>` : html``}<form action="/api/shop/orders/lookup" method="post"><label for="order-email">Email</label><input id="order-email" type="email" name="email" autocomplete="email" required maxlength="254"><label for="order-number">Order number</label><input id="order-number" name="number" placeholder="PSC-1001" required maxlength="40"><button class="btn btn--gold">Find order</button></form><p>Order lookup opens when the collection launches.</p></div></section>`;
}
