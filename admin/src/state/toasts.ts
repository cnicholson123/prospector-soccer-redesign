import { signal } from '@preact/signals';
export const toast = signal<{ text: string; href?: string; undo?: () => Promise<void> } | null>(null);
export function notify(text: string, href?: string, undo?: () => Promise<void>) { toast.value = { text, href, undo }; }
