import { api, ApiError, message } from '../api';
import { editorPath, type ContentDoc } from '../state/content';
import type { CollectionName } from '../../../shared/schema';
export interface Usage { collection: CollectionName; id: string; title: string; path: string }
export interface ActionFailure { message: string; usage: Usage[] }
export function actionFailure(error: unknown): ActionFailure {
  return { message: message(error), usage: error instanceof ApiError && error.details && typeof error.details === 'object' && 'usage' in error.details ? (error.details as { usage: Usage[] }).usage : [] };
}
export function Failure({ failure }: { failure: ActionFailure | null }) {
  return failure && <div role="alert" class="error-box"><p>{failure.message}</p>{failure.usage.length > 0 && <><strong>Used by</strong><ul>{failure.usage.map((use, i) => <li key={i}><a href={editorPath(use.collection, use.id)}>{use.title}</a> <small>{use.path}</small></li>)}</ul><p>Remove these references before moving this item to trash.</p></>}</div>;
}
export async function trashDoc(doc: ContentDoc, restore = false) { return (await api<{ doc: ContentDoc }>(`/docs/${doc.collection}/${doc.id}/${restore ? 'untrash' : 'trash'}`, 'POST', { baseVersion: doc.version })).doc; }
