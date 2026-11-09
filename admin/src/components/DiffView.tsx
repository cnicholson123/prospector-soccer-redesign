import { collections } from '../../../shared/schema';
export interface Change { path: string; label: string; kind?: string; before?: unknown; after?: unknown; words?: { value: string; added?: boolean; removed?: boolean }[] }
export const displayValue = (value: unknown): string => value === undefined || value === '' ? '—' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : typeof value === 'object' ? JSON.stringify(value) : String(value);
export function eventDiff(before: Record<string, unknown>, after: Record<string, unknown>): Change[] {
  return Object.entries(collections.events.fields).flatMap(([path, field]) => JSON.stringify(before[path]) === JSON.stringify(after[path]) ? [] : [{ path, label: field.label ?? path.replace(/([A-Z])/g, ' $1'), before: before[path], after: after[path] }]);
}
export function DiffView({ changes, beforeLabel = 'Earlier', afterLabel = 'Now' }: { changes: Change[]; beforeLabel?: string; afterLabel?: string }) {
  return <div class="diff-view">{changes.length ? changes.map(change => <div class="diff-row" key={change.path}>
    <h4>{change.label}</h4><div class="diff-columns"><div><span class="small-label">{beforeLabel}</span><p>{displayValue(change.before)}</p></div><div><span class="small-label">{afterLabel}</span><p>{displayValue(change.after)}</p></div></div>
    {change.words && <p class="word-diff" aria-label="Text changes">{change.words.map(word => word.added ? <ins>{word.value}</ins> : word.removed ? <del>{word.value}</del> : word.value)}</p>}
  </div>) : <p class="muted">No field changes.</p>}</div>;
}
