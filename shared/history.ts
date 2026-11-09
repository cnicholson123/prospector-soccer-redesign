import type { CollectionName } from './schema.js';
import type { PublishRecord } from './types.js';
import type { FieldDiff } from './content-diff.js';
export interface SiteChange {
  collection: CollectionName; id: string; title: string; operation: 'restore' | 'unpublish' | 'keep';
  draftDiff: FieldDiff[]; liveDiff: FieldDiff[]; effects: string[];
  /** Original historical-to-current API fields, retained for existing clients. */
  diff: FieldDiff[]; order: { before?: number; after?: number };
}
export interface SiteComparison {
  publish: PublishRecord; currentSiteVersion: number; token: string; changes: SiteChange[];
}
