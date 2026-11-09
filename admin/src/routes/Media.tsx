import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { api, ApiError, allowed, message, session } from '../api.js';
import { registerEditorFlush } from '../state/autosave.js';
import { changed, editorPath } from '../state/content.js';
import { focal, isImage, mediaUrl, type MediaDoc, type Usage } from '../state/media.js';
import { notify } from '../state/toasts.js';
import { MediaLibrary } from '../components/MediaLibrary.js';
import { MediaUpload } from '../components/MediaUpload.js';
import { FocalPoint } from '../components/FocalPoint.js';
import { Dialog } from '../components/ConfirmDialog.js';
export function MediaDetails({ id, close, updated }: { id: string; close: () => void; updated: () => void }) {
  const [doc, setDoc] = useState<MediaDoc>(), [usage, setUsage] = useState<Usage[]>([]), [usageLoaded, setUsageLoaded] = useState(false);
  const [alt, setAlt] = useState(''), [caption, setCaption] = useState(''), [point, setPoint] = useState({ x: 0.5, y: 0.5 });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [replacing, setReplacing] = useState(false), [confirm, setConfirm] = useState(false), [discard, setDiscard] = useState(false), [retry, setRetry] = useState(0);
  const saving = useRef<Promise<boolean> | null>(null);
  const flush = useRef<() => Promise<boolean>>(async () => true);
  const accept = (doc: MediaDoc) => { setDoc(doc); setAlt(String(doc.draft.alt ?? '')); setCaption(String(doc.draft.caption ?? '')); setPoint(focal(doc)); };
  useEffect(() => {
    let active = true; setError(''); setUsageLoaded(false);
    void api<{ doc: MediaDoc }>(`/media/${id}`).then(data => { if (active) accept(data.doc); }).catch(e => { if (active) setError(message(e)); });
    void api<{ usage: Usage[] }>(`/media/${id}/usage`).then(data => { if (active) { setUsage(data.usage); setUsageLoaded(true); } }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [id, retry]);
  const editable = allowed('media.edit') && (session.value?.user.role !== 'Contributor' || doc?.draft.uploadedBy === session.value.user.id);
  const dirty = !!doc && (alt !== String(doc.draft.alt ?? '') || caption !== String(doc.draft.caption ?? '') || point.x !== focal(doc).x || point.y !== focal(doc).y);
  function save(): Promise<boolean> {
    if (saving.current) return saving.current;
    if (!doc || busy) return Promise.resolve(false);
    setBusy(true); setError('');
    saving.current = (async () => {
      try {
        const data = await api<{ doc: MediaDoc }>(`/media/${id}`, 'PATCH', { baseVersion: doc.version, alt, caption, ...(isImage(doc) ? { focal: point } : {}) });
        accept(data.doc); changed(); updated(); notify('Media details saved'); return true;
      } catch (e) { setError(message(e)); return false; }
      finally { setBusy(false); saving.current = null; }
    })();
    return saving.current;
  }
  flush.current = () => saving.current ?? (busy ? Promise.resolve(false) : editable && dirty ? save() : Promise.resolve(true));
  useEffect(() => registerEditorFlush(() => flush.current()), [id]);
  async function remove() {
    if (!doc || busy) return; setBusy(true); setError('');
    try { await api(`/media/${id}`, 'DELETE', { baseVersion: doc.version }); changed(); updated(); notify('Media moved to trash'); close(); }
    catch (e) { setError(message(e)); if (e instanceof ApiError && e.details && typeof e.details === 'object' && 'usage' in e.details) { setUsage((e.details as { usage: Usage[] }).usage); setUsageLoaded(true); } }
    finally { setBusy(false); setConfirm(false); }
  }
  return <Dialog title="Media details" drawer close={() => dirty ? setDiscard(true) : close()} dismissible={!busy}>
    {error && <div role="alert" class="error-box">{error}<button class="text-button" disabled={busy || dirty} onClick={() => setRetry(n => n + 1)}>Reload details</button>{dirty && <p>Your changes are still here. Close and reopen to discard them and load the latest version.</p>}</div>}
    {discard && <section class="notice" role="alert"><h3>Discard unsaved details?</h3><p>Your saved media will stay as it is.</p><div class="dialog-actions"><button class="button secondary" onClick={() => setDiscard(false)}>Keep editing</button><button class="button" onClick={close}>Discard and close</button></div></section>}
    {!doc ? !error && <p role="status">Loading media details…</p> : <>
      <h3>{String(doc.draft.filename)}</h3>{isImage(doc) ? <img class="media-detail-image" src={mediaUrl(doc)} alt={alt} /> : <div class="media-file-icon">PDF</div>}
      <p class="muted">{String(doc.draft.mime)} · {Math.ceil(Number(doc.draft.size) / 1024)} KB{isImage(doc) ? ` · ${doc.draft.width} × ${doc.draft.height}` : ''}</p>
      <div class="dialog-actions"><a href={String((doc.draft.variants as Record<string, string>).original)} target="_blank" rel="noreferrer">Open original</a>{isImage(doc) && <a href={mediaUrl(doc)} target="_blank" rel="noreferrer">Open web image</a>}</div>
      <div class="media-metadata">{isImage(doc) && <><label for="media-alt">Default alternative text</label><input id="media-alt" maxLength={500} value={alt} disabled={!editable || busy} onInput={e => setAlt(e.currentTarget.value)} /><small>Used when choosing this image. Existing placements keep their own alternative text.</small></>}
      <label for="media-caption">Caption</label><textarea id="media-caption" maxLength={500} value={caption} disabled={!editable || busy} onInput={e => setCaption(e.currentTarget.value)} />
      {isImage(doc) && <FocalPoint doc={doc} value={point} change={setPoint} disabled={!editable || busy} />}
      {editable && <><button class="button" disabled={busy || !dirty} onClick={() => void save()}>Save media details</button><small>Saved as a draft. Review changes to publish focal-point updates.</small></>}</div>
      <section class="media-usage"><h3>Used by</h3>{!usageLoaded ? <p role="status">Loading usage…</p> : usage.length ? <ul>{usage.map((item, index) => <li key={index}><a href={editorPath(item.collection, item.id)}>{item.title}</a><small>{item.path}</small></li>)}</ul> : <p>No current uses. Published history keeps its files.</p>}<small>Includes drafts, published content and scheduled content.</small></section>
      {editable && <section class="media-replace"><h3>Replace file</h3><p>Keep this library item and its placements. Publish the media change to update live pages. Earlier published files are retained.</p>{dirty && <p>Save your details before replacing the file.</p>}
        {!replacing ? <button class="button secondary" disabled={busy || dirty} onClick={() => setReplacing(true)}>Replace file</button> : <MediaUpload kind={isImage(doc) ? 'images' : 'documents'} replace={doc} busyChanged={setBusy} uploaded={next => { accept(next); setBusy(false); setReplacing(false); updated(); notify('Replacement saved as a draft'); }} />}</section>}
      {allowed('content.manage') && <section class="media-delete"><h3>Delete media</h3><p>Files in use cannot be deleted. Published history remains available.</p>{confirm ? <div class="dialog-actions"><button class="button secondary" disabled={busy} onClick={() => setConfirm(false)}>Keep media</button><button class="button danger" disabled={busy} onClick={() => void remove()}>Confirm delete</button></div> : <button class="button secondary danger-text" disabled={busy || dirty} onClick={() => setConfirm(true)}>Delete media</button>}</section>}
      {dirty && <p role="status">Unsaved media details</p>}
    </>}
  </Dialog>;
}
export function Media({ id, refresh }: { id?: string; refresh: number }) {
  const { route } = useLocation(); const [revision, setRevision] = useState(0);
  return <><header class="page-heading"><div><span class="eyebrow">Your club library</span><h1>Media</h1><p>Images and documents, ready for every page.</p></div></header>
    <MediaLibrary refresh={refresh + revision} choose={doc => route(`/admin/media/${doc.id}`)} />
    {id && <MediaDetails key={id} id={id} close={() => route('/admin/media')} updated={() => setRevision(n => n + 1)} />}
  </>;
}
