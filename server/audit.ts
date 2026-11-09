import { createHistoryId } from './content/ids.js';
import type { AuditEntry, User } from '../shared/types.js';
export interface Actor { id: string; displayName: string; ip?: string; userAgent?: string }
export function audit(actor: Actor, action: string, details: Partial<AuditEntry> = {}, now = new Date()): AuditEntry {
  return { ...details, id: createHistoryId('aud', now), at: now.toISOString(), actorId: actor.id, actorName: actor.displayName, action, ip: actor.ip, userAgent: actor.userAgent };
}
export const publicUser = ({ passwordHash: _hash, ...user }: User) => user;
