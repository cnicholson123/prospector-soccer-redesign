import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { Pool } from '@neondatabase/serverless';
import { postgresPool } from '../server/store/postgres';
export async function migrate(pool: Pool): Promise<void> {
  const sql = await readFile(new URL('../server/store/postgres-schema.sql', import.meta.url), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(734215906)');
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; migration not run (no env)');
  const pool = postgresPool(process.env.DATABASE_URL);
  try { await migrate(pool); console.log('Postgres migrations applied (idempotent).'); }
  finally { await pool.end(); }
}
