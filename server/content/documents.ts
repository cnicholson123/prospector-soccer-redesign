import type { CreateDoc, Store } from '../store/types';
import { collections, type CollectionName } from '../../shared/schema';
import type { Doc } from '../../shared/types';
import { applyDefaults, validate, ValidationError } from './validate';

/** Creation entry point for the API. Existing drafts never receive defaults. */
export async function createDocument(store: Store, input: CreateDoc): Promise<Doc> {
  const defaults = new Map<string, Doc | null>();
  const paths = Object.values(collections[input.doc.collection].fields).flatMap(field => field.defaultFrom ? [field.defaultFrom] : []);
  for (const path of paths) {
    const collection = path.split('.')[0] as CollectionName;
    defaults.set(collection, await store.getDoc(collection, collection));
  }
  const draft = applyDefaults(input.doc.collection, input.doc.draft, collection => defaults.get(collection) ?? null);
  const result = validate(input.doc.collection, draft, { mode: 'draft' });
  if (!result.valid) throw new ValidationError(result.errors);
  return store.createDoc({ ...input, doc: { ...input.doc, draft }, revision: { ...input.revision, data: draft } });
}
