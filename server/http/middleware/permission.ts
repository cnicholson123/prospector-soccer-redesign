import type { MiddlewareHandler } from 'hono';
import type { Permission } from '../../../shared/permissions-table.js';
import type { CollectionName } from '../../../shared/schema.js';
import { can } from '../../permissions.js';
import { ApiError } from './errors.js';
import type { AdminEnv } from './auth.js';
export function requirePermission(permission: Permission): MiddlewareHandler<AdminEnv> {
  return async (c, next) => {
    if (!can(c.get('user'), permission, { collection: c.req.param('collection') as CollectionName | undefined })) throw new ApiError(403, 'forbidden', 'You do not have permission for this action');
    await next();
  };
}
