import { Pool, neon, neonConfig } from '@neondatabase/serverless';
// Node >=22 provides WebSocket. Only interactive transactions need Pool.
neonConfig.webSocketConstructor = WebSocket;
const pools = new Map<string, Pool>();
export function postgresPool(connectionString: string, reuse = false): Pool {
  const existing = pools.get(connectionString);
  if (reuse && existing && !existing.ended) return existing;
  const pool = new Pool({ connectionString, max: 4, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 });
  if (reuse) pools.set(connectionString, pool);
  return pool;
}
export function postgresRead(connectionString: string) {
  const sql = neon(connectionString);
  return (query: string, values: unknown[]) => sql.query(query, values);
}
