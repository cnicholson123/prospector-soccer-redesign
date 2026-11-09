import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('public page and assets remain byte-identical; health responds', async ({ request }) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe(await readFile('docs/index.html', 'utf8'));
  const css = await request.get('/assets/css/styles.css');
  expect(await css.body()).toEqual(await readFile('public/assets/css/styles.css'));
  expect(await (await request.get('/api/admin/healthz')).json()).toEqual({ ok: true });
});
for (const width of [390, 1280]) {
  test(`admin scaffold is usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/admin/');
    await expect(page.getByRole('heading', { name: 'A home for your club’s content.' })).toBeVisible();
    await expect(page.getByText('19 content types defined')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const back = page.getByRole('link', { name: 'Back to the club' });
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    await expect(back).toBeFocused();
    await expect(back).toHaveCSS('outline-style', 'solid');
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`scaffold-${width}.png`), fullPage: true });
    await back.click(); await expect(page).toHaveTitle('Prospector Soccer Club');
  });
}
