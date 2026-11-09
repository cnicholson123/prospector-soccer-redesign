import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { useLocation } from 'preact-iso';
import { api, message, session, setSession, publicOrigin } from '../api';
import { navigationGuard } from '../state/autosave';
import { Icon } from './Icon';
import { notify } from '../state/toasts';
export function Shell({ children, publish }: { children: ComponentChildren; publish: () => void }) {
  const { path, route } = useLocation();
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('psc_password_banner') === session.value?.user.id);
  const [busy, setBusy] = useState(false);
  async function logout() {
    if (navigationGuard.value && !await navigationGuard.value()) { notify('Save or resolve your draft before signing out'); return; }
    setBusy(true);
    try { await api('/auth/logout', 'POST'); setSession(null); sessionStorage.removeItem('psc_password_banner'); route('/admin/login', true); }
    catch (error) { notify(message(error)); } finally { setBusy(false); }
  }
  const links = [{ href: '/admin', label: 'Dashboard', icon: 'dashboard' }, { href: '/admin/events', label: 'Events', icon: 'calendar' }, { href: '/admin/profile', label: 'Profile', icon: 'user' }];
  const navigation = links.map(link => <a href={link.href} aria-current={(link.href === '/admin' ? path === '/admin' || path === '/admin/' : path.startsWith(link.href)) ? 'page' : undefined}><Icon name={link.icon} /><span>{link.label}</span></a>);
  return <div class="admin-shell"><a class="skip-link" href="#main-content">Skip to content</a><aside class="sidebar"><a class="brand" href="/admin"><img src="/assets/img/crest-sm.png" width="42" height="52" alt="" /><span>Prospector<small>Club administration</small></span></a><p class="nav-label">Your workspace</p><nav aria-label="Main navigation">{navigation}</nav><div class="sidebar-bottom"><p>For our players.<br />For our community.</p><a href={publicOrigin + '/'} target="_blank" rel="noreferrer">View club website <Icon name="external" size={16} /></a></div></aside>
    <div class="workspace"><header class="topbar"><span class="workspace-title">Prospector Soccer Club <span>/ Admin</span></span><div class="topbar-actions"><button class="text-button publish-shortcut" onClick={publish}>Review changes</button><a class="profile-link" href="/admin/profile" aria-label="Your profile"><span class="avatar">{session.value?.user.displayName.slice(0, 1)}</span><span>{session.value?.user.displayName}</span></a><button class="text-button" disabled={busy} onClick={() => void logout()}>Sign out</button></div></header>
      {session.value?.passwordWeak && !dismissed && <section class="password-banner" aria-label="Password security"><Icon name="shield" /><div><strong>A stronger password helps protect your club.</strong><p>You can keep working and update it whenever you choose.</p></div><a href="/admin/profile#password">Change password</a><button class="icon-button" aria-label="Dismiss password reminder for this session" onClick={() => { sessionStorage.setItem('psc_password_banner', session.value!.user.id); setDismissed(true); }}><Icon name="close" /></button></section>}
      <main id="main-content" class="main-content" tabIndex={-1}>{children}</main>
    </div><nav class="mobile-tabs" aria-label="Mobile navigation">{navigation}</nav>
  </div>;
}
