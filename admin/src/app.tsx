import { useEffect, useRef, useState } from 'preact/hooks';
import { LocationProvider, Router, Route, useLocation } from 'preact-iso';
import { loadSession, session } from './api.js';
import { navigationGuard } from './state/autosave.js';
import { toast } from './state/toasts.js';
import { Shell } from './components/Shell.js';
import type { PublishMode } from './components/PublishButton.js';
import { PublishTray } from './components/PublishTray.js';
import { Dialog } from './components/ConfirmDialog.js';
import { Dashboard } from './routes/Dashboard.js';
import { CollectionList } from './routes/CollectionList.js';
import { DocEditor } from './routes/DocEditor.js';
import { Login } from './routes/Login.js';
import { collections, type CollectionName } from '../../shared/schema.js';
import { prefetchRoute } from './state/prefetch.js';
import { contentChanged } from './state/content.js';
import { PageEditor } from './routes/PageEditor.js';
import { Pages } from './routes/Pages.js';
import { History } from './routes/History.js';
import { Audit } from './routes/Audit.js';
import { Media } from './routes/Media.js';
import { Profile } from './routes/Profile.js';
function Workspace() {
  const { path, route } = useLocation();
  const acceptedUrl = useRef(location.pathname + location.search + location.hash);
  useEffect(() => { acceptedUrl.current = location.pathname + location.search + location.hash; }, [path]);
  const [loading, setLoading] = useState(true), [publish, setPublish] = useState<string[] | null>(null), [refresh, setRefresh] = useState(0), [leave, setLeave] = useState<string | null>(null);
  const [publishMode, setPublishMode] = useState<PublishMode>('publish');
  function openPublish(ids: string[] = [], mode: PublishMode = 'publish') { setPublishMode(mode); setPublish(ids); }
  useEffect(() => { prefetchRoute(location.href); void loadSession().finally(() => setLoading(false)); }, []);
  useEffect(() => {
    const prefetch = (event: Event) => { const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]'); if (link) prefetchRoute(link.href); };
    document.addEventListener('pointerover', prefetch); document.addEventListener('focusin', prefetch);
    return () => { document.removeEventListener('pointerover', prefetch); document.removeEventListener('focusin', prefetch); };
  }, []);
  useEffect(() => {
    if (loading) return;
    if (!session.value && path !== '/admin/login') route('/admin/login', true);
    if (session.value && path === '/admin/login') route('/admin', true);
    if (session.value?.user.mustChangePassword && path !== '/admin/profile') route('/admin/profile', true);
    const section = path.split('/')[2] as CollectionName;
    document.title = `${collections[section]?.labelPlural || (String(section) === 'pages' ? 'Pages' : String(section) === 'settings' ? 'Site settings' : String(section) === 'profile' ? 'Profile' : String(section) === 'history' ? 'History' : String(section) === 'audit' ? 'Audit log' : 'Dashboard')} · Prospector Admin`;
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
    const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); openPublish(); } };
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
  const revision = refresh + contentChanged.value;
  return <><Shell publish={() => openPublish()} refresh={revision}><Router>
    <Route component={Dashboard} path="/admin" publish={() => openPublish()} refresh={revision} />
    <Route component={Dashboard} path="/admin/" publish={() => openPublish()} refresh={revision} />
    <Route component={Pages} path="/admin/pages" refresh={revision} />
    <Route key={path} component={PageEditor} path="/admin/pages/:page" page={path.split('/').at(-1)!} publish={(mode?: PublishMode) => openPublish([], mode)} refresh={revision} />
    <Route component={DocEditor} path="/admin/store/settings" id="storeSettings" collection="storeSettings" publish={(mode?: PublishMode) => openPublish([], mode)} refresh={revision} />
    <Route component={DocEditor} path="/admin/settings" id="site" collection="site" publish={(mode?: PublishMode) => openPublish([], mode)} refresh={revision} />
    {Object.values(collections).filter(d => d.kind === 'collection' && !d.systemManaged).flatMap(d => [
      <Route key={d.name} component={CollectionList} path={`/admin/${d.name}`} collection={d.name} publish={(ids?: string[]) => openPublish(ids ?? [])} refresh={revision} />,
      <Route key={`${d.name}-${path}`} component={DocEditor} path={`/admin/${d.name}/:id`} collection={d.name} id={path.split('/').at(-1)!} publish={(mode?: PublishMode) => openPublish([], mode)} refresh={revision} />,
    ])}
    <Route component={Media} path="/admin/media" refresh={revision} />
    <Route component={Media} path="/admin/media/:id" id={path.split('/').at(-1)!} refresh={revision} />
    <Route component={History} path="/admin/history" refresh={revision} />
    <Route component={Audit} path="/admin/audit" />
    <Route component={Profile} path="/admin/profile" />
    <Route default component={() => <div class="card empty-state"><h1>Workspace not found.</h1><p>Choose a page or collection from the navigation.</p><a class="button" href="/admin/events">Go to events</a></div>} />
  </Router></Shell>
    {publish !== null && <PublishTray initialMode={publishMode} selectedIds={publish} close={() => setPublish(null)} published={() => setRefresh(value => value + 1)} />}
    {leave && <Dialog title="Leave with unsaved changes?" close={() => setLeave(null)}><p>Your changes are kept on this device for recovery. You can stay to finish saving or resolve a conflict.</p><div class="dialog-actions"><button class="button secondary" onClick={() => setLeave(null)}>Stay and edit</button><button class="button" onClick={() => { const destination = leave; setLeave(null); navigate(destination); }}>Leave editor</button></div></Dialog>}
    {toast.value && <div class="toast" role="status"><span>{toast.value.text}</span>{toast.value.undo && <button class="text-button" onClick={() => { const undo = toast.value?.undo; toast.value = null; void undo?.(); }}>Undo</button>}{toast.value.href && <a href={toast.value.href} target="_blank" rel="noreferrer">View live</a>}<button class="icon-button" aria-label="Dismiss notification" onClick={() => { toast.value = null; }}>×</button></div>}
  </>;
}
export function App() { return <LocationProvider scope="/admin"><Workspace /></LocationProvider>; }
