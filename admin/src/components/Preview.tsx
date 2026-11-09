import { useEffect, useRef, useState } from 'preact/hooks';
import type { CollectionName } from '../../../shared/schema.js';
import { previewPath } from '../state/content.js';
import { Icon } from './Icon.js';
import { editPath } from '../../../shared/edit-path.js';
export function Preview({ version, id, collection = 'events', draft = {}, focusedPath = '' }: { version: number; id: string; collection?: CollectionName; draft?: Record<string, unknown>; focusedPath?: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  function highlight() {
    const document = iframe.current?.contentDocument;
    if (!document) return;
    document.querySelectorAll<HTMLElement>('[data-preview-focus]').forEach(node => { node.style.outline = ''; node.style.outlineOffset = ''; node.removeAttribute('data-preview-focus'); });
    for (const node of document.querySelectorAll<HTMLElement>('[data-edit]')) {
      try {
        const target = JSON.parse(node.dataset.edit!);
        const path = editPath(collection, draft, target.path)?.formPath;
        if (target.collection !== collection || target.id !== id || !path || (path !== focusedPath && !focusedPath.startsWith(path + '.'))) continue;
        node.dataset.previewFocus = 'true'; node.style.outline = '3px solid #F2B705'; node.style.outlineOffset = '4px';
        node.scrollIntoView({ block: 'center', behavior: 'instant' }); break;
      } catch { /* Ignore malformed annotations. */ }
    }
  }
  useEffect(highlight, [focusedPath, version]);
  const [available, setAvailable] = useState(390);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setAvailable(entries[0].contentRect.width));
    if (frame.current) observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  const [width, setWidth] = useState(390);
  const [refresh, setRefresh] = useState(0);
  const scale = Math.max(0.1, Math.min(1, available / width));
  const [path, anchor] = previewPath(collection, draft).split('#');
  const url = `${location.port === '5173' ? '/preview' : ''}${path}?preview=1&edit=1&revision=${version}&refresh=${refresh}${anchor ? '#' + anchor : ''}`;
  return <section class="preview-panel" aria-label="Draft preview">
    <div class="preview-toolbar"><div><span class="eyebrow">Private preview</span><h2>See it on the site</h2></div><button class="icon-button" onClick={() => setRefresh(refresh + 1)} aria-label="Refresh preview"><Icon name="history" /></button></div>
    <div class="segmented" role="group" aria-label="Preview device">{[[390, 'Phone'], [820, 'iPad'], [1280, 'Desktop']].map(([size, label]) => <button aria-pressed={width === size} onClick={() => setWidth(Number(size))}>{label}</button>)}</div>
    <p class="preview-caption">{width}px · Saved draft · Only visible to signed-in members</p>
    {/* Keep the full public site's links out of the editor's tab sequence.
        The following link opens the same preview for keyboard exploration. */}
    <div class="preview-scroll" ref={frame}><iframe ref={iframe} tabIndex={-1} onLoad={highlight} key={`${id}-${version}-${refresh}-${width}`} title={collection === 'events' ? 'Draft event preview' : 'Draft content preview'} src={url} style={{ width: `${width}px`, height: `${610 / scale}px`, transform: `scale(${scale})`, transformOrigin: 'top left' }} /></div>
    <a class="text-link preview-open" href={url.replace('&edit=1', '')} target="_blank" rel="noreferrer">Open preview in a new tab <Icon name="external" size={16} /></a>
  </section>;
}
