import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAdminApp } from '../../server/http/hono-app.js';
import { loadConfig } from '../../server/config.js';
import { KvStore } from '../../server/store/kv-store.js';
import { FsPrimitives } from '../../server/store/primitives/fs.js';
import { postgresFixture } from '../helpers/postgres.js';
import { dbMetrics, newDbMetrics } from '../../server/store/metrics.js';
import { instanceWork } from '../../server/http/middleware/instance-work.js';
import { newSession } from '../../server/auth/session.js';
import { audit } from '../../server/audit.js';
import type { Store, User } from '../../server/store/types.js';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
const at = new Date('2030-01-01T12:00:00Z');
async function fixture(postgres: boolean) {
  const root = await mkdtemp(resolve('.cache/performance-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const primitives = new FsPrimitives(root);
  let writes = 0;
  const pg = postgres ? await postgresFixture({ now: () => at, afterWrite: () => writes++ }) : undefined;
  if (pg) cleanups.push(pg.cleanup);
  const store: Store = pg?.store ?? new KvStore({ get: k => primitives.get(k), list: k => primitives.list(k),
    put: async (k,v) => { writes++; await primitives.put(k,v); }, delete: async k => { writes++; await primitives.delete(k); } }, { exclusive: primitives.exclusive });
  const config = loadConfig({ DATA_DIR: root, SESSION_SECRET: 'x'.repeat(32) }, () => undefined);
  let now = at;
  const app = createAdminApp(() => store, { config, now: () => now });
  const login = await app.request('/api/admin/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Phil', password: 'Phil' }) });
  expect(login.status).toBe(200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const csrf = (await login.json()).csrfToken;
  const req = (path: string, method = 'GET', body?: unknown) => app.request('/api/admin' + path, { method, headers: { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { store, pg, req, clock: (date: Date) => { now = date; }, writes: () => writes, reset: () => { writes = 0; } };
}
function timing(response: Response, name: string) { return Number(response.headers.get('server-timing')?.match(new RegExp(`${name};desc="(\\d+)"`))?.[1]); }
for (const postgres of [false, true]) describe.skipIf(postgres && !process.env.DATABASE_URL)(`admin performance ${postgres ? 'Postgres' : 'FS'}`, () => {
  it('keeps steady GET/HEAD reads write-free and uses a single counts aggregate', async () => {
    const f = await fixture(postgres);
    await f.req('/dashboard'); // Warm persisted health cache and schedule state.
    for (const path of ['/auth/me','/auth/sessions','/users','/reviews','/search?title=1&q=test','/docs/events','/counts','/pending','/dashboard','/media','/media?unused=1','/media?missingAlt=1','/media/missing/usage']) {
      f.reset();
      const response = await f.req(path);
      expect(response.status).toBe(200);
      expect(f.writes(), path).toBe(0);
      expect(timing(response, 'db_writes'), path).toBe(0);
      expect(response.headers.get('server-timing')).toMatch(/auth;dur=.*ratelimit;dur=.*settle;dur=.*handler;dur=.*db;dur=/);
      if (postgres && path === '/counts') expect(timing(response, 'db_count')).toBe(1);
      if (postgres && path === '/auth/me') expect(timing(response, 'db_count')).toBeLessThanOrEqual(2);
      console.info(`${postgres ? 'Postgres' : 'FS'} ${path}: ${timing(response, 'db_count')} SQL, ${f.writes()} writes`);
    }
    f.reset(); expect((await f.req('/docs/events', 'HEAD')).status).toBe(200); expect(f.writes()).toBe(0);
    const metrics = newDbMetrics();
    const counts = await dbMetrics.run(metrics, () => f.store.adminCounts());
    expect(counts.pendingCount).toBe(0); expect(counts.counts.events).toBe(0);
    if (postgres) expect(metrics.count).toBe(1);
  });
  it('refreshes once at 15 minutes and never takes a global lock for session/rate/meta/maintenance', async () => {
    const f = await fixture(postgres);
    const owner = (await f.store.listUsers())[0];
    const { session } = await newSession(f.store, owner, {}, at);
    const metrics = newDbMetrics();
    const refresh = await dbMetrics.run(metrics, () => Promise.all(Array.from({ length: 5 }, () => f.store.refreshSession(session.hash, new Date(at.getTime()+900000).toISOString()))));
    expect(refresh.filter(r => r?.refreshed)).toHaveLength(1);
    await f.store.rateLimitHit('independent', 300); await f.store.setMeta('independent', true);
    expect(await f.store.claimMaintenance('independent-claim', 600000, at.toISOString())).toBe(true);
    expect(await f.store.claimMaintenance('independent-claim', 600000, at.toISOString())).toBe(false);
    if (postgres) expect(metrics.statements.some(sql => sql.includes('pg_advisory'))).toBe(false);
    f.reset();
    await Promise.all(Array.from({ length: 5 }, (_, i) => f.store.setScheduleError({ at: new Date(at.getTime()+i).toISOString() })));
    expect(f.writes()).toBe(1);
    f.reset(); await Promise.all(Array.from({ length: 5 }, () => f.store.setScheduleError(null)));
    expect(f.writes()).toBe(1);
  });
  it('observes new schedules across instances and only settles due work or changes the error state', async () => {
    const f = await fixture(postgres);
    await f.req('/docs/events'); // Cache the initial schedule generation.
    const created = await f.req('/docs/events', 'POST', { draft: { title: 'Scheduled event', date: '2030-01-03' } });
    const doc = (await created.json()).doc;
    const { scheduleDocuments } = await import('../../server/content/schedule.js');
    await scheduleDocuments(f.store, [{ collection: 'events', id: doc.id, expectedVersion: doc.version }], '2030-01-01T12:05:00Z', { id: 'test', displayName: 'Test' }, at);
    const capture = vi.spyOn(f.store, 'capturePublication');
    f.clock(new Date('2030-01-01T12:04:59Z')); f.reset();
    expect((await f.req('/docs/events')).status).toBe(200);
    expect(capture).not.toHaveBeenCalled(); expect(f.writes()).toBe(0);
    capture.mockRejectedValue(new Error('Temporary settlement failure'));
    f.clock(new Date('2030-01-01T12:05:00Z'));
    const meta = vi.spyOn(f.store, 'setScheduleError');
    await f.req('/docs/events'); await f.req('/docs/events');
    expect(meta.mock.calls).toHaveLength(1);
    capture.mockRestore();
    await f.req('/docs/events');
    expect(meta.mock.calls).toHaveLength(2);
    expect(await f.store.getMeta('schedule-error')).toBeNull();
    expect((await f.store.getDoc('events', doc.id))?.published).toBeDefined();
    f.reset(); await f.req('/docs/events'); expect(f.writes()).toBe(0);
  });
  it('rejects a stale health cache written after a concurrent content mutation', async () => {
    const f = await fixture(postgres);
    const oldDocs = await f.store.listAllDocs();
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(f.store, 'listAllDocs').mockImplementationOnce(async () => { entered(); await held; return oldDocs; });
    const stale = f.req('/dashboard?section=health');
    await ready;
    expect((await f.req('/docs/events', 'POST', { draft: { title: 'Concurrent past event', date: '2020-01-01' } })).status).toBe(201);
    release(); await stale;
    const current = await (await f.req('/dashboard?section=health')).json();
    expect(current.health.some((issue: { code: string }) => issue.code === 'past_event')).toBe(true);
  });
  it('invalidates persisted health on edits, keeps private findings scoped, and splits sections', async () => {
    const f = await fixture(postgres);
    const a = await f.req('/dashboard?section=health'); expect(a.status).toBe(200);
    expect(await f.store.getMeta('health-cache')).not.toBeNull();
    const created = await f.req('/docs/events', 'POST', { draft: { title: 'Past event', date: '2020-01-01' } });
    expect(created.status).toBe(201);
    expect(await f.store.getMeta('health-cache')).toBeNull();
    const health = await (await f.req('/dashboard?section=health')).json();
    expect(health.health.some((i: { code: string }) => i.code === 'past_event')).toBe(true);
    expect(health).not.toHaveProperty('recent');
    const counts = await (await f.req('/counts')).json(); expect(counts.pendingCount).toBe(1); expect(counts.counts.events).toBe(1);
    const activity = await (await f.req('/dashboard?section=activity')).json(); expect(activity).toHaveProperty('recent'); expect(activity).not.toHaveProperty('health');
    expect((await f.req('/dashboard?section=invalid')).status).toBe(422);
  });
});
if (!process.env.DATABASE_URL) console.info('Postgres performance acceptance: not run (no env)');
it('keeps API limiter instance-local, bounded by its expiry, with the original threshold', () => {
  const first = instanceWork(), second = instanceWork();
  for (let i=0;i<600;i++) first.rateLimit('a', 0);
  expect(() => first.rateLimit('a', 0)).toThrow('Too many requests');
  expect(() => second.rateLimit('a', 0)).not.toThrow();
  expect(() => first.rateLimit('a', 300000)).not.toThrow();
});

it.skipIf(!process.env.DATABASE_URL)('runs Neon HTTP single-statement reads and row writes against local Postgres; transactions stay on Pool', async () => {
  const { postgresRead } = await import('../../server/store/postgres.js');
  const { PostgresStore } = await import('../../server/store/postgres-store.js');
  const f = await fixture(true);
  const sent: string[] = [];
  // Model Neon's HTTP wire response with the local PostgreSQL fixture, not a cloud service.
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
    const { query, params } = JSON.parse(String(init.body)) as { query: string; params: unknown[] };
    sent.push(query);
    const result = await f.pg!.pool.query({ text: query, values: params, rowMode: 'array' });
    return new Response(JSON.stringify({ fields: result.fields.map(field => ({ name: field.name, dataTypeID: field.dataTypeID })), rows: result.rows.map((row: unknown[]) => row.map(value => value == null ? null : typeof value === 'string' ? value : JSON.stringify(value))), rowCount: result.rowCount, command: result.command }), { headers: { 'Content-Type': 'application/json' } });
  });
  try {
    const store = new PostgresStore(f.pg!.pool, { readQuery: postgresRead(f.pg!.pool.options.connectionString!), now: () => at });
    const metrics = newDbMetrics();
    expect((await dbMetrics.run(metrics, () => store.adminCounts())).pendingCount).toBe(0);
    expect(metrics.count).toBe(1); expect(sent).toHaveLength(1);
    const owner = (await store.listUsers())[0];
    const { session } = await newSession(store, owner, {}, at);
    expect((await store.getSessionContext(session.hash))?.user?.id).toBe(owner.id);
    expect(sent.some(sql => /^INSERT INTO sessions/.test(sql))).toBe(true);
    expect(sent.some(sql => /BEGIN|pg_advisory/.test(sql))).toBe(false);
    const before = sent.length;
    await store.recordAudit(audit(owner, 'test.http-transport', {}, at));
    expect(sent).toHaveLength(before); // Audit is an explicit multi-statement transaction.
  } finally { vi.unstubAllGlobals(); }
});

it('clears an old schedule error when a new snapshot has no due items', async () => {
  const work = instanceWork();
  const getMeta = vi.fn().mockResolvedValue({ at: at.toISOString() });
  const setScheduleError = vi.fn().mockResolvedValue(undefined);
  const store = { getMeta, setScheduleError } as unknown as Store;
  await work.settle(store, at, { scheduleVersion: 2, nextDueAt: null });
  await work.settle(store, at, { scheduleVersion: 2, nextDueAt: null });
  expect(setScheduleError).toHaveBeenCalledExactlyOnceWith(null);
  expect(getMeta).toHaveBeenCalledTimes(1);
});

it('dedicated presence heartbeat makes no filesystem writes', async () => {
  const f = await fixture(false);
  const { doc } = await (await f.req('/docs/events', 'POST', { draft: { title: 'Open event', date: '2030-01-04' } })).json();
  f.reset();
  expect((await f.req(`/docs/events/${doc.id}/presence`, 'POST')).status).toBe(200);
  expect(f.writes()).toBe(0);
  expect((await f.req(`/docs/events/${doc.id}`)).status).toBe(200);
  expect(f.writes()).toBe(0);
});
