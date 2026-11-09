import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
/** Pointer dragging is restricted to the handle, so text selection and form controls remain native. */
export function DragList({ ids, label, move, disabled = false, children }: { ids: string[]; label: (index: number) => string; move: (from: number, to: number) => void; disabled?: boolean; children: (index: number) => ComponentChildren }) {
  const root = useRef<HTMLDivElement>(null), dragging = useRef<number | null>(null), target = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null), [announcement, setAnnouncement] = useState('');
  function reorder(from: number, to: number) { if (from === to || to < 0 || to >= ids.length) return; move(from, to); setAnnouncement(`${label(from)} moved to position ${to + 1} of ${ids.length}`); }
  return <div class="drag-list" ref={root}><span class="sr-only" role="status">{announcement}</span>{ids.map((id, index) => <div key={id} data-drag-id={id} data-drag-index={index} class={`drag-row ${over === index ? 'drag-over' : ''}`}>
    {!disabled && <div class="reorder-controls"><button type="button" class="drag-handle" aria-label={`Reorder ${label(index)}. Use Alt and arrow keys`} onKeyDown={event => { if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); reorder(index, index + (event.key === 'ArrowUp' ? -1 : 1)); } }}
      onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); dragging.current = index; target.current = index; }}
      onPointerMove={event => { if (dragging.current === null) return; const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-drag-index]'); if (row && root.current?.contains(row)) { target.current = Number(row.dataset.dragIndex); setOver(target.current); } }}
      onPointerUp={() => { if (dragging.current !== null && target.current !== null) reorder(dragging.current, target.current); dragging.current = null; target.current = null; setOver(null); }} onPointerCancel={() => { dragging.current = null; setOver(null); }}>⠿</button>
      <button type="button" class="icon-button" disabled={index === 0} aria-label={`Move ${label(index)} up`} onClick={() => reorder(index, index - 1)}>↑</button><button type="button" class="icon-button" disabled={index === ids.length - 1} aria-label={`Move ${label(index)} down`} onClick={() => reorder(index, index + 1)}>↓</button></div>}
    <div class="drag-content">{children(index)}</div>
  </div>)}</div>;
}
