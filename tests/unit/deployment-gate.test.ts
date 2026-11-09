import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { adminFixture } from '../helpers/admin.js';
import { generatedPassword } from '../helpers/password.js';
import { postgresFixture } from '../helpers/postgres.js';
import { createMediaBlobs } from '../../server/store/index.js';
import { createAdminApp } from '../../server/http/hono-app.js';
import { FsPrimitives } from '../../server/store/primitives/fs.js';
import { KvStore } from '../../server/store/kv-store.js';
import { readGrant, serveMedia, uploadGrant } from '../../server/media.js';
import { revision } from '../../server/content/revisions.js';
import { audit } from '../../server/audit.js';
import * as cdn from '../../server/render/cdn.js';
import type { CreateDoc, Doc, Store } from '../../server/store/types.js';

const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
const now = new Date('2030-01-01T12:00:00Z');
const pdf = Buffer.from('%PDF-1.7\n%%EOF');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMsAAAAAASUVORK5CYII=', 'base64');
const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');

afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const f = await adminFixture();
  roots.push(f.root);
  await f.login();
  return f;
}
async function ticket(f: Awaited<ReturnType<typeof fixture>>, bytes = pdf, mime = 'application/pdf') {
  const response = await f.req('/media/upload-url', 'POST', { filename: 'gate.' + (mime === 'application/pdf' ? 'pdf' : 'webp'), mime, size: bytes.length });
  expect(response.status).toBe(200);
  const issued = await response.json();
  await createMediaBlobs(f.config, f.store).put(issued.pathname, bytes, { contentType: mime });
  return issued;
}
async function binaryFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return (await Promise.all(entries.map(entry => entry.isDirectory() ? binaryFiles(join(root, entry.name)) : [join(root, entry.name)]))).flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

it('rejects older signed grants while preserving new owner-bound grants', async () => {
  const f = await fixture();
  const { grant, ticket } = uploadGrant({ filename: 'gate.pdf', mime: 'application/pdf', size: pdf.length }, 'owner', f.config, now);
  expect(readGrant(ticket, 'owner', f.config, now)).toEqual(grant);
  const { version: _version, ...legacy } = grant;
  const payload = Buffer.from(JSON.stringify(legacy)).toString('base64url');
  const oldTicket = payload + '.' + createHmac('sha256', f.config.sessionSecret).update(payload).digest('base64url');
  expect(() => readGrant(oldTicket, 'owner', f.config, now)).toThrow('older protocol');
});

it('rejects unchanged passwords for created/reset accounts and ordinary changes without altering credentials or sessions', async () => {
  const f = await fixture();
  const created = await (await f.req('/users', 'POST', { username: 'GateEditor', role: 'Editor' })).json();
  let password = created.temporaryPassword as string;
  for (const flow of ['created', 'reset', 'ordinary']) {
    await f.login('GateEditor', password);
    const before = (await f.store.getUser(created.user.id))!;
    const sessions = await f.store.listSessions(before.id);
    const audits = (await f.store.queryAudit({ action: 'auth.password', limit: 100 })).items;
    const rejected = await f.req('/auth/password', 'POST', { current: password, next: password });
    expect(rejected.status, flow).toBe(422);
    expect((await rejected.json()).error.message).toBe('New password must differ from the current password');
    expect(await f.store.getUser(before.id)).toEqual(before);
    expect(await f.store.listSessions(before.id)).toEqual(sessions);
    expect((await f.store.queryAudit({ action: 'auth.password', limit: 100 })).items).toEqual(audits);
    expect((await f.req('/docs/events')).status).toBe(flow === 'ordinary' ? 200 : 403);
    const next = generatedPassword();
    const changed = await f.req('/auth/password', 'POST', { current: password, next });
    expect(changed.status).toBe(200);
    expect((await changed.json()).user.mustChangePassword).toBe(false);
    password = next;
    if (flow === 'created') {
      await f.login();
      const reset = await (await f.req('/users/' + created.user.id + '/reset-password', 'POST')).json();
      password = reset.temporaryPassword;
    }
  }
});

it('consumes original and web grants once across create/replace and returns identical retries without copies', async () => {
  const f = await fixture();
  const original = await ticket(f, png, 'image/png'), web = await ticket(f, webp, 'image/webp');
  const input = { ticket: original.ticket, webTicket: web.ticket, alt: 'Gate crest' };
  const first = await f.req('/media', 'POST', input);
  expect(first.status).toBe(201);
  const doc = (await first.json()).doc;
  const paths = await binaryFiles(join(f.root, 'blobs/media/2030'));
  const retry = await f.req('/media', 'POST', input);
  expect((await retry.json()).doc).toEqual(doc);
  expect(await binaryFiles(join(f.root, 'blobs/media/2030'))).toEqual(paths);
  expect((await f.req('/media', 'POST', { ...input, alt: 'Different operation' })).status).toBe(409);
  expect((await f.req('/media/' + doc.id + '/replace', 'POST', { ...input, baseVersion: doc.version })).status).toBe(409);
  const fresh = await ticket(f, png, 'image/png');
  expect((await f.req('/media', 'POST', { ...input, ticket: fresh.ticket })).status).toBe(409);
  const login = await f.login();
  for (const issued of [original, web]) {
    expect((await f.app.request(issued.uploadUrl, { method: 'PUT', headers: { Cookie: f.getCookie(), Origin: f.config.publicBaseUrl, 'X-CSRF-Token': login.data.csrfToken, 'Content-Type': issued === web ? 'image/webp' : 'image/png' }, body: issued === web ? webp : png })).status).toBe(409);
    expect((await f.app.request(issued.handleUploadUrl, { method: 'POST', headers: { Cookie: f.getCookie(), Origin: f.config.publicBaseUrl, 'X-CSRF-Token': login.data.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'blob.generate-client-token' }) })).status).toBe(409);
  }
  const replacement = await ticket(f, png, 'image/png'), replacementWeb = await ticket(f, webp, 'image/webp');
  const replaceInput = { ticket: replacement.ticket, webTicket: replacementWeb.ticket, baseVersion: doc.version };
  const replaced = await f.req('/media/' + doc.id + '/replace', 'POST', replaceInput);
  expect(replaced.status).toBe(200);
  const result = (await replaced.json()).doc;
  const afterReplace = await binaryFiles(join(f.root, 'blobs/media/2030'));
  expect((await (await f.req('/media/' + doc.id + '/replace', 'POST', replaceInput)).json()).doc).toEqual(result);
  expect(await binaryFiles(join(f.root, 'blobs/media/2030'))).toEqual(afterReplace);
  expect((await f.req('/media/' + doc.id + '/replace', 'POST', { ...replaceInput, baseVersion: result.version })).status).toBe(409);
  expect((await f.req('/media', 'POST', replaceInput)).status).toBe(409);
  expect((await f.store.queryAudit({ action: 'media.upload', limit: 100 })).items).toHaveLength(1);
  expect((await f.store.queryAudit({ action: 'media.replace', limit: 100 })).items).toHaveLength(1);
});

it('allows retry after validation, copy and pre-commit failures without consuming grants', async () => {
  const f = await fixture(), blobs = createMediaBlobs(f.config, f.store);
  const login = await f.login();
  const app = createAdminApp(() => f.store, { config: f.config, now: () => now, media: blobs });
  const issued = await ticket(f);
  const post = (extra = {}) => app.request('/api/admin/media', { method: 'POST', headers: { Cookie: f.getCookie(), Origin: f.config.publicBaseUrl, 'X-CSRF-Token': login.data.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: issued.ticket, ...extra }) });
  expect((await post({ alt: 'x'.repeat(501) })).status).toBe(422);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(blobs, 'put').mockRejectedValueOnce(new Error('copy failed'));
  expect((await post()).status).toBe(500);
  vi.spyOn(f.store, 'createDoc').mockRejectedValueOnce(new Error('before transaction'));
  expect((await post()).status).toBe(500);
  expect(await f.store.isUploadConsumed(issued.pathname.split('/')[2])).toBe(false);
  expect(await binaryFiles(join(f.root, 'blobs/media/2030'))).toEqual([]);
  expect((await post()).status).toBe(201);
});

it('tags only public media and limits GET/HEAD shared caching through replacement and unpublish', async () => {
  const f = await fixture(), blobs = createMediaBlobs(f.config, f.store);
  const tagged = vi.spyOn(cdn, 'tagContent').mockResolvedValue(undefined);
  const issued = await ticket(f);
  const doc = (await (await f.req('/media', 'POST', { ticket: issued.ticket })).json()).doc;
  const url = doc.draft.variants.original;
  const privateFile = await serveMedia(new Request('http://localhost:3000' + url, { headers: { Cookie: f.getCookie() } }), f.store, blobs, now);
  expect(privateFile.headers.get('cache-control')).toBe('private, no-store');
  expect(tagged).not.toHaveBeenCalled();
  expect((await f.req('/publish', 'POST', { items: [{ collection: 'media', id: doc.id, expectedVersion: doc.version }] })).status).toBe(200);
  for (const method of ['GET', 'HEAD']) {
    const response = await serveMedia(new Request('http://localhost:3000' + url, { method }), f.store, blobs, now);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=300, stale-while-revalidate=60');
  }
  expect(tagged).toHaveBeenCalledTimes(2);
  const current = (await f.store.getDoc('media', doc.id))!;
  await f.req('/unpublish', 'POST', { items: [{ collection: 'media', id: doc.id, expectedVersion: current.version }] });
  expect((await serveMedia(new Request('http://localhost:3000' + url), f.store, blobs, now)).status).toBe(404);
  expect(tagged).toHaveBeenCalledTimes(2);
});

const actor = { id: 'owner', displayName: 'Owner' };
function creation(): CreateDoc {
  const id = 'media_' + 'a'.repeat(32);
  const doc: Doc = { id, collection: 'media', version: 1, draft: { filename: 'gate.pdf' }, status: 'draft', createdAt: now.toISOString(), updatedAt: now.toISOString(), createdBy: actor.id, updatedBy: actor.id };
  return { doc, revision: revision(doc, actor, 'created', now), audit: audit(actor, 'media.upload', {}, now),
    upload: { grantIds: [id, 'media_' + 'b'.repeat(32)], fingerprint: 'c'.repeat(64) } };
}
async function storeFixture(driver: string, fail?: (stage: string) => void) {
  if (driver === 'Postgres') {
    const f = await postgresFixture({ afterWrite: fail });
    cleanups.push(f.cleanup);
    return { store: f.store as Store, reopen: f.reopen };
  }
  const root = await mkdtemp(resolve('.cache/gate-store-')); roots.push(root);
  const fs = new FsPrimitives(root);
  const put = fs.put.bind(fs);
  fs.put = async (key, value) => {
    await put(key, value);
    fail?.(key.startsWith('revisions/') ? 'revisions' : key.startsWith('audit/') ? 'audit' : key.startsWith('docs/') ? 'docs' : key.startsWith('meta/upload-grant-') ? 'receipt' : 'other');
  };
  const reopen = () => new KvStore(fs, { exclusive: fs.exclusive });
  return { store: reopen() as Store, reopen };
}
if (!process.env.DATABASE_URL) console.info('Deployment gate Postgres regressions: not run (no env)');
for (const driver of ['FS', 'Postgres']) describe.skipIf(driver === 'Postgres' && !process.env.DATABASE_URL)(driver + ' atomic upload consumption', () => {
  it('serializes different operations sharing a web grant across store instances', async () => {
    const f = await storeFixture(driver);
    const first = creation(), second = creation();
    second.doc = { ...second.doc, id: 'media_' + 'd'.repeat(32) };
    second.revision = revision(second.doc, actor, 'created', now);
    second.audit = audit(actor, 'media.upload', {}, now);
    second.upload = { grantIds: [second.doc.id, first.upload!.grantIds[1]], fingerprint: 'e'.repeat(64) };
    const results = await Promise.allSettled([f.store.createDoc(first), f.reopen().createDoc(second)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason.code).toBe('upload_consumed');
    expect(await f.store.listDocs('media')).toHaveLength(1);
    expect((await f.store.queryAudit({ limit: 100 })).items).toHaveLength(1);
  });
  for (const stage of ['revisions', 'audit', 'receipt', 'docs']) it('recovers replacement after ' + stage + ' without a second revision', async () => {
    let armed = false;
    const f = await storeFixture(driver, table => {
      if (armed && table === (driver === 'Postgres' && stage === 'receipt' ? 'meta' : stage)) {
        armed = false;
        throw new Error('Injected replacement failure');
      }
    });
    const original = creation();
    await f.store.createDoc({ ...original, upload: undefined });
    const next = { ...original.doc, version: 2, draft: { filename: 'replacement.pdf' } };
    const upload = { grantIds: ['media_' + 'e'.repeat(32), 'media_' + 'f'.repeat(32)], fingerprint: '1'.repeat(64) };
    const mutation = { collection: 'media' as const, id: next.id, expectedVersion: 1, patch: { draft: next.draft },
      revision: { append: revision(next, actor, 'edited', now) }, audit: audit(actor, 'media.replace', {}, now), upload };
    armed = true;
    await expect(f.store.mutateDoc(mutation)).rejects.toThrow('Injected replacement failure');
    const reopened = f.reopen();
    if (driver === 'Postgres') {
      expect(await reopened.getUploadResult(upload)).toBeNull();
      expect(await reopened.getDoc('media', next.id)).toEqual(original.doc);
    }
    expect(await reopened.mutateDoc(mutation)).toEqual(next);
    expect(await reopened.mutateDoc(mutation)).toEqual(next);
    expect(await reopened.getUploadResult(upload)).toEqual(next);
    expect(await reopened.listRevisions('media', next.id, 100)).toHaveLength(2);
    expect((await reopened.queryAudit({ action: 'media.replace', limit: 100 })).items).toHaveLength(1);
    await expect(reopened.mutateDoc({ ...mutation, upload: { ...upload, fingerprint: '2'.repeat(64) } })).rejects.toMatchObject({ code: 'upload_consumed' });
  });
  for (const stage of ['revisions', 'audit', 'receipt', 'docs']) it('recovers a failure after ' + stage + ' with exactly one result', async () => {
    let armed = false;
    const f = await storeFixture(driver, table => {
      if (armed && table === (driver === 'Postgres' && stage === 'receipt' ? 'meta' : stage)) {
        armed = false;
        throw new Error('Injected gate failure');
      }
    });
    const input = creation();
    armed = true;
    await expect(f.store.createDoc(input)).rejects.toThrow('Injected gate failure');
    const reopened = f.reopen();
    if (driver === 'Postgres') {
      expect(await reopened.getUploadResult(input.upload!)).toBeNull();
      expect(await reopened.getDoc('media', input.doc.id)).toBeNull();
    }
    expect(await reopened.createDoc(input)).toEqual(input.doc);
    expect(await reopened.getUploadResult(input.upload!)).toEqual(input.doc);
    expect(await reopened.createDoc(input)).toEqual(input.doc);
    expect(await reopened.listRevisions('media', input.doc.id, 100)).toHaveLength(1);
    expect((await reopened.queryAudit({ limit: 100 })).items).toHaveLength(1);
  });
});

it('awaits the content tag before returning a public media response', async () => {
  const f = await fixture(), blobs = createMediaBlobs(f.config, f.store);
  const issued = await ticket(f);
  const doc = (await (await f.req('/media', 'POST', { ticket: issued.ticket })).json()).doc;
  await f.req('/publish', 'POST', { items: [{ collection: 'media', id: doc.id, expectedVersion: doc.version }] });
  let release!: () => void;
  const tagged = vi.spyOn(cdn, 'tagContent').mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  let returned = false;
  const response = serveMedia(new Request('http://localhost:3000' + doc.draft.variants.original), f.store, blobs, now).then(result => { returned = true; return result; });
  await vi.waitFor(() => expect(tagged).toHaveBeenCalledOnce());
  expect(returned).toBe(false);
  release();
  expect((await response).status).toBe(200);
});

it('returns the committed result when a concurrent finalize removes quarantine during verification', async () => {
  const f = await fixture(), blobs = createMediaBlobs(f.config, f.store);
  const login = await f.login();
  const app = createAdminApp(() => f.store, { config: f.config, now: () => now, media: blobs });
  let current: Doc | undefined;
  for (const operation of ['create', 'replace']) {
    const issued = await ticket(f);
    let release!: () => void;
    let reached!: () => void;
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const read = blobs.read.bind(blobs);
    const paused = vi.spyOn(blobs, 'read').mockImplementationOnce(async path => { reached(); await gate; return read(path); });
    const path = current ? '/media/' + current.id + '/replace' : '/media';
    const input = { ticket: issued.ticket, ...(current ? { baseVersion: current.version } : {}) };
    const slow = app.request('/api/admin' + path, { method: 'POST', headers: { Cookie: f.getCookie(), Origin: f.config.publicBaseUrl, 'X-CSRF-Token': login.data.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    await entered;
    const fast = await f.req(path, 'POST', input);
    expect(fast.status, operation).toBe(current ? 200 : 201);
    current = (await fast.json()).doc;
    release();
    const finished = await slow;
    expect(finished.status, operation).toBe(operation === 'create' ? 201 : 200);
    expect((await finished.json()).doc).toEqual(current);
    paused.mockRestore();
  }
  expect(await binaryFiles(join(f.root, 'blobs/media/2030'))).toHaveLength(2);
});
