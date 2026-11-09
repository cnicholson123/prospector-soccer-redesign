import { useEffect, useState } from 'preact/hooks';
import type { Role } from '../../../shared/types.js';
import { api, allowed, message, session, setSession } from '../api.js';
import { Dialog } from '../components/ConfirmDialog.js';
import { notify } from '../state/toasts.js';
import { assignableRoles, canManageUser, type PublicUser } from '../state/users.js';

type Action = { user: PublicUser; kind: 'reset' | 'revoke' | 'deactivate' | 'reactivate' };
export function Users() {
  const [users, setUsers] = useState<PublicUser[]>([]), [loaded, setLoaded] = useState(false), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [status, setStatus] = useState('all'), [editing, setEditing] = useState<PublicUser | 'new' | null>(null);
  const [action, setAction] = useState<Action | null>(null), [secret, setSecret] = useState<{ username: string; password: string; signOut?: boolean } | null>(null);
  const [busy, setBusy] = useState(false), [dialogError, setDialogError] = useState('');
  const actor = session.value!.user;
  async function load() { try { setUsers((await api<{ users: PublicUser[] }>('/users')).users); setLoaded(true); setError(''); } catch (e) { setError(message(e)); } }
  useEffect(() => { if (allowed('users.manage')) void load(); }, []);
  if (!allowed('users.manage')) return <section class="card"><h1>Users</h1><p>Your role cannot manage accounts.</p></section>;
  const lastOwner = users.filter(u => u.active && u.role === 'Owner').length === 1;
  const visible = users.filter(u => `${u.displayName} ${u.username} ${u.role}`.toLowerCase().includes(query.toLowerCase()) && (status === 'all' || u.active === (status === 'active')));
  async function perform() {
    if (!action) return;
    setBusy(true); setDialogError('');
    try {
      const { user, kind } = action;
      if (kind === 'reset') {
        const result = await api<{ temporaryPassword: string }>(`/users/${user.id}/reset-password`, 'POST');
        setAction(null); setSecret({ username: user.username, password: result.temporaryPassword, signOut: user.id === actor.id });
      } else {
        if (kind === 'revoke') await api(`/users/${user.id}/revoke-sessions`, 'POST');
        else if (kind === 'deactivate') await api(`/users/${user.id}`, 'DELETE');
        else await api(`/users/${user.id}`, 'PATCH', { active: true });
        setAction(null); notify(kind === 'revoke' ? 'User signed out everywhere' : kind === 'deactivate' ? 'User deactivated' : 'User reactivated');
      }
      if (user.id === actor.id && kind !== 'reactivate' && kind !== 'reset') { setSession(null); return; }
      if (user.id !== actor.id || kind !== 'reset') await load();
    } catch (e) { setDialogError(message(e)); } finally { setBusy(false); }
  }
  return <><header class="page-heading"><div><span class="eyebrow">Your club team</span><h1>Users</h1><p>Give each person the access they need.</p></div><button class="button" onClick={() => { setDialogError(''); setEditing('new'); }}>Add user</button></header>
    <section class="card"><div class="account-filters"><div class="field"><label for="user-search">Search users</label><input id="user-search" type="search" value={query} onInput={e => setQuery(e.currentTarget.value)} placeholder="Name, username or role" /></div><div class="field"><label for="user-status">Status</label><select id="user-status" value={status} onChange={e => setStatus(e.currentTarget.value)}><option value="all">All users</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div></div>
    {error && <p role="alert" class="error-box">{error} <button class="text-button" onClick={() => void load()}>Retry</button></p>}
    {!loaded ? <p role="status">Loading users…</p> : !visible.length ? <p class="empty-state">No users match these filters.</p> : <ul class="account-list">{visible.map(user => {
      const manage = canManageUser(actor, user), protectedOwner = user.active && user.role === 'Owner' && lastOwner;
      return <li key={user.id} class="account-row"><div class="account-identity"><span class="avatar" aria-hidden="true">{user.displayName.slice(0, 1)}</span><div><h2>{user.displayName} {user.id === actor.id && <small>(you)</small>}</h2><p>@{user.username}</p></div></div><div class="account-meta"><span class="badge">{user.role}</span><span class={`badge ${user.active ? 'status-published' : ''}`}>{user.active ? 'Active' : 'Inactive'}</span><p>Last sign-in: {user.lastLoginAt ? <time dateTime={user.lastLoginAt}>{new Date(user.lastLoginAt).toLocaleString()}</time> : 'Never'}</p></div><div class="account-actions">{manage ? <><button class="text-button" onClick={() => { setDialogError(''); setEditing(user); }}>Edit user</button>{(['reset', 'revoke', user.active ? 'deactivate' : 'reactivate'] as const).map(kind => <button class="text-button" disabled={kind === 'deactivate' && protectedOwner} onClick={() => { setDialogError(''); setAction({ user, kind }); }}>{kind === 'reset' ? 'Reset password' : kind === 'revoke' ? 'Sign out everywhere' : kind === 'deactivate' ? 'Deactivate' : 'Reactivate'}</button>)}{protectedOwner && <small>Keep at least one active Owner.</small>}</> : <small>Only an Owner can manage this account.</small>}</div></li>;
    })}</ul>}</section>
    {editing && <UserForm user={editing} busy={busy} error={dialogError} close={() => { if (!busy) setEditing(null); }} save={async input => {
      setBusy(true); setDialogError('');
      try {
        const result = await api<{ user: PublicUser; temporaryPassword?: string }>(editing === 'new' ? '/users' : `/users/${editing.id}`, editing === 'new' ? 'POST' : 'PATCH', input);
        setEditing(null); if (result.temporaryPassword) setSecret({ username: result.user.username, password: result.temporaryPassword }); else notify('User updated');
        if (editing !== 'new' && editing.id === actor.id) setSession({ ...session.value!, user: result.user });
        await load();
      } catch (e) { setDialogError(message(e)); } finally { setBusy(false); }
    }} />}
    {action && <Dialog title={`${action.kind === 'reset' ? 'Reset password' : action.kind === 'revoke' ? 'Sign out everywhere' : action.kind === 'deactivate' ? 'Deactivate user' : 'Reactivate user'}?`} close={() => { if (!busy) setAction(null); }}><p>{action.user.displayName} (@{action.user.username})</p><p>{action.kind === 'reset' ? 'A new temporary password will be shown once. Existing sessions will be signed out. Password changes remain optional.' : action.kind === 'revoke' ? 'All active sessions for this user will be signed out.' : action.kind === 'deactivate' ? 'This user will lose access and their sessions will be signed out. You can reactivate them later.' : 'This user can sign in again with their existing password.'}</p>{dialogError && <p role="alert" class="error-box">{dialogError}</p>}<div class="dialog-actions"><button class="button secondary" disabled={busy} onClick={() => setAction(null)}>Cancel</button><button class="button" disabled={busy} onClick={() => void perform()}>{busy ? 'Working…' : 'Confirm'}</button></div></Dialog>}
    {secret && <Dialog title="Temporary password" dismissible={false} close={() => {}}><p>Copy this password for <strong>@{secret.username}</strong> and share it securely. It will not be shown again after you close this window.</p><label for="temporary-password">Temporary password for {secret.username}</label><input id="temporary-password" class="temporary-password" value={secret.password} readOnly autoComplete="off" spellcheck={false} /><p class="muted">Changing this password is optional.</p><div class="dialog-actions"><button class="button secondary" onClick={() => { void navigator.clipboard.writeText(secret.password).then(() => notify('Password copied')).catch(() => notify('Select the password and copy it manually')); }}>Copy password</button><button class="button" onClick={() => { setSecret(null); if (secret.signOut) setSession(null); }}>I have saved the password</button></div></Dialog>}
  </>;
}
function UserForm({ user, save, close, busy, error }: { user: PublicUser | 'new'; save: (value: { displayName: string; username: string; email: string; role?: Role }) => Promise<void>; close: () => void; busy: boolean; error: string }) {
  const actor = session.value!.user, isNew = user === 'new', self = !isNew && user.id === actor.id;
  const [name, setName] = useState(isNew ? '' : user.displayName), [username, setUsername] = useState(isNew ? '' : user.username), [email, setEmail] = useState(isNew ? '' : user.email ?? ''), [role, setRole] = useState<Role>(isNew ? 'Contributor' : user.role);
  return <Dialog title={isNew ? 'Add user' : 'Edit user'} close={close}><form onSubmit={e => { e.preventDefault(); void save({ displayName: name, username, email, ...(!self ? { role } : {}) }); }}><div class="field"><label for="user-name">Display name</label><input id="user-name" required maxLength={100} value={name} onInput={e => setName(e.currentTarget.value)} /></div><div class="field"><label for="user-username">Username</label><input id="user-username" required maxLength={64} autoComplete="off" value={username} onInput={e => setUsername(e.currentTarget.value)} /></div><div class="field"><label for="user-email">Email (optional)</label><input id="user-email" type="email" value={email} onInput={e => setEmail(e.currentTarget.value)} /></div><div class="field"><label for="user-role">Role</label><select id="user-role" value={role} disabled={self} onChange={e => setRole(e.currentTarget.value as Role)}>{assignableRoles(actor).map(role => <option value={role}>{role}</option>)}</select><small>{self ? 'You cannot change your own role.' : actor.role === 'Admin' ? 'Admins can manage Viewers, Contributors and Editors.' : 'Owners can manage every role.'}</small></div>{error && <p role="alert" class="error-box">{error}</p>}<div class="dialog-actions"><button class="button secondary" type="button" disabled={busy} onClick={close}>Cancel</button><button class="button" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create user' : 'Save user'}</button></div></form></Dialog>;
}
