import { useEffect, useState } from 'preact/hooks';
import type { Doc } from '../../../shared/types';
import { collections } from '../../../shared/schema';
import { api, allowed, message, publicOrigin } from '../api';
import { editorFlush } from '../state/autosave';
import { notify } from '../state/toasts';
import { Dialog } from './ConfirmDialog';
import { DiffView, type Change } from './DiffView';
export function PublishTray({ close, published }: { close: () => void; published: () => void }) {
  const [docs, setDocs] = useState<(Doc<Record<string, unknown>> & { diff: Change[] })[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [note, setNote] = useState('');
  async function load() {
    setLoading(true);
    try {
      if (editorFlush.value && !await editorFlush.value()) throw new Error('Resolve your unsaved event changes before publishing.');
      const result = await api<{ docs: typeof docs }>('/pending'); setDocs(result.docs); setSelected(result.docs.filter(d => d.collection === 'events').map(d => d.id));
    } catch (error) { setError(message(error)); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function publish() {
    setBusy(true); setError('');
    try {
      const result = await api<{ siteVersion: number; purged: boolean }>('/publish', 'POST', { items: docs.filter(d => selected.includes(d.id)).map(d => ({ collection: d.collection, id: d.id, expectedVersion: d.version })), summary: note || undefined });
      notify(result.purged ? 'Live now' : 'Published · Live within about 5 minutes', `${publicOrigin}/?v=${result.siteVersion}#events`);
      published(); close();
    } catch (error) {
      setError(message(error));
      // Preserve the versioned selection until the user explicitly reviews again.
    } finally { setBusy(false); }
  }
  return <Dialog title="Review & publish" close={() => !busy && close()} wide>
    <p class="muted">Choose the saved changes to share with the club.</p>{error && <div class="error-box" role="alert"><p>{error}</p><button class="button secondary" onClick={() => { setError(''); void load(); }}>Reload pending changes</button></div>}
    {loading ? <p role="status">Loading saved changes…</p> : !docs.length ? <div class="empty-state"><h3>All caught up</h3><p>Your saved content is already published.</p></div> : Object.entries(collections).map(([collection, definition]) => {
      const items = docs.filter(d => d.collection === collection); return !items.length ? null : <section class="publish-group" key={collection}><h3>{definition.labelPlural}</h3>{items.map(doc => <article class="publish-item" key={doc.id}>
        <label class="publish-select"><input type="checkbox" checked={selected.includes(doc.id)} disabled={!allowed('content.publish') || busy} onChange={event => setSelected(event.currentTarget.checked ? [...selected, doc.id] : selected.filter(id => id !== doc.id))} /><strong>{String(doc.draft[definition.titleField] ?? definition.label)}</strong><span class="badge">{doc.trashedAt ? 'Remove from site' : doc.status}</span></label>
        <details><summary>{doc.diff.length} field {doc.diff.length === 1 ? 'change' : 'changes'} · Review details</summary><DiffView changes={doc.diff} beforeLabel="Live" afterLabel="Draft" /></details>
      </article>)}</section>;
    })}
    {allowed('content.publish') ? <><label class="note-label" for="publish-note">Publication note <span class="muted">(optional)</span></label><textarea id="publish-note" rows={2} maxLength={1000} value={note} onInput={event => setNote(event.currentTarget.value)} placeholder="What changed for the club?" /><div class="dialog-actions"><button class="button secondary" disabled={busy} onClick={close}>Keep as draft</button><button class="button" disabled={busy || loading || !selected.length || !!error} onClick={() => void publish()}>{busy ? 'Publishing…' : `Publish ${selected.length} ${selected.length === 1 ? 'change' : 'changes'}`}</button></div></> : <p class="notice">Your role can review changes. An Editor or Owner can publish them.</p>}
  </Dialog>;
}
