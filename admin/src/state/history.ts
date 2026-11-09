import { useEffect, useRef, useState } from 'preact/hooks';
import { api, message } from '../api.js';
import { pacificDateTime } from '../components/Form/index.js';
import type { Revision } from '../../../shared/types.js';
export interface ActorOption { id: string; name: string }
export const revisionAction = (revision: Revision) => ({ created: 'Created', duplicated: 'Duplicated', edited: 'Edited', checkpoint: 'Checkpoint saved', published: 'Published', unpublished: 'Unpublished', restored: 'Revision restored', trashed: 'Moved to trash', untrashed: 'Restored from trash', scheduled: 'Scheduled', site_restored: 'Site restored' })[revision.action];
export const historyTime = (at: string) => new Date(at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }) + ' Pacific';
export function auditParams(values: Record<string, string>) {
  const params = new URLSearchParams();
  for (const key of ['actor', 'action', 'actionGroup', 'collection', 'q']) if (values[key]) params.set(key, values[key]);
  if (values.from) params.set('from', pacificDateTime(values.from + 'T00:00')!);
  if (values.to) params.set('to', pacificDateTime(values.to + 'T23:59')!.replace(':00.000Z', ':59.999Z'));
  return params.toString();
}
// Request generations prevent old filters and overlapping pages from replacing
// the current result set. Errors retain the same cursor for an explicit retry.
export function useHistoryPages<T extends { id?: string; siteVersion?: number }>(path: string, key: 'items' | 'publishes' = 'items') {
  const [rows, setRows] = useState<T[]>([]), [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const generation = useRef(0), busy = useRef(false);
  async function load(next?: string) {
    if (busy.current) return;
    const run = generation.current; busy.current = true; setLoading(true); setError('');
    try {
      const result = await api<{ items?: T[]; publishes?: T[]; cursor?: string }>(`${path}${path.includes('?') ? '&' : '?'}limit=30${next ? `&${key === 'publishes' ? 'before' : 'cursor'}=${encodeURIComponent(next)}` : ''}`);
      if (run !== generation.current) return;
      const incoming = result[key] ?? [];
      setRows(old => next ? [...old, ...incoming.filter(row => !old.some(item => (item.id ?? item.siteVersion) === (row.id ?? row.siteVersion)))] : incoming);
      setCursor(key === 'publishes' ? incoming.length === 30 ? String(incoming.at(-1)!.siteVersion) : undefined : result.cursor);
    } catch (error) { if (run === generation.current) setError(message(error)); }
    finally { if (run === generation.current) { busy.current = false; setLoading(false); } }
  }
  useEffect(() => {
    generation.current++; busy.current = false; setRows([]); setCursor(undefined); void load();
    return () => { generation.current++; busy.current = false; };
  }, [path]);
  return { rows, cursor, loading, error, load };
}
