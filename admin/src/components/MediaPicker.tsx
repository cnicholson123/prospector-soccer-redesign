import { useEffect, useState } from 'preact/hooks';
import { api, message } from '../api.js';
import { record } from '../state/content.js';
import { isImage, mediaUrl, position, type MediaDoc } from '../state/media.js';
import { Dialog } from './ConfirmDialog.js';
import { MediaLibrary } from './MediaLibrary.js';
export function MediaField({ id, type, value, change, disabled }: { id: string; type: 'image' | 'file'; value: unknown; change: (value: unknown) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false), [doc, setDoc] = useState<MediaDoc>(), [error, setError] = useState('');
  const selected = record(value), mediaId = selected.mediaId;
  useEffect(() => {
    let active = true; setDoc(undefined); setError('');
    if (typeof mediaId === 'string') api<{ doc: MediaDoc }>(`/media/${encodeURIComponent(mediaId)}`).then(data => { if (active) setDoc(data.doc); }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [mediaId]);
  return <div class="media-field">
    {doc && <div class="media-selection">{isImage(doc) ? <img src={mediaUrl(doc)} alt={String(selected.alt ?? '')} style={{ objectPosition: position(doc) }} /> : <span class="media-file-icon">PDF</span>}<div><strong>{String(doc.draft.filename)}</strong>{type === 'image' && <p class="muted">Preview uses the image’s focal point.</p>}</div></div>}
    {!mediaId && <p class="muted">No {type} selected.</p>}{error && <p class="error-box" role="alert">{error}</p>}
    <button id={id} type="button" class="button secondary" disabled={disabled} onClick={() => setOpen(true)}>{mediaId ? `Change ${type}` : `Choose ${type}`}</button>
    {type === 'image' && mediaId && <><label for={`${id}-alt`}>Alternative text for this use</label><input id={`${id}-alt`} type="text" maxLength={500} value={String(selected.alt ?? '')} disabled={disabled} onInput={event => change({ ...selected, alt: event.currentTarget.value })} /><small>Describe the image in this context. Leave empty only when decorative.</small></>}
    {open && <Dialog drawer wide title={type === 'image' ? 'Choose an image' : 'Choose a document'} close={() => setOpen(false)}><MediaLibrary kind={type === 'image' ? 'images' : 'documents'} choose={doc => { setDoc(doc); change({ mediaId: doc.id, ...(type === 'image' ? { alt: String(doc.draft.alt ?? '') } : {}) }); setOpen(false); }} /></Dialog>}
  </div>;
}
