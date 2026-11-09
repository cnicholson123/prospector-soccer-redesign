import { signal } from '@preact/signals';
import type { User } from '../../shared/types.js';
export interface Session { user: Omit<User, 'passwordHash'>; csrfToken: string; passwordWeak: boolean; permissions: string[] }
export const session = signal<Session | null>(null);
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown, readonly retryAfter?: number) { super(message); }
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api/admin' + path, {
    method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(session.value ? { 'X-CSRF-Token': session.value.csrfToken } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) session.value = null;
    throw new ApiError(response.status, data.error?.message ?? 'Request failed. Please try again.', data.error?.details, Number(response.headers.get('Retry-After')) || undefined);
  }
  return data as T;
}
export function setSession(value: Session | null) {
  session.value = value;
  try { value ? localStorage.setItem('psc_admin', '1') : localStorage.removeItem('psc_admin'); } catch { /* Storage may be disabled. */ }
}
export const allowed = (permission: string) => session.value?.permissions.includes(permission) ?? false;
export const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
// In Vite development the API and preview run on :3000. Built deployments use this origin.
export const publicOrigin = typeof location === 'undefined' ? 'http://localhost:3000' : location.port === '5173' ? `${location.protocol}//${location.hostname}:3000` : location.origin;
