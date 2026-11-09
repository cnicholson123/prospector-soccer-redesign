import { useEffect, useState } from 'preact/hooks';
import type { AuditEntry } from '../../../shared/types.js';
import { collections } from '../../../shared/schema.js';
import { allowed, api, message } from '../api.js';
import { auditParams, historyTime, useHistoryPages, type ActorOption } from '../state/history.js';
import { activityText } from '../state/activity.js';
import { editorPath } from '../state/content.js';
import { Dialog } from '../components/ConfirmDialog.js';
import { HistoryPager } from '../components/HistoryPager.js';
const blank = { actor: '', action: '', actionGroup: '', collection: '', from: '', to: '', q: '' };
export function Audit() {
  const [filters, setFilters] = useState(blank), [applied, setApplied] = useState(blank), [actors, setActors] = useState<ActorOption[]>([]);
  const [selected, setSelected] = useState<AuditEntry | null>(null), [error, setError] = useState('');
  const params = auditParams(applied), pages = useHistoryPages<AuditEntry>('/audit?' + params);
  useEffect(() => { if (allowed('audit.read')) api<{ actors: ActorOption[] }>('/audit/actors').then(result => setActors(result.actors)).catch(error => setError(message(error))); }, []);
  if (!allowed('audit.read')) return <div class="card"><h1>Audit log</h1><p>Only Owners and Admins can view the audit log.</p></div>;
  const field = (name: keyof typeof blank, value: string) => setFilters(old => ({ ...old, [name]: value }));
  const dirty = JSON.stringify(filters) !== JSON.stringify(applied);
  return <><header class="page-heading"><div><span class="eyebrow">Accountability, made clear</span><h1>Audit log</h1><p>Sign-ins, edits and publications. Newest activity first.</p></div>{allowed('audit.export') && <div class="history-actions"><a class="button secondary" href={`/api/admin/audit/export?format=csv&${params}`} download="audit.csv">Export CSV</a><a class="text-link" href={`/api/admin/audit/export?format=json&${params}`} download="audit.json">Export JSON</a></div>}</header>
    <section class="card history-card"><form class="history-filters" onSubmit={event => { event.preventDefault(); if (filters.from && filters.to && filters.from > filters.to) { setError('End date must be on or after start date.'); return; } setError(''); setApplied({ ...filters }); }}>
      <label>User<select aria-label="User" value={filters.actor} onChange={e => field('actor', e.currentTarget.value)}><option value="">All users</option>{actors.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}<option value="system">System</option><option value="seed">Seed migration</option></select></label>
      <label>Action group<select aria-label="Action group" value={filters.actionGroup} onChange={e => field('actionGroup', e.currentTarget.value)}><option value="">All groups</option>{['auth', 'content', 'site', 'users', 'media', 'system', 'health'].map(group => <option key={group} value={group}>{group === 'auth' ? 'Sign-in & security' : group[0].toUpperCase() + group.slice(1)}</option>)}</select></label>
      <label>Exact action<input list="audit-actions" placeholder="Any action" value={filters.action} onInput={e => field('action', e.currentTarget.value)} /><datalist id="audit-actions">{['auth.login', 'auth.logout', 'auth.login_failed', 'content.edited', 'content.checkpoint', 'content.publish', 'content.restored', 'site.restore'].map(action => <option value={action} key={action} />)}</datalist></label>
      <label>Collection<select aria-label="Collection" value={filters.collection} onChange={e => field('collection', e.currentTarget.value)}><option value="">All collections</option>{Object.values(collections).map(c => <option key={c.name} value={c.name}>{c.labelPlural}</option>)}</select></label>
      <label>From date<input type="date" value={filters.from} onInput={e => field('from', e.currentTarget.value)} /></label><label>Through date<input type="date" min={filters.from} value={filters.to} onInput={e => field('to', e.currentTarget.value)} /></label>
      <label class="history-search">Search activity<input type="search" placeholder="Title, user, action or details" value={filters.q} onInput={e => field('q', e.currentTarget.value)} /></label>
      <div class="history-actions"><button class="button" type="submit">Apply filters</button><button class="text-button" type="button" onClick={() => { setFilters(blank); setApplied(blank); setError(''); }}>Clear filters</button></div>
    </form><p class="history-note" role="status">Dates include the entire day in Pacific time. Exports include all matching records using the applied filters.{dirty ? ' Filter changes are not applied yet.' : ''}</p>{error && <p class="error-box" role="alert">{error}</p>}
      <ol class="audit-list" aria-label="Audit activity" aria-busy={pages.loading}>{pages.rows.map(row => <li key={row.id}><button class="audit-row" onClick={() => setSelected(row)} aria-label={`${activityText(row)}${row.targetTitle ? ': ' + row.targetTitle : ''}. View details`}><time dateTime={row.at}>{historyTime(row.at)}</time><span><strong>{activityText(row)}</strong><span>{row.targetTitle || (row.collection ? collections[row.collection].label : 'Site activity')}</span><code>{row.action}</code></span><span class="audit-detail-hint">Details →</span></button></li>)}</ol>
      {!pages.loading && !pages.error && !pages.rows.length && <div class="empty-state"><h2>No matching activity</h2><p>Try another date range or clear your filters.</p></div>}
      <HistoryPager {...pages} more={pages.cursor} infinite load={() => void pages.load(pages.cursor)} />
    </section>
    {selected && <Dialog title="Activity details" close={() => setSelected(null)} wide drawer><div class="audit-detail"><h3>{activityText(selected)}</h3><dl>{Object.entries({ Time: historyTime(selected.at), Action: selected.action, User: selected.actorName, 'User ID': selected.actorId, Collection: selected.collection, Document: selected.targetTitle, 'Document ID': selected.docId, 'IP address': selected.ip, 'User agent': selected.userAgent, 'Entry ID': selected.id }).filter(([,value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{selected.collection && selected.docId && selected.collection !== 'media' && <a class="text-link" href={editorPath(selected.collection, selected.docId)}>Open document</a>}<h3>Recorded details</h3><pre tabIndex={0} aria-label="Audit metadata">{JSON.stringify(selected.meta ?? {}, null, 2)}</pre></div></Dialog>}
  </>;
}
