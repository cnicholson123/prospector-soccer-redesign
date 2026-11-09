import type { Role } from './types.js';
export const roles: Role[] = ['Viewer', 'Contributor', 'Editor', 'Admin', 'Owner'];
export const permissionTable = {
  'content.read': 0, 'history.read': 0,
  'content.create': 1, 'content.edit': 1, 'media.upload': 1, 'media.edit': 1,
  'content.publish': 2, 'content.manage': 2, 'media.delete': 2, 'site.settings': 2,
  'audit.read': 3, 'audit.export': 3, 'site.export': 3, 'users.manage': 3,
  'site.restore': 4, 'orders.view': 2, 'orders.fulfill': 2, 'orders.manage': 3, 'store.manage': 3,
} as const;
export type Permission = keyof typeof permissionTable;
