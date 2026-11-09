import type { Page } from '@playwright/test';
import { expect, test, restoreSeed } from './fixtures';
import { randomBytes } from 'node:crypto';
import { adminPassword } from './credentials';
// This suite runs only against Playwright's isolated FS store. Preserve the
// original public fixture for the following renderer golden checks.
test.afterEach(async ({ context }) => restoreSeed(context));
async function login(page: Page) {
  await page.goto('/admin');
  await page.getByLabel('Username', { exact: true }).fill('Phil');
  await page.getByLabel('Password', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Phil/ })).toBeVisible();
}
async function publish(page: Page) {
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).first().click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved/ })).toBeVisible();
  await page.getByRole('button', { name: 'Review & publish', exact: true }).click();
  await page.getByRole('button', { name: /^Publish \d+ changes?$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
for (const width of [390, 1280]) test(`breadth editors publish board, sponsor and page copy at ${width}px`, async ({ page, context }, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width, height: 900 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const unique = randomBytes(4).toString('hex'), member = `Club volunteer ${unique}`, sponsor = `Community sponsor ${unique}`, lead = `A club for our community ${unique}.`;
  await login(page);
  await page.goto('/admin/boardMembers/mem_1');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(member);
  await publish(page);
  const live = await context.newPage(); await live.goto('/board');
  await expect(live.getByText(member, { exact: true })).toBeVisible();
  await page.goto('/admin/sponsors/spo_1');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(sponsor);
  await publish(page); await live.goto('/sponsors');
  await expect(live.getByText(sponsor, { exact: true })).toBeVisible();
  await page.goto('/admin/pages/about');
  await page.locator('#section-hero > summary').click();
  await page.getByRole('textbox', { name: 'Lead', exact: true }).fill(lead);
  await publish(page); await live.goto('/about');
  await expect(live.getByText(lead, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.frameLocator('iframe[title="Draft content preview"]').getByText(lead, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'About history', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`breadth-${width}.png`), fullPage: true });
  await live.close(); expect(errors).toEqual([]);
});

test('collection trash refusal, bulk selection and keyboard reordering', async ({ page }) => {
  await login(page);
  await page.goto('/admin/sponsorTiers');
  // The first tier is the seeded Gold tier, referenced by published sponsors.
  const tier = page.locator('.content-row').first();
  await tier.getByText('Actions', { exact: true }).click();
  await tier.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Used by');
  await expect(page.getByRole('alert').getByRole('link').first()).toHaveAttribute('href', /\/admin\/sponsors\//);
  await page.goto('/admin/teams');
  const rows = page.locator('.content-title');
  await expect(rows.first()).toBeVisible();
  const order = () => rows.evaluateAll(links => links.map(link => link.getAttribute('href')));
  const before = await order();
  await page.getByRole('button', { name: /^Reorder / }).first().focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(order).toEqual([before[1], before[0], ...before.slice(2)]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(order).toEqual(before);
  await page.getByRole('checkbox', { name: 'Select all visible items' }).check();
  await expect(page.getByRole('button', { name: 'Publish selected' })).toBeVisible();
});
