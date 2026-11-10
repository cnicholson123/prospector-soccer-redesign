import { afterEach, expect, it, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { adminFixture, createUserWithPassword } from '../helpers/admin.js';
import * as passwords from '../../server/auth/password.js';
import { audit } from '../../server/audit.js';
import { saveDraft } from '../../server/content/revisions.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() { const f = await adminFixture(); roots.push(f.root); return f; }
const event = (title: string) => ({ title, date: '2030-01-03' });

it('rejects cross-site login before consuming the victim IP login budget', async () => {
  const f = await fixture();
  const limit = vi.spyOn(f.store, 'rateLimitHit');
  for (let i = 0; i < 12; i++) expect((await f.req('/auth/login', 'POST', { username: 'Phil', password: 'wrong' }, { Origin: 'https://evil.example' })).status).toBe(403);
  expect(limit).not.toHaveBeenCalled();
  expect((await f.login()).response.status).toBe(200);
});

it('password reset clears login locks while revoking old sessions and requiring password rotation', async () => {
  const f = await fixture(); await f.login();
  const created = await (await createUserWithPassword(f, { username: 'editor', role: 'Editor', password: 'Fieldside secure phrase' })).json();
  for (let i = 0; i < 5; i++) await f.req('/auth/login', 'POST', { username: 'editor', password: 'wrong' });
  expect((await f.req('/auth/login', 'POST', { username: 'editor', password: 'Fieldside secure phrase' })).status).toBe(423);
  const reset = await f.req(`/users/${created.user.id}/reset-password`, 'POST'); expect(reset.status).toBe(200);
  const login = await f.login('editor', (await reset.json()).temporaryPassword);
  expect(login.response.status).toBe(200); expect(login.data.user.mustChangePassword).toBe(true);
});

it('checks target permission and self-reset before hashing, preserving self sign-out everywhere', async () => {
  const f = await fixture(); const owner = await f.login();
  const admin = await (await createUserWithPassword(f, { username: 'admin', role: 'Admin', password: 'Fieldside secure phrase' })).json();
  const hash = vi.spyOn(passwords, 'hashPassword');
  expect((await f.req(`/users/${owner.data.user.id}/reset-password`, 'POST')).status).toBe(403);
  expect((await f.req('/auth/me')).status).toBe(200);
  await f.login('admin', 'Fieldside secure phrase'); hash.mockClear();
  expect((await f.req('/users', 'POST', { username: 'forbidden', role: 'Owner' })).status).toBe(403);
  expect((await f.req(`/users/${owner.data.user.id}/reset-password`, 'POST')).status).toBe(403);
  expect(hash).not.toHaveBeenCalled();
  expect((await f.req(`/users/${admin.user.id}/revoke-sessions`, 'POST')).status).toBe(200);
  expect((await f.req('/auth/me')).status).toBe(401);
});

for (const concurrentEdit of [false, true]) it(`appends after a seal/coalesce race${concurrentEdit ? ' with a concurrent version conflict' : ''}`, async () => {
  const f = await fixture(); const login = await f.login();
  const actor = { id: login.data.user.id, displayName: login.data.user.displayName };
  const created = (await (await f.req('/docs/events', 'POST', { draft: event('Original') })).json()).doc;
  const doc = (await (await f.req(`/docs/events/${created.id}`, 'PUT', { baseVersion: created.version, draft: event('Working') })).json()).doc;
  const working = (await f.store.listRevisions('events', doc.id, 1))[0];
  const mutate = f.store.mutateDoc.bind(f.store);
  const writes = vi.spyOn(f.store, 'mutateDoc').mockImplementation(mutate);
  writes.mockImplementationOnce(async mutation => {
    await f.store.sealWorkingRevisions(actor.id, '2030-01-01T12:00:00.000Z', audit(actor, 'test.seal', {}, new Date('2030-01-01T12:00:00Z')));
    return mutate(mutation);
  });
  if (concurrentEdit) writes.mockImplementationOnce(async mutation => {
    // Another writer can win the document CAS after the sealed-revision
    // failure but before the append retry. The retry must report a conflict.
    await saveDraft(f.store, doc, doc.version, event('Other writer'), { id: 'other', displayName: 'Other writer' }, new Date('2030-01-01T12:00:00Z'));
    return mutate(mutation);
  });
  const saving = saveDraft(f.store, doc, doc.version, event('Saved after seal'), actor, new Date('2030-01-01T12:00:00Z'));
  if (concurrentEdit) {
    await expect(saving).rejects.toMatchObject({ status: 409, code: 'conflict' });
    expect((await f.store.getDoc('events', doc.id))?.draft).toEqual(event('Other writer'));
  } else {
    expect((await saving).version).toBe(doc.version + 1);
    expect(writes).toHaveBeenCalledTimes(2); expect(writes.mock.calls[1][0].revision).toHaveProperty('append');
    expect((await f.store.listRevisions('events', doc.id, 100))).toHaveLength(3);
    expect((await f.store.queryAudit({ action: 'content.edited', docId: doc.id, limit: 100 })).items).toHaveLength(2);
  }
  expect(await f.store.getRevision(doc.id, working.id)).toEqual({ ...working, sealedAt: '2030-01-01T12:00:00.000Z' });
});
