import { focal, mediaUrl, type MediaDoc } from '../state/media.js';
export function FocalPoint({ doc, value = focal(doc), change, disabled = false }: { doc: MediaDoc; value?: { x: number; y: number }; change: (point: { x: number; y: number }) => void; disabled?: boolean }) {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  return <fieldset class="focal-picker"><legend>Focal point</legend><p class="muted">Choose the part to keep in view when the image is cropped. Click the image or adjust the sliders.</p>
    <button type="button" class="focal-image" disabled={disabled} aria-label="Set focal point on image" onClick={event => {
      if (!event.detail) return; // Keyboard users choose exact values with the sliders.
      const bounds = event.currentTarget.getBoundingClientRect();
      change({ x: clamp((event.clientX - bounds.left) / bounds.width), y: clamp((event.clientY - bounds.top) / bounds.height) });
    }}><img src={mediaUrl(doc)} alt={String(doc.draft.alt || doc.draft.filename)} /><span aria-hidden="true" class="focal-marker" style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%` }} /></button>
    <label>Horizontal position <input aria-label="Horizontal focal position" type="range" min="0" max="100" step="1" value={Math.round(value.x * 100)} disabled={disabled} onInput={event => change({ ...value, x: Number(event.currentTarget.value) / 100 })} /></label>
    <label>Vertical position <input aria-label="Vertical focal position" type="range" min="0" max="100" step="1" value={Math.round(value.y * 100)} disabled={disabled} onInput={event => change({ ...value, y: Number(event.currentTarget.value) / 100 })} /></label>
    <div class="focal-preview"><img src={mediaUrl(doc)} alt="Crop preview" style={{ objectPosition: `${value.x * 100}% ${value.y * 100}%` }} /></div>
    <button type="button" class="text-button" disabled={disabled} onClick={() => change({ x: 0.5, y: 0.5 })}>Center focal point</button>
  </fieldset>;
}
