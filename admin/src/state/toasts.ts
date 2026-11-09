import { signal } from '@preact/signals';
export const toast = signal<{ text: string; href?: string } | null>(null);
export function notify(text: string, href?: string) { toast.value = { text, href }; }
