import { afterEach, describe, expect, it, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { adminFixture, createUserWithPassword } from '../helpers/admin.js';
import { createMediaBlobs } from '../../server/store/index.js';
import { serveMedia } from '../../server/media.js';
import { retained } from '../../server/store/blobs/common.js';
import { createAdminApp } from '../../server/http/hono-app.js';
import { scheduleDocuments } from '../../server/content/schedule.js';
import type { Doc, MediaStorage, Revision } from '../../server/store/types.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(seed = false) { const f = await adminFixture(seed); roots.push(f.root); await f.login(); return f; }
async function pdf(f: Awaited<ReturnType<typeof fixture>>, content = 'Original') {
  const bytes = Buffer.from('%PDF-1.7\n' + content + '\n%%EOF');
  const issued = await f.req('/media/upload-url', 'POST', { filename: 'guide.pdf', mime: 'application/pdf', size: bytes.length });
  expect(issued.status).toBe(200);
  const grant = await issued.json();
  await createMediaBlobs(f.config, f.store).put(grant.pathname, bytes, { contentType: 'application/pdf' });
  return grant;
}
type PdfDoc = Doc<{ filename: string; variants: { original: string; web: string } }>;
async function upload(f: Awaited<ReturnType<typeof fixture>>) {
  const grant = await pdf(f), response = await f.req('/media', 'POST', { ticket: grant.ticket });
  expect(response.status).toBe(201);
  return (await response.json()).doc as PdfDoc;
}

describe('media serving and history maintenance', () => {
  it('serves public HEAD from the snapshot without a document read and cancels its binary stream', async () => {
    const f = await fixture(), doc = await upload(f);
    expect((await f.req('/publish', 'POST', { items: [{ collection: 'media', id: doc.id, expectedVersion: doc.version }] })).status).toBe(200);
    const getDoc = vi.spyOn(f.store, 'getDoc'), listDocs = vi.spyOn(f.store, 'listDocs');
    const blobs = createMediaBlobs(f.config, f.store), cancel = vi.fn();
    vi.spyOn(blobs, 'read').mockResolvedValue({ stream: new ReadableStream({ cancel }), contentType: 'application/pdf', size: 25 });
    const response = await serveMedia(new Request('http://localhost:3000' + doc.draft.variants.original, { method: 'HEAD' }), f.store, blobs);
    expect(response.status).toBe(200); expect(response.body).toBeNull();
    expect(response.headers.get('content-length')).toBe('25'); expect(cancel).toHaveBeenCalledOnce();
    expect(getDoc).not.toHaveBeenCalled(); expect(listDocs).not.toHaveBeenCalled();
  });

  it('retains never-published replacement history and serves it privately even after trash', async () => {
    const f = await fixture(), first = await upload(f), replacement = await pdf(f, 'Replacement');
    expect((await f.req(`/media/${first.id}/replace`, 'POST', { baseVersion: first.version, ticket: replacement.ticket })).status).toBe(200);
    const blobs = createMediaBlobs(f.config, f.store);
    expect(await retained(f.store, first.draft.variants.original)).toBe(true);
    await expect(blobs.delete(first.draft.variants.original)).rejects.toThrow('retained');
    expect((await f.req(`/media/${first.id}`, 'DELETE', { baseVersion: 2 })).status).toBe(200);
    const url = 'http://localhost:3000' + first.draft.variants.original;
    expect((await serveMedia(new Request(url), f.store, blobs)).status).toBe(404);
    const privateFile = await serveMedia(new Request(url, { headers: { Cookie: f.getCookie() } }), f.store, blobs);
    expect(privateFile.status).toBe(200); expect(privateFile.headers.get('cache-control')).toBe('private, no-store');
    expect(await privateFile.text()).toContain('Original');
  });

  it('deduplicates publication revision reads and checks every unpublished revision page', async () => {
    const f = await fixture(true), records = await f.store.listPublishes(1), entry = records[0].manifest.find(item => item.collection === 'media')!;
    vi.spyOn(f.store, 'listPublishes').mockResolvedValue([{ ...records[0], manifest: [entry, entry] }, { ...records[0], siteVersion: 2, manifest: [entry] }]);
    const getRevision = vi.spyOn(f.store, 'getRevision').mockResolvedValue(null);
    const historical = { docId: 'never-published', id: 'revision', data: { variants: { original: '/history.pdf' } } } as Revision;
    const query = vi.spyOn(f.store, 'queryRevisions').mockResolvedValueOnce({ items: [], cursor: 'next' }).mockResolvedValueOnce({ items: [historical] });
    expect(await retained(f.store, '/history.pdf')).toBe(true); expect(getRevision).toHaveBeenCalledExactlyOnceWith(entry.id, entry.revId);
    expect(query).toHaveBeenLastCalledWith({ collection: 'media', limit: 1000, cursor: 'next' });
  });

  it('untrashes media with permissions, CSRF, version checks and an audit record', async () => {
    const f = await fixture(), doc = await upload(f);
    expect((await f.req(`/media/${doc.id}`, 'DELETE', { baseVersion: 1 })).status).toBe(200);
    expect((await (await f.req('/media')).json()).docs).toEqual([]);
    const trash = await (await f.req('/media?trash=1')).json();
    expect(trash.docs).toHaveLength(1); expect(trash.docs[0]).toMatchObject({ id: doc.id, status: 'trashed', version: 2 });
    expect((await f.req(`/media/${doc.id}/untrash`, 'POST', { baseVersion: 2 }, { 'X-CSRF-Token': 'wrong' })).status).toBe(403);
    await createUserWithPassword(f, { username: 'contributor', password: 'Strong contributor phrase 123', role: 'Contributor' });
    await f.login('contributor', 'Strong contributor phrase 123');
    expect((await f.req(`/media/${doc.id}/untrash`, 'POST', { baseVersion: 2 })).status).toBe(403);
    await f.login();
    expect((await f.req(`/media/${doc.id}/untrash`, 'POST', { baseVersion: 1 })).status).toBe(409);
    const response = await f.req(`/media/${doc.id}/untrash`, 'POST', { baseVersion: 2 });
    expect(response.status).toBe(200);
    expect((await response.json()).doc).toMatchObject({ status: 'draft', version: 3, draft: doc.draft });
    const restored = await f.store.getDoc('media', doc.id); expect(restored?.trashedAt).toBeUndefined(); expect(restored?.trashedBy).toBeUndefined();
    expect((await (await f.req('/media?trash=1')).json()).docs).toEqual([]);
    expect((await (await f.req('/media')).json()).docs).toHaveLength(1);
    expect((await f.store.queryAudit({ action: 'media.untrash', limit: 10 })).items).toHaveLength(1);
  });
});

describe('independent cron stages', () => {
  it('settles a scheduled publication despite session and Blob cleanup failures, and reports failure for retry', async () => {
    const f = await fixture(true), home = (await f.store.getDoc('home', 'home'))!;
    await scheduleDocuments(f.store, [{ collection: 'home', id: home.id, expectedVersion: home.version }], '2030-01-02T12:00:00Z', { id: 'scheduler', displayName: 'Scheduler' }, new Date('2030-01-01T12:00:00Z'));
    const blobs: MediaStorage = createMediaBlobs(f.config, f.store);
    const incoming = vi.spyOn(blobs, 'incoming').mockRejectedValue(new Error('Blob unavailable'));
    const sessions = vi.spyOn(f.store, 'deleteExpiredSessions').mockRejectedValue(new Error('Session cleanup unavailable'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = createAdminApp(() => f.store, { config: f.config, now: () => new Date('2030-01-03T12:00:00Z'), media: blobs });
    const response = await app.request('/api/admin/cron/settle', { headers: { Authorization: 'Bearer test-cron' } });
    expect(response.status).toBe(500); expect(incoming).toHaveBeenCalledOnce(); expect(sessions).toHaveBeenCalledOnce();
    expect((await f.store.getSnapshot())?.scheduled).toEqual([]); expect((await f.store.getDoc('home', 'home'))?.scheduledAt).toBeUndefined();
    expect(errors).toHaveBeenCalledWith(expect.any(AggregateError));
  });

  it('still runs both cleanup stages if publication settlement fails', async () => {
    const f = await fixture(true), blobs = createMediaBlobs(f.config, f.store);
    vi.spyOn(f.store, 'capturePublication').mockRejectedValue(new Error('Publication unavailable'));
    const sessions = vi.spyOn(f.store, 'deleteExpiredSessions'); const incoming = vi.spyOn(blobs, 'incoming');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = createAdminApp(() => f.store, { config: f.config, now: () => new Date('2030-01-03T12:00:00Z'), media: blobs });
    expect((await app.request('/api/admin/cron/settle', { method: 'POST', headers: { Authorization: 'Bearer test-cron' } })).status).toBe(500);
    expect(sessions).toHaveBeenCalledOnce(); expect(incoming).toHaveBeenCalledOnce();
  });
});
