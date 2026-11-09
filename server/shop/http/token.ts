import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export function mintCheckoutToken(secret: string, now = new Date()): string {
  const payload = Buffer.from(`${now.getTime()}.${randomBytes(24).toString('base64url')}`).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
export function verifyCheckoutToken(token: string, secret: string, now = new Date()): boolean {
  if (typeof token !== 'string' || token.length > 300) return false;
  const [payload, mac, extra] = token.split('.');
  if (!payload || !mac || extra) return false;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const decoded = Buffer.from(payload, 'base64url').toString(), timestamp = Number(decoded.split('.')[0]);
  const age = now.getTime() - timestamp;
  return /^\d+\.[A-Za-z0-9_-]{32}$/.test(decoded) && age >= 3000 && age <= 7200000;
}
