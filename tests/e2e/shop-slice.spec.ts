import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect, restoreSeed } from './fixtures.js';
import { adminPassword } from './credentials.js';

const explanation = 'Proof of concept only — no orders are accepted. Prices are illustrative.';
const disabledLabel = 'Checkout disabled — proof of concept';
async function login(request: APIRequestContext) {
  const response = await request.post('/api/admin/auth/login', { headers: { Origin: 'http://localhost:3000' }, data: { username: 'Phil', password: adminPassword } });
  expect(response.ok()).toBeTruthy();
}
test.afterEach(async ({ context }) => { await restoreSeed(context); });
async function banner(page: Page) {
  const notice = page.getByRole('complementary', { name: 'Proof of concept only' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('No orders are accepted. Prices are illustrative.');
  // The banner must stay in the viewport when browsing farther down a page.
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect.poll(async () => notice.evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
  await expect.poll(async () => notice.evaluate(el => el.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
}
async function keyboardActivate(page: Page, target: Locator) {
  for (let i = 0; i < 150; i++) {
    if (await target.evaluate(el => el === document.activeElement)) { await page.keyboard.press('Enter'); return; }
    await page.keyboard.press('Tab');
  }
  throw new Error('Control not reachable by keyboard');
}
for (const width of [390, 820, 1280]) test(`proof-of-concept browsing and disabled checkout ${width}px`, async ({ page, context }, info) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width, height: 900 });
  const errors: string[] = [], checkoutRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/shop/checkout')) checkoutRequests.push(request.url()); });
  await page.goto('/');
  // Below 1141px the header nav collapses into the Menu panel; open it to reach the link like a visitor would.
  if (width < 1141) {
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
  }
  const nav = page.getByRole('navigation', { name: width < 1141 ? 'Mobile' : 'Main', exact: true });
  // The mobile link includes a decorative CSS arrow in its accessible name.
  const merch = nav.getByRole('link', { name: /^Merch \(concept\)(?: →)?$/ });
  await expect(merch).toBeVisible(); await merch.click();
  await expect(page).toHaveURL(/\/shop$/); await banner(page);
  const headline = page.getByRole('heading', { name: /Wear the gold/ });
  await expect(headline).toBeVisible();
  await expect(headline).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(headline.locator('em')).toHaveCSS('color', 'rgb(248, 211, 106)');
  await page.screenshot({ path: info.outputPath(`concept-hero-${width}.png`), fullPage: true });
  await page.getByRole('link').filter({ has: page.getByRole('heading', { name: 'Crest Hoodie', exact: true }) }).click();
  await banner(page);
  await page.getByRole('radio', { name: 'Youth M', exact: true }).check();
  await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Your club gear' });
  await expect(drawer).toBeVisible(); await expect(drawer).toContainText('Youth M');
  await expect(drawer).toContainText(explanation);
  await expect(drawer.getByRole('button', { name: disabledLabel })).toBeDisabled();
  await drawer.getByRole('button', { name: 'Close cart' }).click();
  await page.getByRole('radio', { name: 'Adult L', exact: true }).check();
  await page.getByLabel('Quantity', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
  await expect(drawer).toContainText('Adult L');
  await drawer.getByRole('link', { name: 'View cart', exact: true }).click(); await banner(page);
  await expect(page.locator('main [data-cart-total]')).toHaveText('$145.00');
  await page.reload(); await expect(page.locator('main [data-cart-total]')).toHaveText('$145.00');
  const summary = page.locator('main aside.cart-summary');
  await expect(summary).toHaveCount(1);
  await expect(summary.getByRole('button', { name: disabledLabel })).toBeDisabled(); await expect(summary).toContainText(explanation);
  await page.locator('main').getByRole('button', { name: 'Increase Crest Hoodie' }).first().click();
  await expect(page.locator('main [data-cart-total]')).toHaveText('$190.00');
  await page.locator('main').getByRole('button', { name: 'Remove Crest Hoodie, Youth M', exact: true }).click();
  await expect(page.locator('main [data-cart-total]')).toHaveText('$100.00');
  for (const path of ['/shop/b/coach-kit', '/shop/c/apparel', '/shop/checkout', '/shop/orders', '/shop/p/missing', '/shop/order/PSC-1001']) {
    await page.goto(path); await banner(page);
    await expect(page.locator('form[data-checkout]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto('/shop/checkout');
  await expect(page.getByRole('heading', { name: 'Checkout is disabled' })).toBeVisible();
  await expect(page.locator('main form')).toHaveCount(0);
  await expect(page.locator('main')).toContainText(explanation);
  const response = await context.request.post('/api/shop/checkout', { data: {} });
  expect(response.status()).toBe(403); expect(await response.json()).toEqual({ error: 'checkout_disabled' });
  expect(checkoutRequests).toEqual([]); expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath(`concept-checkout-${width}.png`), fullPage: true });
});
test('keyboard-only product, drawer and cart retain disabled checkout', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/shop/p/crest-hoodie');
  await keyboardActivate(page, page.getByRole('button', { name: 'Add to cart', exact: true }));
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Add to cart', exact: true })).toBeFocused();
  await keyboardActivate(page, page.getByRole('link', { name: 'Open cart' }));
  await keyboardActivate(page, page.getByRole('dialog').getByRole('link', { name: 'View cart' }));
  await expect(page.locator('main').getByRole('button', { name: disabledLabel })).toBeDisabled();
  await keyboardActivate(page, page.getByRole('link', { name: 'Continue shopping', exact: true }));
  await expect(page.getByRole('heading', { name: /Wear the gold/ })).toBeVisible();
});
test('catalog variants work and store settings show a read-only deployment status', async ({ page, context }) => {
  await login(context.request);
  const original = (await (await context.request.get('/api/admin/docs/products/prod_hoodie')).json()).doc.draft.variants;
  await page.goto('/admin/products/prod_hoodie');
  await expect(page.getByRole('heading', { name: 'Crest Hoodie', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Generate variants', exact: true }).click();
  await expect.poll(async () => (await (await context.request.get('/api/admin/docs/products/prod_hoodie')).json()).doc.draft.variants.length).toBe(12);
  const rows = (await (await context.request.get('/api/admin/docs/products/prod_hoodie')).json()).doc.draft.variants;
  expect(rows.slice(0, original.length)).toEqual(original);
  await page.goto('/admin/store/settings');
  await expect(page.getByRole('status').filter({ hasText: 'Checkout: disabled by deployment (proof of concept)' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /checkout/i })).toHaveCount(0);
});
