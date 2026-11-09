import { useEffect, useState } from 'preact/hooks';
import type { Revision } from '../../../shared/types';
import { api, allowed, message } from '../api';
import type { EventDoc } from '../state/autosave';
import { DiffView, type Change } from './DiffView';
import { Dialog } from './ConfirmDialog';
export function Timeline({ doc, restore, prepare }: { doc: EventDoc; restore: (doc: EventDoc) => void; prepare: () => Promise<EventDoc | null> }) {
  const [revisions, setRevisions] = useState<Revision[]>([]), [before, setBefore] = useState<string>();
  const [selected, setSelected] = useState<Revision | null>(null), [changes, setChanges] = useState<Change[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  async function load(cursor?: string) {
    try { const result = await api<{ revisions: Revision[]; before?: string }>(`/revisions/events/${doc.id}${cursor ? `?before=${cursor}` : ''}`); setRevisions(old => cursor ? [...old, ...result.revisions] : result.revisions); setBefore(result.before); }
    catch (error) { setError(message(error)); }
  }
  useEffect(() => { void load(); }, [doc.version]);
  async function compare(revision: Revision) {
    setSelected(revision); setChanges([]); setError('');
    try { setChanges((await api<{ diff: Change[] }>(`/revisions/${revision.id}?docId=${doc.id}`)).diff); }
    catch (error) { setError(message(error)); }
  }
  async function apply() {
    setBusy(true); setError('');
    try {
      const current = await prepare();
      if (!current) { setError('Save or resolve your current changes first.'); return; }
      const result = await api<{ doc: EventDoc }>(`/revisions/${selected!.id}/restore?docId=${doc.id}`, 'POST', { baseVersion: current.version });
      restore(result.doc); setSelected(null); setConfirm(false);
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <section class="timeline-panel" aria-label="Document history"><span class="eyebrow">Every chapter, kept</span><h2>Event history</h2><p class="muted">Restore an earlier revision to your draft, then publish when ready.</p>
    {error && <p role="alert" class="error-box">{error}</p>}
    <ol class="timeline">{revisions.map(revision => <li key={revision.id}><button class={`timeline-entry ${selected?.id === revision.id ? 'selected' : ''}`} onClick={() => void compare(revision)}>
      <span class="timeline-dot" /><span><strong>{revision.action === 'created' ? 'Event created' : revision.action.replace('_', ' ')}</strong><small>{revision.authorName} · {new Date(revision.at).toLocaleString()}</small><small>Revision {revision.docVersion}{revision.sealedAt ? ' · Saved checkpoint' : ' · Working draft'}</small>{revision.summary && <span>{revision.summary}</span>}</span>
    </button></li>)}</ol>
    {before && <button class="button secondary" onClick={() => void load(before)}>Load earlier revisions</button>}
    {selected && <div class="revision-detail"><h3>Revision {selected.docVersion}</h3><DiffView changes={changes} />{allowed('content.edit') && <button class="button secondary" onClick={() => setConfirm(true)}>Restore this revision</button>}</div>}
    {confirm && <Dialog title="Restore this revision?" close={() => !busy && setConfirm(false)}><p>This replaces your saved draft with revision {selected?.docVersion}. Your current work stays in history. The live site changes only after publishing.</p>{error && <p role="alert">{error}</p>}<div class="dialog-actions"><button class="button secondary" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button><button class="button" disabled={busy} onClick={() => void apply()}>{busy ? 'Restoring…' : 'Restore draft'}</button></div></Dialog>}
  </section>;
}
