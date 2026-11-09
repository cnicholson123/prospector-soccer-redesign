import { afterEach, expect, it, vi } from 'vitest';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { adminFixture, createUserWithPassword } from '../helpers/admin.js';
import { generatedPassword } from '../helpers/password.js';
import { createMediaBlobs } from '../../server/store/index.js';
import { createAdminApp } from '../../server/http/hono-app.js';
import { collectIncoming, prepareMedia, readGrant, serveMedia } from '../../server/media.js';
import { SnapshotView } from '../../server/render/snapshot-view.js';
import { loadConfig } from '../../server/config.js';
import { bootstrap } from '../../server/auth/bootstrap.js';
import { hashPassword } from '../../server/auth/password.js';
import type { Config } from '../../server/config.js';
import type { MediaStorage } from '../../server/store/types.js';

const roots: string[] = [];
const now = new Date('2030-01-01T12:00:00Z');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMsAAAAAASUVORK5CYII=', 'base64');
const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(overrides: Partial<Config> = {}) {
  const f = await adminFixture(false, overrides); roots.push(f.root); await f.login(); return f;
}
async function ticket(f: Awaited<ReturnType<typeof fixture>>, blobs: MediaStorage, bytes = png, mime = 'image/png', filename = 'Club picture.png') {
  const response = await f.req('/media/upload-url', 'POST', { filename, mime, size: bytes.length });
  expect(response.status).toBe(200);
  const grant = await response.json(); await blobs.put(grant.pathname, bytes, { contentType: mime }); return grant.ticket as string;
}
async function imageInput(f: Awaited<ReturnType<typeof fixture>>, blobs = createMediaBlobs(f.config, f.store)) {
  return { ticket: await ticket(f, blobs), webTicket: await ticket(f, blobs, webp, 'image/webp'), alt: 'Club picture' };
}
async function files(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(root, entry.name)) : [join(root, entry.name)]))).flat();
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
it('requires generated temporary credentials, gates content, rotates sessions and preserves optional bootstrap changes', async () => {
  const f = await fixture();
  expect((await f.req('/auth/me')).status).toBe(200);
  expect((await f.req('/docs/events')).status).toBe(200);
  expect((await f.req('/users', 'POST', { username: 'Chosen', role: 'Editor', password: generatedPassword() })).status).toBe(422);
  const { user, temporaryPassword } = await (await f.req('/users', 'POST', { username: 'Temporary', role: 'Editor' })).json();
  expect(user.mustChangePassword).toBe(true);
  const login = await f.login('Temporary', temporaryPassword);
  for (const [path, method, body] of [['/docs/events', 'GET', undefined], ['/publish', 'POST', { all: true }], ['/users', 'GET', undefined]] as const) {
    const denied = await f.req(path, method, body); expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe('password_change_required');
  }
  expect((await f.req('/auth/sessions')).status).toBe(200);
  expect((await f.req('/auth/profile', 'PATCH', { displayName: 'Temporary editor', email: 'temp@example.com' })).status).toBe(200);
  const next = generatedPassword(); const changed = await f.req('/auth/password', 'POST', { current: temporaryPassword, next });
  expect(changed.status).toBe(200); expect((await changed.json()).user.mustChangePassword).toBe(false);
  expect((await f.app.request('/api/admin/auth/me', { headers: { Cookie: login.response.headers.get('set-cookie')!.split(';')[0] } })).status).toBe(401);
  await f.login('Temporary', next); expect((await f.req('/docs/events')).status).toBe(200);
  await f.login(); const reset = await f.req(`/users/${user.id}/reset-password`, 'POST');
  expect(reset.status).toBe(200);
  const password = (await reset.json()).temporaryPassword;
  await f.login('Temporary', password); expect((await f.req('/docs/events')).status).toBe(403);
  expect((await f.req('/auth/logout', 'POST')).status).toBe(200);
});
it('allows manager self identity edits and non-manager profiles, blocks self deactivation and audits changed identity fields', async () => {
  const f = await fixture();
  const password = generatedPassword();
  const created = await (await createUserWithPassword(f, { username: 'Manager', role: 'Admin', password })).json();
  await f.login('Manager', password);
  const patch = { username: 'ManagerRenamed', displayName: 'Club administrator', email: 'admin@example.com' };
  expect((await f.req(`/users/${created.user.id}`, 'PATCH', patch)).status).toBe(200);
  expect((await f.req(`/users/${created.user.id}`, 'PATCH', { role: 'Owner' })).status).toBe(403);
  for (const [method, body] of [['DELETE', undefined], ['PATCH', { active: false }]] as const) expect((await f.req(`/users/${created.user.id}`, method, body)).status).toBe(403);
  const owner = (await f.store.getUserByUsername('Phil'))!;
  expect((await f.req(`/users/${owner.id}`, 'PATCH', { displayName: 'Forbidden' })).status).toBe(403);
  const entry = (await f.store.queryAudit({ action: 'users.update', limit: 10 })).items.find(a => a.meta?.userId === created.user.id)!;
  expect(entry.meta?.changes).toEqual({ username: { before: 'Manager', after: patch.username }, displayName: { before: 'Manager', after: patch.displayName }, email: { before: null, after: patch.email } });
  expect(JSON.stringify(entry)).not.toMatch(/password|scrypt\$/);
  await f.login();
  const viewerPassword = generatedPassword(); const viewer = await (await createUserWithPassword(f, { username: 'ViewerProfile', role: 'Viewer', password: viewerPassword })).json();
  await f.login('ViewerProfile', viewerPassword);
  expect((await f.req('/auth/profile', 'PATCH', { displayName: 'New viewer', email: 'viewer@example.com' })).status).toBe(200);
  expect((await f.req('/auth/profile', 'PATCH', { role: 'Owner' })).status).toBe(422);
  expect((await f.req('/auth/profile', 'PATCH', { email: 'invalid' })).status).toBe(422);
  expect((await f.store.getUser(viewer.user.id))?.role).toBe('Viewer');
});
it('seeds hashed accounts only into an empty store and respects renames on a cold app', async () => {
  const hash = await hashPassword(generatedPassword());
  const f = await adminFixture(false, { adminBootstrapUsers: [{ username: 'Initial', displayName: 'Initial', role: 'Owner', passwordHash: hash }] }); roots.push(f.root);
  expect(await bootstrap(f.store, f.config, now)).toBe(true);
  const owner = (await f.store.listUsers())[0]; await f.store.putUser({ ...owner, username: 'Renamed' });
  expect(await bootstrap(f.store, { ...f.config, adminBootstrapUsers: [...f.config.adminBootstrapUsers!, { username: 'Added', displayName: 'Added', role: 'Owner', passwordHash: hash }] }, now)).toBe(false);
  const app = createAdminApp(() => f.store, { config: f.config, now: () => now });
  expect((await app.request('/api/admin/auth/me')).status).toBe(401);
  expect((await f.store.listUsers()).map(u => u.username)).toEqual(['Renamed']);
  expect((await f.store.queryAudit({ action: 'system.bootstrap', limit: 10 })).items).toHaveLength(1);
});
it('requires a nonblank production cron secret and bounds the configurable byte quota', async () => {
  const env = { NODE_ENV: 'production', STORE_DRIVER: 'fs', PUBLIC_BASE_URL: 'https://example.com', SESSION_SECRET: 'x'.repeat(32), ADMIN_BOOTSTRAP_USERS: JSON.stringify([{ username: 'Owner', displayName: 'Owner', role: 'Owner', passwordHash: await hashPassword(generatedPassword()) }]) };
  for (const secret of [undefined, '', '  ']) expect(() => loadConfig({ ...env, CRON_SECRET: secret })).toThrow('CRON_SECRET');
  expect(loadConfig({ ...env, CRON_SECRET: 'test-cron' }).maxUploadBytesPerDay).toBe(256 * 1024 ** 2);
  expect(() => loadConfig({ MAX_UPLOAD_BYTES_PER_DAY: '0' }, () => {})).toThrow('MAX_UPLOAD_BYTES_PER_DAY');
});
it('uses the time-effective media snapshot before and at a schedule deadline without settlement', async () => {
  const f = await fixture(), blobs = createMediaBlobs(f.config, f.store);
  const first = await (await f.req('/media', 'POST', await imageInput(f, blobs))).json();
  expect(first.doc).toBeDefined(); const id = first.doc.id;
  expect((await f.req('/publish', 'POST', { items: [{ collection: 'media', id, expectedVersion: 1 }] })).status).toBe(200);
  const current = (await f.store.getDoc('media', id))!;
  const replaced = await f.req(`/media/${id}/replace`, 'POST', { ...await imageInput(f, blobs), baseVersion: current.version });
  expect(replaced.status).toBe(200); const updated = (await replaced.json()).doc;
  expect((await f.req('/schedule', 'POST', { items: [{ collection: 'media', id, expectedVersion: updated.version }], at: '2030-01-01T12:01:00Z' })).status).toBe(200);
  const snapshot = (await f.store.getSnapshot())!;
  const oldUrl = first.doc.draft.variants.web, newUrl = updated.draft.variants.web;
  for (const [time, live, unavailable] of [[new Date('2030-01-01T12:00:59.999Z'), oldUrl, newUrl], [new Date('2030-01-01T12:01:00Z'), newUrl, oldUrl]] as const) {
    expect(new SnapshotView(snapshot, time).doc('media', id).text('variants.web')).toBe(live);
    const delivered = await serveMedia(new Request('http://localhost:3000' + live), f.store, blobs, time);
    expect(delivered.status).toBe(200); expect(delivered.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=86400');
    expect((await serveMedia(new Request('http://localhost:3000' + unavailable), f.store, blobs, time)).status).toBe(404);
  }
  expect(await f.store.getSnapshot()).toEqual(snapshot); // Delivery does not settle or write.
  const version = (await f.store.getDoc('media', id))!.version;
  expect((await f.req('/unpublish', 'POST', { items: [{ collection: 'media', id, expectedVersion: version }] })).status).toBe(200);
  expect((await serveMedia(new Request('http://localhost:3000' + newUrl), f.store, blobs, new Date('2030-01-01T12:02:00Z'))).status).toBe(404);
});
it('validates metadata before copies, requires web variants, and cleans partial copy and failed commit attempts', async () => {
  const f = await fixture(), blobs = createMediaBlobs(f.config, f.store);
  const app = createAdminApp(() => f.store, { config: f.config, now: () => now, media: blobs });
  const login = await f.login();
  const post = (input: unknown) => app.request('/api/admin/media', { method: 'POST', headers: { Cookie: f.getCookie(), Origin: f.config.publicBaseUrl, 'X-CSRF-Token': login.data.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const input = await imageInput(f, blobs); const put = vi.spyOn(blobs, 'put');
  expect((await post({ ...input, alt: 'a'.repeat(501) })).status).toBe(422); expect(put).not.toHaveBeenCalled();
  expect((await post({ ticket: input.ticket })).status).toBe(422); expect(put).not.toHaveBeenCalled();
  put.mockRestore(); const realPut = blobs.put.bind(blobs);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const failing = vi.spyOn(blobs, 'put').mockImplementation(async (...args) => { const result = await realPut(...args); if (args[0].endsWith('/web.webp')) throw new Error('copy failed after write'); return result; });
  expect((await post(input)).status).toBe(500); expect((await files(join(f.root, 'blobs/media/2030')))).toEqual([]);
  failing.mockRestore();
  const failure = vi.spyOn(f.store, 'createDoc').mockRejectedValueOnce(new Error('commit failed'));
  expect((await post(input)).status).toBe(500); expect((await files(join(f.root, 'blobs/media/2030')))).toEqual([]);
  failure.mockRestore();
  const responses = await Promise.all([post(input), post(input)]); expect(responses.map(r => r.status)).toEqual([201, 201]);
  expect((await f.store.listDocs('media'))).toHaveLength(1);
  expect(await files(join(f.root, 'blobs/media/2030'))).toHaveLength(2);
});
it('cleans a replacement conflict and sends the sanitized original PDF filename', async () => {
  const f = await fixture(), blobs = createMediaBlobs(f.config, f.store);
  const app = createAdminApp(() => f.store, { config: f.config, now: () => now, media: blobs });
  const login = await f.login(); const headers = { Cookie: f.getCookie(), 'X-CSRF-Token': login.data.csrfToken, Origin: f.config.publicBaseUrl, 'Content-Type': 'application/json' };
  const first = await (await f.req('/media', 'POST', await imageInput(f, blobs))).json();
  const pending = await imageInput(f, blobs);
  vi.spyOn(f.store, 'mutateDoc').mockResolvedValueOnce('conflict');
  const response = await app.request(`/api/admin/media/${first.doc.id}/replace`, { method: 'POST', headers, body: JSON.stringify({ ...pending, baseVersion: 1 }) });
  expect(response.status).toBe(409); expect(await files(join(f.root, 'blobs/media/2030'))).toHaveLength(2);
  const pdfTicket = await ticket(f, blobs, Buffer.from('%PDF-1.7\n%%EOF'), 'application/pdf', '../Club "guide".pdf');
  const pdf = (await (await f.req('/media', 'POST', { ticket: pdfTicket })).json()).doc;
  await f.req('/publish', 'POST', { items: [{ collection: 'media', id: pdf.id, expectedVersion: 1 }] });
  const delivered = await serveMedia(new Request('http://localhost:3000' + pdf.draft.variants.original), f.store, blobs, now);
  expect(delivered.headers.get('content-disposition')).toBe('inline; filename="Club _guide_.pdf"');
});
it('reserves daily bytes atomically per user across instances, including both image variants', async () => {
  const f = await fixture({ maxUploadBytesPerDay: 100 });
  const app = createAdminApp(() => f.store, { config: f.config, now: () => now });
  const login = await f.login();
  const options = { method: 'POST', headers: { Cookie: f.getCookie(), 'X-CSRF-Token': login.data.csrfToken, Origin: f.config.publicBaseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'x.webp', mime: 'image/webp', size: 60 }) };
  const responses = await Promise.all([f.app.request('/api/admin/media/upload-url', options), app.request('/api/admin/media/upload-url', options)]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 429]);
  const denied = responses.find(r => r.status === 429)!; expect(Number(denied.headers.get('retry-after'))).toBe(86400);
  f.clock('2030-01-02T12:00:01Z'); expect((await f.req('/media/upload-url', 'POST', { filename: 'x.webp', mime: 'image/webp', size: 60 })).status).toBe(200);
});

it('journals abandoned copies for bounded cleanup and preserves referenced successful uploads', async () => {
  const f = await fixture(), blobs = createMediaBlobs(f.config, f.store);
  const input = await imageInput(f, blobs), owner = (await f.store.getUserByUsername('Phil'))!;
  const prepared = await prepareMedia(f.store, blobs, readGrant(input.ticket, owner.id, f.config, now), readGrant(input.webTicket, owner.id, f.config, now), { alt: '', caption: '', focal: { x: 0.5, y: 0.5 }, uploadedAt: now.toISOString() });
  expect(await f.store.listMediaCleanups('2030-01-02T13:00:00Z', 100)).toHaveLength(1);
  expect(await f.store.listMediaCleanups(now.toISOString(), 100)).toHaveLength(0);
  // Simulate interruption after both copies, before metadata commit.
  expect(await files(join(f.root, 'blobs/media/2030'))).toHaveLength(2);
  await collectIncoming(blobs, new Date('2030-01-02T13:00:00Z'), f.store);
  expect(await files(join(f.root, 'blobs/media/2030'))).toHaveLength(0);
  expect(await f.store.listMediaCleanups('2030-01-03T00:00:00Z', 100)).toHaveLength(0);
  const successful = (await (await f.req('/media', 'POST', await imageInput(f, blobs))).json()).doc;
  await f.store.setMeta('media-cleanup-' + prepared.intent.id, { ...prepared.intent, urls: Object.values(successful.draft.variants) });
  await collectIncoming(blobs, new Date('2030-01-02T13:00:00Z'), f.store);
  expect(await files(join(f.root, 'blobs/media/2030'))).toHaveLength(2);
});
