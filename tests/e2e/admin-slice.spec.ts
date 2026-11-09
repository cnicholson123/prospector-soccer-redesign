import type { Locator, Page } from '@playwright/test';
import { recordPageError, expect, test, restoreSeed } from './fixtures.js';
import { randomBytes } from 'node:crypto';
import { adminPassword, reminderPassword } from './credentials.js';

test.afterEach(async ({ context }) => restoreSeed(context));

async function keyboardActivate(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let step = 0; step < 100; step++) {
    if (await target.evaluate(element => element === document.activeElement)) { await page.keyboard.press('Enter'); return; }
    await page.keyboard.press('Tab');
  }
  throw new Error(`Target not reachable with Tab: ${await target.innerText()}; focused: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 300))}`);
}
async function keyboardField(page: Page, target: Locator, value: string) {
  await expect(target).toBeVisible();
  for (let step = 0; step < 100; step++) {
    if (await target.evaluate(element => element === document.activeElement)) {
      await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type(value); return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error('Field not reachable with Tab');
}
for (const { width, keyboard } of [{ width: 390, keyboard: false }, { width: 1280, keyboard: false }, { width: 1280, keyboard: true }]) {
  test(`full event workflow ${width}px${keyboard ? ' keyboard only' : ''}`, async ({ page, context }, testInfo) => {
    test.setTimeout(90000);
    const errors: string[] = []; page.on('pageerror', error => recordPageError(errors, error));
    const title = `Club gathering ${randomBytes(5).toString('hex')}`;
    const activate = async (target: Locator) => keyboard ? keyboardActivate(page, target) : target.click();
    const fill = async (target: Locator, value: string) => keyboard ? keyboardField(page, target, value) : target.fill(value);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await activate(page.getByRole('link', { name: 'Admin', exact: true }));
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    await fill(page.getByLabel('Username', { exact: true }), 'Phil');
    await fill(page.getByLabel('Password', { exact: true }), adminPassword);
    await activate(page.getByRole('button', { name: 'Sign in', exact: true }));
    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Phil/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Site health' })).toBeVisible();
    await activate(page.getByRole('link', { name: 'Events', exact: true }).filter({ visible: true }));
    await activate(page.getByRole('link', { name: 'New event', exact: true }));
    await fill(page.getByRole('textbox', { name: 'Title', exact: true }), title);
    // Use the date input's native segmented keyboard control in the keyboard pass.
    if (keyboard) {
      // The default is today's valid date, visible in the public event window.
      await expect(page.getByRole('textbox', { name: 'Date', exact: true })).not.toHaveValue('');
    } else await fill(page.getByRole('textbox', { name: 'Date', exact: true }), '2099-06-12');
    await activate(page.getByRole('button', { name: 'Create event', exact: true }).first());
    await expect(page).toHaveURL(/\/admin\/events\/evt_/);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await fill(page.getByRole('textbox', { name: 'Location', exact: true }), 'Club fields');
    await expect(page.getByRole('status').filter({ hasText: /^Saved/ })).toBeVisible();
    const saved = await context.request.get(page.url().replace('/admin/events/', '/api/admin/docs/events/'));
    expect((await saved.json()).doc.draft.location).toBe('Club fields');
    await activate(page.getByRole('button', { name: 'Preview', exact: true }));
    await expect(page.locator('iframe[title="Draft event preview"]')).toHaveAttribute('tabindex', '-1');
    await expect(page.frameLocator('iframe[title="Draft event preview"]').getByText(title, { exact: true })).toBeVisible();
    for (const device of ['iPad', 'Desktop', 'Phone']) await activate(page.getByRole('button', { name: device, exact: true }));
    await activate(page.getByRole('button', { name: 'Review & publish', exact: true }));
    await expect(page.getByRole('dialog')).toBeVisible();
    await activate(page.getByRole('button', { name: /Publish \d+ changes?/ }));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const live = await context.newPage();
    await live.goto('/'); await expect(live.getByText(title, { exact: true })).toBeVisible(); await live.close();
    await activate(page.getByRole('button', { name: 'Event details', exact: true }));
    await fill(page.getByRole('textbox', { name: 'Title', exact: true }), `${title} updated`);
    await expect(page.getByRole('status').filter({ hasText: /^Saved/ })).toBeVisible();
    await activate(page.getByRole('button', { name: 'Save checkpoint', exact: true }).last());
    await activate(page.getByRole('button', { name: 'Review & publish', exact: true }));
    await activate(page.getByRole('button', { name: /Publish \d+ changes?/ }));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const changedLive = await context.newPage(); await changedLive.goto('/');
    await expect(changedLive.getByText(`${title} updated`, { exact: true })).toBeVisible(); await changedLive.close();
    await activate(page.getByRole('button', { name: 'History', exact: true }));
    await activate(page.getByRole('button', { name: /Event created/ }));
    await expect(page.getByText('Revision 1', { exact: true })).toBeVisible();
    await activate(page.getByRole('button', { name: 'Restore this revision' }));
    await activate(page.getByRole('button', { name: 'Restore draft', exact: true }));
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await activate(page.getByRole('button', { name: 'Review & publish', exact: true }));
    await activate(page.getByRole('button', { name: /Publish \d+ changes?/ }));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const restored = await context.newPage(); await restored.goto('/');
    await expect(restored.getByText(title, { exact: true })).toBeVisible();
    await expect(restored.getByText(`${title} updated`, { exact: true })).toHaveCount(0); await restored.close();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`editor-${width}.png`), fullPage: true });
  });
}

test('weak-password reminder is optional, persists across screens and dismisses per session', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('Username', { exact: true }).fill('Reminder');
  await page.getByLabel('Password', { exact: true }).fill(reminderPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Reminder/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Password security' })).toBeVisible();
  await page.getByRole('link', { name: 'New event' }).click();
  await expect(page.getByRole('region', { name: 'Password security' })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss password reminder for this session' }).click();
  await expect(page.getByRole('region', { name: 'Password security' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Password security' })).toHaveCount(0);
});
