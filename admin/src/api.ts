import { signal } from '@preact/signals';
import type { User } from '../../shared/types.js';
export interface Session { user: Omit<User, 'passwordHash'>; csrfToken: string; passwordWeak: boolean; permissions: string[] }
export const session = signal<Session | null>(null);
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown, readonly retryAfter?: number) { super(message); }
}
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api/admin' + path, {
    method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(session.value ? { 'X-CSRF-Token': session.value.csrfToken } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  // Hosting/proxy errors can contain HTML or no body at all. Preserve their
  // HTTP status so validation failures are never mistaken for offline retries.
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    if (response.status === 401 && (!path.startsWith('/auth/') || path === '/auth/logout' || path === '/auth/me')) setSession(null);
    const error = data && typeof data === 'object' && 'error' in data ? data.error : undefined;
    const detail = error && typeof error === 'object' ? error as { message?: unknown; details?: unknown } : undefined;
    throw new ApiError(response.status, typeof detail?.message === 'string' ? detail.message : 'Request failed. Please try again.', detail?.details, Number(response.headers.get('Retry-After')) || undefined);
  }
  if (data === undefined) throw new ApiError(response.status, 'The server returned an unreadable response. Please try again.');
  return data as T;
}
export function setSession(value: Session | null) {
  if ((session.value && session.value.user.id !== value?.user.id) || value === null) invalidateCache();
  session.value = value;
  try { value ? localStorage.setItem('psc_admin', '1') : localStorage.removeItem('psc_admin'); } catch { /* Storage may be disabled. */ }
}
export const allowed = (permission: string) => session.value?.permissions.includes(permission) ?? false;
export const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
// In Vite development the API and preview run on :3000. Built deployments use this origin.
export const publicOrigin = typeof location === 'undefined' ? 'http://localhost:3000' : location.port === '5173' ? `${location.protocol}//${location.hostname}:3000` : location.origin;

// Private, page-lifetime cache only. An epoch prevents old in-flight responses
// repopulating data after a write, sign-out, or account change.
let epoch = 0;
const cache = new Map<string, unknown>();
const fetchedAt = new Map<string, number>();
const pending = new Map<string, Promise<unknown>>();
export function invalidateCache() { epoch++; cache.clear(); fetchedAt.clear(); pending.clear(); }
export function peek<T>(path: string): T | undefined { return cache.get(path) as T | undefined; }
export function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (method !== 'GET') return path.endsWith('/presence') ? request<T>(path, method, body) : request<T>(path, method, body).finally(invalidateCache);
  // Review is a fresh snapshot after editor flushes, never a shared read that
  // may have started before the latest save (including raw media uploads).
  if (path.split('?')[0] === '/pending') return request<T>(path);
  const existing = pending.get(path);
  if (existing) return existing as Promise<T>;
  const generation = epoch;
  const promise = request<T>(path).then(data => {
    if (generation === epoch) {
      if (path.startsWith('/docs/')) {
        cache.set(path, data);
        if (cache.size > 200) cache.delete(cache.keys().next().value!);
      }
      fetchedAt.set(path, Date.now());
      if (fetchedAt.size > 200) fetchedAt.delete(fetchedAt.keys().next().value!);
    }
    return data;
  }).finally(() => { if (pending.get(path) === promise) pending.delete(path); });
  pending.set(path, promise);
  return promise;
}
export function prefetch(path: string) {
  if (Date.now() - (fetchedAt.get(path) ?? 0) < 10000) return;
  void api(path).catch(() => {});
}
export async function cachedApi<T>(path: string, updated: (value: T) => void): Promise<T> {
  const saved = peek<T>(path), generation = epoch;
  const refresh = api<T>(path);
  if (saved === undefined) return refresh;
  void refresh.then(value => { if (generation === epoch) updated(value); }).catch(() => {});
  return saved;
}
let validation: Promise<void> | undefined;
export function loadSession() {
  return validation ??= api<Session>('/auth/me').then(setSession).catch(() => setSession(null));
}
