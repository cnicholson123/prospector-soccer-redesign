import { Pool, neonConfig } from '@neondatabase/serverless';
// Node >=22 provides WebSocket. Neon Pool supports interactive transactions.
neonConfig.webSocketConstructor = WebSocket;
export function postgresPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 4, idleTimeoutMillis: 1000, connectionTimeoutMillis: 15000 });
}
