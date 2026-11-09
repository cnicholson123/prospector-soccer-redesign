import type { User } from '../../shared/types';
import { can } from '../permissions';
import { collections } from '../../shared/schema';
import { allDocs, title } from './publish';
import { references } from './references';
import type { Store } from '../store/types';
export async function health(store: Store, now = new Date(), timeZone = 'America/Los_Angeles', viewer?: User) {
  const docs = await allDocs(store), issues: { code: string; message: string; collection?: string; id?: string; path?: string; href: string }[] = [];
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  for (const doc of docs.filter(d => !d.trashedAt)) {
    const data = doc.draft as Record<string, unknown>, href = doc.collection === 'site' ? '/admin/settings' : collections[doc.collection].kind === 'singleton' ? `/admin/pages/${doc.collection === 'sponsorsPage' ? 'sponsors' : doc.collection}` : `/admin/${doc.collection}/${doc.id}`;
    if (doc.collection === 'events' && typeof data.date === 'string' && data.date < day) issues.push({ code: 'past_event', message: `Past event: ${title(doc)}`, collection: doc.collection, id: doc.id, href });
    if (doc.collection === 'media' && String(data.mime).startsWith('image/') && !data.alt) issues.push({ code: 'missing_alt', message: `Missing alt text: ${title(doc)}`, collection: doc.collection, id: doc.id, href });
    for (const [state, value] of [['draft', doc.draft], ['published', doc.published]] as const) for (const ref of references(doc.collection, value)) {
      if (!docs.some(d => d.collection === ref.collection && d.id === ref.id && !d.trashedAt)) issues.push({ code: 'broken_reference', message: `Broken reference: ${title(doc)} (${state})`, collection: doc.collection, id: doc.id, path: ref.path, href });
    }
  }
  if ((await store.listUsers()).some(u => u.active && u.role === 'Owner' && u.passwordWeak !== false && (!viewer || can(viewer, 'users.manage') || viewer.id === u.id))) issues.push({ code: 'weak_owner_password', message: 'Owner password is weak', href: '/admin/profile#password' });
  if (await store.getMeta('schedule-error')) issues.push({ code: 'schedule_failed', message: 'Scheduled publication failed. Review or cancel the schedule.', href: '/admin/history' });
  return issues;
}
