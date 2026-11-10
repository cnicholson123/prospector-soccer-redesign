import { isDeepStrictEqual } from 'node:util';
import type { User } from './types.js';
import { can } from '../permissions.js';
import { ApiError } from '../http/middleware/errors.js';

/** The stores call this inside their writer lock, using the current actor. */
export function authorizeUserChange(actor: User | null, old: User | null, next: User) {
  if (!actor?.active) throw new ApiError(403, 'forbidden', 'Role exceeds your permission');
  const self = old?.id === actor.id;
  if (self && old.passwordHash !== next.passwordHash) throw new ApiError(403, 'forbidden', 'Use your profile to change your own password');
  if (self && old.role !== next.role) throw new ApiError(403, 'forbidden', 'You cannot change your own role');
  if (self && !next.active) throw new ApiError(403, 'forbidden', 'You cannot deactivate your own account');
  if (self && !can(actor, 'users.manage')) {
    const { displayName: _oldName, email: _oldEmail, ...previous } = old;
    const { displayName: _newName, email: _newEmail, ...updated } = next;
    if (isDeepStrictEqual(previous, updated)) return;
  } else if (self || can(actor, 'users.manage', { role: next.role }) && (!old || can(actor, 'users.manage', { role: old.role }))) return;
  throw new ApiError(403, 'forbidden', 'Role exceeds your permission');
}
