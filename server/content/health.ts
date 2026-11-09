import type { User } from '../../shared/types.js';
import { can } from '../permissions.js';
import { collections } from '../../shared/schema.js';
import { allDocs, title } from './publish.js';
import { references } from './references.js';
import type { Store } from '../store/types.js';
/** Only known static browser/chrome assets are exempt; uploaded content is always checked. */
export function isNonContentMedia(data: Record<string, unknown>): boolean {
  return data.source === 'static' && /^(?:favicon(?:[-.].*)?|apple-touch-icon(?:[-.].*)?|touch-icon(?:[-.].*)?|crest(?:[-.].*)?)$/i.test(String(data.filename ?? ''));
}
export async function health(store: Store, now = new Date(), timeZone = 'America/Los_Angeles', viewer?: User, contentOnly = false) {
  const docs = await allDocs(store), issues: { code: string; message: string; collection?: string; id?: string; path?: string; href: string }[] = [];
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  for (const doc of docs.filter(d => !d.trashedAt)) {
    const data = doc.draft as Record<string, unknown>, href = doc.collection === 'site' ? '/admin/settings' : collections[doc.collection].kind === 'singleton' ? `/admin/pages/${doc.collection === 'sponsorsPage' ? 'sponsors' : doc.collection}` : `/admin/${doc.collection}/${doc.id}`;
    if (doc.collection === 'events' && typeof data.date === 'string' && data.date < day) issues.push({ code: 'past_event', message: `Past event: ${title(doc)}`, collection: doc.collection, id: doc.id, href });
    if (doc.collection === 'media' && String(data.mime).startsWith('image/') && !data.alt && !isNonContentMedia(data)) issues.push({ code: 'missing_alt', message: `Missing alt text: ${title(doc)}`, collection: doc.collection, id: doc.id, href });
    for (const [state, value] of [['draft', doc.draft], ['published', doc.published]] as const) for (const ref of references(doc.collection, value)) {
      if (!docs.some(d => d.collection === ref.collection && d.id === ref.id && !d.trashedAt)) issues.push({ code: 'broken_reference', message: `Broken reference: ${title(doc)} (${state})`, collection: doc.collection, id: doc.id, path: ref.path, href });
    }
  }
  if (!contentOnly && (await store.listUsers()).some(u => u.active && u.role === 'Owner' && u.passwordWeak !== false && (!viewer || can(viewer, 'users.manage') || viewer.id === u.id))) issues.push({ code: 'weak_owner_password', message: 'Owner password is weak', href: '/admin/profile#password' });
  if (!contentOnly && await store.getMeta('schedule-error')) issues.push({ code: 'schedule_failed', message: 'Scheduled publication failed. Review or cancel the schedule.', href: '/admin/history' });
  return issues;
}

export async function cachedHealth(store: Store, now: Date, timeZone: string, viewer: User) {
  type Cache = { at: string; timeZone: string; generation: unknown; issues: Awaited<ReturnType<typeof health>> };
  const [raw, users, scheduleError, generation] = await Promise.all([store.getMeta('health-cache'), store.listUsers(), store.getMeta('schedule-error'), store.getMeta('health-generation')]);
  const cached = raw as Cache | null;
  const valid = cached && cached.generation === generation && cached.timeZone === timeZone && Date.parse(cached.at) <= now.getTime() && now.getTime() - Date.parse(cached.at) < 300000;
  const issues = valid ? [...cached.issues] : await health(store, now, timeZone, undefined, true);
  if (!valid) await store.setMeta('health-cache', { at: now.toISOString(), timeZone, generation, issues });
  if (users.some(u => u.active && u.role === 'Owner' && u.passwordWeak !== false && (can(viewer, 'users.manage') || viewer.id === u.id))) issues.push({ code: 'weak_owner_password', message: 'Owner password is weak', href: '/admin/profile#password' });
  if (scheduleError) issues.push({ code: 'schedule_failed', message: 'Scheduled publication failed. Review or cancel the schedule.', href: '/admin/history' });
  return issues;
}
