import { afterEach, expect, it, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { adminFixture } from '../helpers/admin.js';
import { KvStore } from '../../server/store/kv-store.js';
import { FsPrimitives } from '../../server/store/primitives/fs.js';
import { audit } from '../../server/audit.js';
import { health } from '../../server/content/health.js';
import { newSession } from '../../server/auth/session.js';
import { loadSeed } from '../../scripts/seed.js';
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() { const f = await adminFixture(true); roots.push(f.root); await f.login(); return f; }
it('all unauthenticated routes reject, and low roles cannot mutate through alternate routes', async () => {
  const f = await fixture();
  for (const [path, method] of [
    ['/docs/events', 'GET'], ['/docs/events', 'POST'], ['/docs/site/site', 'PUT'], ['/publish', 'POST'], ['/schedule', 'POST'], ['/audit/export', 'GET'], ['/users', 'GET'], ['/publishes', 'GET'], ['/dashboard', 'GET'], ['/search?q=a', 'GET'], ['/export/content', 'GET'], ['/health/links', 'POST'],
  ]) expect((await f.req(path, method, undefined, { Cookie: '' })).status, `${method} ${path}`).toBe(401);
  await f.req('/users', 'POST', { username: 'contributor', role: 'Contributor', password: 'Fieldside secure phrase' });
  await f.login('contributor', 'Fieldside secure phrase');
  for (const [path, method] of [['/unpublish', 'POST'], ['/schedule', 'POST'], ['/rebuild', 'POST'], ['/health/links', 'POST'], ['/publishes/1/restore', 'POST'], ['/docs/events/evt_1/trash', 'POST'], ['/export/content', 'GET']]) expect((await f.req(path, method, method === 'GET' ? undefined : {})).status, path).toBe(403);
  const siteRev = (await f.store.listRevisions('site', 'site', 1))[0];
  expect((await f.req(`/revisions/${siteRev.id}/restore?docId=site`, 'POST', { baseVersion: 1 })).status).toBe(403);
  expect((await (await f.req('/dashboard')).json()).recent).toEqual([]);
});
it('publishing unrelated content does not publish a pending reorder', async () => {
  const f = await fixture();
  const original = (await f.store.getSnapshot())!.docs.callouts!;
  const docs = await f.store.listDocs('callouts');
  expect((await f.req('/docs/callouts/reorder', 'POST', { items: [...docs].reverse().map(d => ({ id: d.id, baseVersion: d.version })) })).status).toBe(200);
  const created = await (await f.req('/docs/events', 'POST', { draft: { title: 'Unrelated', date: '2030-01-02' } })).json();
  expect((await f.req('/publish', 'POST', { items: [{ collection: 'events', id: created.doc.id, expectedVersion: created.doc.version }] })).status).toBe(200);
  expect((await f.store.getSnapshot())!.docs.callouts!.map(d => [d.id, d.order])).toEqual(original.map(d => [d.id, d.order]));
});
it('atomic reorder checks unchanged siblings, recovers interruptions, and writes one audit', async () => {
  const f = await fixture(), docs = (await f.store.listDocs('callouts')).slice(0, 3);
  const primitives = new FsPrimitives(f.root);
  let fail = true;
  const failing = new KvStore({ get: primitives.get.bind(primitives), list: primitives.list.bind(primitives), delete: primitives.delete.bind(primitives), put: async (key, value) => {
    if (fail && key.startsWith('docs/callouts/')) { fail = false; throw new Error('Injected reorder interruption'); }
    return primitives.put(key, value);
  } }, { exclusive: primitives.exclusive });
  const entry = audit({ id: 'test', displayName: 'Test' }, 'content.reorder');
  await expect(failing.mutateDoc({ collection: 'callouts', id: docs[0].id, expectedVersion: docs[0].version, patch: { order: 9 }, relatedOrder: [{ id: docs[1].id, expectedVersion: docs[1].version, order: 8 }], audit: entry })).rejects.toThrow('Injected');
  await f.store.recoverPublish();
  expect((await f.store.getDoc('callouts', docs[0].id))?.order).toBe(9);
  expect((await f.store.getDoc('callouts', docs[1].id))?.order).toBe(8);
  expect((await f.store.queryAudit({ action: 'content.reorder', limit: 100 })).items).toHaveLength(1);
  const current = (await f.store.getDoc('callouts', docs[0].id))!;
  expect(await f.store.mutateDoc({ collection: 'callouts', id: current.id, expectedVersion: current.version, patch: { order: 1 }, relatedOrder: [], guardVersions: [{ id: docs[1].id, expectedVersion: 1 }], audit: audit({ id: 'test', displayName: 'Test' }, 'content.reorder') })).toBe('conflict');
});
it('reports broken references in either draft or published state', async () => {
  const f = await fixture(), home = (await f.store.getDoc('home', 'home'))!;
  const draft = structuredClone(home.draft) as { resultsSection: { resultIds: string[] } };
  draft.resultsSection.resultIds = ['res_missing'];
  await f.req('/docs/home/home', 'PUT', { baseVersion: 1, draft });
  expect((await health(f.store)).some(i => i.code === 'broken_reference' && i.id === 'home' && i.path === 'resultsSection.resultIds')).toBe(true);
});
it('runs login session GC at most hourly and never refreshes a session twice within an hour', async () => {
  const f = await fixture(); const gc = vi.spyOn(f.store, 'deleteExpiredSessions');
  await f.login(); await f.login(); expect(gc).not.toHaveBeenCalled();
  f.clock('2030-01-01T13:00:00Z'); await f.login(); expect(gc).toHaveBeenCalledTimes(1);
  const put = vi.spyOn(f.store, 'putSession');
  await f.req('/auth/me'); await f.req('/auth/me'); expect(put).not.toHaveBeenCalled();
});
it('serializes last-Owner protections and rejects stale user updates', async () => {
  const f = await fixture(), owner = (await f.store.listUsers())[0];
  const second = await (await f.req('/users', 'POST', { username: 'second', role: 'Owner', password: 'Fieldside secure phrase' })).json();
  const other = (await f.store.getUser(second.user.id))!;
  await f.store.changeUser({ ...other, active: false }, owner.id, audit({ id: owner.id, displayName: owner.displayName }, 'users.deactivate'), other);
  await expect(f.store.changeUser({ ...owner, active: false }, owner.id, audit({ id: owner.id, displayName: owner.displayName }, 'users.deactivate'), owner)).rejects.toMatchObject({ code: 'last_owner' });
  await expect(f.store.changeUser({ ...other, role: 'Editor' }, owner.id, audit({ id: owner.id, displayName: owner.displayName }, 'users.update'), other)).rejects.toMatchObject({ code: 'conflict' });
});
it('publishing after soft trash removes the document while untrash keeps its draft', async () => {
  const f = await fixture();
  const doc = (await loadSeed()).find(d => d.collection === 'events')!;
  const trash = await f.req(`/docs/events/${doc.id}/trash`, 'POST', { baseVersion: 1 }); expect(trash.status).toBe(200);
  expect((await f.store.getSnapshot())?.docs.events?.some(d => d.id === doc.id)).toBe(true);
  expect((await f.req('/publish', 'POST', { items: [{ collection: 'events', id: doc.id, expectedVersion: 2 }] })).status).toBe(200);
  expect((await f.store.getSnapshot())?.docs.events?.some(d => d.id === doc.id)).toBe(false);
  expect((await f.req(`/docs/events/${doc.id}/untrash`, 'POST', { baseVersion: 3 })).status).toBe(200);
  expect((await f.store.getDoc('events', doc.id))?.draft).toEqual(doc.draft);
});
