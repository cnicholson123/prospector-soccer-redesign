import { afterEach, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { adminFixture } from '../helpers/admin.js';
import { generatedPassword } from '../helpers/password.js';
import { createRenderHandler } from '../../server/render/handler.js';
import { pageNames } from '../../shared/schema.js';
import { editPath } from '../../shared/edit-path.js';
import type { Doc } from '../../shared/types.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const item = (doc: Doc) => ({ collection: doc.collection, id: doc.id, expectedVersion: doc.version });
it('keeps inline saves in normal revisions/audit, guards publication, and schedules frozen content with notes on FS', async () => {
  const f = await adminFixture(true); roots.push(f.root); await f.login();
  let now = new Date('2030-01-01T12:00:00Z'); const render = createRenderHandler(f.store, f.config, () => now);
  const publicPage = () => render(new Request('http://localhost:3000/'));
  const original = (await f.store.getDoc('home', 'home'))!;
  const draft = structuredClone(original.draft) as { hero: { lead: string } }; draft.hero.lead = 'Inline home lead';
  const saved = await f.req('/docs/home/home', 'PUT', { baseVersion: original.version, draft });
  expect(saved.status).toBe(200); let doc = (await saved.json()).doc;
  expect((await (await f.req('/pending')).json()).docs.find((d: Doc) => d.id === 'home').diff).toContainEqual(expect.objectContaining({ path: 'hero.lead', after: 'Inline home lead' }));
  const revisions = await f.store.listRevisions('home', 'home', 10); expect(revisions[0].data).toEqual(draft);
  expect((await f.store.queryAudit({ collection: 'home', docId: 'home', limit: 10 })).items.some(row => row.action === 'content.edited')).toBe(true);
  expect(await (await publicPage()).text()).not.toContain('Inline home lead');
  const privatePage = await render(new Request('http://localhost:3000/?edit=1', { headers: { Cookie: f.getCookie() } }));
  expect(privatePage.headers.get('cache-control')).toBe('no-store');
  expect(privatePage.headers.get('content-security-policy')).toContain("script-src 'self'");
  expect(privatePage.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
  expect(privatePage.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  expect(await privatePage.text()).toContain('/assets/js/admin-inline.js');
  expect((await render(new Request('http://localhost:3000/?edit=1'))).status).toBe(401);
  // Another writer changes the exact version selected in the tray.
  const next = structuredClone(draft); next.hero.lead = 'Concurrent home lead';
  const changed = (await (await f.req('/docs/home/home', 'PUT', { baseVersion: doc.version, draft: next })).json()).doc;
  const conflict = await f.req('/publish', 'POST', { items: [item(doc)] }); expect(conflict.status).toBe(409);
  expect(await (await publicPage()).text()).not.toContain('Concurrent home lead');
  const refreshed = (await (await f.req('/pending')).json()).docs.find((d: Doc) => d.id === 'home');
  expect(refreshed.version).toBe(changed.version);
  const published = await f.req('/publish', 'POST', { items: [item(refreshed)], summary: 'Reviewed concurrent edit' }); expect(published.status).toBe(200);
  const version = (await published.json()).siteVersion;
  const live = await render(new Request(`http://localhost:3000/?v=${version}`));
  expect(await live.text()).toContain('Concurrent home lead');
  doc = (await f.store.getDoc('home', 'home'))!;
  const scheduledDraft = structuredClone(next); scheduledDraft.hero.lead = 'Scheduled home lead';
  doc = (await (await f.req('/docs/home/home', 'PUT', { baseVersion: doc.version, draft: scheduledDraft })).json()).doc;
  const scheduled = await f.req('/schedule', 'POST', { items: [item(doc)], at: '2030-01-01T13:00:00Z', summary: 'Morning update Pacific' });
  expect(scheduled.status).toBe(200);
  const scheduleVersion = (await scheduled.json()).siteVersion;
  expect((await f.store.getPublish(scheduleVersion))?.summary).toBe('Morning update Pacific');
  expect((await f.store.listRevisions('home', 'home', 10)).some(rev => rev.action === 'scheduled' && rev.summary === 'Morning update Pacific')).toBe(true);
  expect(await (await publicPage()).text()).not.toContain('Scheduled home lead');
  now = new Date('2030-01-01T13:00:01Z'); f.clock(now.toISOString());
  expect(await (await publicPage()).text()).toContain('Scheduled home lead'); // render-time correctness before settlement
  const settled = await f.req('/cron/settle', 'POST', undefined, { authorization: 'Bearer test-cron' });
  expect(settled.status).toBe(200);
  expect((await f.store.getSnapshot())?.scheduled).toHaveLength(0);
  expect(await (await publicPage()).text()).toContain('Scheduled home lead');
}, 15000);
it('resolves all real-page annotations and gives Contributors private previews and review without publication', async () => {
  const f = await adminFixture(true); roots.push(f.root); await f.login();
  const render = createRenderHandler(f.store, f.config);
  for (const page of pageNames) {
    const response = await render(new Request(`http://localhost:3000/${page === 'home' ? '' : page}?edit=1`, { headers: { Cookie: f.getCookie() } }));
    const body = await response.text();
    for (const match of body.matchAll(/data-edit="([^"]+)"/g)) {
      const target = JSON.parse(match[1].replaceAll('&quot;', '"'));
      const doc = await f.store.getDoc(target.collection, target.id);
      expect(editPath(target.collection, doc?.draft, target.path), `${page}: ${target.path}`).not.toBeNull();
    }
    const live = await render(new Request(`http://localhost:3000/${page === 'home' ? '' : page}`));
    const liveBody = await live.text(); expect(liveBody).not.toContain('admin-inline'); expect(liveBody).not.toContain('data-edit=');
  }
  const password = generatedPassword();
  const created = await f.req('/users', 'POST', { username: 'Contributor', displayName: 'Contributor', role: 'Contributor', password });
  expect(created.status).toBe(201);
  await f.login('Contributor', password);
  expect((await render(new Request('http://localhost:3000/?preview=1', { headers: { Cookie: f.getCookie() } }))).status).toBe(200);
  const doc = (await f.store.getDoc('home', 'home'))!;
  expect((await f.req('/publish', 'POST', { items: [item(doc)] })).status).toBe(403);
  expect((await f.req('/schedule', 'POST', { items: [item(doc)], at: '2099-01-01T00:00:00Z' })).status).toBe(403);
  const reviewed = await f.req('/docs/home/home/review', 'POST', { baseVersion: doc.version, note: 'Please check the lead' });
  expect(reviewed.status).toBe(200);
  expect((await f.store.getDoc('home', 'home'))?.reviewNote).toBe('Please check the lead');
}, 15000);
