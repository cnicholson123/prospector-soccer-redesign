import type { AuditEntry } from '../../../shared/types';
export function relativeTime(at: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(at)) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} ${seconds < 7200 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(seconds / 86400); return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
export function activityText(entry: AuditEntry): string {
  const verbs: Record<string, string> = { 'auth.login': 'signed in', 'auth.logout': 'signed out', 'auth.login_failed': 'had an unsuccessful sign-in', 'auth.locked': 'had a sign-in locked', 'auth.password': 'changed their password', 'content.create': 'created', 'content.edit': 'edited', 'content.edited': 'edited', 'content.trashed': 'moved to trash', 'content.untrashed': 'restored from trash', 'content.restored': 'restored a revision', 'content.unpublish': 'unpublished content', 'content.schedule': 'scheduled content', 'content.checkpoint': 'saved a checkpoint for', 'content.duplicate': 'duplicated', 'content.trash': 'moved to trash', 'content.untrash': 'restored from trash', 'content.reorder': 'reordered content', 'content.restore': 'restored a revision', 'content.review_request': 'requested a review', 'content.review_return': 'returned a review', 'system.bootstrap': 'initialized an account', 'system.seed': 'initialized site content' };
  if (entry.action === 'content.publish') { const count = Array.isArray(entry.meta?.items) ? entry.meta.items.length : 1; return `${entry.actorName} published ${count} ${count === 1 ? 'change' : 'changes'}`; }
  return `${entry.actorName} ${verbs[entry.action] ?? entry.action.replace(/^[^.]+\./, '').replaceAll('_', ' ')}`;
}
export function groupActivity(entries: AuditEntry[]): { system: boolean; entries: AuditEntry[] }[] {
  const rows: { system: boolean; entries: AuditEntry[] }[] = [];
  for (const entry of entries) {
    const system = entry.action.startsWith('system.') || ['system', 'seed'].includes(entry.actorId) || /migration|seed/.test(entry.action);
    const last = rows.at(-1);
    if (system && last?.system) last.entries.push(entry); else rows.push({ system, entries: [entry] });
  }
  return rows;
}
