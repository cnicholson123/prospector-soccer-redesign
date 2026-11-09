import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { useLocation } from 'preact-iso';
import { api, allowed, message, session, setSession, publicOrigin } from '../api.js';
import { navigationGuard } from '../state/autosave.js';
import { Dialog } from './ConfirmDialog.js';
import { Icon } from './Icon.js';
import { notify } from '../state/toasts.js';
export function Shell({ children, publish, refresh, palette, help, restricted = false }: { children: ComponentChildren; publish: () => void; refresh: number; palette?: () => void; help?: () => void; restricted?: boolean }) {
  const { path, route } = useLocation();
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('psc_password_banner') === session.value?.user.id);
  const [busy, setBusy] = useState(false);
  async function logout() {
    if (navigationGuard.value && !await navigationGuard.value()) { notify('Save or resolve your draft before signing out'); return; }
    setBusy(true);
    try { await api('/auth/logout', 'POST'); setSession(null); sessionStorage.removeItem('psc_password_banner'); route('/admin/login', true); }
    catch (error) { notify(message(error)); } finally { setBusy(false); }
  }
  const [menu, setMenu] = useState(false), [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => { if (restricted) return; api<{ counts: Record<string, number> }>('/counts').then(data => setCounts(data.counts)).catch(() => {}); }, [refresh, restricted]);
  useEffect(() => { setMenu(false); }, [path]);
  const groups = [
    { label: 'Content', links: [['Pages', '/admin/pages', 'book', 'pages'], ['Home page', '/admin/pages/home', 'book', 'home'], ['Events', '/admin/events', 'calendar', 'events'], ['Callouts & announcements', '/admin/callouts', 'calendar', 'callouts']] },
    { label: 'Club', links: [['Programs & fees', '/admin/pages#programs', 'book', ''], ['Teams & coaches', '/admin/teams', 'user', 'teams'], ['Results', '/admin/results', 'flag', 'results'], ['Board members', '/admin/boardMembers', 'user', 'boardMembers'], ['Sponsors', '/admin/sponsors', 'flag', 'sponsors'], ['Sponsor tiers', '/admin/sponsorTiers', 'flag', 'sponsorTiers']] },
    { label: 'Store', links: [['Products', '/admin/products', 'book', 'products'], ['Bundles', '/admin/bundles', 'book', 'bundles'], ['Categories', '/admin/categories', 'book', 'categories'], ['Store settings', '/admin/store/settings', 'shield', 'storeSettings']] },
    { label: 'Library', links: [['Media', '/admin/media', 'book', 'media'], ['Documents', '/admin/documents', 'book', 'documents'], ['FAQs', '/admin/faqs', 'book', 'faqs']] },
    { label: 'Settings', links: [['Site settings', '/admin/settings', 'shield', 'site'], ['History', '/admin/history', 'book', ''], ...(allowed('audit.read') ? [['Audit log', '/admin/audit', 'shield', '']] : []), ...(allowed('users.manage') ? [['Users', '/admin/users', 'user', '']] : []), ['Profile', '/admin/profile', 'user', '']] },
  ];
  const link = ([label, href, icon, count]: string[]) => <a href={href} aria-current={path === href || (!href.includes('#') && href !== '/admin' && path.startsWith(href + '/')) ? 'page' : undefined}><Icon name={icon} /><span>{label}</span>{counts[count] !== undefined && <small class="nav-count" aria-hidden="true">{counts[count]}</small>}</a>;
  const navigation = restricted ? link(['Profile', '/admin/profile', 'user', '']) : <>{link(['Dashboard', '/admin', 'dashboard', ''])}{groups.map(group => <section key={group.label}><h2 class="nav-label">{group.label}</h2>{group.links.map(link)}</section>)}</>;
  return <div class="admin-shell"><a class="skip-link" href="#main-content">Skip to content</a><aside class="sidebar"><a class="brand" href="/admin"><img src="/assets/img/crest-sm.png" width="42" height="52" alt="" /><span>Prospector<small>Club administration</small></span></a><nav aria-label="Main navigation">{navigation}</nav><div class="sidebar-bottom"><p>For our players.<br />For our community.</p><a href={publicOrigin + '/'} target="_blank" rel="noreferrer">View club website <Icon name="external" size={16} /></a></div></aside>
    <div class="workspace"><header class="topbar"><span class="workspace-title">Prospector Soccer Club <span>/ Admin</span></span><div class="topbar-actions">{!restricted && <><button class="text-button palette-trigger" aria-label="Open command palette" onClick={palette}>Search <kbd>⌘K / Ctrl K</kbd></button><button class="icon-button" aria-label="Keyboard shortcuts" onClick={help}>?</button><button class="text-button publish-shortcut" onClick={publish}>Review changes</button></>}<a class="profile-link" href="/admin/profile" aria-label="Your profile"><span class="avatar">{session.value?.user.displayName.slice(0, 1)}</span><span>{session.value?.user.displayName}</span></a><button class="text-button" disabled={busy} onClick={() => void logout()}>Sign out</button></div></header>
      {!restricted && session.value?.passwordWeak && !dismissed && <section class="password-banner" aria-label="Password security"><Icon name="shield" /><div><strong>A stronger password helps protect your club.</strong><p>You can keep working and update it whenever you choose.</p></div><a href="/admin/profile#password">Change password</a><button class="icon-button" aria-label="Dismiss password reminder for this session" onClick={() => { sessionStorage.setItem('psc_password_banner', session.value!.user.id); setDismissed(true); }}><Icon name="close" /></button></section>}
      {restricted && <section class="password-banner" aria-label="Password change required"><Icon name="shield" /><div><strong>Choose your own password to continue.</strong><p>Your administrator issued a temporary password. Update it below before opening the workspace.</p></div></section>}<main id="main-content" class="main-content" tabIndex={-1}>{children}</main>
    </div>{!restricted && <nav class="mobile-tabs" aria-label="Mobile navigation"><a href="/admin" aria-current={path === '/admin' ? 'page' : undefined}><Icon name="dashboard" />Dashboard</a><a href="/admin/events" aria-current={path.startsWith('/admin/events') ? 'page' : undefined}><Icon name="calendar" />Events</a><button onClick={() => setMenu(true)} aria-expanded={menu}><Icon name="book" />Content</button><a href="/admin/media" aria-current={path.startsWith('/admin/media') ? 'page' : undefined}><Icon name="book" />Media</a></nav>}{menu && <Dialog title="Club workspace" close={() => setMenu(false)}><nav class="mobile-menu" aria-label="All content">{navigation}</nav></Dialog>}
  </div>;
}
