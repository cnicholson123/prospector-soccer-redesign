export class ApiError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 423 | 429, readonly code: string, message: string, readonly details?: unknown, readonly retryAfter?: number) { super(message); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(422, 'validation', 'Expected a JSON object');
  return value as Record<string, unknown>;
}
export function string(value: unknown, name: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError(422, 'validation', `Invalid ${name}`, [{ path: name, message: `Required text, maximum ${max} characters` }]);
  return value;
}
export function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ApiError(422, 'validation', 'A positive baseVersion is required');
  return Number(value);
}
