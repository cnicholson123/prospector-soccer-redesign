import type { Store } from '../store/types';
import { ApiError } from '../http/middleware/errors';
export async function rateLimit(store: Store, key: string, limit: number, seconds: number, now = new Date()) {
  const result = await store.rateLimitHit(key, seconds);
  if (result.count > limit) throw new ApiError(429, 'rate_limited', 'Too many requests', undefined, Math.max(1, Math.ceil((Date.parse(result.resetAt) - now.getTime()) / 1000)));
}
export interface LockState { failures: number; locks: number; until?: string }
export const lockKey = (username: string) => `login-lock-${Buffer.from(username.toLowerCase()).toString('base64url')}`;
export async function failedLogin(store: Store, username: string, now: Date): Promise<LockState> {
  return store.loginFailure(lockKey(username), now.toISOString());
}
