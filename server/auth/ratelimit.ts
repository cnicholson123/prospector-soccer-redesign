import { createHash } from 'node:crypto';
import type { Store } from '../store/types';
import { ApiError } from '../http/middleware/errors';
export async function rateLimit(store: Store, key: string, limit: number, seconds: number, now = new Date()) {
  const result = await store.rateLimitHit(key, seconds);
  if (result.count > limit) throw new ApiError(429, 'rate_limited', 'Too many requests', undefined, Math.max(1, Math.ceil((Date.parse(result.resetAt) - now.getTime()) / 1000)));
}
export interface LockState { failures: number; locks: number; until?: string }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const usernameRateKey = (username: string) => `login-user-${digest(username.toLowerCase())}`;
export const loginGenerationKey = (username: string) => `login-generation-${digest(username.toLowerCase())}`;
export const lockKey = (username: string, ip = 'unknown', generation = 0) => `login-lock-${digest(`${username.toLowerCase()}|${ip}|${generation}`)}`;
export async function failedLogin(store: Store, username: string, now: Date, ip = 'unknown', generation = 0): Promise<LockState> {
  return store.loginFailure(lockKey(username, ip, generation), now.toISOString());
}
