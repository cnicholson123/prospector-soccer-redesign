import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from './Icon.js';
export function Dialog({ title, close, children, wide = false, dismissible = true, drawer = false, initialFocus }: { title: string; close: () => void; children: ComponentChildren; wide?: boolean; dismissible?: boolean; drawer?: boolean; initialFocus?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    if (initialFocus) dialog?.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => { dialog?.close(); before?.focus(); };
  }, []);
  return <dialog ref={ref} class={`dialog${wide ? ' dialog-wide' : ''}${drawer ? ' dialog-drawer' : ''}`} aria-label={title} onKeyDown={event => {
    if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    // showModal makes the page inert, but Chrome can still tab into browser
    // chrome at the boundary. Keep keyboard navigation inside this workspace.
    const dialog = event.currentTarget;
    const controls = [...dialog.querySelectorAll<HTMLElement>('a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable="true"]')]
      .filter(node => node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[hidden], [inert]') && node.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1), active = document.activeElement;
    if (!first || !controls.some(node => node === active) || active === (event.shiftKey ? first : last)) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      if (!first) dialog.focus();
    }
  }} onCancel={event => { event.preventDefault(); if (dismissible) close(); }}>
    <header class="dialog-heading"><h2>{title}</h2>{dismissible && <button class="icon-button" aria-label="Close dialog" onClick={close}><Icon name="close" /></button>}</header>
    {children}
  </dialog>;
}
