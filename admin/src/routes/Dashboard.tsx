import { useEffect, useState } from 'preact/hooks';
import type { AuditEntry } from '../../../shared/types';
import { api, allowed, message, session } from '../api';
import { Icon } from '../components/Icon';
interface DashboardData { pendingCount: number; reviewCount: number; scheduled: unknown[]; health: { code: string; message: string; href: string }[]; recent: AuditEntry[] }
export function Dashboard({ publish, refresh }: { publish: () => void; refresh: number }) {
  const [data, setData] = useState<DashboardData>(), [error, setError] = useState('');
  useEffect(() => { api<DashboardData>('/dashboard').then(setData).catch(error => setError(message(error))); }, [refresh]);
  const hour = new Date().getHours(), greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return <><header class="page-heading"><div><span class="eyebrow">Your club, connected</span><h1>{greeting}, {session.value?.user.displayName}.</h1><p>Make the next great season happen.</p></div>{allowed('content.create') && <a class="button" href="/admin/events/new"><Icon name="plus" /> New event</a>}</header>
    {error && <p role="alert" class="error-box">{error}</p>}{!data ? <p role="status">Loading your dashboard…</p> : <>
      <div class="stats-grid"><button class="stat-card stat-primary" onClick={publish}><span>Pending changes</span><strong>{data.pendingCount}</strong><span>Review & publish <Icon name="arrow" /></span></button><div class="stat-card"><span>Scheduled</span><strong>{data.scheduled.length}</strong><small>Ready for the right moment</small></div><div class="stat-card"><span>Awaiting review</span><strong>{data.reviewCount}</strong><small>A second pair of eyes</small></div></div>
      <div class="dashboard-grid"><section class="card"><div class="section-heading"><div><span class="eyebrow">Keep things in good shape</span><h2>Site health</h2></div><span class="badge">{data.health.length} items</span></div>
        {data.health.length ? <ul class="health-list">{data.health.map((item, index) => <li key={index}><span class="health-dot" /><div><strong>{item.message}</strong>{item.href.startsWith('/admin/events/') || item.href.startsWith('/admin/profile') ? <a href={item.href}>Review item <span aria-hidden="true">→</span></a> : <small>Available with the upcoming content screens</small>}</div></li>)}</ul> : <p class="empty-state">Everything is looking good.</p>}
      </section><section class="card"><div class="section-heading"><div><span class="eyebrow">A shared effort</span><h2>Recent activity</h2></div><Icon name="history" /></div>
        {data.recent.length ? <ol class="activity-list">{data.recent.map(item => <li key={item.id}><span class="avatar">{item.actorName.slice(0, 1)}</span><div><strong>{item.actorName}</strong> <span>{item.action.replace(/^(content|auth|system)\./, '').replaceAll('_', ' ')}</span>{item.targetTitle && <p>{item.targetTitle}</p>}<time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time></div></li>)}</ol> : <p class="empty-state">{allowed('audit.read') ? 'The next chapter starts with your first edit.' : 'Activity details are available to administrators.'}</p>}
      </section></div></>}
  </>;
}
