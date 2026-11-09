import { roles } from '../../../shared/permissions-table.js';
import type { Role, User } from '../../../shared/types.js';
export type PublicUser = Omit<User, 'passwordHash'>;
export const assignableRoles = (actor: PublicUser) => roles.filter(role => actor.role === 'Owner' || roles.indexOf(role) <= roles.indexOf('Editor'));
export const canManageUser = (actor: PublicUser, target: PublicUser) => ['Owner', 'Admin'].includes(actor.role) && (actor.id === target.id || assignableRoles(actor).includes(target.role));
export function passwordStrength(value: string, username: string) {
  if (!value) return { score: 0, label: 'Enter a new password' };
  if (value.length < 10 || value.toLowerCase() === username.toLowerCase() || /^(.)\1+$/.test(value)) return { score: 1, label: 'Weak' };
  if (value.length < 14) return { score: 2, label: 'Fair' };
  if (value.length < 18) return { score: 3, label: 'Good' };
  return { score: 4, label: 'Strong' };
}
