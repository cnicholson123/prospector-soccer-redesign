import { useEffect, useRef, useState } from 'preact/hooks';
import { message } from '../api.js';
import { uploadMedia, type MediaDoc, type MediaKind, type UploadProgress } from '../state/media.js';
interface Job extends UploadProgress { name: string; error?: string }
export function MediaUpload({ uploaded, kind = 'all', replace, busyChanged }: { uploaded: (doc: MediaDoc) => void; kind?: MediaKind; replace?: MediaDoc; busyChanged?: (busy: boolean) => void }) {
  const [jobs, setJobs] = useState<Job[]>([]), [busy, setBusy] = useState(false), [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null), controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);
  async function start(files: File[]) {
    if (controller.current && !controller.current.signal.aborted && busy) return;
    const batch = replace ? files.slice(0, 1) : files;
    if (!batch.length) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); busyChanged?.(true); setJobs(batch.map(file => ({ name: file.name, percent: 0, stage: 'Waiting' })));
    for (const [index, file] of batch.entries()) {
      const update = (value: Partial<Job>) => { if (!abort.signal.aborted) setJobs(old => old.map((job, i) => i === index ? { ...job, ...value } : job)); };
      try {
        if (kind === 'images' && !file.type.startsWith('image/') || kind === 'documents' && file.type !== 'application/pdf') throw new Error(kind === 'images' ? 'Choose an image file.' : 'Choose a PDF file.');
        const doc = await uploadMedia(file, update, abort.signal, replace); if (!abort.signal.aborted) uploaded(doc);
      } catch (error) { if (!abort.signal.aborted) update({ error: message(error), stage: 'Upload failed' }); }
      if (abort.signal.aborted) break;
    }
    if (!abort.signal.aborted) { setBusy(false); busyChanged?.(false); }
  }
  return <section class={`media-dropzone${over ? ' is-over' : ''}`} aria-label={replace ? 'Replace file' : 'Upload media'} onDragOver={event => { event.preventDefault(); if (!busy) setOver(true); }} onDragLeave={() => setOver(false)} onDrop={event => { event.preventDefault(); setOver(false); if (!busy) void start(Array.from(event.dataTransfer?.files ?? [])); }}>
    <strong>{replace ? 'Choose a replacement file' : 'Drop files here to add to your library'}</strong><p>JPEG, PNG, WebP or GIF up to 8 MB. PDF up to 15 MB.</p><p class="muted">Images include an original and an optimized WebP, up to 2000 pixels.</p>
    <input ref={input} class="visually-hidden" type="file" aria-label={replace ? 'Replacement file' : 'Upload files'} multiple={!replace} disabled={busy} accept={kind === 'images' ? 'image/jpeg,image/png,image/webp,image/gif' : kind === 'documents' ? 'application/pdf' : 'image/jpeg,image/png,image/webp,image/gif,application/pdf'} onChange={event => { void start(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ''; }} />
    <button type="button" class="button secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : replace ? 'Choose replacement' : 'Choose files'}</button>
    <div aria-live="polite">{jobs.map((job, index) => <div class="upload-job" key={index}><strong>{job.name}</strong><span>{job.stage} · {Math.round(job.percent)}%</span><progress max="100" value={job.percent} aria-label={`Upload progress for ${job.name}`} />{job.error && <p role="alert" class="error-box">{job.error} Choose the file again to retry.</p>}</div>)}</div>
  </section>;
}
