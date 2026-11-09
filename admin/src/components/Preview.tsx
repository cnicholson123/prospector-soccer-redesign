import { useEffect, useRef, useState } from 'preact/hooks';
import type { CollectionName } from '../../../shared/schema';
import { previewPath } from '../state/content';
import { Icon } from './Icon';
export function Preview({ version, id, collection = 'events', draft = {} }: { version: number; id: string; collection?: CollectionName; draft?: Record<string, unknown> }) {
  const frame = useRef<HTMLDivElement>(null);
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
  const url = `${location.port === '5173' ? '/preview' : ''}${path}?preview=1&revision=${version}&refresh=${refresh}${anchor ? '#' + anchor : ''}`;
  return <section class="preview-panel" aria-label="Draft preview">
    <div class="preview-toolbar"><div><span class="eyebrow">Private preview</span><h2>See it on the site</h2></div><button class="icon-button" onClick={() => setRefresh(refresh + 1)} aria-label="Refresh preview"><Icon name="history" /></button></div>
    <div class="segmented" role="group" aria-label="Preview device">{[[390, 'Phone'], [820, 'iPad'], [1280, 'Desktop']].map(([size, label]) => <button aria-pressed={width === size} onClick={() => setWidth(Number(size))}>{label}</button>)}</div>
    <p class="preview-caption">{width}px · Saved draft · Only visible to signed-in members</p>
    <div class="preview-scroll" ref={frame}><iframe key={`${id}-${version}-${refresh}-${width}`} title={collection === 'events' ? 'Draft event preview' : 'Draft content preview'} src={url} style={{ width: `${width}px`, height: `${610 / scale}px`, transform: `scale(${scale})`, transformOrigin: 'top left' }} /></div>
    <a class="text-link preview-open" href={url} target="_blank" rel="noreferrer">Open preview in a new tab <Icon name="external" size={16} /></a>
  </section>;
}
