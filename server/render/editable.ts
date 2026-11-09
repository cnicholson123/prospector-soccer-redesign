import type { CollectionName } from '../../shared/schema';
import { html, type Html } from './html';
export function editable(enabled: boolean, collection: CollectionName, id: string, path: string): Html {
  return enabled ? html` data-edit="${JSON.stringify({ collection, id, path })}"` : html``;
}
