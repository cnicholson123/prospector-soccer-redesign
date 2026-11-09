import type { CollectionName } from '../../shared/schema.js';
import { html, type Html } from './html.js';
export function editable(enabled: boolean, collection: CollectionName, id: string, path: string): Html {
  return enabled ? html` data-edit="${JSON.stringify({ collection, id, path })}"` : html``;
}
