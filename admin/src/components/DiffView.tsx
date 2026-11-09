export interface Change { path: string; label: string; kind?: string; before?: unknown; after?: unknown; words?: { value: string; added?: boolean; removed?: boolean }[] }
export const displayValue = (value: unknown): string => value === undefined || value === '' ? '—' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : typeof value === 'object' ? JSON.stringify(value) : String(value);
// The server and compare panel share the same stable-key, schema-aware algorithm.
export { diff as contentDiff } from '../../../shared/content-diff.js';
import { diff } from '../../../shared/content-diff.js';
export const eventDiff = (before: Record<string, unknown>, after: Record<string, unknown>) => diff('events', before, after);
export function DiffView({ changes, beforeLabel = 'Earlier', afterLabel = 'Now' }: { changes: Change[]; beforeLabel?: string; afterLabel?: string }) {
  return <div class="diff-view">{changes.length ? changes.map(change => <div class="diff-row" key={`${change.path}-${change.kind}`}>
    <h4>{change.label} {change.kind && <span class="diff-kind">{change.kind}</span>}</h4><code class="diff-path">{change.path}</code>{change.kind === 'moved' && <p class="diff-move">Moved from position {Number(change.before) + 1} to {Number(change.after) + 1}</p>}<div class="diff-columns"><div><span class="small-label">{beforeLabel}</span><p>{change.kind === 'moved' ? `Position ${Number(change.before) + 1}` : displayValue(change.before)}</p></div><div><span class="small-label">{afterLabel}</span><p>{change.kind === 'moved' ? `Position ${Number(change.after) + 1}` : displayValue(change.after)}</p></div></div>
    {change.words && <p class="word-diff" aria-label="Text changes">{change.words.map(word => word.added ? <ins><span class="sr-only">Added: </span>{word.value}</ins> : word.removed ? <del><span class="sr-only">Removed: </span>{word.value}</del> : word.value)}</p>}
  </div>) : <p class="muted">No field changes.</p>}</div>;
}
