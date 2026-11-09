import { test, expect } from './fixtures.js';
import { adminPassword } from './credentials.js';

test('loads page data beside session validation and reuses the session across navigation', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('Username', { exact: true }).fill('Phil');
  await page.getByLabel('Password', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Good .*Phil/ })).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const meRequests: string[] = [];
  let listStarted = false;
  await page.route('**/api/admin/auth/me', async route => { meRequests.push(route.request().url()); await held; await route.continue(); });
  page.on('request', req => { if (req.url().includes('/api/admin/docs/events?trashed=1')) listStarted = true; });
  await page.goto('/admin/events', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => listStarted).toBe(true); // auth is deliberately still pending
  release();
  await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
  const prefetched = page.waitForResponse(response => response.url().includes('/api/admin/docs/boardMembers?trashed=1') && response.ok());
  await page.getByRole('link', { name: 'Board members', exact: true }).filter({ visible: true }).hover();
  await (await prefetched).finished();
  let releaseRefresh!: () => void;
  const refreshHeld = new Promise<void>(resolve => { releaseRefresh = resolve; });
  await page.route('**/api/admin/docs/boardMembers?trashed=1', async route => { await refreshHeld; await route.continue(); });
  try {
    await page.getByRole('link', { name: 'Board members', exact: true }).filter({ visible: true }).click();
    await expect(page.getByRole('heading', { name: 'Board members', exact: true })).toBeVisible();
    await expect(page.locator('.content-row').first()).toBeVisible(); // Cached rows render while refresh is held.
  } finally { releaseRefresh(); }
  await page.getByRole('link', { name: 'Events', exact: true }).filter({ visible: true }).click();
  await expect(page.locator('.content-row').first()).toBeVisible();
  expect(meRequests).toHaveLength(1);
});

test('sends immutable hashed assets and no-store shell with request timing', async ({ request }) => {
  const shell = await request.get('/admin');
  expect(shell.headers()['cache-control']).toContain('no-store');
  const html = await shell.text();
  const asset = html.match(/(?:src|href)="(\/admin\/assets\/[^\"]+)"/)?.[1];
  expect(asset).toBeTruthy();
  expect((await request.get(asset!)).headers()['cache-control']).toContain('immutable');
  const response = await request.get('/api/admin/healthz');
  expect(response.headers()['server-timing']).toContain('db_count;desc="0"');
});
