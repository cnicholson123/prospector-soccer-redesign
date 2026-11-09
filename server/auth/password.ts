import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import common from './common-passwords.json';
import { ApiError } from '../http/middleware/errors';
// First 1,000 entries of SecLists Common-Credentials/10k-most-common.txt.
// https://github.com/danielmiessler/SecLists (MIT); see common-passwords.LICENSE.
const passwords = new Set(common.map(value => value.toLowerCase()));
const derive = (password: string, salt: Buffer): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, salt, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 ** 2 }, (error, key) => error ? reject(error) : resolve(key));
});
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$15$8$1$${salt.toString('base64')}$${(await derive(password, salt)).toString('base64')}`;
}
const dummySalt = Buffer.alloc(16, 73);
export async function verifyPassword(password: string, encoded?: string): Promise<boolean> {
  const parts = encoded?.split('$');
  const valid = parts?.length === 6 && parts.slice(0, 4).join('$') === 'scrypt$15$8$1';
  const salt = valid ? Buffer.from(parts[4], 'base64') : dummySalt;
  const expected = valid ? Buffer.from(parts[5], 'base64') : Buffer.alloc(64);
  const actual = await derive(password, salt.length === 16 ? salt : dummySalt);
  return !!valid && salt.length === 16 && expected.length === actual.length && timingSafeEqual(expected, actual);
}
export const passwordWeak = (password: string, username: string) => password.length < 10 || password.toLowerCase() === username.toLowerCase() || passwords.has(password.toLowerCase());
export function checkPassword(password: string, username: string) {
  if (password.length > 1024 || passwordWeak(password, username)) throw new ApiError(422, 'validation', 'Use at least 10 characters, not your username or a common password', [{ path: 'next', message: 'Choose a stronger password' }]);
}
