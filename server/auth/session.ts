import { createHash, randomBytes } from 'node:crypto';
import type { Store } from '../store/types';
import type { Session, User } from '../../shared/types';
import type { Config } from '../config';
export const DAY = 86400000;
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export function cookie(token: string, config: Config, expires = 14 * DAY / 1000) {
  return `psc_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expires}${config.cookieSecure ? '; Secure' : ''}`;
}
export async function newSession(store: Store, user: User, context: { ip?: string; userAgent?: string }, now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  const session: Session = { hash: tokenHash(token), userId: user.id, createdAt: now.toISOString(), lastSeenAt: now.toISOString(), expiresAt: new Date(now.getTime() + 14 * DAY).toISOString(), csrfToken: randomBytes(32).toString('base64url'), authVersion: user.authVersion ?? 0, ip: context.ip, userAgent: context.userAgent };
  await store.putSession(session);
  return { token, session };
}
export async function readSession(store: Store, request: Request, now = new Date()) {
  const token = /(?:^|;\s*)psc_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(request.headers.get('cookie') ?? '')?.[1];
  if (!token) return null;
  const session = await store.getSession(tokenHash(token));
  if (!session) return null;
  const user = await store.getUser(session.userId);
  if (!user?.active || (session.authVersion ?? 0) !== (user.authVersion ?? 0) || Date.parse(session.expiresAt) <= now.getTime() || Date.parse(session.createdAt) + 30 * DAY <= now.getTime()) {
    await store.deleteSession(session.hash); return null;
  }
  if (now.getTime() - Date.parse(session.lastSeenAt) >= 3600000) {
    const result = await store.refreshSession(session.hash, now.toISOString());
    return result ? { user, session: result.session, token, refreshed: result.refreshed } : null;
  }
  return { user, session, token, refreshed: false };
}
export async function revokeSessions(store: Store, userId: string, except?: string) {
  for (const session of await store.listSessions(userId)) if (session.hash !== except) await store.deleteSession(session.hash);
}
