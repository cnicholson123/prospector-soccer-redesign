import { expect, test } from './fixtures.js';
import { readFile } from 'node:fs/promises';
import { normalizeHtml } from '../normalize.js';

const pages = ['recreational', 'competitive', 'referees', 'sponsors', 'board', 'resources', 'about'];
test('renderer serves the home page, cache headers, assets and health', async ({ request }) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('<title>Prospector Soccer Club</title>');
  expect(response.headers().etag).toMatch(/^W\//);
  expect(response.headers()['cache-control']).toContain('s-maxage=0');
  const conditional = await request.get('/', { headers: { 'If-None-Match': response.headers().etag } });
  expect(conditional.status()).toBe(304);
  const css = await request.get('/assets/css/styles.css');
  expect(await css.body()).toEqual(await readFile('public/assets/css/styles.css'));
  expect(await (await request.get('/api/admin/healthz')).json()).toEqual({ ok: true });
});
test('all migrated pages match the goldens through HTTP', async ({ request }) => {
  for (const name of pages) {
    const response = await request.get('/' + name);
    expect(response.status()).toBe(200);
    expect(normalizeHtml(await response.text())).toBe(normalizeHtml(await readFile(`tests/golden/${name}.html`, 'utf8')));
    const legacy = await request.get(`/${name}.html?keep=1`, { maxRedirects: 0 });
    expect(legacy.status()).toBe(308);
    expect(legacy.headers().location).toBe(`/${name}?keep=1`);
  }
});
test('404, crawler controls and unauthenticated previews', async ({ request }) => {
  const missing = await request.get('/missing/deep/path');
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain('class="site-footer"');
  expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /');
  expect(await (await request.get('/sitemap.xml')).text()).not.toContain('<url>');
  for (const query of ['edit=1', 'preview=1']) {
    const response = await request.get('/?' + query);
    expect(response.status()).toBe(401);
    expect(response.headers()['cache-control']).toBe('no-store');
  }
});
for (const width of [390, 1280]) {
  test(`public pages retain responsive layouts at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const name of ['', ...pages]) {
      await page.goto('/' + name);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('.site-header')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${name || 'home'}-${width}.png`), fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}
test('teams and resources keep their client-side filters', async ({ page }) => {
  await page.goto('/competitive');
  await page.getByRole('button', { name: 'Girls', exact: true }).click();
  await expect(page.locator('.team[data-gender="boys"]:visible')).toHaveCount(0);
  await expect(page.locator('.team[data-gender="girls"]:visible')).toHaveCount(7);
  await page.goto('/resources');
  await page.getByPlaceholder('Search documents').fill('concussion');
  await expect(page.locator('[data-doc]:visible')).toHaveCount(1);
  await page.getByPlaceholder('Search documents').fill('zzzz-no-document');
  await expect(page.locator('[data-doc-empty]')).toBeVisible();
});
test('content is visible with JavaScript disabled', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/recreational');
  await expect(page.getByRole('heading', { name: 'Recreational soccer' })).toBeVisible();
  await expect(page.locator('.price-card')).toHaveCount(2);
  await context.close();
});
