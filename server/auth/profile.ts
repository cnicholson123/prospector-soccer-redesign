import type { User } from '../store/types.js';
import { validateFields } from '../content/validate.js';
import { ApiError } from '../http/middleware/errors.js';

export function profileEmail(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!validateFields({ email: { type: 'email' } }, { email: value }).valid) throw new ApiError(422, 'validation', 'Invalid email');
  return value as string;
}
export function userChanges(before: User, after: User) {
  return Object.fromEntries((['username', 'displayName', 'email', 'role', 'active'] as const)
    .filter(key => before[key] !== after[key])
    .map(key => [key, { before: before[key] ?? null, after: after[key] ?? null }]));
}
