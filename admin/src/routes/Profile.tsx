import { useState } from 'preact/hooks';
import { api, session, setSession, message, type Session } from '../api';
import { notify } from '../state/toasts';
export function Profile() {
  const [current, setCurrent] = useState(''), [next, setNext] = useState(''), [confirm, setConfirm] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function change(event: SubmitEvent) {
    event.preventDefault(); setError('');
    if (next !== confirm) { setError('The new passwords do not match.'); return; }
    setBusy(true);
    try { const result = await api<Omit<Session, 'permissions'>>('/auth/password', 'POST', { current, next }); setSession({ ...result, permissions: session.value!.permissions }); setCurrent(''); setNext(''); setConfirm(''); notify('Password updated'); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <><header class="page-heading"><div><span class="eyebrow">Your account</span><h1>Profile</h1><p>{session.value?.user.displayName} · {session.value?.user.role}</p></div></header><section class="card profile-card" id="password"><h2>Change password</h2><p>You can change your password whenever you choose.</p><form onSubmit={event => void change(event)}>{[['current', 'Current password', current, setCurrent], ['next', 'New password', next, setNext], ['confirm', 'Confirm new password', confirm, setConfirm]].map(([id, label, value, setter]) => <div class="field"><label for={String(id)}>{label}</label><input id={String(id)} type="password" autoComplete={id === 'current' ? 'current-password' : 'new-password'} required minLength={id === 'current' ? 1 : 10} maxLength={1024} value={String(value)} onInput={event => (setter as (value: string) => void)(event.currentTarget.value)} /></div>)}<p class="muted">Use at least 10 characters. Avoid your username and common passwords.</p>{error && <p role="alert" class="error-box">{error}</p>}<button class="button" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button></form></section></>;
}
