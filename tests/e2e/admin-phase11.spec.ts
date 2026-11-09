import { randomBytes } from 'node:crypto';
import type { Page, Locator } from '@playwright/test';
import { test, expect, restoreSeed } from './fixtures.js';
import { adminPassword } from './credentials.js';
async function signIn(page: Page, username: string, password: string) {
  await page.goto('/admin');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
}
async function requestReview(page: Page, title: string) {
  await page.getByRole('button', { name: 'Request review', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review & publish', exact: true });
  await dialog.getByRole('button', { name: 'Deselect all', exact: true }).click();
  await dialog.getByRole('checkbox', { name: new RegExp(title) }).check();
  await dialog.getByRole('button', { name: 'Request review for 1', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
test.afterEach(async ({ context }) => restoreSeed(context));
for (const width of [390, 1280]) test(`users and contributor review lifecycle ${width}px`, async ({ page, context, browser }, info) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width, height: 900 });
  await signIn(page, 'Phil', adminPassword);
  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'Add user', exact: true }).click();
  const username = `writer_${randomBytes(5).toString('hex')}`;
  const create = page.getByRole('dialog', { name: 'Add user', exact: true });
  await create.getByRole('textbox', { name: 'Display name', exact: true }).fill('Review contributor');
  await create.getByRole('textbox', { name: 'Username', exact: true }).fill(username);
  await create.getByRole('combobox', { name: 'Role', exact: true }).selectOption('Contributor');
  await create.getByRole('button', { name: 'Create user', exact: true }).click();
  const password = await page.getByRole('textbox', { name: `Temporary password for ${username}`, exact: true }).inputValue();
  await page.getByRole('button', { name: 'I have saved the password', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`users-${width}.png`), fullPage: true });
  const contributorContext = await browser.newContext({ viewport: { width, height: 900 }, baseURL: 'http://localhost:3000' });
  try {
    const contributor = await contributorContext.newPage();
    await signIn(contributor, username, password);
    await contributor.goto('/admin/events/new');
    const title = `Review event ${randomBytes(5).toString('hex')}`;
    await contributor.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
    await contributor.getByRole('textbox', { name: 'Date', exact: true }).fill('2099-06-12');
    await contributor.getByRole('button', { name: 'Create event', exact: true }).first().click();
    await expect(contributor).toHaveURL(/\/events\/evt_/);
    const editorUrl = contributor.url();
    await expect(contributor.getByRole('button', { name: 'Review & publish', exact: true })).toHaveCount(0);
    await expect(contributor.getByRole('button', { name: 'Publish now', exact: true })).toHaveCount(0);
    const me = await (await contributorContext.request.get('/api/admin/auth/me')).json();
    const denied = await contributorContext.request.post('/api/admin/publish', { headers: { 'X-CSRF-Token': me.csrfToken, Origin: 'http://localhost:3000' }, data: { all: true } });
    expect(denied.status()).toBe(403);
    await requestReview(contributor, title);
    await page.goto('/admin');
    await expect(page.getByRole('link', { name: /Awaiting review/ })).toBeVisible();
    await page.getByRole('button', { name: `Review ${title}`, exact: true }).click();
    await page.getByRole('button', { name: 'Approve and publish', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await (await context.request.get('/')).text()).toContain(title);
    await contributor.goto(editorUrl);
    await contributor.getByRole('textbox', { name: 'Location', exact: true }).fill('Club fields');
    await requestReview(contributor, title);
    await page.reload();
    await page.getByRole('button', { name: `Review ${title}`, exact: true }).click();
    await page.getByRole('textbox', { name: 'Return note (required to return)', exact: true }).fill('Please confirm the field number.');
    await page.getByRole('button', { name: 'Return with note', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await contributor.reload();
    await expect(contributor.getByRole('region', { name: 'Review returned' })).toContainText('Please confirm the field number.');
    await contributor.goto('/admin/profile');
    await expect(contributor.getByRole('heading', { name: 'Active sessions' })).toBeVisible();
    await expect(contributor.getByText('This session', { exact: true })).toBeVisible();
    await expect(contributor.getByText('Password changes are optional.', { exact: false })).toBeVisible();
  } finally { await contributorContext.close(); }
});

test('Admin role ceiling and audited account controls', async ({ page, context, browser }) => {
  await signIn(page, 'Phil', adminPassword);
  const me = await (await context.request.get('/api/admin/auth/me')).json();
  const suffix = randomBytes(4).toString('hex');
  const headers = { 'X-CSRF-Token': me.csrfToken, Origin: 'http://localhost:3000' };
  const admin = await (await context.request.post('/api/admin/users', { headers, data: { username: `admin_${suffix}`, role: 'Admin' } })).json();
  const child = await (await context.request.post('/api/admin/users', { headers, data: { username: `child_${suffix}`, displayName: `Child ${suffix}`, role: 'Contributor' } })).json();
  const ctx = await browser.newContext({ baseURL: 'http://localhost:3000' });
  try {
    const adminPage = await ctx.newPage(); await signIn(adminPage, admin.user.username, admin.temporaryPassword);
    await adminPage.goto('/admin/users'); await adminPage.getByRole('button', { name: 'Add user', exact: true }).click();
    const dialog = adminPage.getByRole('dialog');
    await expect(dialog.getByRole('option', { name: 'Owner', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('option', { name: 'Admin', exact: true })).toHaveCount(0);
    const adminMe = await (await ctx.request.get('/api/admin/auth/me')).json();
    expect((await ctx.request.post('/api/admin/users', { headers: { ...headers, 'X-CSRF-Token': adminMe.csrfToken }, data: { username: `forbidden_${suffix}`, role: 'Owner' } })).status()).toBe(403);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const row = adminPage.locator('li.account-row').filter({ hasText: `Child ${suffix}` });
    await row.getByRole('button', { name: 'Reset password', exact: true }).click();
    await adminPage.getByRole('button', { name: 'Confirm', exact: true }).click();
    const newPassword = await adminPage.getByRole('textbox', { name: `Temporary password for ${child.user.username}` }).inputValue();
    expect(newPassword).not.toBe(child.temporaryPassword);
    await adminPage.getByRole('button', { name: 'I have saved the password', exact: true }).click();
    await row.getByRole('button', { name: 'Deactivate', exact: true }).click();
    await adminPage.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(row.getByText('Inactive', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Reactivate', exact: true }).click();
    await adminPage.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(row.getByText('Active', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Sign out everywhere', exact: true }).click();
    await adminPage.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(adminPage.getByRole('dialog')).toHaveCount(0);
  } finally { await ctx.close(); }
});

test('command palette publishes all and exposes keyboard navigation', async ({ page, context }) => {
  await signIn(page, 'Phil', adminPassword);
  const title = `Palette event ${randomBytes(4).toString('hex')}`;
  await page.goto('/admin/events/new');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Date', exact: true }).fill('2099-07-01');
  await page.getByRole('button', { name: 'Create event', exact: true }).first().click();
  await expect(page).toHaveURL(/\/events\/evt_/);
  await page.getByRole('textbox', { name: 'Location', exact: true }).fill('Palette club fields');
  await page.keyboard.press('Meta+k');
  let palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  const combo = palette.getByRole('combobox', { name: 'Search commands and documents' });
  await expect(combo).toBeFocused(); await combo.fill('Publish all');
  await expect(palette.getByRole('option', { name: /Publish all/ })).toHaveAttribute('aria-selected', 'true');
  const published = page.waitForResponse(r => r.url().endsWith('/api/admin/publish') && r.request().method() === 'POST');
  await page.keyboard.press('Enter'); expect((await published).status()).toBe(200);
  await expect(palette).toHaveCount(0);
  expect(await (await context.request.get('/')).text()).toContain(title);
  await page.keyboard.press('Control+k');
  palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await palette.getByRole('combobox').fill(title);
  await expect(palette.getByRole('option', { name: new RegExp(title) })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(palette).toHaveCount(0);
  await page.getByRole('heading', { name: title, exact: true }).click();
  await page.keyboard.press('?'); await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
});
async function focusWithTab(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let i = 0; i < 220; i++) { if (await target.evaluate(e => e === document.activeElement)) return; await page.keyboard.press('Tab'); }
  throw new Error('Control could not be reached by keyboard');
}
test('Users add form is usable entirely by keyboard at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/admin');
  for (const [name, value] of [['Username', 'Phil'], ['Password', adminPassword]]) {
    const field = page.getByLabel(name, { exact: true }); await focusWithTab(page, field); await page.keyboard.type(value);
  }
  await focusWithTab(page, page.getByRole('button', { name: 'Sign in', exact: true })); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  // A person sees the palette before typing; wait until its search box has focus.
  await expect(page.getByRole('combobox', { name: 'Search commands and documents' })).toBeFocused();
  await page.keyboard.type('Users'); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  await focusWithTab(page, page.getByRole('button', { name: 'Add user', exact: true })); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add user', exact: true });
  for (const [name, value] of [['Display name', 'Keyboard contributor'], ['Username', `keys_${randomBytes(4).toString('hex')}`]]) {
    await focusWithTab(page, dialog.getByRole('textbox', { name, exact: true })); await page.keyboard.type(value);
  }
  await focusWithTab(page, dialog.getByRole('button', { name: 'Create user', exact: true })); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Temporary password', exact: true })).toBeVisible();
  await focusWithTab(page, page.getByRole('button', { name: 'I have saved the password', exact: true })); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('presence, adjacent-item shortcuts, health fix links and snapshot rebuild', async ({ page, context, browser }) => {
  await signIn(page, 'Phil', adminPassword);
  const me = await (await context.request.get('/api/admin/auth/me')).json();
  const headers = { 'X-CSRF-Token': me.csrfToken, Origin: 'http://localhost:3000' };
  const suffix = randomBytes(4).toString('hex');
  const docs = [];
  // A run-unique past date keeps the two events adjacent regardless of what earlier specs left behind.
  const uniqueDate = `1901-${String(1 + (parseInt(suffix.slice(0, 2), 16) % 12)).padStart(2, '0')}-${String(1 + (parseInt(suffix.slice(2, 4), 16) % 28)).padStart(2, '0')}`;
  for (const title of [`Adjacent A ${suffix}`, `Adjacent B ${suffix}`]) {
    const result = await context.request.post('/api/admin/docs/events', { headers, data: { draft: { title, date: uniqueDate } } });
    expect(result.status()).toBe(201); docs.push((await result.json()).doc);
  }
  const other = await (await context.request.post('/api/admin/users', { headers, data: { username: `presence_${suffix}`, displayName: `Other editor ${suffix}`, role: 'Editor' } })).json();
  await page.goto(`/admin/events/${docs[0].id}`);
  await expect(page.getByText('No other editors seen on this server.', { exact: true })).toBeVisible();
  const ctx = await browser.newContext({ baseURL: 'http://localhost:3000' });
  try {
    const otherPage = await ctx.newPage(); await signIn(otherPage, other.user.username, other.temporaryPassword);
    await otherPage.goto(`/admin/events/${docs[0].id}`);
    await expect(otherPage.getByText('Also editing: Phil', { exact: true })).toBeVisible();
    // Brackets do not intercept typing, then navigate after the field is saved.
    const location = page.getByRole('textbox', { name: 'Location', exact: true });
    await location.fill('Fields'); await location.press(']'); await expect(location).toHaveValue('Fields]');
    await page.getByRole('heading', { name: docs[0].draft.title, exact: true }).click();
    await page.keyboard.press(']'); await expect(page).toHaveURL(new RegExp(`/events/${docs[1].id}$`));
    await page.keyboard.press('['); await expect(page).toHaveURL(new RegExp(`/events/${docs[0].id}$`));
    await page.goto('/admin');
    const finding = page.locator('.health-list li').filter({ hasText: `Past event: ${docs[0].draft.title}` });
    await finding.getByRole('link', { name: 'Review item' }).click();
    await expect(page).toHaveURL(new RegExp(`/events/${docs[0].id}#field-date$`));
    await expect(page.getByRole('textbox', { name: 'Date', exact: true })).toBeFocused();
    await page.goto('/admin'); await page.getByRole('button', { name: 'Rebuild snapshot', exact: true }).click();
    const rebuilding = page.waitForResponse(r => r.url().endsWith('/api/admin/rebuild') && r.request().method() === 'POST');
    await page.getByRole('dialog').getByRole('button', { name: 'Rebuild snapshot', exact: true }).click();
    expect((await rebuilding).status()).toBe(200); await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally { await ctx.close(); }
});
