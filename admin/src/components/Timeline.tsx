import { useEffect, useRef, useState } from 'preact/hooks';
import type { Revision } from '../../../shared/types.js';
import { api, allowed, message, publicOrigin } from '../api.js';
import type { EventDoc } from '../state/autosave.js';
import { collections } from '../../../shared/schema.js';
import { DiffView, contentDiff, type Change } from './DiffView.js';
import { Dialog } from './ConfirmDialog.js';
import { historyTime, revisionAction } from '../state/history.js';
import { changed, previewPath } from '../state/content.js';
import { notify } from '../state/toasts.js';
export function Timeline({ doc, restore, prepare }: { doc: EventDoc; restore: (doc: EventDoc) => void; prepare: () => Promise<EventDoc | null> }) {
  const [revisions, setRevisions] = useState<Revision[]>([]), [before, setBefore] = useState<string>();
  const [selected, setSelected] = useState<Revision | null>(null), [changes, setChanges] = useState<Change[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false), [publish, setPublish] = useState(false);
  const [loading, setLoading] = useState(true), [comparing, setComparing] = useState(false), [resultMessage, setResultMessage] = useState('');
  const listRequest = useRef(0), detailRequest = useRef(0);
  async function load(cursor?: string) {
    const run = ++listRequest.current; setLoading(true); setError('');
    try {
      const result = await api<{ revisions: Revision[]; before?: string }>(`/revisions/${doc.collection}/${doc.id}${cursor ? `?before=${encodeURIComponent(cursor)}` : ''}`);
      if (run === listRequest.current) { setRevisions(old => cursor ? [...old, ...result.revisions.filter(rev => !old.some(item => item.id === rev.id))] : result.revisions); setBefore(result.before); }
    } catch (error) { if (run === listRequest.current) setError(message(error)); }
    finally { if (run === listRequest.current) setLoading(false); }
  }
  async function compare(id: string) {
    const run = ++detailRequest.current; setSelected(null); setChanges([]); setError(''); setComparing(true);
    try { const result = await api<{ revision: Revision; diff: Change[] }>(`/revisions/${encodeURIComponent(id)}?docId=${encodeURIComponent(doc.id)}`); if (run === detailRequest.current) { setSelected(result.revision); setChanges(result.diff); } }
    catch (error) { if (run === detailRequest.current) setError(message(error)); }
    finally { if (run === detailRequest.current) setComparing(false); }
  }
  useEffect(() => { void load(); return () => { listRequest.current++; }; }, [doc.collection, doc.id, doc.version]);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('revision'); if (id) void compare(id);
    return () => { detailRequest.current++; };
  }, [doc.collection, doc.id]);
  async function apply() {
    if (!selected) return;
    setBusy(true); setError(''); setResultMessage('');
    try {
      const current = await prepare();
      if (!current) { setError('Save or resolve your current changes first.'); return; }
      const result = await api<{ doc: EventDoc; published?: boolean; siteVersion?: number; message?: string; publishError?: { message: string } }>(`/revisions/${selected.id}/restore?docId=${doc.id}`, 'POST', { baseVersion: current.version, publish });
      restore(result.doc); changed(); setSelected(null); setConfirm(false); void load();
      if (result.publishError) setResultMessage(`Revision restored to draft. Publication failed: ${result.publishError.message}. Review and publish the saved draft when ready.`);
      else if (result.published) {
        const live = new URL(previewPath(doc.collection, result.doc.draft), publicOrigin); live.searchParams.set('v', String(result.siteVersion));
        notify(result.message ?? 'Revision restored and published', live.href);
      }
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <section class="timeline-panel" aria-label="Document history"><span class="eyebrow">Every chapter, kept</span><h2>{collections[doc.collection].label} history</h2><p class="muted">Review saved revisions. Restoring keeps your previous work in history.</p>
    {error && <p role="alert" class="error-box">{error}</p>}{resultMessage && <p role="status" class="notice">{resultMessage}</p>}{loading && <p role="status">Loading revisions…</p>}
    <ol class="timeline" aria-busy={loading}>{revisions.map(revision => <li key={revision.id}><button class={`timeline-entry ${selected?.id === revision.id ? 'selected' : ''}`} aria-pressed={selected?.id === revision.id} onClick={() => void compare(revision.id)}>
      <span class="timeline-dot" /><span><strong>{revision.action === 'created' ? `${collections[doc.collection].label} created` : revisionAction(revision)}</strong><small>{revision.authorName} · <time dateTime={revision.at}>{historyTime(revision.at)}</time></small><small>Revision {revision.docVersion}{revision.sealedAt ? ' · Sealed' : ' · Working draft'}</small>{revision.summary && <span>{revision.summary}</span>}</span>
    </button></li>)}</ol>
    {!loading && !revisions.length && !error && <p class="empty-state">No revisions yet.</p>}
    {(before || error) && <button class="button secondary" disabled={loading} onClick={() => void load(before)}>{error ? 'Retry loading revisions' : 'Load earlier revisions'}</button>}
    {comparing && <p role="status">Loading revision…</p>}
    {selected && !comparing && <div class="revision-detail"><h3>Revision {selected.docVersion}</h3><p class="muted">Changes from the preceding revision</p><DiffView changes={changes} />{doc.collection !== 'media' && allowed('content.edit') && (doc.collection !== 'site' || allowed('site.settings')) && <button class="button secondary" onClick={() => { setPublish(false); setConfirm(true); }}>Restore this revision</button>}</div>}
    {confirm && selected && <Dialog title="Restore this revision?" dismissible={!busy} close={() => !busy && setConfirm(false)}><p>This replaces your saved draft with revision {selected.docVersion}. Your current work stays in history.</p><DiffView changes={contentDiff(doc.collection, doc.draft, selected.data)} beforeLabel="Current draft" afterLabel="Restored draft" />{allowed('content.publish') && <label class="restore-publish"><input type="checkbox" checked={publish} disabled={busy} onChange={e => setPublish(e.currentTarget.checked)} />Publish restored revision immediately</label>}<p class="muted">{publish ? 'The restored content will be published to the live site.' : 'The live site changes only after publishing.'}</p>{error && <p class="error-box" role="alert">{error}</p>}<div class="dialog-actions"><button class="button secondary" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button><button class="button" disabled={busy} onClick={() => void apply()}>{busy ? 'Restoring…' : publish ? 'Restore and publish' : 'Restore draft'}</button></div></Dialog>}
  </section>;
}
