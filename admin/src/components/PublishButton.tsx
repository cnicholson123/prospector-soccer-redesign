import { useEffect, useRef, useState } from 'preact/hooks';
import { allowed } from '../api.js';
export type PublishMode = 'publish' | 'schedule' | 'review';
export function PublishButton({ open, disabled = false }: { open: (mode: PublishMode) => void; disabled?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const host = useRef<HTMLDivElement>(null), toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: MouseEvent) => { if (!host.current?.contains(event.target as Node)) setExpanded(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [expanded]);
  if (!allowed('content.edit')) return <button class="button" onClick={() => open('publish')}>Review changes</button>;
  const publisher = allowed('content.publish');
  return <div ref={host} class="publish-split" onKeyDown={event => { if (event.key === 'Escape') { setExpanded(false); toggle.current?.focus(); } }}>
    <button class="button" disabled={disabled} onClick={() => open(publisher ? 'publish' : 'review')}>{publisher ? 'Review & publish' : 'Request review'}</button>
    <button ref={toggle} class="button split-toggle" disabled={disabled} aria-label="Publish options" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>▾</button>
    {expanded && <div class="publish-options" role="group" aria-label="Publication actions">
      {publisher && <><button onClick={() => { setExpanded(false); open('publish'); }}>Publish now</button><button onClick={() => { setExpanded(false); open('schedule'); }}>Schedule for later</button></>}
      <button onClick={() => { setExpanded(false); open('review'); }}>Request review</button>
    </div>}
  </div>;
}
