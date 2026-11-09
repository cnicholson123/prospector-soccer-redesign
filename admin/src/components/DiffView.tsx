export interface Change { path: string; label: string; kind?: string; before?: unknown; after?: unknown; words?: { value: string; added?: boolean; removed?: boolean }[] }
export const displayValue = (value: unknown): string => value === undefined || value === '' ? '—' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : typeof value === 'object' ? JSON.stringify(value) : String(value);
// The server and compare panel share the same stable-key, schema-aware algorithm.
export { diff as contentDiff } from '../../../shared/content-diff';
import { diff } from '../../../shared/content-diff';
export const eventDiff = (before: Record<string, unknown>, after: Record<string, unknown>) => diff('events', before, after);
export function DiffView({ changes, beforeLabel = 'Earlier', afterLabel = 'Now' }: { changes: Change[]; beforeLabel?: string; afterLabel?: string }) {
  return <div class="diff-view">{changes.length ? changes.map(change => <div class="diff-row" key={change.path}>
    <h4>{change.label}</h4><div class="diff-columns"><div><span class="small-label">{beforeLabel}</span><p>{displayValue(change.before)}</p></div><div><span class="small-label">{afterLabel}</span><p>{displayValue(change.after)}</p></div></div>
    {change.words && <p class="word-diff" aria-label="Text changes">{change.words.map(word => word.added ? <ins>{word.value}</ins> : word.removed ? <del>{word.value}</del> : word.value)}</p>}
  </div>) : <p class="muted">No field changes.</p>}</div>;
}
