import { SCHEMA_VERSION } from '../../shared/schema';
import type { Doc, PublishRecord, Snapshot } from '../../shared/types';
import { references } from './references';

export function buildSnapshot(docs: Doc[], metadata: Pick<Snapshot, 'siteVersion' | 'publishedAt' | 'templateHash'> & Partial<Pick<Snapshot, 'scheduled' | 'effectiveAt'>>, manifest?: PublishRecord['manifest']): Snapshot {
  const published: Snapshot['docs'] = {};
  const media: Snapshot['media'] = {};
  for (const doc of docs) {
    const entry = manifest?.find(item => item.collection === doc.collection && item.id === doc.id);
    if (doc.published === undefined || (manifest ? !entry : doc.status === 'trashed')) continue;
    (published[doc.collection] ??= []).push({ id: doc.id, collection: doc.collection, data: structuredClone(doc.published),
      version: entry?.version ?? doc.publishedVersion ?? doc.version, order: entry?.order ?? doc.order ?? 0 });
  }
  const referenced = Object.values(published).flatMap(items => (items ?? []).flatMap(item => references(item.collection, item.data)))
    .concat((metadata.scheduled ?? []).flatMap(item => references(item.collection, item.data)));
  for (const ref of referenced.filter(ref => ref.collection === 'media')) {
    const item = docs.find(item => item.collection === 'media' && item.id === ref.id);
    const value = item?.published ?? item?.draft;
    if (!value || typeof value !== 'object') continue;
    const data = value as Record<string, unknown>;
    const variants = data.variants as Record<string, string> | undefined;
    media[ref.id] = { url: variants?.web || variants?.original || '', mime: String(data.mime ?? ''),
      width: Number(data.width ?? 0), height: Number(data.height ?? 0), alt: String(data.alt ?? '') };
  }
  return { ...metadata, schemaVersion: SCHEMA_VERSION, docs: published, media, scheduled: structuredClone(metadata.scheduled ?? []).map(item => ({ ...item, order: item.order ?? 0 })) };
}
