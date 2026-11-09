import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, restoreSeed } from './fixtures.js';
import { adminPassword } from './credentials.js';

test.afterEach(async ({ context }) => restoreSeed(context));
async function login(page: Page) {
  await page.goto('/admin'); await page.getByLabel('Username', { exact: true }).fill('Phil');
  await page.getByLabel('Password', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening),/ })).toBeVisible();
}
async function publishOnly(page: Page, id: string) {
  const title = await page.getByRole('heading', { level: 1 }).innerText();
  await page.getByRole('button', { name: 'Review & publish', exact: true }).click();
  const tray = page.getByRole('dialog', { name: 'Review & publish', exact: true });
  const item = tray.locator('.publish-item').filter({ has: page.getByText(title, { exact: true }) });
  await expect(item).toBeVisible();
  await tray.getByRole('button', { name: 'Deselect all', exact: true }).click();
  await item.getByRole('checkbox').check();
  await tray.getByRole('button', { name: 'Publish 1 change', exact: true }).click(); await expect(tray).toHaveCount(0);
  const saved = (await (await page.request.get(`/api/admin/pending`)).json()).docs;
  expect(saved.some((doc: { id: string }) => doc.id === id)).toBe(false);
}
for (const width of [390, 1280]) test(`media JPEG, focal point, sponsor, usage refusal and uploaded PDF at ${width}px`, async ({ page, context }, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width, height: 900 }); await login(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/admin/media');
  // Existing site and store images are selectable before any upload.
  await expect(page.getByRole('button', { name: 'Details for hero.webp', exact: true })).toBeVisible();
  await page.getByLabel('Search media').fill('hoodie');
  await expect(page.locator('.media-card')).toHaveCount(1); await page.getByLabel('Search media').clear();
  // Real browser JPEG encoding gives an input wider than the 2000px limit.
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2600; canvas.height = 1300;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#0B2A5B'; ctx.fillRect(0, 0, 2600, 1300); ctx.fillStyle = '#F2B705'; ctx.fillRect(900, 100, 600, 1000);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  const filename = `club-${randomBytes(4).toString('hex')}.jpg`;
  const finalized = page.waitForResponse(response => response.url().endsWith('/api/admin/media') && response.request().method() === 'POST');
  await page.getByLabel('Upload files', { exact: true }).setInputFiles({ name: filename, mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
  const result = await finalized; expect(result.status()).toBe(201); const { doc } = await result.json();
  expect(doc.draft.width).toBe(2000); expect(doc.draft.height).toBe(1000); expect(doc.draft.variants.web).toMatch(/\/web.webp$/);
  const variant = await context.request.get(doc.draft.variants.web); expect(variant.headers()['content-type']).toBe('image/webp');
  expect((await variant.body()).subarray(8, 12).toString()).toBe('WEBP');
  const healthBefore = await (await context.request.get('/api/admin/dashboard?section=health')).json();
  expect(healthBefore.health.some((item: { id: string }) => item.id === doc.id)).toBe(true);
  await page.getByLabel('Search media').fill(filename);
  await page.getByRole('button', { name: `Details for ${filename}`, exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Media details', exact: true });
  await details.getByLabel('Default alternative text', { exact: true }).fill('Club colors at the field');
  await details.getByLabel('Caption', { exact: true }).fill('Our local soccer community');
  await details.getByLabel('Horizontal focal position').focus(); await page.keyboard.press('Home');
  await details.getByLabel('Vertical focal position').focus(); await page.keyboard.press('End');
  await details.getByRole('button', { name: 'Save media details', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Media details saved' })).toBeVisible();
  const healthAfter = await (await context.request.get('/api/admin/dashboard?section=health')).json();
  expect(healthAfter.health.some((item: { id: string }) => item.id === doc.id)).toBe(false);
  await details.getByRole('button', { name: 'Close dialog' }).click();
  await page.goto('/admin/sponsors/spo_1');
  await page.getByRole('button', { name: 'Choose image', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose an image' });
  await picker.getByLabel('Search media').fill(filename);
  await picker.getByRole('button', { name: `Select ${filename}`, exact: true }).click();
  await page.getByLabel('Alternative text for this use', { exact: true }).fill('A sponsor supporting youth soccer');
  await publishOnly(page, 'spo_1');
  const live = await context.newPage(); await live.goto('/sponsors');
  const logo = live.getByRole('img', { name: 'A sponsor supporting youth soccer', exact: true });
  await expect(logo).toHaveAttribute('src', doc.draft.variants.web); await expect(logo).toHaveCSS('object-position', '0% 100%');
  await logo.scrollIntoViewIfNeeded();
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 2000)).toBe(true);
  await page.goto(`/admin/media/${doc.id}`);
  await expect(details.locator('.media-usage')).toContainText('logo'); await expect(details.locator('.media-usage a[href="/admin/sponsors/spo_1"]')).toBeVisible();
  const refused = page.waitForResponse(r => r.url().endsWith(`/media/${doc.id}`) && r.request().method() === 'DELETE');
  await details.getByRole('button', { name: 'Delete media', exact: true }).click(); await details.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  expect((await refused).status()).toBe(409); await expect(details.getByRole('alert')).toBeVisible();
  await expect(details.locator('.media-usage a[href="/admin/sponsors/spo_1"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`media-${width}.png`), fullPage: true });
  await details.getByRole('button', { name: 'Close dialog' }).click();
  // Create a document, choose upload mode, upload the PDF in the shared picker.
  await page.goto('/admin/documents/new');
  const title = `Club guide ${randomBytes(4).toString('hex')}`;
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title); await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('club');
  await page.getByRole('combobox', { name: 'Kind', exact: true }).selectOption('pdf'); await page.getByRole('combobox', { name: 'Source type', exact: true }).selectOption('upload');
  await page.getByRole('button', { name: 'Choose file', exact: true }).click();
  const filePicker = page.getByRole('dialog', { name: 'Choose a document' });
  const pdfName = `guide-${randomBytes(4).toString('hex')}.pdf`;
  const pdfResponse = page.waitForResponse(r => r.url().endsWith('/api/admin/media') && r.request().method() === 'POST');
  await filePicker.getByLabel('Upload files', { exact: true }).setInputFiles({ name: pdfName, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF') });
  const pdfDoc = (await (await pdfResponse).json()).doc;
  await filePicker.getByLabel('Search media').fill(pdfName); await filePicker.getByRole('button', { name: `Select ${pdfName}`, exact: true }).click();
  await page.getByRole('button', { name: /^(Save checkpoint|Create document)$/ }).first().click();
  await expect(page).toHaveURL(/\/admin\/documents\/doc_/);
  await expect(page.getByRole('status').filter({ hasText: /^Saved/ })).toBeVisible();
  const documentId = new URL(page.url()).pathname.split('/').at(-1)!;
  await publishOnly(page, documentId);
  await live.goto('/resources'); const link = live.locator('a.doc').filter({ hasText: title });
  await expect(link).toHaveAttribute('href', pdfDoc.draft.variants.original);
  const anonymous = await context.browser()!.newContext();
  const pdf = await anonymous.request.get('http://localhost:3000' + pdfDoc.draft.variants.original);
  expect(pdf.ok()).toBe(true); expect(pdf.headers()['content-type']).toBe('application/pdf'); await anonymous.close();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await live.close(); expect(errors).toEqual([]);
});

test('multi-file drop, replacement and unused deletion keep the media drawer operable', async ({ page, context }) => {
  test.setTimeout(90000); await login(page); await page.goto('/admin/media');
  const suffix = randomBytes(4).toString('hex');
  const data = await page.evaluateHandle(suffix => {
    const transfer = new DataTransfer();
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40;
    const data = atob(canvas.toDataURL('image/png').split(',')[1]);
    const bytes = Uint8Array.from(data, char => char.charCodeAt(0));
    for (const name of [`first-${suffix}.png`, `second-${suffix}.png`]) transfer.items.add(new File([bytes], name, { type: 'image/png' }));
    return transfer;
  }, suffix);
  await page.locator('.media-dropzone').dispatchEvent('drop', { dataTransfer: data }); await data.dispose();
  await expect(page.locator('.upload-job').filter({ hasText: 'Uploaded' })).toHaveCount(2);
  const media = (await (await context.request.get('/api/admin/media')).json()).docs;
  const original = media.find((doc: { draft: { filename: string } }) => doc.draft.filename === `first-${suffix}.png`);
  expect(original).toBeTruthy();
  await page.getByRole('button', { name: `Details for first-${suffix}.png`, exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Media details' });
  await drawer.getByRole('button', { name: 'Replace file', exact: true }).click();
  const replaced = page.waitForResponse(r => r.url().endsWith(`/media/${original.id}/replace`) && r.request().method() === 'POST');
  await drawer.getByLabel('Replacement file', { exact: true }).setInputFiles('public/assets/img/crest-sm.png');
  expect((await replaced).ok()).toBe(true);
  await expect(page.getByRole('status').filter({ hasText: 'Replacement saved as a draft' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Close dialog' })).toBeEnabled();
  const updated = (await (await context.request.get(`/api/admin/media/${original.id}`)).json()).doc;
  expect(updated.id).toBe(original.id); expect(updated.draft.variants.web).not.toBe(original.draft.variants.web);
  await drawer.getByRole('button', { name: 'Delete media', exact: true }).click();
  const deleted = page.waitForResponse(r => r.url().endsWith(`/media/${original.id}`) && r.request().method() === 'DELETE');
  await drawer.getByRole('button', { name: 'Confirm delete', exact: true }).click(); expect((await deleted).ok()).toBe(true);
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Details for second-${suffix}.png`, exact: true })).toBeVisible();
});
