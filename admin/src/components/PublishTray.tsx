import { useEffect, useState } from 'preact/hooks';
import type { Doc, ValidationIssue } from '../../../shared/types.js';
import { collections, collectionNames, type CollectionName } from '../../../shared/schema.js';
import { api, ApiError, allowed, message, publicOrigin } from '../api.js';
import { editorFlush } from '../state/autosave.js';
import { changed, docTitle, editorPath, previewPath } from '../state/content.js';
import { notify } from '../state/toasts.js';
import { Dialog } from './ConfirmDialog.js';
import { DiffView, displayValue, type Change } from './DiffView.js';
import { localDateTime, pacificDateTime } from './Form/index.js';
import type { PublishMode } from './PublishButton.js';
export const publishConflictMessage = 'Someone else saved changes while you were reviewing. Nothing was published or scheduled. We refreshed the pending list and cleared your selection. Review the updated changes, select what you want, then try again.';
type PendingDoc = Doc<Record<string, unknown>> & { diff: Change[] };
export function PublishTray({ close, published, selectedIds = [], initialMode = 'publish' }: { selectedIds?: string[]; initialMode?: PublishMode; close: () => void; published: () => void }) {
  const [docs, setDocs] = useState<PendingDoc[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [note, setNote] = useState('');
  const [mode, setMode] = useState<PublishMode>(allowed('content.publish') ? initialMode : 'review'), [at, setAt] = useState('');
  const [problems, setProblems] = useState<ValidationIssue[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const clearError = () => { if (!loadFailed) { setError(''); setProblems([]); } };
  const publisher = allowed('content.publish'), editor = allowed('content.edit');
  const canSelect = (doc: PendingDoc, action = mode) => editor &&
    (!['site', 'storeSettings'].includes(doc.collection) || allowed('site.settings')) &&
    (action !== 'review' || !collections[doc.collection].systemManaged);
  async function load(conflict = false) {
    setLoading(true);
    try {
      if (editorFlush.value && !await editorFlush.value()) throw new Error('Resolve your unsaved changes before publishing.');
      const result = await api<{ docs: PendingDoc[] }>('/pending');
      setDocs(result.docs); setSelected(conflict ? [] : result.docs.filter(d => canSelect(d) && (!selectedIds.length || selectedIds.includes(d.id))).map(d => d.id));
      setError(''); setLoadFailed(false);
    } catch (error) { setError(message(error)); setLoadFailed(true); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function cancelSchedule(doc: PendingDoc) {
    setBusy(true); setError('');
    try {
      await api(`/schedule/${doc.collection}/${doc.id}`, 'DELETE', { baseVersion: doc.version });
      changed(); published(); setNotice('Schedule cancelled. The saved changes are still available as a draft.'); await load(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) { setNotice(publishConflictMessage); setSelected([]); await load(true); }
      else setError(message(error));
    } finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true); setError(''); setNotice(''); setProblems([]);
    try {
      const items = docs.filter(d => canSelect(d) && selected.includes(d.id)).map(d => ({ collection: d.collection, id: d.id, expectedVersion: d.version }));
      if (mode === 'review') {
        // Review mutations are individually versioned. Remove successful items
        // so a later failure cannot hide partial completion or submit twice.
        let completed = 0;
        try {
          for (const item of items) {
            await api(`/docs/${item.collection}/${item.id}/review`, 'POST', { baseVersion: item.expectedVersion, note: note || undefined });
            completed++; setSelected(current => current.filter(id => id !== item.id));
          }
        } catch (error) {
          setNotice(`${completed} review ${completed === 1 ? 'request sent' : 'requests sent'}. Review the remaining changes before retrying.`);
          await load(true); throw error;
        }
        notify('Review requested'); changed(); published(); close(); return;
      }
      if (mode === 'schedule') {
        const iso = pacificDateTime(at);
        if (!iso || !iso.endsWith('Z') || Date.parse(iso) <= Date.now()) throw new Error('Choose a future date and time in Pacific time. This time must exist on the calendar.');
        await api('/schedule', 'POST', { items, at: iso, summary: note || undefined });
        notify('Changes scheduled in Pacific time');
      } else {
        const result = await api<{ siteVersion: number; purged: boolean }>('/publish', 'POST', { items, summary: note || undefined });
        const first = docs.find(d => selected.includes(d.id));
        const url = new URL(previewPath(first?.collection ?? 'home', first?.draft), publicOrigin); url.searchParams.set('v', String(result.siteVersion));
        notify(result.purged ? 'Live now' : 'Published · Live within about 5 minutes', url.href);
      }
      changed(); published(); close();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && mode !== 'review') {
        setNotice(publishConflictMessage); setSelected([]); await load(true);
      } else {
        setError(message(error));
        if (error instanceof ApiError && error.status === 422 && Array.isArray(error.details)) setProblems(error.details);
      }
    } finally { setBusy(false); }
  }
  return <Dialog title="Review & publish" close={() => !busy && close()} wide>
    <p class="muted">Choose the saved changes to share with the club.</p>
    {notice && <div class="notice" role="alert"><p>{notice}</p></div>}
    {error && <div class="error-box" role="alert"><p>{error}</p>{problems.length > 0 && <ul>{problems.map(problem => {
      const [name, id, ...field] = problem.path.split('.'), collection = name as CollectionName;
      const href = collectionNames.includes(collection) && id ? `${editorPath(collection, id)}#${collections[collection].kind === 'singleton' ? 'section-' + field[0] : 'field-' + field.join('.')}` : undefined;
      return <li key={problem.path}>{href ? <a href={href} target="_self" onClick={close}>{problem.path}: {problem.message}</a> : `${problem.path}: ${problem.message}`}</li>;
    })}</ul>}<button class="button secondary" disabled={busy || loading} onClick={() => { setProblems([]); void load(true); }}>Reload pending changes</button></div>}
    {editor && <div class="publish-selection"><button class="text-button" disabled={busy || loading} onClick={() => { clearError(); setSelected(docs.filter(d => canSelect(d)).map(d => d.id)); }}>Select all</button><button class="text-button" disabled={busy || loading} onClick={() => { clearError(); setSelected([]); }}>Deselect all</button><span>{selected.length} selected</span></div>}
    {loading ? <p role="status">Loading saved changes…</p> : !docs.length && !error ? <div class="empty-state"><h3>All caught up</h3><p>Your saved content is already published.</p></div> : Object.entries(collections).map(([collection, definition]) => {
      const items = docs.filter(d => d.collection === collection); return !items.length ? null : <section class="publish-group" key={collection}><h3>{definition.labelPlural}</h3>{items.map(doc => <article class="publish-item" key={doc.id}>
        <label class="publish-select"><input type="checkbox" checked={selected.includes(doc.id)} disabled={!canSelect(doc) || busy || loading} onChange={event => { clearError(); setSelected(event.currentTarget.checked ? [...selected, doc.id] : selected.filter(id => id !== doc.id)); }} /><strong>{docTitle(doc)}</strong><span class="badge">{doc.trashedAt ? 'Remove from site' : doc.status}</span></label>
        {editor && !canSelect(doc) && <p class="muted">{collections[doc.collection].systemManaged && mode === 'review' ? 'Media is published with the content that uses it.' : 'Your role can view these changes. An Editor or Owner can submit them.'}</p>}
        {doc.scheduledAt && <p class="muted">Scheduled for {localDateTime(doc.scheduledAt).replace('T', ' ')} Pacific. Publishing now replaces this schedule. {publisher && <button class="text-button" disabled={busy} onClick={() => void cancelSchedule(doc)}>Cancel schedule</button>}</p>}
        <p class="publish-summary">{doc.trashedAt ? 'Remove this item from the live site.' : doc.diff.length ? doc.diff.slice(0, 3).map(d => `${d.label}: ${displayValue(d.before).slice(0, 80)} → ${displayValue(d.after).slice(0, 80)}`).join(' · ') + (doc.diff.length > 3 ? ` · +${doc.diff.length - 3} more` : '') : 'Publication status or order changed.'}</p>
        <details><summary>{doc.diff.length} field {doc.diff.length === 1 ? 'change' : 'changes'} · Review details</summary><DiffView changes={doc.diff} beforeLabel="Live" afterLabel="Draft" /></details>
      </article>)}</section>;
    })}
    {editor ? <>
      <label class="note-label" for="publish-action">Action</label><select id="publish-action" disabled={busy || loading} value={mode} onChange={e => { clearError(); const action = e.currentTarget.value as PublishMode; setMode(action); setSelected(selected.filter(id => docs.some(doc => doc.id === id && canSelect(doc, action)))); }}>{publisher && <><option value="publish">Publish now</option><option value="schedule">Schedule for later</option></>}<option value="review">Request review</option></select>
      {mode === 'schedule' && <><label class="note-label" for="publish-at">Publish date and time (Pacific)</label><input id="publish-at" type="datetime-local" value={at} disabled={busy} onInput={e => { clearError(); setAt(e.currentTarget.value); }} /><p class="muted">America/Los_Angeles · Daylight saving time is applied automatically. This schedules the selected saved versions.</p></>}
      <label class="note-label" for="publish-note">{mode === 'review' ? 'Review note' : 'Publication note'} <span class="muted">(optional)</span></label><textarea id="publish-note" rows={2} maxLength={1000} value={note} disabled={busy} onInput={event => { clearError(); setNote(event.currentTarget.value); }} placeholder="What changed for the club?" />
      <div class="dialog-actions"><button class="button secondary" disabled={busy} onClick={close}>Keep as draft</button><button class="button" disabled={busy || loading || !selected.length || !!error} onClick={() => void submit()}>{busy ? 'Working…' : mode === 'review' ? `Request review for ${selected.length}` : `${mode === 'schedule' ? 'Schedule' : 'Publish'} ${selected.length} ${selected.length === 1 ? 'change' : 'changes'}`}</button></div>
    </> : <p class="notice">Your role can review changes. An Editor or Owner can publish them.</p>}
  </Dialog>;
}
