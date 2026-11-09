import { adminPassword } from './credentials';
import { expect, test } from './fixtures';
// Phase 4/5 exercise the HTTP engine and authenticated public preview. The
// actual login/editor screens and keyboard UI flow belong to Phase 7a.
for (const width of [390, 1280]) {
  test(`authenticated content lifecycle and preview at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const api = context.request;
    const login = await api.post('/api/admin/auth/login', { data: { username: 'Phil', password: adminPassword } });
    expect(login.ok()).toBeTruthy();
    const session = await login.json(); expect(session.passwordWeak).toBe(false);
    const headers = { 'X-CSRF-Token': session.csrfToken, Origin: 'http://localhost:3000' };
    const draft = { title: `Engine original ${width}`, date: '2099-01-01', showOnHome: true };
    const created = await api.post('/api/admin/docs/events', { headers, data: { draft } });
    expect(created.status()).toBe(201); let doc = (await created.json()).doc;
    const path = `/api/admin/docs/events/${doc.id}`;
    const checkpoint = await api.put(path, { headers, data: { baseVersion: doc.version, draft, checkpoint: true, summary: 'Original event' } });
    doc = (await checkpoint.json()).doc;
    const history = await (await api.get(`/api/admin/revisions/events/${doc.id}`)).json();
    const originalRevision = history.revisions.find((r: { action: string }) => r.action === 'checkpoint');
    const changed = { ...draft, title: `Engine changed ${width}` };
    doc = (await (await api.put(path, { headers, data: { baseVersion: doc.version, draft: changed } })).json()).doc;
    const stale = await api.put(path, { headers, data: { baseVersion: 1, draft } });
    expect(stale.status()).toBe(409); expect((await stale.json()).error.message).toContain('Reload and compare');
    await page.goto('/?preview=1'); await expect(page.getByText(changed.title, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const published = await api.post('/api/admin/publish', { headers, data: { items: [{ collection: 'events', id: doc.id, expectedVersion: doc.version }] } });
    expect(published.ok()).toBeTruthy();
    await page.goto('/?v=' + (await published.json()).siteVersion); await expect(page.getByText(changed.title, { exact: true })).toBeVisible();
    doc = (await (await api.get(path)).json()).doc;
    const restored = await api.post(`/api/admin/revisions/${originalRevision.id}/restore?docId=${doc.id}`, { headers, data: { baseVersion: doc.version, publish: true } });
    expect(restored.ok()).toBeTruthy();
    await page.goto('/?v=' + (await restored.json()).siteVersion); await expect(page.getByText(draft.title, { exact: true })).toBeVisible();
    expect((await api.post('/api/admin/publishes/1/restore', { headers, data: { summary: 'E2E cleanup and site restore' } })).ok()).toBeTruthy();
    const exportResponse = await api.get('/api/admin/audit/export?format=csv&action=content.publish');
    expect(exportResponse.headers()['content-type']).toContain('text/csv');
    expect(await exportResponse.text()).toContain('content.publish');
    await api.post('/api/admin/auth/logout', { headers });
    expect((await api.get('/?preview=1')).status()).toBe(401);
  });
}
