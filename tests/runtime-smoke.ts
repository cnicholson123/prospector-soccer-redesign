import assert from 'node:assert/strict';
import admin from '../api/admin.js';
import render from '../api/render.js';
import shop from '../api/shop.js';

assert.equal(typeof admin, 'object');
assert.equal(typeof render, 'object');

const health = await admin.fetch(new Request('http://localhost:3000/api/admin/healthz'));
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { ok: true });

const home = await render.fetch(new Request('http://localhost:3000/?page=index'));
assert.equal(home.status, 200);
assert.match(home.headers.get('content-type') ?? '', /text\/html/);
assert.match(await home.text(), /Prospector Soccer Club/);

const login = await admin.fetch(new Request('http://localhost:3000/api/admin/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ username: process.env.ADMIN_BOOTSTRAP_USERNAME, password: 'incorrect-password' }),
}));
assert.equal(login.status, 401);
assert.equal(login.headers.get('set-cookie'), null);
console.log('Plain Node ESM PASS — health 200, render 200 HTML, wrong-password login 401');

assert.equal(typeof shop, 'object');
const signedIn = await admin.fetch(new Request('http://localhost:3000/api/admin/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ username: process.env.ADMIN_BOOTSTRAP_USERNAME, password: process.env.ADMIN_BOOTSTRAP_PASSWORD }),
}));
assert.equal(signedIn.status, 200);
// Private preview remains available alongside the published concept catalog.
const quote = await shop.fetch(new Request('http://localhost:3000/api/shop/quote?preview=1', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Cookie: signedIn.headers.get('set-cookie')!.split(';')[0] },
  body: JSON.stringify({ lines: [] }),
}));
assert.equal(quote.status, 200); assert.equal((await quote.json()).totals.totalCents, 0);
console.log('Plain Node ESM PASS — shop empty-cart quote 200 (authenticated preview)');

const publicQuote = await shop.fetch(new Request('http://localhost:3000/api/shop/quote', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }, body: '{"lines":[]}',
}));
assert.equal(publicQuote.status, 200);
for (const path of ['checkout', 'orders', 'orders/lookup', 'payments/status', 'webhooks/stripe']) {
  const blocked = await shop.fetch(new Request('http://localhost:3000/api/shop/' + path, { method: 'POST', body: 'invalid-json' }));
  assert.equal(blocked.status, 403); assert.deepEqual(await blocked.json(), { error: 'checkout_disabled' });
}
const disabled = await render.fetch(new Request('http://localhost:3000/shop/checkout'));
assert.equal(disabled.status, 200);
const disabledHtml = await disabled.text();
assert.match(disabledHtml, /Checkout is disabled/); assert.doesNotMatch(disabledHtml, /data-checkout/);
console.log('Plain Node ESM PASS — public quote 200, operational routes 403, checkout disabled');
