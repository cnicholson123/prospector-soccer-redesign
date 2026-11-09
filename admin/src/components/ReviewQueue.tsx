import { useEffect, useState } from 'preact/hooks';
import { api, ApiError, message } from '../api.js';
import { changed, docTitle, editorPath, type ContentDoc } from '../state/content.js';
import { contentDiff, DiffView } from './DiffView.js';
import { Dialog } from './ConfirmDialog.js';
import { notify } from '../state/toasts.js';
export function ReviewQueue({ refresh }: { refresh: number }) {
  const [docs, setDocs] = useState<ContentDoc[] | null>(null), [error, setError] = useState(''), [selected, setSelected] = useState<ContentDoc | null>(null), [note, setNote] = useState(''), [busy, setBusy] = useState(false);
  async function load() { try { setDocs((await api<{ docs: ContentDoc[] }>('/reviews')).docs); setError(''); } catch (e) { setError(message(e)); } }
  useEffect(() => { let active = true; api<{ docs: ContentDoc[] }>('/reviews').then(r => { if (active) { setDocs(r.docs); setError(''); } }).catch(e => { if (active) setError(message(e)); }); return () => { active = false; }; }, [refresh]);
  async function decide(approve: boolean) {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      if (approve) await api('/publish', 'POST', { items: [{ collection: selected.collection, id: selected.id, expectedVersion: selected.version }], summary: 'Approved review' });
      else await api(`/docs/${selected.collection}/${selected.id}/review`, 'DELETE', { baseVersion: selected.version, note });
      setSelected(null); changed(); notify(approve ? 'Review approved and published' : 'Returned with your note'); await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { setSelected(null); await load(); setError('This item changed. Review its latest version before deciding.'); }
      else setError(message(e));
    } finally { setBusy(false); }
  }
  return <section class="card review-queue" id="awaiting-review"><div class="section-heading"><div><span class="eyebrow">Ready for a second look</span><h2>Awaiting review</h2></div><button class="text-button" onClick={() => void load()}>Refresh reviews</button></div>{error && <p role="alert" class="error-box">{error}</p>}{docs === null ? <p role="status">Loading review requests…</p> : !docs.length ? <p class="muted">No items are waiting for review.</p> : <ul class="review-list">{docs.map(doc => <li key={doc.id}><div><a href={editorPath(doc.collection, doc.id)}>{docTitle(doc)}</a>{doc.reviewNote && <p>{doc.reviewNote}</p>}<small>Requested {new Date(doc.updatedAt).toLocaleString()}</small></div><button class="button secondary" onClick={() => { setSelected(doc); setNote(''); setError(''); }}>Review {docTitle(doc)}</button></li>)}</ul>}
    {selected && <Dialog title={`Review ${docTitle(selected)}`} wide close={() => { if (!busy) setSelected(null); }}><p>Approve publishes this saved version. Return leaves it as a draft with your note.</p>{selected.reviewNote && <p class="notice">Contributor note: {selected.reviewNote}</p>}<DiffView changes={contentDiff(selected.collection, selected.published, selected.draft)} beforeLabel="Live" afterLabel="Requested draft" /><div class="field"><label for="return-note">Return note (required to return)</label><textarea id="return-note" rows={3} maxLength={1000} value={note} onInput={e => setNote(e.currentTarget.value)} /></div>{error && <p role="alert" class="error-box">{error}</p>}<div class="dialog-actions"><button class="button secondary" disabled={busy || !note.trim()} onClick={() => void decide(false)}>Return with note</button><button class="button" disabled={busy} onClick={() => void decide(true)}>{busy ? 'Working…' : 'Approve and publish'}</button></div></Dialog>}
  </section>;
}
