import { bootstrapEnvironment } from '../helpers/password.js';
import { afterEach, expect, it, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { adminFixture, createUserWithPassword } from '../helpers/admin.js';
import { commitSnapshot, publishDocuments } from '../../server/content/publish.js';
import { scheduleDocuments } from '../../server/content/schedule.js';
import { saveDraft, revision } from '../../server/content/revisions.js';
import { restoreRevision } from '../../server/content/restore.js';
import { audit } from '../../server/audit.js';
import { loadConfig, type Config } from '../../server/config.js';
import { loginGenerationKey, lockKey, usernameRateKey } from '../../server/auth/ratelimit.js';
import { newSession } from '../../server/auth/session.js';
import type { Doc } from '../../shared/types.js';
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
const now = new Date('2030-01-01T12:00:00Z');
const actor = { id: 'test', displayName: 'Test' };
const item = (d: Doc) => ({ collection: d.collection, id: d.id, expectedVersion: d.version });
async function fixture(seed = false, config: Partial<Config> = {}) { const f = await adminFixture(seed, config); roots.push(f.root); await f.login(); return f; }
async function create(f: Awaited<ReturnType<typeof fixture>>, collection: string, draft: unknown): Promise<Doc> {
  const r = await f.req('/docs/' + collection, 'POST', { draft }); expect(r.status).toBe(201); return (await r.json()).doc;
}
it('A3: stale in-flight rebuild cannot resurrect a completed unpublish', { timeout: 15000 }, async () => {
  const f = await fixture(true), capture = await f.store.capturePublication(), d = capture.docs.find(d => d.collection === 'events')!;
  await publishDocuments(f.store, [item(d)], actor, now, undefined, true);
  await expect(commitSnapshot(f.store, capture, [], actor, now, { kind: 'rebuild' })).rejects.toMatchObject({ status: 409 });
  expect((await f.store.getSnapshot())?.docs.events?.some(x => x.id === d.id)).toBe(false);
  expect((await f.store.getDoc(d.collection, d.id))?.version).toBe(d.version + 1);
});
it('A3: publication envelopes, scheduling and cancellation each advance versions', async () => {
  const f = await fixture(), d = await create(f, 'events', { title: 'Versioned', date: '2030-01-03' });
  await publishDocuments(f.store, [item(d)], actor, now);
  let current = (await f.store.getDoc(d.collection, d.id))!; expect(current.version).toBe(2);
  await scheduleDocuments(f.store, [item(current)], '2030-01-04T00:00:00Z', actor, now);
  current = (await f.store.getDoc(d.collection, d.id))!; expect(current.version).toBe(3);
  await scheduleDocuments(f.store, [item(current)], null, actor, now);
  expect((await f.store.getDoc(d.collection, d.id))?.version).toBe(4);
});
it('A4: trash A and publish B preserves A until selected unpublication, with accurate audit', async () => {
  const f = await fixture(true), a = (await f.store.listDocs('events'))[0];
  expect((await f.req(`/docs/events/${a.id}/trash`, 'POST', { baseVersion: a.version })).status).toBe(200);
  const b = await create(f, 'events', { title: 'B', date: '2030-01-03' });
  await publishDocuments(f.store, [item(b)], actor, now);
  expect((await f.store.getSnapshot())?.docs.events?.some(x => x.id === a.id)).toBe(true);
  expect((await f.store.getPublish(2))?.manifest.some(x => x.id === a.id)).toBe(true);
  const changes = (await f.store.queryAudit({ action: 'content.publish', limit: 1 })).items[0].meta as {items:{id:string}[]};
  expect(changes.items.map(x => x.id)).toEqual([b.id]);
  await publishDocuments(f.store, [item((await f.store.getDoc('events', a.id))!)], actor, now, undefined, true);
  expect((await f.store.getSnapshot())?.docs.events?.some(x => x.id === a.id)).toBe(false);
});
it('A5: frozen scheduled references block trash after draft changes', async () => {
  const f = await fixture(), a = await create(f, 'sponsorTiers', { name: 'A' }), b = await create(f, 'sponsorTiers', { name: 'B' });
  let sponsor = await create(f, 'sponsors', { name: 'Sponsor', tier: a.id });
  await scheduleDocuments(f.store, [item(sponsor)], '2030-01-04T00:00:00Z', actor, now);
  sponsor = (await f.store.getDoc('sponsors', sponsor.id))!;
  await expect(f.store.mutateDoc({collection:sponsor.collection,id:sponsor.id,expectedVersion:sponsor.version,patch:{status:'trashed'},audit:audit(actor,'trash',{},now)})).rejects.toMatchObject({code:'in_use'});
  await saveDraft(f.store, sponsor, sponsor.version, { name: 'Sponsor', tier: b.id }, actor, now);
  const blocked = await f.req(`/docs/sponsorTiers/${a.id}/trash`, 'POST', { baseVersion: a.version });
  expect(blocked.status).toBe(409); expect((await blocked.json()).error.details.usage[0].path).toBe('scheduled.tier');
});
it('A5: failed due settlement reports health and leaves repair, cancel, auth and logout usable', async () => {
  const f = await fixture(), d = await create(f, 'events', { title: 'Scheduled', date: '2030-01-03' });
  const repair = await create(f, 'events', { title: 'Repair', date: '2030-01-03' });
  expect((await f.req(`/docs/events/${repair.id}/trash`, 'POST', {baseVersion:repair.version})).status).toBe(200);
  await scheduleDocuments(f.store, [item(d)], '2030-01-01T12:01:00Z', actor, now);
  f.clock('2030-01-01T12:02:00Z');
  const publish = f.store.publish.bind(f.store);
  vi.spyOn(f.store, 'publish').mockImplementation(tx => tx.audit?.[0]?.action === 'content.schedule_settle' ? Promise.reject(new Error('Settlement unavailable')) : publish(tx));
  const dashboard = await f.req('/dashboard'); expect(dashboard.status).toBe(200);
  expect((await dashboard.json()).health.some((i: {code:string}) => i.code === 'schedule_failed')).toBe(true);
  expect((await f.req('/auth/me')).status).toBe(200);
  const current = (await f.store.getDoc('events', d.id))!;
  expect((await f.req(`/docs/events/${repair.id}/untrash`, 'POST', {baseVersion:repair.version+1})).status).toBe(200);
  expect((await f.req(`/docs/events/${repair.id}`, 'PUT', {baseVersion:repair.version+2,draft:{title:'Repaired',date:'2030-01-03'}})).status).toBe(200);
  // Cancellation dispatches its own write even while settlement keeps failing.
  expect((await f.req(`/schedule/events/${d.id}`, 'DELETE', { baseVersion: current.version })).status).toBe(200);
  expect((await f.req('/auth/logout', 'POST')).status).toBe(200);
});
it('A6: generic restore denies media even for another uploader’s Contributor', async () => {
  const f = await fixture(), data = { filename: 'other.png', uploadedBy: 'someone-else' };
  const doc: Doc = { id: 'med_other', collection: 'media', draft: data, version: 1, status: 'draft', createdAt: now.toISOString(), updatedAt: now.toISOString(), createdBy: actor.id, updatedBy: actor.id };
  const rev = revision(doc, actor, 'created', now); await f.store.createDoc({ doc, revision: rev, audit: audit(actor, 'media.upload', {}, now) });
  await createUserWithPassword(f, { username: 'writer', role: 'Contributor', password: 'Strong testing phrase' }); await f.login('writer', 'Strong testing phrase');
  expect((await f.req(`/revisions/${rev.id}/restore?docId=${doc.id}`, 'POST', { baseVersion: 1 })).status).toBe(403);
  expect((await f.store.getDoc('media', doc.id))?.version).toBe(1);
});
it('A7: revokes all other sessions and audits the same store operation', async () => {
  const f = await fixture(), user = (await f.store.listUsers())[0];
  const others = await Promise.all([newSession(f.store, user, {}, now), newSession(f.store, user, {}, now)]);
  expect((await f.req('/auth/sessions/revoke-others', 'POST')).status).toBe(200);
  for (const other of others) expect(await f.store.getSession(other.session.hash)).toBeNull();
  expect(await f.store.listSessions(user.id)).toHaveLength(1);
  expect((await f.store.queryAudit({ action: 'auth.sessions_revoke', limit: 10 })).items).toHaveLength(1);
});
it('A8: failed restore-and-publish returns the committed draft and explicit publish failure', async () => {
  const f = await fixture(), d = await create(f, 'events', { title: 'A', date: '2030-01-03' });
  const original = (await f.store.listRevisions('events', d.id, 1))[0];
  const edited = await saveDraft(f.store, d, d.version, { title: 'B', date: '2030-01-03' }, actor, now);
  vi.spyOn(f.store, 'publish').mockRejectedValue(new Error('Write unavailable'));
  const result = await restoreRevision(f.store, original.id, edited.version, actor, now, true, d.id);
  expect(result).toMatchObject({ published: false, publishError: { code: 'internal' }, doc: { draft: { title: 'A' } } });
  expect((await f.store.getDoc('events', d.id))?.draft).toEqual(result.doc.draft);
});
it('A9/M4: malformed Unicode tokens, audit cursors and non-object throws never escape as crashes', async () => {
  const f = await adminFixture(); roots.push(f.root);
  f.app.get('/api/admin/throw-string', () => { throw 'bad'; });
  f.app.get('/api/admin/throw-null', () => { throw null; });
  await f.login(); vi.spyOn(console, 'error').mockImplementation(() => {});
  expect((await f.req('/auth/logout', 'POST', {}, { 'X-CSRF-Token': 'é'.repeat(43) })).status).toBe(403);
  expect((await f.req('/cron/settle', 'POST', undefined, { Authorization: 'é'.repeat(16) })).status).toBe(401);
  expect((await f.req('/audit?cursor=garbage')).status).toBe(422);
  expect((await f.req('/revisions/events/evt_unknown?before=garbage')).status).toBe(422);
  expect((await f.req('/audit/export?cursor=garbage')).status).toBe(422);
  for (const path of ['/throw-string','/throw-null']) expect((await f.req(path)).status).toBe(500);
});
it('F-H1/H2: attacker IP cannot lock a correct password at another IP; audit floods are counted, not appended', async () => {
  const f = await fixture();
  for (let i = 0; i < 5; i++) await f.req('/auth/login', 'POST', { username: 'Phil', password: 'bad' });
  for (let i = 0; i < 25; i++) await f.req('/auth/login', 'POST', { username: 'Phil', password: 'bad' });
  expect((await f.store.queryAudit({ action: 'auth.login_failed', limit: 100 })).items).toHaveLength(1);
  expect((await f.store.queryAudit({ action: 'auth.locked', limit: 100 })).items).toHaveLength(1);
  expect((await f.req('/auth/login', 'POST', { username: 'Phil', password: 'Phil' }, { 'X-Forwarded-For': '192.0.2.77' })).status).toBe(200);
  expect(await f.store.rateLimitHit('login-audit-192.0.2.40', 900)).toMatchObject({ count: 31 });
});
it('F-H1: audited local unlock invalidates pair locks and clears username throttle', async () => {
  const f = await fixture();
  for (let i = 0; i < 5; i++) await f.req('/auth/login', 'POST', { username: 'Phil', password: 'bad' });
  await f.store.rateLimitHit(usernameRateKey('Phil'), 900);
  await f.store.unlockLogin('Phil', audit(actor, 'auth.unlock', {}, now));
  expect(await f.store.getMeta(loginGenerationKey('Phil'))).toBe(1);
  expect(await f.store.getMeta(lockKey('Phil', '192.0.2.40', 1))).toBeNull();
  expect((await f.store.queryAudit({ action: 'auth.unlock', limit: 10 })).items).toHaveLength(1);
  expect((await f.req('/auth/login', 'POST', { username: 'Phil', password: 'Phil' }, { 'X-Forwarded-For': '192.0.2.40' })).status).toBe(200);
});
it('F-H3: create A then edit B retains both restorable revisions', async () => {
  const f = await fixture(), d = await create(f, 'events', { title: 'A', date: '2030-01-03' });
  const owner = (await f.store.listUsers())[0], sameAuthor = {id:owner.id,displayName:owner.displayName};
  const edited = await saveDraft(f.store, d, 1, { title: 'B', date: '2030-01-03' }, sameAuthor, now);
  const history = await f.store.listRevisions('events', d.id, 10); expect(history).toHaveLength(2);
  const created = history.find(r => r.action === 'created')!; expect(created.sealedAt).toBeTruthy();
  const restored = await restoreRevision(f.store, created.id, edited.version, actor, now, false, d.id);
  expect(restored.doc.draft).toMatchObject({ title: 'A' });
});
it('F-M1: future routes require authentication by default', async () => {
  const f = await adminFixture(); roots.push(f.root); f.app.get('/api/admin/future-route', c => c.json({ ok: true })); await f.login();
  expect((await f.req('/future-route', 'GET', undefined, { Cookie: '' })).status).toBe(401);
  expect((await f.req('/future-route')).status).toBe(200);
});
it('F-M2: Viewer and Editor cannot see another Owner’s weak-password health finding', async () => {
  const f = await fixture();
  for (const role of ['Viewer','Editor','Admin']) {
    await f.login(); await createUserWithPassword(f, { username: role, role, password: 'Strong testing phrase' }); await f.login(role, 'Strong testing phrase');
    const data = await (await f.req('/dashboard')).json();
    expect(data.health.some((i: {code:string}) => i.code === 'weak_owner_password')).toBe(role === 'Admin');
  }
});
it('F-M3: overlong keys, invalid doc IDs and invalid login usernames return 4xx without poisoning recovery', async () => {
  const f = await fixture(); const recover = vi.spyOn(f.store, 'recoverPublish');
  for (const path of ['/docs/events/' + 'a'.repeat(201), '/docs/events/bad.id', '/auth/sessions/' + 'a'.repeat(201)]) expect((await f.req(path)).status).toBe(422);
  for (const username of ['a'.repeat(101), 'a/b', '..']) expect((await f.req('/auth/login', 'POST', { username, password: 'bad' })).status).toBe(422);
  recover.mockClear(); expect((await f.req('/auth/me')).status).toBe(200); expect(recover).not.toHaveBeenCalled();
});
it('explicit must-change flags restrict content until password rotation', async () => {
  const f = await fixture(false, { adminForcePasswordChange: true });
  expect((await f.req('/auth/me')).status).toBe(200);
  expect((await f.req('/dashboard')).status).toBe(403);
  expect((await f.req('/auth/sessions')).status).toBe(200);
  const changed = await f.req('/auth/password', 'POST', { current: 'Phil', next: 'Strong replacement phrase' }); expect(changed.status).toBe(200);
  expect((await f.login('Phil', 'Strong replacement phrase')).response.status).toBe(200); expect((await f.req('/dashboard')).status).toBe(200);
  expect(f.config.adminForcePasswordChange).toBe(true);
  expect(loadConfig({}, () => {}).adminForcePasswordChange).toBe(false);
  expect(loadConfig({ NODE_ENV:'production', STORE_DRIVER:'fs', PUBLIC_BASE_URL:'https://example.com', SESSION_SECRET:'x'.repeat(32), ...await bootstrapEnvironment() }).adminForcePasswordChange).toBe(false);
});
it('F-L2: current-password attempts are capped at ten per user per fifteen minutes', async () => {
  const f = await fixture();
  for (let i = 0; i < 10; i++) expect((await f.req('/auth/password', 'POST', { current: 'bad', next: 'Strong replacement phrase' })).status).toBe(401);
  expect((await f.req('/auth/password', 'POST', { current: 'Phil', next: 'Strong replacement phrase' })).status).toBe(429);
  f.clock('2030-01-01T12:16:00Z');
  expect((await f.req('/auth/password', 'POST', { current: 'Phil', next: 'Strong replacement phrase' })).status).toBe(200);
});
it('F-L4: production emits and accepts only the __Host session cookie', async () => {
  const f = await fixture(false, { production: true, cookieSecure: true });
  expect(f.getCookie()).toMatch(/^__Host-psc_session=/);
  const login = await f.login(), header = login.response.headers.get('set-cookie')!;
  expect(header).toContain('Secure'); expect(header).toContain('Path=/'); expect(header).not.toContain('Domain=');
  expect((await f.req('/auth/me')).status).toBe(200);
  expect((await f.req('/auth/me', 'GET', undefined, { Cookie: f.getCookie().replace('__Host-', '') })).status).toBe(401);
});
it('F-H1: username-wide throttle slows distributed failures but allows a correct password', async () => {
  const f = await fixture();
  for (let i = 0; i < 100; i++) await f.store.rateLimitHit(usernameRateKey('Phil'), 900);
  expect((await f.req('/auth/login', 'POST', { username:'Phil', password:'bad' }, { 'X-Forwarded-For':'192.0.2.90' })).status).toBe(429);
  expect((await f.req('/auth/login', 'POST', { username:'Phil', password:'Phil' }, { 'X-Forwarded-For':'192.0.2.91' })).status).toBe(200);
});
it('bootstrap policy false retains advisory weakness and rejects malformed flag values', async () => {
  const f = await fixture(false, {adminForcePasswordChange:false});
  const me = await (await f.req('/auth/me')).json(); expect(me.passwordWeak).toBe(true); expect(me.user.mustChangePassword).toBe(false);
  expect((await f.req('/dashboard')).status).toBe(200);
  expect(() => loadConfig({ADMIN_FORCE_PASSWORD_CHANGE:'yes'}, () => {})).toThrow('ADMIN_FORCE_PASSWORD_CHANGE');
});
it('F-H3: the first edit seals a duplicated document’s creation revision', async () => {
  const f = await fixture(), d = await create(f,'events',{title:'Original',date:'2030-01-03'});
  const duplicate = await f.req(`/docs/events/${d.id}/duplicate`,'POST'); expect(duplicate.status).toBe(201);
  const copy = (await duplicate.json()).doc;
  expect((await f.req(`/docs/events/${copy.id}`,'PUT',{baseVersion:1,draft:{title:'Edited copy',date:'2030-01-03'}})).status).toBe(200);
  const history = await f.store.listRevisions('events',copy.id,10);
  expect(history).toHaveLength(2); expect(history.find(r=>r.action==='duplicated')?.sealedAt).toBeTruthy();
});
it('F-H1: a correct password from a different IP survives an attacker’s account lock', async () => {
  const f = await fixture();
  for (let i=0;i<5;i++) await f.req('/auth/login','POST',{username:'Phil',password:'bad'});
  expect((await f.req('/auth/login','POST',{username:'Phil',password:'Phil'},{'X-Forwarded-For':'192.0.2.101'})).status).toBe(200);
});
