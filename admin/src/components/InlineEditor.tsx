import { useEffect, useRef, useState } from 'preact/hooks';
import { collectionNames, collections, type CollectionName } from '../../../shared/schema.js';
import { editPath, setEditValue } from '../../../shared/edit-path.js';
import { allowed, message } from '../api.js';
import { EditorState, registerEditorFlush } from '../state/autosave.js';
import { previewPath } from '../state/content.js';
import { Form, fieldLabel } from './Form/index.js';
import { DiffView, contentDiff } from './DiffView.js';

interface Target { collection: CollectionName; id: string; path: string }
interface Selection { target: Target; state: EditorState; initial: unknown; text: boolean }
export function InlineEditor({ state, close }: { state: EditorState; close: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null), states = useRef(new Map([[`${state.collection}/${state.id}`, state]]));
  const generation = useRef(0), popover = useRef<HTMLElement>(null);
  const active = useRef<Selection | null>(null), timers = useRef(new Map<EditorState, ReturnType<typeof setTimeout>>());
  const [selection, setSelection] = useState<Selection | null>(null), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [path, anchor] = previewPath(state.collection, state.draft.value).split('#');
  const url = `${location.port === '5173' ? '/preview' : ''}${path}?preview=1&edit=1&refresh=${refresh}${anchor ? '#' + anchor : ''}`;
  const send = (data: unknown) => frame.current?.contentWindow?.postMessage(data, location.origin);
  const initialize = () => send({ type: 'initialize', editable: allowed('content.edit'), siteSettings: allowed('site.settings') });
  async function flush() {
    let ok = true;
    for (const item of states.current.values()) {
      clearTimeout(timers.current.get(item));
      if (!await item.flush()) ok = false;
    }
    return ok;
  }
  function update(item: Selection, value: unknown) {
    const resolved = editPath(item.target.collection, item.state.draft.value, item.target.path);
    if (!resolved) { setError('This field moved. Return to the form and reload the preview.'); return; }
    const next = setEditValue(item.state.draft.value, resolved.keys, value);
    const root = String(resolved.keys[0]); item.state.update(root, next[root]);
    clearTimeout(timers.current.get(item.state));
    timers.current.set(item.state, setTimeout(() => void item.state.save(), 1500));
  }
  async function finish() {
    const token = generation.current, item = active.current;
    if (await flush()) {
      if (generation.current !== token) return;
      active.current = null; setSelection(null);
      if (item && !item.text) setRefresh(n => n + 1);
    }
    else setError('Your draft is safe. Resolve the highlighted issue before continuing.');
  }
  useEffect(() => {
    const unregister = registerEditorFlush(flush);
    let disposed = false, request = 0;
    const unload = (event: BeforeUnloadEvent) => {
      if ([...states.current.values()].some(item => item.dirty.value || item.saving.value)) { event.preventDefault(); event.returnValue = ''; }
    };
    const listener = async (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
      const data = event.data as Record<string, unknown>;
      if (data.type === 'ready') { initialize(); return; }
      if (!allowed('content.edit') || !collectionNames.includes(data.collection as CollectionName) || typeof data.id !== 'string' || !/^[\w-]{1,64}$/.test(data.id) || typeof data.path !== 'string') return;
      const target = { collection: data.collection as CollectionName, id: data.id, path: data.path };
      if (collections[target.collection].systemManaged || target.collection === 'site' && !allowed('site.settings')) return;
      if (data.type === 'edit') {
        const current = ++request;
        generation.current++;
        try {
          if (!await flush()) { setError('Finish saving or resolve the current conflict before editing another field.'); return; }
          const key = `${target.collection}/${target.id}`;
          let itemState = states.current.get(key);
          if (!itemState) {
            const loaded = new EditorState(target.id, target.collection);
            try { await loaded.load(); } catch (error) { loaded.dispose(); throw error; }
            if (disposed) { loaded.dispose(); return; }
            itemState = states.current.get(key);
            if (itemState) loaded.dispose();
            else { itemState = loaded; states.current.set(key, itemState); }
          }
          if (disposed || current !== request) return;
          if (itemState.doc.value?.trashedAt) throw new Error('This item is in the trash. Restore it in the form editor first.');
          const resolved = editPath(target.collection, itemState.draft.value, target.path);
          if (!resolved) throw new Error('This field is no longer available. Reload the preview.');
          const item = { target, state: itemState, initial: structuredClone(resolved.value), text: resolved.field.type === 'text' };
          active.current = item; setSelection(item); setError('');
          if (!itemState.recovery.value) send({ type: 'begin', ...target, fieldType: resolved.field.type, value: resolved.value, label: fieldLabel(String(resolved.keys.at(-1)), resolved.field) });
        } catch (error) { if (!disposed) setError(message(error)); }
      } else {
        const item = active.current;
        if (!item || !item.text || JSON.stringify(item.target) !== JSON.stringify(target) || typeof data.value !== 'string') return;
        if (data.type === 'change') update(item, data.value);
        else if (data.type === 'commit' || data.type === 'cancel') {
          update(item, data.type === 'cancel' ? item.initial : data.value); await finish();
        }
      }
    };
    window.addEventListener('message', listener);
    window.addEventListener('beforeunload', unload);
    return () => {
      disposed = true; window.removeEventListener('message', listener); window.removeEventListener('beforeunload', unload);
      unregister();
      for (const [item, timer] of timers.current) { clearTimeout(timer); if (item !== state) item.dispose(); }
      for (const item of states.current.values()) if (item !== state) item.dispose();
    };
  }, [state]);
  useEffect(() => {
    if (selection && !selection.text) popover.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
  }, [selection]);
  const resolved = selection && editPath(selection.target.collection, selection.state.draft.value, selection.target.path);
  const selectedState = selection?.state;
  return <section class="inline-workspace" aria-label="Edit on page">
    <div class="inline-toolbar"><div><strong>Edit on page</strong><p>Click outlined text to edit. Enter saves; Escape cancels. Other fields open their usual control.</p></div><button class="button secondary" onClick={async () => { if (await flush()) close(); else setError('Resolve your unsaved changes before returning to the form.'); }}>Back to form</button></div>
    <p role="status">{selectedState?.status.value ?? 'Private draft · Changes are saved before you publish.'}</p>
    {error && <p class="error-box" role="alert">{error}</p>}
    <div class="inline-canvas"><iframe ref={frame} onLoad={initialize} title="Inline page editor" src={url} sandbox="allow-scripts allow-same-origin" />
      {selection && resolved && (!selection.text || selectedState?.recovery.value || selectedState?.conflict.value || !!selectedState?.errors.value.length) && <aside ref={popover} class="inline-popover" aria-label="Edit selected field">
        <h2>{fieldLabel(String(resolved.keys.at(-1)), resolved.field)}</h2><p class="muted">{collections[selection.target.collection].label} · {selection.target.path}</p>
        {selectedState?.recovery.value ? <><p>An unsaved draft is stored on this device.</p>{selectedState.recoveryWarning.value && <p>{selectedState.recoveryWarning.value}</p>}<button class="button" onClick={() => selectedState.recover()}>Recover draft</button><button class="text-button" onClick={() => selectedState.clearRecovery()}>Use saved version</button></> : selectedState?.conflict.value ? <><h3>Someone else saved this. Reload and compare</h3><p>Your local draft is safe. Choose which version to keep.</p><DiffView changes={contentDiff(selectedState.collection, selectedState.conflict.value.draft, selectedState.draft.value)} beforeLabel="Saved on server" afterLabel="Your local draft" /><button class="button secondary" onClick={() => selectedState.accept(selectedState.conflict.value!)}>Discard mine</button><button class="button" onClick={() => void selectedState.keepMine()}>Keep mine (overwrite)</button></> : <Form fields={{ value: { ...resolved.field, label: fieldLabel(String(resolved.keys.at(-1)), resolved.field) } }} value={{ value: resolved.value }} change={(_, value) => update(selection, value)} errors={selectedState?.errors.value.filter(e => e.path.startsWith(resolved.formPath)).map(e => ({ ...e, path: 'value' + e.path.slice(resolved.formPath.length) }))} blur={() => { void selectedState?.save(); }} />}
        <div class="dialog-actions"><button class="button" onClick={() => void finish()}>Done</button></div>
      </aside>}
    </div>
  </section>;
}
