import { Pool, neon, neonConfig } from '@neondatabase/serverless';
// Node >=22 provides WebSocket. Only interactive transactions need Pool.
neonConfig.webSocketConstructor = WebSocket;
const pools = new Map<string, Pool>();
export function postgresPool(connectionString: string, reuse = false): Pool {
  const existing = pools.get(connectionString);
  if (reuse && existing && !existing.ended) return existing;
  const pool = new Pool({ connectionString, max: 4, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 });
  // Idle WebSocket disconnects are normal when Neon scales to zero. The pool
  // removes that client; listening prevents EventEmitter from crashing Node.
  pool.on('error', () => { console.error('Postgres idle connection failed; connection removed from pool'); });
  if (reuse) pools.set(connectionString, pool);
  return pool;
}
export function postgresRead(connectionString: string) {
  const sql = neon(connectionString);
  return (query: string, values: unknown[]) => sql.query(query, values);
}
