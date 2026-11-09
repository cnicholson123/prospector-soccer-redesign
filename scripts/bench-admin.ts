/** Local/preview benchmark. Credentials are read only from the environment. */
const base = process.argv[2] ?? process.env.ADMIN_BENCH_BASE_URL;
const username = process.env.ADMIN_BENCH_USERNAME, password = process.env.ADMIN_BENCH_PASSWORD;
if (!base || !username || !password) throw new Error('Set ADMIN_BENCH_BASE_URL, ADMIN_BENCH_USERNAME and ADMIN_BENCH_PASSWORD (or pass the base URL as the first argument)');
const url = new URL(base);
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) base URL without embedded credentials');
const iterations = Number(process.env.ADMIN_BENCH_ITERATIONS ?? 20);
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 50) throw new Error('ADMIN_BENCH_ITERATIONS must be 1–50');
const login = await fetch(new URL('/api/admin/auth/login', url), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url.origin }, body: JSON.stringify({ username, password }), redirect: 'error' });
if (!login.ok) throw new Error(`Login failed (${login.status}); no credentials or response body logged`);
const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
if (!cookie) throw new Error('Login returned no session cookie');
await login.arrayBuffer();
const paths = ['/healthz', '/auth/me', '/counts', '/dashboard?section=activity', '/dashboard?section=health', '/dashboard', '/pending', '/docs/events'];
try {
  for (const path of paths) {
    const samples: number[] = []; let timing = '';
    for (let n = 0; n <= iterations; n++) {
      const start = performance.now();
      const response = await fetch(new URL('/api/admin' + path, url), { headers: { Cookie: cookie }, redirect: 'error' });
      await response.arrayBuffer();
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      if (n) samples.push(performance.now() - start); // First call warms the function/cache.
      timing = response.headers.get('server-timing') ?? 'unavailable';
    }
    samples.sort((a,b) => a-b);
    const percentile = (p: number) => samples[Math.max(0, Math.ceil(samples.length*p)-1)].toFixed(1);
    console.log(`${path.padEnd(30)} p50=${percentile(.5)} ms  p95=${percentile(.95)} ms  ${timing}`);
  }
} finally {
  // Revoke only this benchmark's session.
  const me = await fetch(new URL('/api/admin/auth/me', url), { headers: { Cookie: cookie } });
  if (me.ok) {
    const { csrfToken } = await me.json() as { csrfToken: string };
    await fetch(new URL('/api/admin/auth/logout', url), { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken, Origin: url.origin } });
  }
}
export {};
