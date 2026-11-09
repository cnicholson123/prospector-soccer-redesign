import { randomBytes } from 'node:crypto';
import { hashPassword } from '../../server/auth/password';
export const generatedPassword = () => randomBytes(24).toString('base64url');
export async function bootstrapEnvironment() {
  const password = generatedPassword();
  const users = [{ username: 'Owner', displayName: 'Owner', role: 'Owner', passwordHash: await hashPassword(password) }];
  return { ADMIN_BOOTSTRAP_USERS: JSON.stringify(users) };
}
