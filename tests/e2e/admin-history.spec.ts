import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { recordPageError, expect, test, restoreSeed } from './fixtures.js';
import { adminPassword } from './credentials.js';
import type { Revision } from '../../shared/types.js';

test.afterEach(async ({ context }) => restoreSeed(context));
async function login(page: Page) {
  await page.goto('/admin');
  await page.getByLabel('Username', { exact: true }).fill('Phil');
  await page.getByLabel('Password', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Phil/ })).toBeVisible();
}
async function keyboardActivate(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let i = 0; i < 200; i++) {
    if (await target.evaluate(element => element === document.activeElement)) { await page.keyboard.press('Enter'); return; }
    await page.keyboard.press('Tab');
  }
  throw new Error('Control is not keyboard reachable');
}
for (const width of [390, 1280]) {
  test(`history, revision restore, audit and filtered CSV at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = []; page.on('pageerror', error => recordPageError(errors, error));
    await login(page);
    const me = await (await context.request.get('/api/admin/auth/me')).json();
    const marker = `History ${randomBytes(5).toString('hex')}`;
    await page.goto('/admin/events/new');
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill(marker);
    await page.getByRole('textbox', { name: 'Date', exact: true }).fill('2099-06-15');
    await page.getByRole('button', { name: 'Create event', exact: true }).first().click();
    await expect(page).toHaveURL(/\/events\/evt_/);
    const id = page.url().split('/').at(-1)!;
    for (const suffix of ['first', 'second']) {
      // Hold blur autosave in flight: clicking Checkpoint must queue a sealed
      // revision, not lose the click when the save state changes.
      let release!: () => void, started!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const saving = new Promise<void>(resolve => { started = resolve; });
      const path = `/api/admin/docs/events/${id}`;
      await page.route(path, async route => {
        if (route.request().method() === 'PUT' && !route.request().postDataJSON().checkpoint) { started(); await gate; }
        await route.continue();
      });
      await page.getByRole('textbox', { name: 'Title', exact: true }).fill(`${marker} ${suffix}`);
      const checkpoint = page.getByRole('button', { name: 'Save checkpoint', exact: true }).last();
      await checkpoint.focus(); await saving;
      await expect(checkpoint).toBeEnabled();
      const saved = page.waitForResponse(response => response.url().endsWith(path) && response.request().method() === 'PUT' && response.request().postDataJSON().checkpoint === true);
      await checkpoint.click(); release();
      const response = await saved;
      expect(response.ok()).toBe(true);
      expect((await response.json()).doc.draft.title).toBe(`${marker} ${suffix}`);
      await expect(page.getByRole('status').filter({ hasText: /^Saved/ })).toBeVisible();
      await page.unroute(path);
    }
    const revisions = (await (await context.request.get(`/api/admin/revisions/events/${id}`)).json()).revisions as Revision[];
    const first = revisions.find(rev => rev.action === 'checkpoint' && (rev.data as { title: string }).title === `${marker} first`)!;
    const second = revisions.find(rev => rev.action === 'checkpoint' && (rev.data as { title: string }).title === `${marker} second`)!;
    expect(first).toMatchObject({ sealedAt: expect.any(String) }); expect(second).toMatchObject({ sealedAt: expect.any(String) });
    await page.getByRole('button', { name: 'History', exact: true }).click();
    const timeline = page.getByRole('region', { name: 'Document history' });
    await expect(timeline.getByRole('button').filter({ hasText: `Revision ${first.docVersion} · Sealed` })).toBeVisible();
    await expect(timeline.getByRole('button').filter({ hasText: `Revision ${second.docVersion} · Sealed` })).toBeVisible();
    await page.getByRole('button', { name: 'Review & publish', exact: true }).click();
    await page.getByRole('button', { name: /Publish \d+ changes?/ }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await timeline.getByRole('button').filter({ hasText: `Revision ${first.docVersion} · Sealed` }).click();
    await page.getByRole('button', { name: 'Restore this revision', exact: true }).click();
    await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: `${marker} first`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Review & publish', exact: true }).click();
    await page.getByRole('button', { name: /Publish \d+ changes?/ }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const live = await context.newPage(); await live.goto('/');
    await expect(live.getByText(`${marker} first`, { exact: true })).toBeVisible();
    await expect(live.getByText(`${marker} second`, { exact: true })).toHaveCount(0); await live.close();
    await page.goto('/admin/history');
    await page.getByRole('button', { name: 'All revisions', exact: true }).click();
    await page.getByLabel('Collection', { exact: true }).selectOption('events');
    await page.getByLabel('Author', { exact: true }).selectOption(me.user.id);
    await expect(page.locator('.revision-list > li').first()).toContainText(`${marker} first`);
    await page.locator('.revision-list > li').first().getByRole('link', { name: 'View revision' }).click();
    await expect(page.getByRole('region', { name: 'Document history' }).getByRole('heading', { name: /Revision \d+/ })).toBeVisible();
    await page.goto('/admin/audit');
    await page.getByLabel('User', { exact: true }).selectOption(me.user.id);
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    const auditRows = page.getByRole('list', { name: 'Audit activity' }).getByRole('button');
    await expect(auditRows.first()).toContainText('content.publish');
    // The list renders progressively and may re-render; assert the expected order atomically on one snapshot.
    await expect.poll(async () => {
      const t = await auditRows.allTextContents();
      return t.length >= 3 && t[0].includes('content.publish') && t[1].includes('content.restored') && t[2].includes('content.publish')
        && t.some(x => x.includes('content.checkpoint')) && t.some(x => x.includes('auth.login'));
    }, { timeout: 20000 }).toBe(true);
    // The drawer contains keyboard focus and returns it on Escape.
    if (width === 1280) await keyboardActivate(page, auditRows.first()); else await auditRows.first().click();
    await expect(page.getByRole('dialog', { name: 'Activity details' })).toBeVisible();
    await expect(page.getByLabel('Audit metadata')).toContainText(id);
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(auditRows.first()).toBeFocused();
    await page.getByLabel('Exact action', { exact: true }).fill('content.checkpoint');
    await page.getByLabel('Collection', { exact: true }).selectOption('events');
    await page.getByLabel('Search activity', { exact: true }).fill(marker);
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect(auditRows).toHaveCount(2);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Export CSV', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('audit.csv');
    const csv = await readFile((await download.path())!, 'utf8');
    expect(csv).toContain(`${marker} first`); expect(csv).toContain(`${marker} second`); expect(csv).not.toContain('auth.login');
    expect(csv.trim().split('\r\n')).toHaveLength(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]); await page.screenshot({ path: info.outputPath(`audit-${width}.png`), fullPage: true });
  });
  test(`site comparison lists draft changes and confirms a forward restore at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(90000); await page.setViewportSize({ width, height: 900 }); await login(page);
    const me = await (await context.request.get('/api/admin/auth/me')).json();
    const doc = (await (await context.request.get('/api/admin/docs/home/home')).json()).doc;
    const title = `Draft only ${randomBytes(5).toString('hex')}`;
    doc.draft.hero.title = title;
    expect((await context.request.put('/api/admin/docs/home/home', { headers: { 'X-CSRF-Token': me.csrfToken, Origin: 'http://localhost:3000' }, data: { baseVersion: doc.version, draft: doc.draft } })).ok()).toBe(true);
    await page.goto('/admin/history');
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
    // Keep paging until the seed version is visible; suites share the isolated FS store.
    const compare = page.getByRole('button', { name: 'Compare with current site version 1', exact: true });
    await expect(page.locator('.version-list > li').first()).toBeVisible();
    for (let n = 0; n < 30 && !await compare.count(); n++) {
      const count = await page.locator('.version-list > li').count();
      await page.getByRole('button', { name: 'Load more', exact: true }).click();
      await expect.poll(() => page.locator('.version-list > li').count()).toBeGreaterThan(count);
    }
    await compare.click();
    const dialog = page.getByRole('dialog');
    const home = dialog.locator('.site-changes > li').filter({ hasText: 'Home ·' }).first();
    await home.locator('summary').click(); await expect(home).toContainText(title);
    const count = await dialog.locator('.site-changes > li').count(); expect(count).toBeGreaterThan(100);
    await dialog.getByRole('button', { name: 'Restore site to this version', exact: true }).click();
    await expect(dialog).toHaveAccessibleName('Restore site version 1?');
    await expect(dialog.locator('.site-changes > li')).toHaveCount(count);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`site-restore-${width}.png`), fullPage: true });
    await dialog.getByRole('button', { name: 'Confirm site restore', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const restored = (await (await context.request.get('/api/admin/docs/home/home')).json()).doc;
    expect(restored.draft.hero.title).not.toBe(title); expect(restored.draft).toEqual(restored.published);
  });
}

test('audit scrolls through all filtered activity and exports beyond the loaded page', async ({ page, context }) => {
  test.setTimeout(120000); await page.setViewportSize({ width: 390, height: 844 }); await login(page);
  const me = await (await context.request.get('/api/admin/auth/me')).json();
  const headers = { 'X-CSRF-Token': me.csrfToken, Origin: 'http://localhost:3000' };
  const marker = `Audit pages ${randomBytes(5).toString('hex')}`;
  let doc = (await (await context.request.post('/api/admin/docs/events', { headers, data: { draft: { title: marker, date: '2099-06-01' } } })).json()).doc;
  for (let i = 0; i < 35; i++) {
    const response = await context.request.put(`/api/admin/docs/events/${doc.id}`, { headers, data: { baseVersion: doc.version, draft: { ...doc.draft, title: `${marker} ${i}` }, checkpoint: true } });
    expect(response.ok()).toBe(true); doc = (await response.json()).doc;
  }
  await page.goto('/admin/audit');
  await page.getByLabel('Exact action', { exact: true }).fill('content.checkpoint');
  await page.getByLabel('Search activity', { exact: true }).fill(marker);
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  const rows = page.getByRole('list', { name: 'Audit activity' }).getByRole('button');
  await expect(rows).toHaveCount(30);
  // Export uses all matching records, even before the second page is loaded.
  const pending = page.waitForEvent('download'); await page.getByRole('link', { name: 'Export CSV', exact: true }).click();
  const csv = await readFile((await (await pending).path())!, 'utf8');
  expect(csv.trim().split('\r\n')).toHaveLength(36);
  await rows.last().scrollIntoViewIfNeeded();
  await expect(rows).toHaveCount(35);
  const text = await rows.allTextContents(); expect(new Set(text).size).toBe(35);
  await keyboardActivate(page, rows.last());
  const dialog = page.getByRole('dialog', { name: 'Activity details' }); await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
  const metadata = dialog.getByLabel('Audit metadata');
  await expect(close).toBeFocused();
  // Check both wrap boundaries, then repeated forward/backward traversal.
  await page.keyboard.press('Shift+Tab'); await expect(metadata).toBeFocused();
  await page.keyboard.press('Tab'); await expect(close).toBeFocused();
  for (const key of ['Tab', 'Shift+Tab']) for (let i = 0; i < 12; i++) {
    await page.keyboard.press(key);
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape'); await expect(rows.last()).toBeFocused();
});
