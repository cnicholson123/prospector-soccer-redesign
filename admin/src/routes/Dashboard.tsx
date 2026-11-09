import { useEffect, useState } from 'preact/hooks';
import type { AuditEntry } from '../../../shared/types';
import { api, allowed, message, session } from '../api';
import { activityText, groupActivity, relativeTime } from '../state/activity';
import { Icon } from '../components/Icon';
interface DashboardData { pendingCount: number; reviewCount: number; scheduled: unknown[]; health: { code: string; message: string; href: string }[]; recent: AuditEntry[] }
export function Dashboard({ publish, refresh }: { publish: () => void; refresh: number }) {
  const [data, setData] = useState<DashboardData>(), [error, setError] = useState('');
  useEffect(() => { api<DashboardData>('/dashboard').then(setData).catch(error => setError(message(error))); }, [refresh]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const activity = (item: AuditEntry) => <><span class="avatar">{item.actorName.slice(0, 1)}</span><div><strong>{activityText(item)}</strong>{item.targetTitle && <p>{item.targetTitle}</p>}<time dateTime={item.at} title={new Date(item.at).toLocaleString()}>{relativeTime(item.at, now)}</time></div></>;
  const hour = new Date().getHours(), greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return <><header class="page-heading"><div><span class="eyebrow">Your club, connected</span><h1>{greeting}, {session.value?.user.displayName}.</h1><p>Make the next great season happen.</p></div>{allowed('content.create') && <a class="button" href="/admin/events/new"><Icon name="plus" /> New event</a>}</header>
    {error && <p role="alert" class="error-box">{error}</p>}{!data ? <p role="status">Loading your dashboard…</p> : <>
      <div class="stats-grid"><button class="stat-card stat-primary" onClick={publish}><span>Pending changes</span><strong>{data.pendingCount}</strong><span>Review & publish <Icon name="arrow" /></span></button><div class="stat-card"><span>Scheduled</span><strong>{data.scheduled.length}</strong><small>Ready for the right moment</small></div><div class="stat-card"><span>Awaiting review</span><strong>{data.reviewCount}</strong><small>A second pair of eyes</small></div></div>
      <div class="dashboard-grid"><section class="card"><div class="section-heading"><div><span class="eyebrow">Keep things in good shape</span><h2>Site health</h2></div><span class="badge">{data.health.length} items</span></div>
        {data.health.length ? <ul class="health-list">{data.health.map((item, index) => <li key={index}><span class="health-dot" /><div><strong>{item.message}</strong>{!item.href.startsWith('/admin/media') && item.href !== '/admin/history' ? <a href={item.href}>Review item <span aria-hidden="true">→</span></a> : <small>Available in the media or history phase</small>}</div></li>)}</ul> : <p class="empty-state">Everything is looking good.</p>}
      </section><section class="card"><div class="section-heading"><div><span class="eyebrow">A shared effort</span><h2>Recent activity</h2></div><Icon name="history" /></div>
        {data.recent.length ? <ol class="activity-list">{groupActivity(data.recent).map(group => <li key={group.entries[0].id}>{group.system ? <details class="activity-group"><summary>System setup · {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}<time title={new Date(group.entries[0].at).toLocaleString()} dateTime={group.entries[0].at}>{relativeTime(group.entries[0].at, now)}</time></summary><ol>{group.entries.map(item => <li key={item.id}>{activity(item)}</li>)}</ol></details> : activity(group.entries[0])}</li>)}</ol> : <p class="empty-state">{allowed('audit.read') ? 'The next chapter starts with your first edit.' : 'Activity details are available to administrators.'}</p>}
      </section></div></>}
  </>;
}
