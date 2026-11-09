import { afterEach, describe, expect, it, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { adminFixture } from '../helpers/admin.js';
import { createRenderHandler, renderPage } from '../../server/render/handler.js';
import { diff } from '../../server/content/diff.js';
import { health } from '../../server/content/health.js';
import { checkLink, publicAddress } from '../../server/content/links.js';
import { settleSchedules } from '../../server/content/schedule.js';
import type { Snapshot } from '../../shared/types.js';
import { allDocs } from '../../server/content/publish.js';
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() { const f = await adminFixture(true); roots.push(f.root); await f.login(); return f; }
const event = (title: string) => ({ title, date: '2030-01-03', showOnHome: true });
const item = (doc: { id: string; collection: string; version: number }) => ({ collection: doc.collection, id: doc.id, expectedVersion: doc.version });
const contents = (snapshot: Snapshot) => Object.fromEntries(Object.entries(snapshot.docs).map(([key, docs]) => [key, docs?.map(d => ({ id: d.id, data: d.data, order: d.order }))]));
// These complete lifecycles rewrite a 111-document FS snapshot several times.
// Leave room for concurrent suite I/O without weakening their assertions.
const lifecycleTimeout = process.env.DATABASE_URL ? 60000 : 15000;
describe('Phase 5 HTTP content lifecycle', () => {
  it('creates, coalesces, checkpoints, conflicts, publishes and restores forward', async () => {
    const f = await fixture(), original = (await f.store.getSnapshot())!;
    let response = await f.req('/docs/events', 'POST', { draft: event('New event') }); expect(response.status).toBe(201);
    let doc = (await response.json()).doc;
    const createdId = (await f.store.listRevisions('events', doc.id, 20))[0].id;
    response = await f.req(`/docs/events/${doc.id}`, 'PUT', { baseVersion: doc.version, draft: event('Updated event') }); expect(response.status).toBe(200); doc = (await response.json()).doc;
    let history = await f.store.listRevisions('events', doc.id, 20); expect(history).toHaveLength(2); expect(history[1].id).toBe(createdId); expect(history[0].docVersion).toBe(2);
    const stale = await f.req(`/docs/events/${doc.id}`, 'PUT', { baseVersion: 1, draft: event('Stale edit') }); expect(stale.status).toBe(409); expect((await stale.json()).error.details.current.version).toBe(2);
    const stalePublish = await f.req('/publish', 'POST', { items: [{ ...item(doc), expectedVersion: 1 }] }); expect(stalePublish.status).toBe(409);
    const published = await f.req('/publish', 'POST', { items: [item(doc)] }); expect(published.status).toBe(200); expect(await published.json()).toMatchObject({ siteVersion: 2, purged: false, message: 'Live within about 5 minutes' });
    history = await f.store.listRevisions('events', doc.id, 20); expect(history.every(r => r.sealedAt)).toBe(true);
    doc = (await f.store.getDoc('events', doc.id))!;
    response = await f.req(`/docs/events/${doc.id}`, 'PUT', { baseVersion: doc.version, draft: event('Later event'), checkpoint: true }); expect(response.status).toBe(200); doc = (await response.json()).doc;
    const restored = await f.req(`/revisions/${createdId}/restore?docId=${doc.id}`, 'POST', { baseVersion: doc.version, publish: true }); expect(restored.status).toBe(200);
    expect((await f.store.getDoc('events', doc.id))?.draft).toMatchObject({ title: 'New event' });
    expect((await f.req('/publishes/1/restore', 'POST', { summary: 'Return to the starting point' })).status).toBe(200);
    const final = (await f.store.getSnapshot())!;
    expect(final.siteVersion).toBe(4); expect(contents(final)).toEqual(contents(original));
    expect((await f.store.getPublish(4))?.kind).toBe('restore');
    expect((await f.store.getDoc('events', doc.id))?.draft).toMatchObject({ title: 'New event' });
    expect(final.docs.events!.some(d => d.id === doc.id)).toBe(false);
    expect((await f.req('/search?q=New')).status).toBe(200);
    expect((await f.req('/publishes/1?diff=1')).status).toBe(200);
  }, lifecycleTimeout);
  it('seals a working revision when another author saves or ten minutes elapse', async () => {
    const f = await fixture();
    let doc = (await (await f.req('/docs/events', 'POST', { draft: event('Original') })).json()).doc;
    const ownerRevision = (await f.store.listRevisions('events', doc.id, 20))[0];
    await f.req('/users', 'POST', { username: 'writer', role: 'Contributor', password: 'Fieldside secure phrase' });
    await f.login('writer', 'Fieldside secure phrase');
    doc = (await (await f.req(`/docs/events/${doc.id}`, 'PUT', { baseVersion: doc.version, draft: event('Other writer') })).json()).doc;
    expect((await f.store.getRevision(doc.id, ownerRevision.id))?.sealedAt).toBeTruthy();
    f.clock('2030-01-01T12:11:00Z');
    doc = (await (await f.req(`/docs/events/${doc.id}`, 'PUT', { baseVersion: doc.version, draft: event('After eleven minutes') })).json()).doc;
    const history = await f.store.listRevisions('events', doc.id, 20); expect(history).toHaveLength(3); expect(history.filter(r => r.sealedAt)).toHaveLength(2);
    await f.req('/auth/logout', 'POST'); expect((await f.store.listRevisions('events', doc.id, 20)).every(r => r.sealedAt)).toBe(true);
  });
  it('validates references and protects in-use content, with health findings', async () => {
    const f = await fixture();
    const inUse = await f.req('/docs/sponsorTiers/tier_gold/trash', 'POST', { baseVersion: 1 });
    expect(inUse.status).toBe(409); expect((await inUse.json()).error.code).toBe('in_use');
    const home = (await f.store.getDoc('home', 'home'))!;
    const saved = await f.req('/docs/home/home', 'PUT', { baseVersion: home.version, draft: {} }); expect(saved.status).toBe(200);
    const bad = await f.req('/publish', 'POST', { items: [{ collection: 'home', id: 'home', expectedVersion: 2 }] }); expect(bad.status).toBe(422); expect((await bad.json()).error.details.some((x: { path: string }) => x.path === 'home.home.hero')).toBe(true);
    const issues = await health(f.store, new Date('2030-01-01')); expect(issues.some(i => i.code === 'past_event')).toBe(true); expect(issues.some(i => i.code === 'weak_owner_password')).toBe(true);
    const data = { filename: 'missing.jpg', mime: 'image/jpeg' };
    const { revision } = await import('../../server/content/revisions.js'); const { audit } = await import('../../server/audit.js');
    const d = { id: 'media_missing', collection: 'media' as const, draft: data, version: 1, status: 'draft' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: 'test', updatedBy: 'test' };
    await f.store.createDoc({ doc: d, revision: revision(d, { id: 'test', displayName: 'Test' }, 'created', new Date()), audit: audit({ id: 'test', displayName: 'Test' }, 'test') });
    expect((await health(f.store)).some(i => i.code === 'missing_alt')).toBe(true);
  });
  it('versions reordered docs atomically, leaves revisions alone and restores historical order', async () => {
    const f = await fixture(), docs = await f.store.listDocs('callouts'), reversed = [...docs].reverse();
    const revisionCounts = await Promise.all(docs.map(d => f.store.listRevisions('callouts', d.id, 100)));
    const moved = await f.req('/docs/callouts/reorder', 'POST', { items: reversed.map(d => ({ id: d.id, baseVersion: d.version })) }); expect(moved.status).toBe(200);
    const after = await f.store.listDocs('callouts'); expect(after.map(d => d.id)).toEqual(reversed.map(d => d.id));
    expect(after.every(d => d.version === 2)).toBe(true);
    expect(await Promise.all(docs.map(d => f.store.listRevisions('callouts', d.id, 100)))).toEqual(revisionCounts);
    expect((await f.store.queryAudit({ action: 'content.reorder', limit: 100 })).items).toHaveLength(1);
    expect((await f.req('/docs/callouts/reorder', 'POST', { items: docs.map(d => ({ id: d.id, baseVersion: 1 })) })).status).toBe(409);
    await f.req('/publish', 'POST', { items: after.map(item) });
    expect((await f.store.getPublish(2))?.manifest.filter(e => e.collection === 'callouts').map(e => e.order).sort()).toEqual(after.map(d => d.order).sort());
    await f.req('/publishes/1/restore', 'POST', {}); expect((await f.store.listDocs('callouts')).map(d => d.id)).toEqual(docs.map(d => d.id));
  });
  it('authenticates previews and renders draft edits without cache leakage', async () => {
    const f = await fixture();
    await f.req('/docs/events', 'POST', { draft: event('Preview-only event') });
    const handler = createRenderHandler(f.store, f.config, () => new Date('2030-01-01'));
    expect((await handler(new Request('http://localhost/?preview=1'))).status).toBe(401);
    const preview = await handler(new Request('http://localhost/?preview=1&edit=1', { headers: { Cookie: f.getCookie() } }));
    expect(preview.status).toBe(200); expect(preview.headers.get('cache-control')).toBe('no-store'); const body = await preview.text(); expect(body).toContain('Preview-only event'); expect(body).toContain('data-edit=');
    expect(await (await handler(new Request('http://localhost/'))).text()).not.toContain('Preview-only event');
  });
});
describe('schedules and cache boundaries', () => {
  it('freezes scheduled content, flips the ETag at due time, then settles idempotently preserving newer drafts', async () => {
    const f = await fixture();
    let doc = (await (await f.req('/docs/events', 'POST', { draft: event('Frozen scheduled title') })).json()).doc;
    const at = '2030-01-01T12:01:00Z';
    expect((await f.req('/schedule', 'POST', { items: [item(doc)], at })).status).toBe(200);
    expect((await f.store.getPublish(2))?.kind).toBe('schedule');
    doc = (await f.store.getDoc('events', doc.id))!;
    doc = (await (await f.req(`/docs/events/${doc.id}`, 'PUT', { baseVersion: doc.version, draft: event('Newer private draft') })).json()).doc;
    let time = new Date('2030-01-01T12:00:30Z');
    const render = createRenderHandler(f.store, { ...f.config, cacheSmaxage: 15, cacheSwr: 300 }, () => time);
    const before = await render(new Request('http://localhost/')); expect(before.headers.get('cache-control')).toContain('stale-while-revalidate=0'); expect(await before.text()).not.toContain('Frozen scheduled title');
    time = new Date('2030-01-01T12:00:55Z');
    expect((await render(new Request('http://localhost/'))).headers.get('cache-control')).toContain('s-maxage=5, stale-while-revalidate=0');
    time = new Date(at);
    const due = await render(new Request('http://localhost/', { headers: { 'If-None-Match': before.headers.get('etag')! } }));
    expect(due.status).toBe(200); const body = await due.text(); expect(body).toContain('Frozen scheduled title'); expect(body).not.toContain('Newer private draft');
    const settled = await settleSchedules(f.store, time); expect(settled.settled).toBe(1);
    expect((await settleSchedules(f.store, time)).settled).toBe(0);
    const final = await f.store.getDoc('events', doc.id); expect(final?.draft).toMatchObject({ title: 'Newer private draft' }); expect(final?.published).toMatchObject({ title: 'Frozen scheduled title' }); expect(final?.status).toBe('changed');
    expect((await f.store.getSnapshot())?.effectiveAt).toBe(at.replace('Z', '.000Z'));
    expect(renderPage((await f.store.getSnapshot())!, 'home', { now: time })).toContain('Frozen scheduled title');
  }, lifecycleTimeout);
  it('records schedule cancellation, rejects unauthenticated cron, and accepts GET/POST bearer cron', async () => {
    const f = await fixture(); let doc = (await (await f.req('/docs/events', 'POST', { draft: event('Cancelled') })).json()).doc;
    await f.req('/schedule', 'POST', { items: [item(doc)], at: '2030-01-02T12:00:00Z' });
    doc = (await f.store.getDoc('events', doc.id))!;
    expect((await f.req(`/schedule/events/${doc.id}`, 'DELETE', { baseVersion: doc.version })).status).toBe(200);
    expect((await f.store.getSnapshot())?.scheduled).toEqual([]); expect((await f.store.getPublish(3))?.kind).toBe('schedule');
    expect((await f.req('/cron/settle', 'POST')).status).toBe(401);
    for (const method of ['GET', 'POST']) expect((await f.req('/cron/settle', method, undefined, { Authorization: 'Bearer test-cron' })).status).toBe(200);
  });
  it('replays an interrupted publish before the next operation, once', async () => {
    const f = await fixture(); const doc = (await (await f.req('/docs/events', 'POST', { draft: event('Recovery') })).json()).doc;
    const publish = vi.spyOn(f.store, 'publish'); publish.mockRejectedValueOnce(new Error('Injected publish outage'));
    expect((await f.req('/publish', 'POST', { items: [item(doc)] })).status).toBe(500);
    const recovery = vi.spyOn(f.store, 'recoverPublish'); await f.req('/dashboard'); expect(recovery).toHaveBeenCalled();
    expect((await f.req('/publish', 'POST', { items: [item(doc)] })).status).toBe(200);
    expect((await f.store.getSnapshot())?.siteVersion).toBe(2);
  });
});
describe('diffs and SSRF-safe links', () => {
  it('matches list keys and produces word changes with schema labels', () => {
    const a = { season: { cards: [{ _key: 'aaaaaaaa', title: 'First', text: 'Old words' }, { _key: 'bbbbbbbb', title: 'Second' }] } };
    const b = { season: { cards: [{ _key: 'bbbbbbbb', title: 'Second' }, { _key: 'aaaaaaaa', title: 'First', text: 'New words' }, { _key: 'cccccccc', title: 'Third' }] } };
    const result = diff('recreational', a, b);
    expect(result.filter(d => d.kind === 'moved')).toHaveLength(2); expect(result.some(d => d.kind === 'added')).toBe(true); expect(result.find(d => d.path.endsWith('.text'))?.words?.some(d => d.added)).toBe(true);
  });
  it.each(['127.0.0.1', '0.0.0.0', '10.1.2.3', '172.16.1.1', '192.168.1.1', '169.254.169.254', '224.0.0.1', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', 'ff00::1', '::ffff:127.0.0.1', '2002:7f00:1::'])('refuses %s', address => expect(publicAddress(address)).toBe(false));
  it('refuses a real loopback stub without sending it a request', async () => {
    let hits = 0; const server = createServer((_req, res) => { hits++; res.end('no'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const addr = server.address(); if (!addr || typeof addr === 'string') throw new Error('No port');
      const result = await checkLink(`http://127.0.0.1:${addr.port}/`); expect(result.ok).toBe(false); expect(hits).toBe(0);
      expect((await checkLink('file:///etc/passwd')).ok).toBe(false);
      expect((await checkLink(`http://localhost:${addr.port}/`)).ok).toBe(false);
    } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  });
});
