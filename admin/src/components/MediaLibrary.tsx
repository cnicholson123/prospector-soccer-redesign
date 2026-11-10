import { useEffect, useState } from 'preact/hooks';
import { api, allowed, message } from '../api.js';
import { filterMedia, isImage, mediaUrl, position, type MediaDoc, type MediaKind } from '../state/media.js';
import { MediaUpload } from './MediaUpload.js';
export function MediaLibrary({ choose, kind: fixedKind, refresh = 0, allowTrash = false }: { choose: (doc: MediaDoc) => void; kind?: MediaKind; refresh?: number; allowTrash?: boolean }) {
  const [docs, setDocs] = useState<MediaDoc[]>([]), [kind, setKind] = useState<MediaKind>(fixedKind ?? 'all'), [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'), [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    api<{ docs: MediaDoc[] }>(`/media${filter === 'unused' ? '?unused=1' : filter === 'missing' ? '?missingAlt=1' : filter === 'trash' && allowTrash ? '?trash=1' : ''}`).then(data => { if (active) setDocs(data.docs); }).catch(error => { if (active) setError(message(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filter, revision, refresh]);
  const matches = filterMedia(docs, fixedKind ?? kind, query);
  return <div class="media-library">
    {allowed('media.upload') && <MediaUpload kind={fixedKind} uploaded={() => setRevision(n => n + 1)} />}
    <div class="media-filters"><label>Search media<input type="search" value={query} placeholder="Filename, alt text or caption" onInput={event => setQuery(event.currentTarget.value)} /></label>
      {!fixedKind && <label>Media type<select aria-label="Media type" value={kind} onChange={event => setKind(event.currentTarget.value as MediaKind)}><option value="all">All files</option><option value="images">Images</option><option value="documents">Documents</option></select></label>}
      <label>Show<select aria-label="Media filter" value={filter} onChange={event => setFilter(event.currentTarget.value)}><option value="all">All media</option><option value="unused">Unused</option><option value="missing">Missing alt text</option>{allowTrash && allowed('content.manage') && <option value="trash">Trash</option>}</select></label>
    </div>
    {error && <div class="error-box" role="alert">{error} <button class="text-button" onClick={() => setRevision(n => n + 1)}>Try again</button></div>}
    {loading ? <p role="status">Loading media…</p> : <><p class="muted" role="status">{matches.length} {matches.length === 1 ? 'file' : 'files'}</p><div class="media-grid">{matches.map(doc => <button type="button" class="media-card" key={doc.id} onClick={() => choose(doc)} aria-label={`${fixedKind ? 'Select' : 'Details for'} ${doc.draft.filename}`}>
      <span class="media-thumbnail">{isImage(doc) ? <img src={mediaUrl(doc)} alt="" loading="lazy" style={{ objectPosition: position(doc) }} /> : <span class="media-file-icon">PDF</span>}</span>
      <strong>{String(doc.draft.filename)}</strong><small>{isImage(doc) ? `${doc.draft.width} × ${doc.draft.height}` : 'PDF document'} · {Math.ceil(Number(doc.draft.size) / 1024)} KB</small><small>{doc.draft.source === 'static' ? 'Site asset' : 'Upload'}{isImage(doc) && !String(doc.draft.alt ?? '').trim() ? ' · Needs alt text' : ''}</small>
    </button>)}</div>{!matches.length && <div class="empty-state"><h3>No matching media</h3><p>Try another search or add a file to your library.</p></div>}</>}
  </div>;
}
