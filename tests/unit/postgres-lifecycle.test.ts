import { expect, it, vi } from 'vitest';
import type { Pool } from '@neondatabase/serverless';
import { postgresPool } from '../../server/store/postgres.js';
import { PostgresStore } from '../../server/store/postgres-store.js';
import type { AuditEntry } from '../../server/store/types.js';
const entry: AuditEntry = { id: 'aud_test', at: '2030-01-01T00:00:00.000Z', actorId: 'owner', actorName: 'Owner', action: 'test' };

it('handles idle pool errors without leaking their messages, and closes the pool', async () => {
  const pool = postgresPool('postgres://test:test@localhost/test');
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    expect(() => pool.emit('error', new Error('secret connection detail'))).not.toThrow();
    expect(log).toHaveBeenCalledWith('Postgres idle connection failed; connection removed from pool');
    const store = new PostgresStore(pool); await store.close(); await store.close();
    expect(pool.ended).toBe(true);
  } finally { log.mockRestore(); if (!pool.ended) await pool.end(); }
});

for (const rollbackFails of [false, true]) it(`preserves the mutation error and ${rollbackFails ? 'discards a client after failed rollback' : 'releases after successful rollback'}`, async () => {
  const original = new Error('original write failed'), rollback = new Error('connection lost');
  const query = vi.fn(async (sql: string) => {
    if (sql === 'ROLLBACK' && rollbackFails) throw rollback;
    return { rows: sql.startsWith('INSERT INTO audit') ? [{ id: entry.id }] : [] };
  });
  const release = vi.fn(); const client = { query, release };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  const store = new PostgresStore(pool, { afterWrite: () => { throw original; } });
  await expect(store.recordAudit(entry)).rejects.toBe(original);
  expect(query).toHaveBeenCalledWith('ROLLBACK');
  expect(release).toHaveBeenCalledWith(rollbackFails ? rollback : undefined);
});

it('seals logout revisions with a targeted SQL update instead of fetching their bodies', async () => {
  const query = vi.fn(async (sql: string) => ({ rows: sql.startsWith('INSERT INTO audit') || sql.startsWith('UPDATE revisions') ? [{ id: 'changed' }] : [] }));
  const client = { query, release: vi.fn() };
  const store = new PostgresStore({ connect: async () => client } as unknown as Pool);
  expect(await store.revokeSessions('owner', entry, { seal: true })).toBe(true);
  expect(query).toHaveBeenCalledWith(expect.stringMatching(/^UPDATE revisions .*WHERE sealed_at IS NULL AND author_id=\$1/), ['owner', entry.at]);
  expect(query.mock.calls.some(([sql]) => /^SELECT body FROM revisions/.test(sql))).toBe(false);
});
