import { useEffect, useRef, useState } from 'preact/hooks';
import { LocationProvider, Router, Route, useLocation } from 'preact-iso';
import { api, session, setSession, type Session } from './api';
import { navigationGuard } from './state/autosave';
import { toast } from './state/toasts';
import { Shell } from './components/Shell';
import { PublishTray } from './components/PublishTray';
import { Dialog } from './components/ConfirmDialog';
import { Dashboard } from './routes/Dashboard';
import { CollectionList } from './routes/CollectionList';
import { DocEditor } from './routes/DocEditor';
import { Login } from './routes/Login';
import { Profile } from './routes/Profile';
function Workspace() {
  const { path, route } = useLocation();
  const acceptedUrl = useRef(location.pathname + location.search + location.hash);
  useEffect(() => { acceptedUrl.current = location.pathname + location.search + location.hash; }, [path]);
  const [loading, setLoading] = useState(true), [publish, setPublish] = useState(false), [refresh, setRefresh] = useState(0), [leave, setLeave] = useState<string | null>(null);
  useEffect(() => { api<Session>('/auth/me').then(setSession).catch(() => setSession(null)).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (loading) return;
    if (!session.value && path !== '/admin/login') route('/admin/login', true);
    if (session.value && path === '/admin/login') route('/admin', true);
    if (session.value?.user.mustChangePassword && path !== '/admin/profile') route('/admin/profile', true);
    document.title = `${path.includes('events') ? 'Events' : path.includes('profile') ? 'Profile' : path.includes('login') ? 'Sign in' : 'Dashboard'} · Prospector Admin`;
  }, [loading, !!session.value, path]);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
      if (!link || link.target || link.download || link.getAttribute('href')?.startsWith('#') || !navigationGuard.value) return;
      const url = new URL(link.href);
      if (url.href === location.href) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const destination = url.origin === location.origin && url.pathname.startsWith('/admin') ? url.pathname + url.search + url.hash : url.href;
      void navigationGuard.value().then(ok => { if (ok) navigate(destination); else setLeave(destination); });
    };
    const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); setPublish(true); } };
    const pop = (event: PopStateEvent) => {
      if (!navigationGuard.value) return;
      const destination = location.pathname + location.search + location.hash;
      event.stopImmediatePropagation();
      history.replaceState(history.state, '', acceptedUrl.current);
      void navigationGuard.value().then(ok => { if (ok) route(destination, true); else setLeave(destination); });
    };
    window.addEventListener('popstate', pop, true);
    document.addEventListener('click', click, true); document.addEventListener('keydown', key);
    return () => { window.removeEventListener('popstate', pop, true); document.removeEventListener('click', click, true); document.removeEventListener('keydown', key); };
  }, []);
  function navigate(destination: string) { destination.startsWith('/admin') ? route(destination) : location.assign(destination); }
  if (loading) return <main class="initial-loading" role="status">Opening the clubhouse…</main>;
  if (!session.value) return <Login />;
  return <><Shell publish={() => setPublish(true)}><Router>
    <Route component={Dashboard} path="/admin" publish={() => setPublish(true)} refresh={refresh} />
    <Route component={Dashboard} path="/admin/" publish={() => setPublish(true)} refresh={refresh} />
    <Route component={CollectionList} path="/admin/events" refresh={refresh} />
    <Route key={path} component={DocEditor} path="/admin/events/:id" id={path.split('/').at(-1)!} publish={() => setPublish(true)} refresh={refresh} />
    <Route component={Profile} path="/admin/profile" />
    <Route default component={() => <div class="card empty-state"><h1>This workspace is coming next.</h1><p>Events are ready to edit and publish.</p><a class="button" href="/admin/events">Go to events</a></div>} />
  </Router></Shell>
    {publish && <PublishTray close={() => setPublish(false)} published={() => setRefresh(value => value + 1)} />}
    {leave && <Dialog title="Leave with unsaved changes?" close={() => setLeave(null)}><p>Your changes are kept on this device for recovery. You can stay to finish saving or resolve a conflict.</p><div class="dialog-actions"><button class="button secondary" onClick={() => setLeave(null)}>Stay and edit</button><button class="button" onClick={() => { const destination = leave; setLeave(null); navigate(destination); }}>Leave editor</button></div></Dialog>}
    {toast.value && <div class="toast" role="status"><span>{toast.value.text}</span>{toast.value.href && <a href={toast.value.href} target="_blank" rel="noreferrer">View live</a>}<button class="icon-button" aria-label="Dismiss notification" onClick={() => { toast.value = null; }}>×</button></div>}
  </>;
}
export function App() { return <LocationProvider scope="/admin"><Workspace /></LocationProvider>; }
