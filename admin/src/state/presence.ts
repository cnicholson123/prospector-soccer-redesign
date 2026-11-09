import { api, session } from '../api.js';
import type { CollectionName } from '../../../shared/schema.js';
interface Presence { others: { id: string; name: string }[] }
const recent = new Map<string, { at: number; response: Promise<Presence> }>();
/** Remounts and concurrent panes share the 30-second heartbeat budget. */
export function heartbeat(collection: CollectionName, id: string, now = Date.now()): Promise<Presence> {
  const key = `${session.value?.user.id}/${collection}/${id}`, previous = recent.get(key);
  if (previous && now - previous.at < 30000) return previous.response;
  for (const [key, value] of recent) if (now - value.at > 75000) recent.delete(key);
  if (recent.size >= 100) recent.delete(recent.keys().next().value!);
  const response = api<Presence>(`/docs/${collection}/${id}/presence`, 'POST');
  recent.set(key, { at: now, response });
  return response;
}
