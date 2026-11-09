import { AsyncLocalStorage } from 'node:async_hooks';
export interface DbMetrics { count: number; writes: number; time: number; statements: string[]; stages: Record<string, number> }
export const dbMetrics = new AsyncLocalStorage<DbMetrics>();
export const newDbMetrics = (): DbMetrics => ({ count: 0, writes: 0, time: 0, statements: [], stages: {} });
/** Counts every SQL statement, including transaction control, per async request. */
export async function measureQuery<T>(sql: string, query: () => Promise<T>): Promise<T> {
  const metrics = dbMetrics.getStore(), start = performance.now();
  if (metrics) { metrics.count++; metrics.statements.push(sql); if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) metrics.writes++; }
  try { return await query(); } finally { if (metrics) metrics.time += performance.now() - start; }
}
export async function stage<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try { return await operation(); } finally { const metrics = dbMetrics.getStore(); if (metrics) metrics.stages[name] = (metrics.stages[name] ?? 0) + performance.now() - start; }
}
