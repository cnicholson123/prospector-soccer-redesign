/* Plain ES2020. Cart identities are local; every price comes from /quote. */
(() => {
  'use strict';
  const key = 'psc_shop_cart_v1', preview = new URLSearchParams(location.search).get('preview') === '1';
  const api = path => '/api/shop/' + path + (preview ? '?preview=1' : '');
  const page = path => path + (preview ? '?preview=1' : '');
  const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
  const all = selector => [...document.querySelectorAll(selector)];
  function storedCart(value) {
    if (!Array.isArray(value)) return [];
    const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
    return value.slice(0, 20).filter(x => x && Number.isSafeInteger(x.quantity) && x.quantity > 0 && (x.kind === 'product' ? id(x.productId) && id(x.variantKey) : x.kind === 'bundle' && id(x.bundleId) && x.selections && typeof x.selections === 'object' && !Array.isArray(x.selections) && Object.entries(x.selections).every(([k,v]) => /^\d{1,2}$/.test(k) && id(v))));
  }
  let cart = [], quote = null, tokenAt = 0, revision = 0, pending = Promise.resolve();
  try { const saved = JSON.parse(localStorage.getItem(key) || '[]'); cart = storedCart(saved); } catch { /* A corrupt or unavailable local store starts empty. */ }
  const element = (tag, text, attrs = {}) => { const el = document.createElement(tag); if (text) el.textContent = text; Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v)); return el; };
  const persist = () => { try { localStorage.setItem(key, JSON.stringify(cart)); } catch { announce('Your browser cannot save this cart between visits.'); } };
  const announce = text => all('[data-cart-live]').forEach(el => { el.textContent = text; });
  function showProblems(messages) { all('[data-cart-problems]').forEach(el => { el.hidden = !messages.length; el.textContent = messages.join(' '); }); }
  function identity(line) { return line.kind === 'product' ? { kind: 'product', productId: line.productId, variantKey: line.variantKey, quantity: line.quantity } : { kind: 'bundle', bundleId: line.bundleId, selections: line.selections, quantity: line.quantity }; }
  function render() {
    const count = cart.reduce((sum, line) => sum + line.quantity, 0);
    all('[data-cart-count]').forEach(el => { el.textContent = String(count); });
    if (!quote) return;
    all('[data-cart-lines]').forEach(container => {
      container.replaceChildren();
      if (!quote.lines.length) { container.append(element('p', 'Your cart is empty.'), element('a', 'Explore the collection', { href: page('/shop') })); return; }
      quote.lines.forEach((line, i) => {
        if (!line.quantity) return;
        const row = element('article', '', { class: 'cart-line' });
        if (line.image) row.append(element('img', '', { src: line.image, alt: '', loading: 'lazy' }));
        const body = element('div'); body.append(element('h3', line.title), element('p', line.variantLabel), element('p', money(line.lineCents)));
        const step = element('div', '', { class: 'cart-stepper' });
        step.append(element('button', '−', { type: 'button', 'aria-label': 'Decrease ' + line.title, 'data-cart-change': String(i), 'data-delta': '-1' }), element('input', '', { type: 'number', min: '1', max: '1000', value: String(line.quantity), inputmode: 'numeric', 'aria-label': 'Quantity for ' + line.title + ', ' + line.variantLabel, 'data-cart-quantity': String(i) }), element('button', '+', { type: 'button', 'aria-label': 'Increase ' + line.title, 'data-cart-change': String(i), 'data-delta': '1' }));
        body.append(step, element('button', 'Remove', { type: 'button', 'data-remove': String(i), 'aria-label': 'Remove ' + line.title + ', ' + line.variantLabel })); row.append(body); container.append(row);
      });
    });
    ['subtotal', 'shipping', 'tax', 'total'].forEach(name => all('[data-cart-' + name + ']').forEach(el => { el.textContent = money(quote.totals[name + 'Cents']); }));
    all('[data-tax-row]').forEach(el => { el.hidden = !quote.totals.taxCents; });
  }
  const fulfillment = () => ({ method: document.querySelector('[name=fulfillment]:checked')?.value === 'shipping' ? 'shipping' : 'pickup' });
  function refresh() {
    const version = ++revision;
    pending = pending.catch(() => {}).then(async () => {
      if (version !== revision) return;
      try {
        const response = await fetch(api('quote'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: cart.map(identity), fulfillment: fulfillment() }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || 'Your cart could not be checked. Please try again.');
        if (version !== revision) return;
        quote = data; tokenAt = Date.now(); cart = data.lines.filter(line => line.quantity > 0).map(identity); persist();
        // Keep line indexes aligned with the server response after removals.
        quote.lines = data.lines.filter(line => line.quantity > 0);
        showProblems(data.problems.map(p => p.message)); render();
      } catch (error) { showProblems([error.message]); announce(error.message); }
    });
    return pending;
  }
  const drawer = document.querySelector('#cart-drawer'); let opener;
  function openCart(source) {
    opener = source;
    if (!document.querySelector('link[href="/assets/css/shop.css"]')) document.head.append(element('link', '', { rel: 'stylesheet', href: '/assets/css/shop.css' }));
    if (drawer && !drawer.open) drawer.showModal();
    all('[data-cart-open]').forEach(el => el.setAttribute('aria-expanded', 'true'));
  }
  function closeCart() { if (drawer?.open) drawer.close(); opener?.focus(); }
  drawer?.addEventListener('click', event => { if (event.target === drawer) { const r = drawer.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeCart(); } });
  drawer?.addEventListener('close', () => { opener?.focus(); all('[data-cart-open]').forEach(el => el.setAttribute('aria-expanded', 'false')); });
  document.addEventListener('click', event => {
    const target = event.target.closest('button,a'); if (!target) return;
    if (target.hasAttribute('data-cart-open')) { event.preventDefault(); openCart(target); void refresh(); }
    if (target.hasAttribute('data-cart-close')) closeCart();
    if (target.hasAttribute('data-step')) { const input = target.closest('form').querySelector('[name=quantity]'); input.value = String(Math.max(1, Math.min(Number(input.max), Number(input.value) + Number(target.dataset.step)))); }
    if (target.hasAttribute('data-remove')) { const index = Number(target.dataset.remove); cart.splice(index, 1); persist(); void refresh(); }
    if (target.hasAttribute('data-cart-change')) { const index = Number(target.dataset.cartChange); if (cart[index]) { cart[index].quantity = Math.max(1, cart[index].quantity + Number(target.dataset.delta)); persist(); void refresh(); } }
  });
  document.addEventListener('change', event => {
    const input = event.target;
    if (input.hasAttribute('data-cart-quantity')) { const i = Number(input.dataset.cartQuantity); if (cart[i]) { cart[i].quantity = Math.max(1, Math.trunc(Number(input.value) || 1)); persist(); void refresh(); } }
    if (input.name === 'fulfillment') {
      const shipping = input.value === 'shipping'; all('[data-shipping]').forEach(el => { el.hidden = !shipping; });
      all('[data-address]').forEach(el => { el.required = shipping && el.name !== 'line2'; el.disabled = !shipping; }); void refresh();
    }
    const form = input.closest('form[data-product],form[data-bundle]');
    if (form) {
      if (input.hasAttribute('data-color')) {
        all('[data-variant]').filter(radio => form.contains(radio)).forEach(radio => { const allowed = radio.closest('label').textContent.includes(input.value); radio.closest('label').hidden = !allowed; if (!allowed) radio.checked = false; });
        const first = form.querySelector('.product-option:not([hidden]) input:not(:disabled)'); if (first) first.checked = true;
      }
      const selected = [...form.querySelectorAll('input[data-variant]:checked')];
      const quantity = form.querySelector('[name=quantity]'); quantity.max = String(Math.min(...selected.map(r => Number(r.dataset.cap)), Number(form.dataset.quantityLimit || 10))); quantity.value = String(Math.min(Number(quantity.value), Number(quantity.max)));
    }
  });
  all('form[data-product],form[data-bundle]').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = new FormData(form), quantity = Number(values.get('quantity'));
    let line;
    if (form.dataset.product) line = { kind: 'product', productId: form.dataset.product, variantKey: values.get('variantKey'), quantity };
    else { const selections = {}; for (const [k, v] of values) if (k.startsWith('selection-')) selections[k.slice(10)] = v; line = { kind: 'bundle', bundleId: form.dataset.bundle, selections, quantity }; }
    if (cart.length >= 20) { announce('Your cart holds up to 20 selections. Review it before adding more.'); openCart(form.querySelector('button[type=submit]')); return; }
    cart.push(line); persist(); await refresh(); openCart(form.querySelector('button[type=submit]') || form.querySelector('button')); announce(quote?.problems.length ? quote.problems.map(p => p.message).join(' ') : 'Added ' + form.dataset.title + (line.variantKey ? ', ' + form.querySelector('input:checked')?.dataset.label : '') + '.');
  }));
  let checkoutBlocked = false;
  const checkout = document.querySelector('[data-checkout]');
  function checkoutError(message) { const errors = checkout.querySelector('[data-checkout-errors]'); errors.hidden = false; errors.textContent = message; errors.focus(); }
  checkout?.addEventListener('submit', async event => {
    event.preventDefault(); const button = checkout.querySelector('button[type=submit]'); if (button.disabled) return; button.disabled = true;
    try {
      await pending;
      if (!quote || !cart.length) throw new Error('Your cart is empty. Add some club gear before placing an order.');
      const data = new FormData(checkout), customer = {};
      ['name','email','phone','playerName','team'].forEach(k => { customer[k] = String(data.get(k) || '').trim(); });
      const selected = String(data.get('fulfillment') || '');
      if (!selected) throw new Error('Choose a pickup location or shipping.');
      const delivery = selected === 'shipping' ? { method: 'shipping', address: Object.fromEntries(['addressName','line1','line2','city','state','postalCode'].map(k => [k === 'addressName' ? 'name' : k, data.get(k)])) } : { method: 'pickup', pickupOptionKey: selected.split(':')[1] };
      // Tokens are deliberately unusable for the first three seconds.
      await new Promise(resolve => setTimeout(resolve, Math.max(0, 3100 - (Date.now() - tokenAt))));
      const response = await fetch(api('checkout'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: quote.token, lines: cart.map(identity), customer, fulfillment: delivery, payment: { provider: data.get('payment') }, customerNote: data.get('customerNote') || '', website: data.get('website') || '' }) });
      const result = await response.json();
      if (response.status === 409) { const updated = result.quote || result.error?.details?.quote; if (updated) { quote = { ...updated, token: updated.token || quote.token }; quote.lines = updated.lines.filter(line => line.quantity > 0); cart = quote.lines.map(identity); tokenAt = Date.now(); persist(); render(); } else await refresh(); throw new Error('Your cart changed: ' + (updated?.problems?.map(p => p.message).join(' ') || 'Please review your quantities and total before placing your order again.')); }
      if (response.status === 403 && result.error === 'checkout_disabled') { checkoutBlocked = true; button.textContent = 'Checkout disabled — proof of concept'; throw new Error('Proof of concept only — no orders are accepted. Prices are illustrative.'); }
      if (response.status !== 201) throw new Error(response.status === 404 ? 'Ordering is not open yet. Your cart is saved for later.' : result.error?.message || 'We could not place your order. Please try again.');
      if (!result.next?.url) throw new Error('We could not confirm your order. Please contact the club.');
      const next = new URL(result.next.url, location.origin);
      if (next.origin !== location.origin && next.origin !== 'https://checkout.stripe.com') throw new Error('The payment address could not be verified.');
      cart = []; persist(); location.assign(next.href);
    } catch (error) { checkoutError(error.message); } finally { button.disabled = checkoutBlocked; }
  });
  window.addEventListener('storage', event => { if (event.key === key) { try { cart = storedCart(JSON.parse(event.newValue || '[]'));  void refresh(); } catch { /* Ignore corrupt cross-tab values. */ } } });
  async function refreshAvailability() {
    const radios = all('[data-variant]'); if (!radios.length) return;
    try { const response = await fetch(api('availability') + (preview ? '&' : '?') + 'ids=' + encodeURIComponent([...new Set(radios.map(r => r.dataset.variant))].join(','))); if (!response.ok) return; const data = await response.json();
      radios.forEach(radio => { const state = data.availability[radio.dataset.variant]; if (!state) return; radio.disabled = !state.available; radio.dataset.cap = String(state.cap); const text = document.getElementById(radio.getAttribute('aria-describedby')); if (text) text.textContent = state.label; });
      const stateBadge = document.querySelector('[data-product-state]');
      if (stateBadge) { const states = radios.map(r => data.availability[r.dataset.variant]).filter(Boolean); const state = states.find(s => s.available) || states[0]; if (state) stateBadge.textContent = state.label; }
      all('form[data-product],form[data-bundle]').forEach(form => { const groups = [...new Set([...form.querySelectorAll('[data-variant]')].map(r => r.name))]; let ready = true; groups.forEach(name => { const choices = [...form.querySelectorAll('[data-variant]')].filter(r => r.name === name); if (!choices.some(r => r.checked && !r.disabled)) { choices.forEach(r => { r.checked = false; }); const first = choices.find(r => !r.disabled); if (first) first.checked = true; else ready = false; } }); const button = form.querySelector('button[type=submit]') || [...form.querySelectorAll('button')].slice(-1)[0]; if (button) button.disabled = !ready; });
    } catch { /* Cached labels remain; quote rechecks before checkout. */ }
  }
  render(); void refresh(); void refreshAvailability();
})();
