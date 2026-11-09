import { collections } from '../../../shared/schema.js';
import { allowed } from '../api.js';
import { editorPath } from './content.js';
export interface Command { id: string; title: string; detail: string; href?: string; action?: 'publish' | 'review' | 'help' | 'preview-ipad' }
export function commands(): Command[] {
  const screens: Command[] = [
    { id: 'dashboard', title: 'Dashboard', detail: 'Navigate', href: '/admin' },
    { id: 'pages', title: 'Pages', detail: 'Navigate', href: '/admin/pages' },
    { id: 'history', title: 'History', detail: 'Navigate', href: '/admin/history' },
    { id: 'profile', title: 'Profile', detail: 'Navigate', href: '/admin/profile' },
    { id: 'review', title: 'Review changes', detail: 'Open saved changes', action: 'review' },
    { id: 'help', title: 'Keyboard shortcuts', detail: 'Help', action: 'help' },
  ];
  const current = typeof location === 'undefined' ? [] : location.pathname?.split('/') ?? [];
  const definition = collections[current[2] as keyof typeof collections];
  const inEditor = current[2] === 'settings' || current[2] === 'store' && current[3] === 'settings' ||
    current[3] && current[3] !== 'new' && (current[2] === 'pages' || definition?.kind === 'collection' && !definition.systemManaged);
  if (inEditor) screens.push({ id: 'preview-ipad', title: 'Open preview as iPad', detail: 'Current document · 820px', action: 'preview-ipad' });
  if (allowed('users.manage')) screens.push({ id: 'users', title: 'Users', detail: 'Navigate', href: '/admin/users' });
  if (allowed('audit.read')) screens.push({ id: 'audit', title: 'Audit log', detail: 'Navigate', href: '/admin/audit' });
  if (allowed('content.publish')) screens.push({ id: 'publish', title: 'Publish all', detail: 'Review all saved pending changes', action: 'publish' });
  for (const definition of Object.values(collections)) {
    screens.push({ id: definition.name, title: definition.labelPlural, detail: 'Navigate', href: definition.kind === 'singleton' ? editorPath(definition.name) : `/admin/${definition.name}` });
    if (definition.kind === 'collection' && !definition.systemManaged && allowed('content.create')) screens.push({ id: 'new-' + definition.name, title: `New ${definition.label.toLowerCase()}`, detail: 'Create item', href: `/admin/${definition.name}/new` });
    if (definition.kind === 'singleton') for (const [key, field] of Object.entries(definition.fields)) if (field.type === 'object') screens.push({ id: `${definition.name}-${key}`, title: `${definition.label}: ${field.label || key}`, detail: 'Open section', href: `${editorPath(definition.name)}#section-${key}` });
  }
  return screens;
}
export function typingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"]');
}
