import type { CollectionName } from './schema';
export type Role = 'Owner' | 'Admin' | 'Editor' | 'Contributor' | 'Viewer';
export type DocStatus = 'draft' | 'published' | 'changed' | 'scheduled' | 'review' | 'trashed';
export interface Doc<T = unknown> {
  id: string; collection: CollectionName; draft: T; published?: T;
  version: number; publishedVersion?: number; order?: number; status: DocStatus;
  reviewRequestedBy?: string; reviewNote?: string; scheduledAt?: string;
  trashedAt?: string; trashedBy?: string;
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
}
export interface PublishedDoc<T = unknown> { id: string; collection: CollectionName; data: T; version: number; order?: number }
export interface ScheduledItem { collection: CollectionName; id: string; at: string; data: unknown; version: number; order?: number }
export interface Snapshot {
  siteVersion: number; publishedAt: string;
  docs: Partial<Record<CollectionName, PublishedDoc[]>>;
  scheduled: ScheduledItem[]; templateHash: string;
}
export interface Revision {
  id: string; collection: CollectionName; docId: string; docVersion: number;
  authorId: string; authorName: string; at: string; sealedAt?: string;
  action: 'created' | 'edited' | 'checkpoint' | 'published' | 'unpublished' | 'restored' | 'trashed' | 'untrashed' | 'scheduled' | 'site_restored';
  summary?: string; data: unknown; baseRevId?: string; publishSiteVersion?: number;
}
export interface PublishRecord {
  siteVersion: number; at: string; actorId: string; summary?: string;
  manifest: { collection: CollectionName; id: string; version: number; title: string; revId: string }[];
  kind: 'publish' | 'restore' | 'schedule'; restoredFrom?: number;
}
export interface AuditEntry {
  id: string; at: string; actorId: string; actorName: string; action: string;
  collection?: CollectionName; docId?: string; targetTitle?: string;
  meta?: Record<string, unknown>; ip?: string; userAgent?: string;
}
export interface User {
  id: string; username: string; displayName: string; email?: string; role: Role;
  passwordHash: string; active: boolean; createdAt: string; createdBy: string;
  lastLoginAt?: string; passwordChangedAt?: string; mustChangePassword?: boolean;
}
export interface Session {
  hash: string; userId: string; createdAt: string; lastSeenAt: string; expiresAt: string;
  ip?: string; userAgent?: string; csrfToken: string;
}
export interface ValidationIssue { path: string; message: string }
export interface ValidationResult { valid: boolean; errors: ValidationIssue[] }
