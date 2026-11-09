import { useEffect, useState } from 'preact/hooks';
import type { Session as StoredSession } from '../../../shared/types.js';
import { api, session, setSession, message, type Session } from '../api.js';
import { notify } from '../state/toasts.js';
import { passwordStrength } from '../state/users.js';
import { Dialog } from '../components/ConfirmDialog.js';
type ActiveSession = Omit<StoredSession, 'csrfToken'> & { current: boolean };
export function Profile() {
  const [current, setCurrent] = useState(''), [next, setNext] = useState(''), [confirm, setConfirm] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null), [sessionError, setSessionError] = useState(''), [revoke, setRevoke] = useState<ActiveSession | 'others' | null>(null);
  const [displayName, setDisplayName] = useState(session.value!.user.displayName), [email, setEmail] = useState(session.value!.user.email ?? ''), [profileError, setProfileError] = useState('');
  const strength = passwordStrength(next, session.value!.user.username);
  async function load() { try { setSessions((await api<{ sessions: ActiveSession[] }>('/auth/sessions')).sessions); setSessionError(''); } catch (e) { setSessionError(message(e)); } }
  useEffect(() => { void load(); }, []);
  async function change(event: SubmitEvent) {
    event.preventDefault(); setError('');
    if (next !== confirm) { setError('The new passwords do not match.'); return; }
    setBusy(true);
    try { const result = await api<Omit<Session, 'permissions'>>('/auth/password', 'POST', { current, next }); setSession({ ...result, permissions: session.value!.permissions }); setCurrent(''); setNext(''); setConfirm(''); notify('Password updated'); await load(); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <><header class="page-heading"><div><span class="eyebrow">Your account</span><h1>Profile</h1><p>{session.value?.user.displayName} · {session.value?.user.role} · @{session.value?.user.username}</p></div></header><div class="profile-grid"><section class="card profile-card" id="password"><h2>Change password</h2><p>{session.value?.user.mustChangePassword ? 'Change your temporary password to continue into the workspace.' : 'Password changes are optional. You can keep working with your current password.'}</p><form onSubmit={event => void change(event)}>{[['current', 'Current password', current, setCurrent], ['next', 'New password', next, setNext], ['confirm', 'Confirm new password', confirm, setConfirm]].map(([id, label, value, setter]) => <div class="field"><label for={String(id)}>{label}</label><input role="textbox" id={String(id)} type="password" autoComplete={id === 'current' ? 'current-password' : 'new-password'} aria-describedby={id === 'next' ? 'password-policy password-strength' : undefined} required minLength={id === 'current' ? 1 : 10} maxLength={1024} value={String(value)} onInput={event => (setter as (value: string) => void)(event.currentTarget.value)} /></div>)}<div id="password-strength" class="password-strength"><meter min={0} max={4} value={strength.score} aria-label="Password strength" /><span aria-live="polite">{strength.label}</span></div><p id="password-policy" class="muted">Use at least 10 characters. Avoid your username and common passwords. A longer, unique passphrase is stronger; this meter is only a guide.</p>{error && <p role="alert" class="error-box">{error}</p>}<button class="button" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button></form></section>
    <section class="card profile-card"><h2>Account details</h2><form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setProfileError('');
      try { const result = await api<{ user: Session['user'] }>('/auth/profile', 'PATCH', { displayName, email }); setSession({ ...session.value!, user: result.user }); notify('Profile updated'); }
      catch (e) { setProfileError(message(e)); } finally { setBusy(false); }
    }}><div class="field"><label for="profile-name">Display name</label><input id="profile-name" required maxLength={100} value={displayName} onInput={event => setDisplayName(event.currentTarget.value)} /></div><div class="field"><label for="profile-email">Email (optional)</label><input id="profile-email" type="email" value={email} onInput={event => setEmail(event.currentTarget.value)} /></div>{profileError && <p role="alert" class="error-box">{profileError}</p>}<button class="button" disabled={busy}>Save profile</button></form></section>
    <section class="card"><div class="section-heading"><h2>Active sessions</h2><button class="text-button" disabled={busy || !sessions?.some(s => !s.current)} onClick={() => setRevoke('others')}>Sign out other sessions</button></div><p class="muted">Devices signed in to your account. Last activity updates at most every 15 minutes.</p>{sessionError && <p role="alert" class="error-box">{sessionError} <button class="text-button" onClick={() => void load()}>Retry</button></p>}{sessions === null ? <p role="status">Loading sessions…</p> : <ul class="session-list">{sessions.map(s => <li key={s.hash}><div><strong>{s.current ? 'This session' : 'Other session'}</strong><p class="session-agent">{s.userAgent || 'Unknown browser'}</p><p class="muted">{s.ip || 'Unknown address'}<br />Signed in {new Date(s.createdAt).toLocaleString()}<br />Last active {new Date(s.lastSeenAt).toLocaleString()}</p></div><button class="text-button" disabled={busy} onClick={() => setRevoke(s)}>{s.current ? 'Sign out this session' : 'Revoke session'}</button></li>)}</ul>}</section></div>
    {revoke && <Dialog title="Sign out sessions?" close={() => { if (!busy) setRevoke(null); }}><p>{revoke === 'others' ? 'Your current session will stay signed in.' : revoke.current ? 'You will return to the sign-in screen.' : 'This device will need to sign in again.'}</p>{sessionError && <p role="alert" class="error-box">{sessionError}</p>}<div class="dialog-actions"><button class="button secondary" disabled={busy} onClick={() => setRevoke(null)}>Cancel</button><button class="button" disabled={busy} onClick={async () => {
      setBusy(true); setSessionError('');
      try { if (revoke === 'others') await api('/auth/sessions/revoke-others', 'POST'); else await api(`/auth/sessions/${revoke.hash}`, 'DELETE'); if (revoke !== 'others' && revoke.current) setSession(null); else { setRevoke(null); await load(); notify('Sessions updated'); } } catch (e) { setSessionError(message(e)); } finally { setBusy(false); }
    }}>{busy ? 'Signing out…' : 'Sign out'}</button></div></Dialog>}
  </>;
}
