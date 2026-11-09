import type { Page, BrowserContext } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { expect, test, restoreSeed } from './fixtures.js';
import { adminPassword, chrisPassword } from './credentials.js';
import { localDateTime } from '../../admin/src/components/Form/index.js';
import { publishConflictMessage } from '../../admin/src/components/PublishTray.js';

const marker = (prefix: string) => `${prefix} ${randomBytes(5).toString('hex')}`;
async function login(page: Page, username = 'Phil', password = adminPassword) {
  await page.goto('/admin');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening),/ })).toBeVisible();
}
async function writeLead(context: BrowserContext, lead: string) {
  const { csrfToken } = await (await context.request.get('/api/admin/auth/me')).json();
  const { doc } = await (await context.request.get('/api/admin/docs/home/home')).json();
  const response = await context.request.put('/api/admin/docs/home/home', {
    headers: { 'X-CSRF-Token': csrfToken, Origin: 'http://localhost:3000' },
    data: { baseVersion: doc.version, draft: { ...doc.draft, hero: { ...doc.draft.hero, lead } } },
  });
  expect(response.ok()).toBe(true); return (await response.json()).doc;
}
test.afterEach(async ({ context }) => restoreSeed(context));
for (const width of [390, 1280]) {
  test(`inline home lead → pending → publish → live at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 }); await login(page);
    await page.goto('/admin/pages/home');
    await page.locator('#section-hero > summary').click();
    await page.locator('#section-hero').getByLabel('Lead', { exact: true }).focus();
    await expect(page.frameLocator('iframe[title="Draft content preview"]').locator('.hero__lead')).toHaveAttribute('data-preview-focus', 'true');
    await page.getByRole('button', { name: 'Edit on page', exact: true }).click();
    const frame = page.frameLocator('iframe[title="Inline page editor"]');
    const lead = frame.locator('.hero__lead.admin-inline-field'); const text = marker('Inline home lead');
    await lead.click(); await expect(lead).toHaveAttribute('contenteditable', 'plaintext-only');
    await lead.fill(text);
    await page.screenshot({ path: testInfo.outputPath(`inline-${width}.png`), fullPage: true });
    // The bridge autosaves while typing, without a separate submit button.
    await expect.poll(async () => (await (await context.request.get('/api/admin/docs/home/home')).json()).doc.draft.hero.lead).toBe(text);
    await lead.press('Enter'); await expect(lead).not.toHaveAttribute('contenteditable');
    await page.getByRole('button', { name: 'Review & publish', exact: true }).click();
    const tray = page.getByRole('dialog', { name: 'Review & publish' });
    await expect(tray).toContainText(text); await expect(tray.locator('.publish-group').filter({ has: page.getByRole('heading', { name: 'Home', exact: true }) }).getByRole('checkbox')).toBeChecked();
    await tray.getByLabel('Publication note').fill('Home lead updated inline');
    await tray.getByRole('button', { name: /Publish \d+ changes?/ }).click(); await expect(tray).toHaveCount(0);
    const liveLink = page.getByRole('link', { name: 'View live', exact: true }).last();
    await expect(liveLink).toHaveAttribute('href', /\?v=\d+/);
    const live = await context.newPage(); await live.goto((await liveLink.getAttribute('href'))!);
    await expect(live.locator('.hero__lead')).toHaveText(text); await live.close();
    // Rich text keeps the shared normal control in an accessible side popover.
    await frame.locator('.hero__title.admin-inline-field').click();
    const popover = page.getByRole('complementary', { name: 'Edit selected field' });
    await expect(popover.getByRole('button', { name: 'Bold', exact: true })).toBeVisible();
    const title = popover.getByRole('textbox'); const before = await title.inputValue();
    await title.fill('A **club** for everyone'); await popover.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(frame.locator('.hero__title strong')).toHaveText('club');
    // Undo through the same editor before leaving the test's draft clean.
    await frame.locator('.hero__title.admin-inline-field').click(); await popover.getByRole('textbox').fill(before);
    await popover.getByRole('button', { name: 'Done', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('schedule with Pacific date/time stays private until due and settles on admin activity', async ({ page, context }) => {
  test.setTimeout(110000); await login(page); const text = marker('Scheduled home lead');
  await writeLead(context, text); await page.goto('/admin/pages/home');
  await page.getByRole('button', { name: 'Publish options', exact: true }).click();
  await page.getByRole('button', { name: 'Schedule for later', exact: true }).click();
  const tray = page.getByRole('dialog', { name: 'Review & publish' });
  // The native control has minute precision. Choose the next full safe minute.
  const due = new Date(Date.now() + 75000); due.setUTCSeconds(0, 0);
  await tray.getByLabel('Publish date and time (Pacific)').fill(localDateTime(due.toISOString()));
  await tray.getByLabel('Publication note').fill('Scheduled browser acceptance');
  await tray.getByRole('button', { name: /Schedule \d+ changes?/ }).click(); await expect(tray).toHaveCount(0);
  expect(await (await context.request.get('/')).text()).not.toContain(text);
  const { scheduled } = await (await context.request.get('/api/admin/dashboard')).json();
  expect(scheduled.some((s: { at: string }) => Date.parse(s.at) === due.getTime())).toBe(true);
  // Public rendering becomes effective at the boundary even before settlement.
  await expect.poll(async () => (await (await context.request.get('/')).text()).includes(text), { timeout: 85000, intervals: [1000] }).toBe(true);
  await context.request.get('/api/admin/dashboard'); // Editor+ activity lazily settles due items.
  const { scheduled: remaining } = await (await context.request.get('/api/admin/dashboard')).json(); expect(remaining).toHaveLength(0);
  expect(await (await context.request.get('/')).text()).toContain(text);
});

test('concurrent publish explains the 409, refreshes pending changes, and permits a reviewed retry', async ({ page, context, browser }) => {
  await login(page); await writeLead(context, marker('First draft')); await page.goto('/admin/pages/home');
  await page.getByRole('button', { name: 'Review & publish', exact: true }).click();
  const tray = page.getByRole('dialog', { name: 'Review & publish' });
  await expect(tray.locator('.publish-group').filter({ has: page.getByRole('heading', { name: 'Home', exact: true }) }).getByRole('checkbox')).toBeChecked();
  await tray.getByLabel('Publication note').fill('Reviewed after concurrent save');
  const second = await browser.newContext({ baseURL: 'http://localhost:3000' });
  try {
    expect((await second.request.post('/api/admin/auth/login', { data: { username: 'Chris', password: chrisPassword } })).ok()).toBe(true);
    const text = marker('Another editor saved'); await writeLead(second, text);
    const rejected = page.waitForResponse(r => r.url().endsWith('/api/admin/publish') && r.status() === 409);
    await tray.getByRole('button', { name: /Publish \d+ changes?/ }).click(); await rejected;
    await expect(tray.getByRole('alert')).toContainText(publishConflictMessage);
    await expect(tray).toContainText(text); await expect(tray.locator('.publish-group').filter({ has: page.getByRole('heading', { name: 'Home', exact: true }) }).getByRole('checkbox')).not.toBeChecked();
    await expect(tray.getByLabel('Publication note')).toHaveValue('Reviewed after concurrent save');
    await tray.locator('.publish-group').filter({ has: page.getByRole('heading', { name: 'Home', exact: true }) }).getByRole('checkbox').check();
    await tray.getByRole('button', { name: /Publish \d+ changes?/ }).click(); await expect(tray).toHaveCount(0);
    expect(await (await context.request.get('/')).text()).toContain(text);
  } finally { await second.close(); }
});

test('Contributor can preview and request review; Viewer sees a read-only tray', async ({ page, context, browser }) => {
  await login(page);
  const { csrfToken } = await (await context.request.get('/api/admin/auth/me')).json();
  for (const role of ['Contributor', 'Viewer']) {
    const username = `${role}${randomBytes(3).toString('hex')}`, password = randomBytes(24).toString('base64url');
    expect((await context.request.post('/api/admin/users', { headers: { 'X-CSRF-Token': csrfToken, Origin: 'http://localhost:3000' }, data: { username, displayName: role, role, password } })).status()).toBe(201);
    const other = await browser.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const otherPage = await other.newPage(); await login(otherPage, username, password);
      await otherPage.goto('/admin/pages/home');
      await otherPage.getByRole('button', { name: 'Preview', exact: true }).click();
      await expect(otherPage.frameLocator('iframe[title="Draft content preview"]').locator('.hero__lead')).toBeVisible();
      await otherPage.getByRole('button', { name: role === 'Contributor' ? 'Request review' : 'Review changes', exact: true }).first().click();
      const tray = otherPage.getByRole('dialog', { name: 'Review & publish' });
      if (role === 'Contributor') {
        // Make a pending change through that user's ordinary draft endpoint.
        await tray.getByRole('button', { name: 'Keep as draft' }).click(); await writeLead(other, marker('Review this lead'));
        await otherPage.getByRole('button', { name: 'Request review', exact: true }).click();
        await expect(tray.locator('#publish-action option')).toHaveCount(1);
        await tray.getByRole('button', { name: /Request review for \d+/ }).click(); await expect(tray).toHaveCount(0);
      } else {
        await expect(tray).toContainText('Your role can review changes');
        for (const checkbox of await tray.getByRole('checkbox').all()) await expect(checkbox).toBeDisabled();
        await expect(tray.getByLabel('Action', { exact: true })).toHaveCount(0);
      }
    } finally { await other.close(); }
  }
});
