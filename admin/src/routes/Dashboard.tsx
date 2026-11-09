import { useEffect, useState } from 'preact/hooks';
import type { AuditEntry } from '../../../shared/types.js';
import { api, allowed, message, session } from '../api.js';
import { activityText, groupActivity, relativeTime } from '../state/activity.js';
import { ReviewQueue } from '../components/ReviewQueue.js';
import { Dialog } from '../components/ConfirmDialog.js';
import { changed } from '../state/content.js';
import { notify } from '../state/toasts.js';
import { Icon } from '../components/Icon.js';
interface DashboardData { pendingCount: number; reviewCount: number; scheduled: unknown[]; health: { code: string; message: string; href: string }[]; recent: AuditEntry[] }
export function Dashboard({ publish, refresh }: { publish: () => void; refresh: number }) {
  const [rebuild, setRebuild] = useState(false), [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState({ counts: false, activity: false, health: false });
  const [data, setData] = useState<DashboardData>(), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const update = (value: Partial<DashboardData>) => { if (active) setData(old => ({ pendingCount: 0, reviewCount: 0, scheduled: [], health: [], recent: [], ...old, ...value })); };
    const fail = (error: unknown) => { if (active) setError(message(error)); };
    setError('');
    const mark = (key: 'counts' | 'activity' | 'health') => { if (active) setLoaded(old => ({ ...old, [key]: true })); };
    void api<DashboardData & { scheduledCount: number }>('/counts').then(value => { update({ ...value, scheduled: Array.from({ length: value.scheduledCount }) }); mark('counts'); }).catch(fail);
    void api<DashboardData>('/dashboard?section=activity').then(value => { update(value); mark('activity'); }).catch(fail);
    void api<DashboardData>('/dashboard?section=health').then(value => { update(value); mark('health'); }).catch(fail);
    return () => { active = false; };
  }, [refresh]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const activity = (item: AuditEntry) => <><span class="avatar">{item.actorName.slice(0, 1)}</span><div><strong>{activityText(item)}</strong>{item.targetTitle && <p>{item.targetTitle}</p>}<time dateTime={item.at} title={new Date(item.at).toLocaleString()}>{relativeTime(item.at, now)}</time></div></>;
  const hour = new Date().getHours(), greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return <><header class="page-heading"><div><span class="eyebrow">Your club, connected</span><h1>{greeting}, {session.value?.user.displayName}.</h1><p>Make the next great season happen.</p></div>{allowed('content.create') && <a class="button" href="/admin/events/new"><Icon name="plus" /> New event</a>}</header>
    <div class="dashboard-actions"><a class="button secondary" href="/admin/pages/home">Edit home</a>{allowed('media.upload') && <a class="button secondary" href="/admin/media">Upload media</a>}{allowed('users.manage') && <button class="text-button" onClick={() => setRebuild(true)}>Rebuild snapshot</button>}</div>
    {error && <p role="alert" class="error-box">{error}</p>}{!data ? <p role="status">Loading your dashboard…</p> : <>
      <div class="stats-grid"><button class="stat-card stat-primary" onClick={publish}><span>Pending changes</span><strong>{loaded.counts ? data.pendingCount : '…'}</strong><span>Review & publish <Icon name="arrow" /></span></button><div class="stat-card"><span>Scheduled</span><strong>{loaded.counts ? data.scheduled.length : '…'}</strong><small>Ready for the right moment</small></div>{allowed('content.publish') && <a class="stat-card" href="#awaiting-review"><span>Awaiting review</span><strong>{loaded.counts ? data.reviewCount : '…'}</strong><small>A second pair of eyes</small></a>}</div>
      {allowed('content.publish') && <ReviewQueue refresh={refresh} />}
      <div class="dashboard-grid"><section class="card"><div class="section-heading"><div><span class="eyebrow">Keep things in good shape</span><h2>Site health</h2></div><span class="badge">{data.health.length} items</span></div>
        {!loaded.health ? <p role="status">Checking site health…</p> : data.health.length ? <ul class="health-list">{data.health.map((item, index) => <li key={index}><span class="health-dot" /><div><strong>{item.message}</strong><a href={item.href}>Review item <span aria-hidden="true">→</span></a></div></li>)}</ul> : <p class="empty-state">Everything is looking good.</p>}
      </section><section class="card"><div class="section-heading"><div><span class="eyebrow">A shared effort</span><h2>Recent activity</h2></div><Icon name="history" /></div>
        {!loaded.activity ? <p role="status">Loading recent activity…</p> : data.recent.length ? <ol class="activity-list">{groupActivity(data.recent).map(group => <li key={group.entries[0].id}>{group.system ? <details class="activity-group"><summary>System setup · {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}<time title={new Date(group.entries[0].at).toLocaleString()} dateTime={group.entries[0].at}>{relativeTime(group.entries[0].at, now)}</time></summary><ol>{group.entries.map(item => <li key={item.id}>{activity(item)}</li>)}</ol></details> : activity(group.entries[0])}</li>)}</ol> : <p class="empty-state">{allowed('audit.read') ? 'The next chapter starts with your first edit.' : 'Activity details are available to administrators.'}</p>}
      </section></div></>}
    {rebuild && <Dialog title="Rebuild snapshot?" close={() => { if (!busy) setRebuild(false); }}><p>Regenerate the public snapshot from published content. Draft edits stay unpublished. This action is recorded in the audit log.</p>{error && <p class="error-box" role="alert">{error}</p>}<div class="dialog-actions"><button class="button secondary" disabled={busy} onClick={() => setRebuild(false)}>Cancel</button><button class="button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await api('/rebuild', 'POST'); setRebuild(false); changed(); notify('Snapshot rebuilt'); } catch (e) { setError(message(e)); } finally { setBusy(false); } }}>{busy ? 'Rebuilding…' : 'Rebuild snapshot'}</button></div></Dialog>}
  </>;
}
