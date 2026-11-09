import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from './Icon';
export function Dialog({ title, close, children, wide = false, dismissible = true }: { title: string; close: () => void; children: ComponentChildren; wide?: boolean; dismissible?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { ref.current?.close(); before?.focus(); };
  }, []);
  return <dialog ref={ref} class={wide ? 'dialog dialog-wide' : 'dialog'} aria-label={title} onCancel={event => { event.preventDefault(); if (dismissible) close(); }}>
    <header class="dialog-heading"><h2>{title}</h2>{dismissible && <button class="icon-button" aria-label="Close dialog" onClick={close}><Icon name="close" /></button>}</header>
    {children}
  </dialog>;
}
