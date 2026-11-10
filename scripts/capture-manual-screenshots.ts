import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import type { Doc } from '../shared/types.js';
import type { CollectionName } from '../shared/schema.js';

const baseURL = 'http://localhost:3000';
const outputDirectory = fileURLToPath(new URL('../docs/images/', import.meta.url));
const screenshotNames = [
  'sign-in', 'dashboard', 'site-settings', 'pages', 'page-editor', 'inline-page-editor',
  'events-list', 'event-editor', 'callout-editor', 'recreational-fees', 'competitive-costs',
  'team-editor', 'result-editor', 'board-member-editor', 'sponsor-editor', 'sponsor-tier-editor',
  'document-editor', 'faq-editor', 'media-library', 'media-details', 'media-focal-point',
  'publish-review', 'publish-schedule', 'review-queue', 'item-history', 'item-restore',
  'site-history', 'site-compare', 'site-restore', 'audit-log', 'users', 'add-user', 'profile',
  'command-palette', 'keyboard-shortcuts', 'product-editor', 'bundle-editor', 'store-settings',
  'phone-dashboard', 'phone-preview', 'phone-media',
] as const;
type ScreenshotName = typeof screenshotNames[number];
type ContentDoc = Doc<Record<string, unknown>>;

async function readJson<T>(context: BrowserContext, path: string): Promise<T> {
  const response = await context.request.get(path);
  if (!response.ok()) throw new Error(`Local prerequisite failed for ${path} (HTTP ${response.status()}).`);
  return await response.json() as T;
}

async function captureManual() {
  const username = process.env.PSC_DOC_USER;
  const password = process.env.PSC_DOC_PASSWORD;
  if (!username || !password) throw new Error('Set PSC_DOC_USER and PSC_DOC_PASSWORD for a local Owner account. No screenshots were captured.');
  if (process.env.STORE_DRIVER && process.env.STORE_DRIVER !== 'fs') throw new Error('Use STORE_DRIVER=fs and a local practice server for manual screenshots.');
  if (process.env.NODE_ENV === 'production') throw new Error('Run manual capture in a local development environment.');

  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  context.setDefaultTimeout(20000);
  const page = await context.newPage();
  let signedIn = false;
  let csrfToken: string | undefined;
  const captured = new Set<ScreenshotName>();

  async function go(path: string, heading?: string | RegExp) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    if (new URL(page.url()).origin !== baseURL) throw new Error('Use npm run start on port 3000. The hot-reload admin redirects to port 5173.');
    if (heading) await expect(page.getByRole('heading', { level: 1, name: heading, exact: typeof heading === 'string' })).toBeVisible();
  }
  async function shot(name: ScreenshotName) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => Array.from(document.images).filter(img => {
      const box = img.getBoundingClientRect();
      return box.bottom > 0 && box.top < innerHeight && box.width > 0;
    }).every(img => img.complete));
    await page.screenshot({ path: `${outputDirectory}${name}.png`, animations: 'disabled', fullPage: false });
    captured.add(name);
    console.log(`Captured docs/images/${name}.png`);
  }
  async function readyDashboard() {
    await expect(page.locator('.stats-grid .stat-card strong')).toHaveText([/\d+/, /\d+/, /\d+/]);
    await expect(page.getByRole('heading', { name: 'Site health', exact: true })).toBeVisible();
    await expect(page.getByText('Checking site health…', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Loading recent activity…', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Loading review requests…', { exact: true })).toHaveCount(0);
  }
  async function editor(path: string) {
    await go(path);
    await expect(page.locator('.editor-form')).toBeVisible();
    await expect(page.locator('.editor-form input, .editor-form textarea, .editor-form summary').first()).toBeVisible();
  }
  async function firstDoc(collection: CollectionName): Promise<ContentDoc> {
    const { docs } = await readJson<{ docs: ContentDoc[] }>(context, `/api/admin/docs/${collection}`);
    const doc = docs.find(item => !item.trashedAt);
    if (!doc) throw new Error(`Seed a practice store first. No active ${collection} record is available.`);
    return doc;
  }
  async function collectionEditor(collection: CollectionName, name: ScreenshotName) {
    const doc = await firstDoc(collection);
    await editor(`/admin/${collection}/${encodeURIComponent(doc.id)}`);
    await shot(name);
  }
  async function section(path: string, id: string, name: ScreenshotName) {
    await editor(path);
    const accordion = page.locator(`#section-${id}`);
    await expect(accordion).toBeVisible();
    if (!await accordion.evaluate(element => (element as HTMLDetailsElement).open)) await accordion.locator(':scope > summary').click();
    await accordion.scrollIntoViewIfNeeded();
    await shot(name);
  }

  try {
    await mkdir(outputDirectory, { recursive: true });
    await go('/admin/login', 'Welcome back.');
    await shot('sign-in'); // Capture before filling either credential field.
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill(username);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
    const loginResponse = page.waitForResponse(response => response.url().endsWith('/api/admin/auth/login') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    if (!(await loginResponse).ok()) throw new Error('Local sign-in failed. Check the supplied credentials and any lockout timer.');
    signedIn = true;
    const me = await readJson<{ user: { role: string; mustChangePassword?: boolean }; csrfToken: string }>(context, '/api/admin/auth/me');
    csrfToken = me.csrfToken;
    if (me.user.role !== 'Owner' || me.user.mustChangePassword) throw new Error('Use a local Owner account that has already completed any required password change.');
    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening),/ })).toBeVisible();
    await readyDashboard();
    await shot('dashboard');
    await page.locator('#awaiting-review').scrollIntoViewIfNeeded();
    await expect(page.getByText('Loading review requests…', { exact: true })).toHaveCount(0);
    await shot('review-queue');

    await section('/admin/settings', 'utilityBar', 'site-settings');
    await go('/admin/pages', 'Pages');
    await expect(page.locator('.page-card').first()).toBeVisible();
    await shot('pages');
    await section('/admin/pages/home', 'hero', 'page-editor');
    await page.getByRole('button', { name: 'Edit on page', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Back to form', exact: true })).toBeVisible();
    await expect(page.frameLocator('iframe[title="Inline page editor"]').locator('[data-edit]').first()).toBeVisible();
    await shot('inline-page-editor');
    await page.getByRole('button', { name: 'Back to form', exact: true }).click();

    await go('/admin/events', 'Events');
    await expect(page.locator('.content-row').first()).toBeVisible();
    await shot('events-list');
    await editor('/admin/events/new');
    await expect(page.getByRole('button', { name: 'Create event', exact: true }).first()).toBeVisible();
    await shot('event-editor');
    for (const [collection, name] of [
      ['callouts', 'callout-editor'], ['teams', 'team-editor'], ['results', 'result-editor'],
      ['boardMembers', 'board-member-editor'], ['sponsors', 'sponsor-editor'],
      ['sponsorTiers', 'sponsor-tier-editor'], ['documents', 'document-editor'], ['faqs', 'faq-editor'],
      ['products', 'product-editor'], ['bundles', 'bundle-editor'],
    ] as const) await collectionEditor(collection, name);
    await section('/admin/pages/recreational', 'fees', 'recreational-fees');
    await section('/admin/pages/competitive', 'costs', 'competitive-costs');
    await editor('/admin/store/settings');
    await expect(page.getByText('Checkout: disabled by deployment (proof of concept)', { exact: true })).toBeVisible();
    await shot('store-settings');

    await go('/admin/media', 'Media');
    await expect(page.locator('.media-card').first()).toBeVisible();
    await shot('media-library');
    const { docs: media } = await readJson<{ docs: ContentDoc[] }>(context, '/api/admin/media');
    const image = media.find(doc => String(doc.draft.mime).startsWith('image/') && !doc.trashedAt);
    if (!image) throw new Error('Register the practice store media with npm run seed:media.');
    await go(`/admin/media/${encodeURIComponent(image.id)}`, 'Media');
    const details = page.getByRole('dialog', { name: 'Media details', exact: true });
    await expect(details.getByRole('textbox', { name: 'Default alternative text', exact: true })).toBeVisible();
    await shot('media-details');
    await details.locator('.focal-picker').scrollIntoViewIfNeeded();
    await shot('media-focal-point');
    await details.getByRole('button', { name: 'Close dialog', exact: true }).click();

    await go('/admin', /Good (morning|afternoon|evening),/);
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    const tray = page.getByRole('dialog', { name: 'Review & publish', exact: true });
    await expect(tray.getByRole('combobox', { name: 'Action', exact: true })).toBeEnabled();
    await expect(tray.getByText('Loading saved changes…', { exact: true })).toHaveCount(0);
    await shot('publish-review');
    await tray.getByRole('combobox', { name: 'Action', exact: true }).selectOption('schedule');
    await expect(tray.getByLabel('Publish date and time (Pacific)', { exact: true })).toBeVisible();
    await shot('publish-schedule');
    await tray.getByRole('button', { name: 'Keep as draft', exact: true }).click();

    const event = await firstDoc('events');
    await editor(`/admin/events/${encodeURIComponent(event.id)}?panel=history`);
    await expect(page.locator('.timeline-entry').first()).toBeVisible();
    await page.locator('.timeline-entry').first().click();
    await expect(page.getByRole('button', { name: 'Restore this revision', exact: true })).toBeVisible();
    await shot('item-history');
    await page.getByRole('button', { name: 'Restore this revision', exact: true }).click();
    const restoreItem = page.getByRole('dialog', { name: 'Restore this revision?', exact: true });
    await expect(restoreItem).toBeVisible();
    await shot('item-restore');
    await restoreItem.getByRole('button', { name: 'Cancel', exact: true }).click();
    await go('/admin/history', 'History');
    await expect(page.locator('.version-list > li').first()).toBeVisible();
    await shot('site-history');
    await page.getByRole('button', { name: /Compare with current site version/ }).first().click();
    await expect(page.getByRole('dialog', { name: /^Compare site version/ })).toBeVisible();
    await shot('site-compare');
    await page.getByRole('button', { name: 'Restore site to this version', exact: true }).click();
    const restoreSite = page.getByRole('dialog', { name: /^Restore site version/ });
    await expect(restoreSite.getByRole('button', { name: 'Confirm site restore', exact: true })).toBeVisible();
    await shot('site-restore');
    await restoreSite.getByRole('button', { name: 'Cancel', exact: true }).click();

    await go('/admin/audit', 'Audit log');
    await expect(page.locator('.audit-row').first()).toBeVisible();
    await shot('audit-log');
    await go('/admin/users', 'Users');
    await expect(page.locator('.account-row').first()).toBeVisible();
    await shot('users');
    await page.getByRole('button', { name: 'Add user', exact: true }).click();
    const addUser = page.getByRole('dialog', { name: 'Add user', exact: true });
    await expect(addUser).toBeVisible();
    await shot('add-user');
    await addUser.getByRole('button', { name: 'Cancel', exact: true }).click();
    await go('/admin/profile', 'Profile');
    await expect(page.getByText('Loading sessions…', { exact: true })).toHaveCount(0);
    await shot('profile');
    await page.getByRole('button', { name: 'Open command palette', exact: true }).click();
    const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
    await expect(palette.getByRole('combobox')).toBeVisible();
    await shot('command-palette');
    await palette.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true })).toBeVisible();
    await shot('keyboard-shortcuts');
    await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click();

    await page.setViewportSize({ width: 390, height: 800 });
    await go('/admin', /Good (morning|afternoon|evening),/);
    await readyDashboard();
    await expect(page.getByRole('navigation', { name: 'Mobile navigation', exact: true })).toBeVisible();
    await shot('phone-dashboard');
    await editor('/admin/pages/home');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Phone', exact: true })).toBeVisible();
    await expect(page.frameLocator('iframe[title="Draft content preview"]').locator('main')).toBeVisible();
    await page.locator('.preview-panel').scrollIntoViewIfNeeded();
    await shot('phone-preview');
    await go('/admin/media', 'Media');
    await expect(page.locator('.media-card').first()).toBeVisible();
    await shot('phone-media');
    const missing = screenshotNames.filter(name => !captured.has(name));
    if (missing.length) throw new Error(`Missing screenshots: ${missing.join(', ')}`);
    console.log(`Captured all ${captured.size} manual screenshots. Review PNGs before sharing.`);
  } finally {
    // Revoke only the session this capture created. Never save storage state or credentials.
    try {
      if (signedIn && csrfToken) {
        const response = await context.request.post('/api/admin/auth/logout', { headers: { Origin: baseURL, 'X-CSRF-Token': csrfToken } });
        if (!response.ok()) console.error('Capture logout failed. Revoke the capture session through Profile.');
      }
    } finally { await browser.close(); }
  }
}

if (process.argv.includes('--list')) {
  console.log(screenshotNames.map(name => `docs/images/${name}.png${name.startsWith('phone-') ? ' (390×800)' : ' (1280×800)'}`).join('\n'));
} else {
  await captureManual().catch(error => {
    // Avoid dumping request objects, page contents, passwords or session data.
    console.error(error instanceof Error ? error.message.replaceAll(process.env.PSC_DOC_PASSWORD ?? '\0', '[redacted]') : 'Manual capture failed.');
    process.exitCode = 1;
  });
}
