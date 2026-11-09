import { timingSafeEqual } from 'node:crypto';
import type { Config } from '../config';
import { ApiError } from '../http/middleware/errors';
export function checkOrigin(request: Request, config: Config) {
  const origin = request.headers.get('origin');
  const allowed = [config.publicBaseUrl, ...(!config.production ? ['http://localhost:5173'] : [])];
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && !allowed.includes(origin))) throw new ApiError(403, 'forbidden', 'Request origin is not allowed');
}
export function checkCsrf(request: Request, csrfToken: string, config: Config) {
  checkOrigin(request, config);
  const token = request.headers.get('x-csrf-token') ?? '';
  if (!safeEqual(token, csrfToken)) throw new ApiError(403, 'forbidden', 'Invalid CSRF token');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
