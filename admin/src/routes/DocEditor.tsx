import { useEffect, useMemo, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { collections } from '../../../shared/schema';
import { allowed, api, message } from '../api';
import { EditorState, editorFlush, navigationGuard, type EventDoc } from '../state/autosave';
import { notify } from '../state/toasts';
import { Form } from '../components/Form';
import { Preview } from '../components/Preview';
import { Timeline } from '../components/Timeline';
import { Dialog } from '../components/ConfirmDialog';
import { DiffView, eventDiff } from '../components/DiffView';
import { Icon } from '../components/Icon';
export function DocEditor({ id, publish, refresh }: { id: string; publish: () => void; refresh: number }) {
  const state = useMemo(() => new EditorState(id), [id]);
  const { route } = useLocation();
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [panel, setPanel] = useState('form'), [other, setOther] = useState('');
  const editable = allowed('content.edit');
  useEffect(() => {
    let active = true;
    state.load().then(() => { if (active) setReady(true); }).catch(error => { if (active) setError(message(error)); });
    const flush = async () => !editable || !state.dirty.value || await state.flush();
    navigationGuard.value = flush; editorFlush.value = flush;
    const unload = (event: BeforeUnloadEvent) => { if (editable && (state.dirty.value || state.saving.value)) { event.preventDefault(); event.returnValue = ''; } };
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (editable) void checkpoint(); }
    };
    window.addEventListener('beforeunload', unload); window.addEventListener('keydown', key);
    return () => { active = false; state.dispose(); navigationGuard.value = null; editorFlush.value = null; window.removeEventListener('beforeunload', unload); window.removeEventListener('keydown', key); };
  }, [state]);
  const serialized = JSON.stringify(state.draft.value);
  useEffect(() => {
    if (!ready || !editable || !state.doc.value || !state.dirty.value || state.conflict.value || state.recovery.value) return;
    const timer = setTimeout(() => void state.save(), 1500); return () => clearTimeout(timer);
  }, [serialized, ready, state.conflict.value, state.recovery.value]);
  useEffect(() => {
    if (!ready || id === 'new') return;
    const poll = async () => {
      try {
        const { doc } = await api<{ doc: EventDoc }>(`/docs/events/${id}`);
        if (state.saving.value || !state.doc.value || doc.version === state.doc.value.version) return;
        if (state.dirty.value || state.conflict.value) setOther(`Another editor saved changes at ${new Date(doc.updatedAt).toLocaleTimeString()}. Your draft is still here.`);
        else { state.accept(doc); setOther('Latest saved version loaded.'); }
      } catch { /* A failed presence poll must not interrupt a local edit. */ }
    };
    const timer = setInterval(() => void poll(), 20000); if (refresh) void poll(); return () => clearInterval(timer);
  }, [ready, refresh, id]);
  async function checkpoint() {
    if (await state.save(true)) {
      notify(id === 'new' ? 'Event created' : 'Checkpoint saved');
      if (id === 'new' && state.doc.value) route(`/admin/events/${state.doc.value.id}`, true);
    }
  }
  function restored(doc: EventDoc) { state.accept(doc); notify('Revision restored to draft'); }
  const doc = state.doc.value;
  return <><a href="/admin/events" class="back-link">← All events</a><header class="page-heading editor-heading"><div><span class="eyebrow">Events / {id === 'new' ? 'Create' : 'Edit event'}</span><h1>{id === 'new' ? 'A new reason to gather.' : String(state.draft.value.title || 'Untitled event')}</h1><div class="save-line"><span class={`badge status-${doc?.status ?? 'draft'}`}>{doc?.status ?? 'draft'}</span><span role="status" aria-live="polite">{state.status.value}</span></div></div>
    <div class="editor-actions">{editable && <button class="button secondary" disabled={state.saving.value || !ready} onClick={() => void checkpoint()}>{id === 'new' ? 'Create event' : 'Save checkpoint'}</button>}{doc && <button class="button" disabled={state.saving.value} onClick={publish}>{allowed('content.publish') ? 'Review & publish' : 'Review changes'}</button>}</div></header>
    {error && <p role="alert" class="error-box">{error}</p>}{other && <p class="notice">{other}</p>}
    {state.recovery.value && <section class="notice recovery"><strong>We found an unsaved draft on this device.</strong><p>Recover it to continue where you left off, or use the saved version.</p><button class="button secondary" onClick={() => state.recover()}>Recover draft</button><button class="text-button" onClick={() => state.clearRecovery()}>Use saved version</button></section>}
    {!ready ? <p role="status">Loading event…</p> : <><nav class="editor-tabs" aria-label="Editor panels"><button aria-pressed={panel === 'form'} onClick={() => setPanel('form')}>Event details</button><button aria-pressed={panel === 'preview'} disabled={!doc} onClick={() => setPanel('preview')}><Icon name="eye" size={16} /> Preview</button><button aria-pressed={panel === 'history'} disabled={!doc} onClick={() => setPanel('history')}><Icon name="history" size={16} /> History</button></nav>
      <div class={`editor-layout panel-${panel}`}><section class="card editor-form"><div class="section-heading"><div><h2>Event details</h2><p class="muted">{editable ? 'Changes save automatically. Publish to share them.' : 'Your role can view this event.'}</p></div></div><Form fields={collections.events.fields} value={state.draft.value} change={(name, value) => state.update(name, value)} errors={state.errors.value} disabled={!editable || !!state.recovery.value} blur={() => { if (id !== 'new' && state.dirty.value) void state.save(); }} />
        {state.errors.value.length > 0 && <p class="error-box" role="alert">Please check the highlighted fields before saving.</p>}
        {editable && <div class="form-footer"><small>Required fields are marked with an asterisk.</small><button class="text-button" disabled={state.saving.value} onClick={() => void checkpoint()}>{id === 'new' ? 'Create event' : 'Save checkpoint'}</button></div>}
      </section><aside class="editor-rail">{doc ? panel === 'history' ? <Timeline doc={doc} restore={restored} prepare={async () => await state.flush() ? state.doc.value : null} /> : <Preview version={doc.version} id={doc.id} /> : <div class="card empty-state"><Icon name="eye" size={32} /><h2>Your event, in context.</h2><p>Create your event to see a private preview of the home page.</p></div>}</aside></div></>}
    {state.conflict.value && <Dialog dismissible={false} title="Someone else saved this. Reload and compare" close={() => { /* Resolve explicitly to preserve both versions. */ }} wide><p>Your local draft is safe. Compare it with the latest saved version, then choose which to keep.</p><p class="muted">Server version {state.conflict.value.version} · {new Date(state.conflict.value.updatedAt).toLocaleString()}</p><DiffView changes={eventDiff(state.conflict.value.draft, state.draft.value)} beforeLabel="Saved on server" afterLabel="Your local draft" /><div class="dialog-actions"><button class="button secondary" onClick={() => state.accept(state.conflict.value!)}>Discard mine</button><button class="button" onClick={() => void state.keepMine()}>Keep mine (overwrite)</button></div></Dialog>}
  </>;
}
