import { expect, test } from './fixtures.js';
for (const width of [390, 1280]) {
  test(`admin login is usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`login-${width}.png`), fullPage: true });
    await page.getByRole('link', { name: 'Back to site' }).click();
    await expect(page).toHaveTitle('Prospector Soccer Club');
  });
}

// These HTTP assertions run with the same isolated filesystem server as browser specs.
test('admin assets are cacheable while the SPA shell is no-store', async ({ request }) => {
  const shell = await request.get('/admin/index.html');
  expect(shell.status()).toBe(200);
  expect(shell.headers()['cache-control']).toBe('no-store');
  const source = await shell.text();
  const asset = source.match(/src="([^" ]+\.js)"/)?.[1];
  expect(asset).toBeTruthy();
  const response = await request.get(asset!);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control'] ?? '').not.toContain('no-store');
});
test('admin rejects oversized requests', async ({ request }) => {
  const response = await request.post('/api/admin/missing', { data: 'x'.repeat(1024 * 1024 + 1) });
  expect(response.status()).toBe(413);
});
