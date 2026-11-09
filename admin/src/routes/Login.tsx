import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { api, ApiError, setSession, type Session, message } from '../api';
import { Icon } from '../components/Icon';
export function Login() {
  const { route } = useLocation();
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [until, setUntil] = useState(0), [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  async function login(event: SubmitEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api<Session>('/auth/login', 'POST', { username, password });
      setPassword(''); setSession(result); sessionStorage.removeItem('psc_password_banner');
      route(result.user.mustChangePassword ? '/admin/profile' : '/admin', true);
    } catch (error) {
      setError(message(error));
      if (error instanceof ApiError && error.retryAfter) setUntil(Date.now() + error.retryAfter * 1000);
    } finally { setBusy(false); }
  }
  const locked = until > now;
  return <main class="login-page"><a href="/" class="login-back"><span aria-hidden="true">←</span> Back to site</a><div class="login-wrap">
    <a class="brand login-brand" href="/"><img src="/assets/img/crest-sm.png" alt="Prospector Soccer Club crest" width="56" height="68" /><span>Prospector<small>Soccer Club · Admin</small></span></a>
    <section class="login-card" aria-labelledby="login-title"><span class="eyebrow">Behind every great season</span><h1 id="login-title">Welcome back.</h1><p>A little work here. A big difference out there.</p>
      <form onSubmit={event => void login(event)}>
        <div class="field"><label for="username">Username</label><input id="username" name="username" autoComplete="username" required value={username} onInput={event => setUsername(event.currentTarget.value)} autoCapitalize="none" spellcheck={false} /></div>
        <div class="field"><label for="password">Password</label><div class="password-input"><input id="password" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onInput={event => setPassword(event.currentTarget.value)} onKeyUp={event => setCaps(event.getModifierState('CapsLock'))} onKeyDown={event => setCaps(event.getModifierState('CapsLock'))} /><button type="button" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow(!show)}><Icon name="eye" /></button></div>{caps && <small>Caps Lock is on.</small>}</div>
        {error && <p class="error-box" role="alert">{error}</p>}{locked && <p role="status">Try again in {Math.ceil((until - now) / 1000)} seconds.</p>}
        <button class="button login-submit" disabled={busy || locked}>{busy ? 'Signing in…' : 'Sign in'}<Icon name="arrow" /></button>
      </form><p class="login-help"><Icon name="shield" size={16} /> For the people who keep our club moving.</p>
    </section><p class="login-footer">One club. Many hands. Every player matters.</p>
  </div></main>;
}
