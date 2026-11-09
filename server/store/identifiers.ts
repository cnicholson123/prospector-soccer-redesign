import { ApiError } from '../http/middleware/errors';
export function keyPart(value: string): string {
  let size: number;
  try { size = Buffer.byteLength(encodeURIComponent(value).replace(/\./g, '%2E')); } catch { size = Infinity; }
  // Leave five bytes for the .json suffix used by filesystem keys.
  if (!value || value === '.' || value === '..' || size > 195) throw new ApiError(422, 'validation', 'Invalid storage identifier (maximum 200 encoded bytes)');
  return value;
}
export function documentId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) throw new ApiError(422, 'validation', 'Invalid document id');
  return value;
}
export function username(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.@-]{1,100}$/.test(value) || value === '.' || value === '..') throw new ApiError(422, 'validation', 'Invalid username');
  return value;
}
