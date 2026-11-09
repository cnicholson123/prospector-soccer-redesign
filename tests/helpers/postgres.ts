import { randomBytes } from 'node:crypto';
import { neonConfig } from '@neondatabase/serverless';
import { postgresPool } from '../../server/store/postgres.js';
import { PostgresStore, type PostgresOptions } from '../../server/store/postgres-store.js';
import { migrate } from '../../scripts/db-migrate.js';
export async function postgresFixture(options: PostgresOptions = {}) {
  if (!process.env.DATABASE_URL) throw new Error('Postgres: not run (no env)');
  // Test-only local WS proxy; production always uses Neon's TLS endpoint.
  if (process.env.POSTGRES_TEST_WS_PROXY) {
    neonConfig.wsProxy = (host) => process.env.POSTGRES_TEST_WS_PROXY! + '?address=' + encodeURIComponent(host + ':');
    neonConfig.useSecureWebSocket = false; neonConfig.pipelineTLS = false; neonConfig.pipelineConnect = false;
  }
  const schema = 'contract_' + randomBytes(8).toString('hex');
  const admin = postgresPool(process.env.DATABASE_URL);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL); url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = postgresPool(url.toString());
  await migrate(pool);
  const reopen = () => new PostgresStore(pool, options);
  return { store: reopen(), reopen, pool, cleanup: async () => {
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  } };
}
