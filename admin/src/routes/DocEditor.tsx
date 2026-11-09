import { CheckoutStatus } from '../shop/CheckoutStatus.js';
import { CatalogTools } from '../shop/CatalogTools.js';
import { useEffect, useLayoutEffect, useMemo, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { collections, type CollectionName } from '../../../shared/schema.js';
import { allowed, message } from '../api.js';
import { EditorState, registerEditorFlush, type EventDoc } from '../state/autosave.js';
import { notify } from '../state/toasts.js';
import { Form } from '../components/Form/index.js';
import { Preview } from '../components/Preview.js';
import { Timeline } from '../components/Timeline.js';
import { Dialog } from '../components/ConfirmDialog.js';
import { DiffView, contentDiff } from '../components/DiffView.js';
import { compareDocs, docTitle, editorPath } from '../state/content.js';
import { PublishButton, type PublishMode } from '../components/PublishButton.js';
import { InlineEditor } from '../components/InlineEditor.js';
import { api, publicOrigin } from '../api.js';
import { previewPath } from '../state/content.js';
import { EditorPresence } from '../components/EditorPresence.js';
import { typingTarget } from '../state/palette.js';
import { Icon } from '../components/Icon.js';
export function DocEditor({ id, collection = 'events', publish, refresh }: { id: string; collection?: CollectionName; publish: (mode?: PublishMode) => void; refresh: number }) {
  const state = useMemo(() => new EditorState(id, collection), [id, collection]);
  const { route, url } = useLocation();
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [panel, setPanel] = useState(() => new URLSearchParams(location.search).get('panel') === 'history' ? 'history' : 'form'), [other, setOther] = useState('');
  const [inline, setInline] = useState(false), [focusedPath, setFocusedPath] = useState(''), [siteVersion, setSiteVersion] = useState<number | null>(null);
  const definition = collections[collection], label = definition.label, singleton = definition.kind === 'singleton';
  const editable = allowed('content.edit') && (!['site', 'storeSettings'].includes(collection) || allowed('site.settings'));
  const fields = definition.fields;
  useEffect(() => {
    let active = true;
    state.load().then(() => { if (active) setReady(true); }).catch(error => { if (active) setError(message(error)); });
    const flush = async () => !editable || await state.flush();
    const unregister = registerEditorFlush(flush);
    const unload = (event: BeforeUnloadEvent) => { if (editable && (state.dirty.value || state.saving.value)) { event.preventDefault(); event.returnValue = ''; } };
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (editable) void checkpoint(); }
    };
    window.addEventListener('beforeunload', unload); window.addEventListener('keydown', key);
    return () => { active = false; state.dispose(); unregister(); window.removeEventListener('beforeunload', unload); window.removeEventListener('keydown', key); };
  }, [state]);
  useEffect(() => {
    let active = true;
    api<{ publishes: { siteVersion: number }[] }>('/publishes?limit=1').then(result => { if (active) setSiteVersion(result.publishes[0]?.siteVersion ?? 0); }).catch(() => {});
    return () => { active = false; };
  }, [refresh]);
  useEffect(() => { if (id === 'new' && state.doc.value) route(editorPath(collection, state.doc.value.id), true); }, [state.doc.value?.id]);
  useEffect(() => {
    if (!ready || !location.hash) return;
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!target) return;
    for (let element: HTMLElement | null = target; element; element = element.parentElement) if (element instanceof HTMLDetailsElement) element.open = true;
    target.scrollIntoView({ block: 'center' });
    if (!(target instanceof HTMLDetailsElement)) target.focus();
  }, [ready, url]);
  useEffect(() => { const preview = () => setPanel('preview'); window.addEventListener('psc:preview-ipad', preview); return () => window.removeEventListener('psc:preview-ipad', preview); }, []);
  const serialized = JSON.stringify(state.draft.value);
  useEffect(() => {
    if (!ready || !editable || !state.doc.value || !state.dirty.value || state.conflict.value || state.recovery.value) return;
    const timer = setTimeout(() => void state.save(), 1500); return () => clearTimeout(timer);
  }, [serialized, ready, state.conflict.value, state.recovery.value]);
  useEffect(() => {
    if (!ready || id === 'new') return;
    const poll = async () => {
      try {
        const result = await state.refresh();
        if (result === 'updated') setOther('Latest saved version loaded.');
        if (result === 'changed') setOther('Another editor saved changes. Your draft is still here.');
      } catch { /* A failed presence poll must not interrupt a local edit. */ }
    };
    const timer = setInterval(() => void poll(), 20000); if (refresh) void poll(); return () => clearInterval(timer);
  }, [ready, refresh, id]);
  // Layout effect: register synchronously on mount so a quick second [ or ] after navigating
  // is not lost in the gap before a normal (post-paint) effect would attach the listener.
  useLayoutEffect(() => {
    if (singleton || id === 'new') return;
    let moving = false;
    const next = async (event: KeyboardEvent) => {
      if (!['[', ']'].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || typingTarget(event.target) || document.querySelector('dialog[open]') || moving) return;
      event.preventDefault(); moving = true;
      try {
        // If the address bar already shows another document, this handler belongs to an editor being
        // replaced: its state is closed, so skip the save and navigate from the visible document.
        const shownId = (typeof location !== 'undefined' ? decodeURIComponent(location.pathname.split('/').pop() ?? '') : '') || id;
        if (shownId === id && !await state.flush()) return;
        const listed = (await api<{ docs: EventDoc[] }>(`/docs/${collection}`)).docs;
        // Follow exactly the order the collection list shows by default.
        const docs = listed.filter(d => !d.trashedAt).sort(compareDocs(collections[collection].orderable ? 'order' : 'date') as (a: EventDoc, b: EventDoc) => number);
        // Read the document from the address bar at keypress time: a fast second press can arrive
        // before this editor re-renders for the document the first press navigated to.
        const currentId = (typeof location !== 'undefined' ? decodeURIComponent(location.pathname.split('/').pop() ?? '') : '') || id;
        const index = docs.findIndex(d => d.id === currentId), target = index < 0 ? undefined : docs[index + (event.key === ']' ? 1 : -1)];
        if (target) route(editorPath(collection, target.id)); else notify(event.key === ']' ? 'This is the last item' : 'This is the first item');
      } catch (e) { notify(message(e)); } finally { moving = false; }
    };
    window.addEventListener('keydown', next); return () => window.removeEventListener('keydown', next);
  }, [state, singleton, id, collection]);
  async function checkpoint() {
    // Blur may already be saving. Keep the action operable and let EditorState
    // queue it; disabling on blur can discard the click before it arrives.
    if (await state.save(true)) {
      notify(id === 'new' ? `${label} created` : 'Checkpoint saved');
      if (id === 'new' && state.doc.value) route(editorPath(collection, state.doc.value.id), true);
    }
  }
  function restored(doc: EventDoc) { state.accept(doc); notify('Revision restored to draft'); }
  const doc = state.doc.value;
  const live = new URL(previewPath(collection, state.draft.value), publicOrigin); if (siteVersion !== null) live.searchParams.set('v', String(siteVersion));
  return <><a href={collection === "storeSettings" ? "/admin/products" : singleton ? "/admin/pages" : `/admin/${collection}`} class="back-link">← {collection === "storeSettings" ? "Store" : singleton ? "All pages" : `All ${definition.labelPlural.toLowerCase()}`}</a><header class="page-heading editor-heading"><div><span class="eyebrow">{definition.labelPlural} / {id === 'new' ? 'Create' : 'Edit'}</span><h1>{id === 'new' ? `New ${label.toLowerCase()}` : singleton ? label : doc ? docTitle({ ...doc, draft: state.draft.value }) : label}</h1><div class="save-line"><span class={`badge status-${doc?.status ?? 'draft'}`}>{doc?.status ?? 'draft'}</span><span role="status" aria-live="polite">{state.status.value}</span></div></div>
    <div class="editor-actions">{editable && <button class="button secondary" disabled={!ready} onClick={() => void checkpoint()}>{id === 'new' ? `Create ${label.toLowerCase()}` : 'Save checkpoint'}</button>}{doc && <PublishButton open={publish} />}</div></header>
    {doc && <EditorPresence collection={collection} id={doc.id} />}
    {doc?.reviewNote && <section class="notice" aria-label={doc.reviewRequestedBy ? "Review request" : "Review returned"}><strong>{doc.reviewRequestedBy ? "Review request" : "Returned for changes"}</strong><p>{doc.reviewNote}</p></section>}
    {doc && <div class="editor-page-tools">{editable && <button class="text-button" onClick={async () => { if (await state.flush()) setInline(true); }}>Edit on page</button>}{siteVersion !== null && <a class="text-link" href={live.href} target="_blank" rel="noreferrer">View live</a>}</div>}
    {error && <p role="alert" class="error-box">{error}</p>}{other && <p class="notice">{other}</p>}
    {state.recovery.value && <section class="notice recovery"><strong>We found an unsaved draft on this device.</strong><p>Recover it to continue where you left off, or use the saved version.</p><button class="button secondary" onClick={() => state.recover()}>Recover draft</button><button class="text-button" onClick={() => state.clearRecovery()}>Use saved version</button></section>}
    {inline && doc ? <InlineEditor state={state} close={() => setInline(false)} /> : !ready ? <p role="status">Loading {label.toLowerCase()}…</p> : <><nav class="editor-tabs" aria-label="Editor panels"><button aria-pressed={panel === 'form'} onClick={() => setPanel('form')}>{label} details</button><button aria-pressed={panel === 'preview'} disabled={!doc} onClick={() => setPanel('preview')}><Icon name="eye" size={16} /> Preview</button><button aria-pressed={panel === 'history'} disabled={!doc} onClick={() => setPanel('history')}><Icon name="history" size={16} /> History</button></nav>
      <div class={`editor-layout panel-${panel}`}><section class="card editor-form" onFocusCapture={event => { const field = (event.target as Element).closest<HTMLElement>('[data-field-path]'); if (field) setFocusedPath(field.dataset.fieldPath ?? ''); }}><div class="section-heading"><div><h2>{label} details</h2><p class="muted">{editable ? 'Changes save automatically. Publish to share them.' : 'Your role can view this content.'}</p></div></div>{collection === 'storeSettings' && <CheckoutStatus />}{['products', 'bundles'].includes(collection) && <CatalogTools collection={collection} value={state.draft.value} update={(name, value) => state.update(name, value)} disabled={!editable} />}<Form sections={singleton} fields={fields} value={state.draft.value} change={(name, value) => state.update(name, value)} errors={state.errors.value} disabled={!editable || !!state.recovery.value || !!doc?.trashedAt} blur={() => { if (id !== 'new' && state.dirty.value) void state.save(); }} />
        {state.errors.value.length > 0 && <p class="error-box" role="alert">Please check the highlighted fields before saving.</p>}
        {editable && <div class="form-footer"><small>Required fields are marked with an asterisk.</small><button class="text-button" onClick={() => void checkpoint()}>{id === 'new' ? `Create ${label.toLowerCase()}` : 'Save checkpoint'}</button></div>}
      </section><aside class="editor-rail">{doc ? panel === 'history' ? <Timeline doc={doc} restore={restored} prepare={async () => await state.flush() ? state.doc.value : null} /> : <Preview focusedPath={focusedPath} version={doc.version} id={doc.id} collection={collection} draft={state.draft.value} /> : <div class="card empty-state"><Icon name="eye" size={32} /><h2>Your content, in context.</h2><p>Create your draft to see a private preview of the public page.</p></div>}</aside></div></>}
    {!inline && state.conflict.value && <Dialog dismissible={false} title="Someone else saved this. Reload and compare" close={() => { /* Resolve explicitly to preserve both versions. */ }} wide><p>Your local draft is safe. Compare it with the latest saved version, then choose which to keep.</p><p class="muted">Server version {state.conflict.value.version} · {new Date(state.conflict.value.updatedAt).toLocaleString()}</p><DiffView changes={contentDiff(collection, state.conflict.value.draft, state.draft.value)} beforeLabel="Saved on server" afterLabel="Your local draft" /><div class="dialog-actions"><button class="button secondary" onClick={() => state.accept(state.conflict.value!)}>Discard mine</button><button class="button" onClick={() => void state.keepMine()}>Keep mine (overwrite)</button></div></Dialog>}
  </>;
}
