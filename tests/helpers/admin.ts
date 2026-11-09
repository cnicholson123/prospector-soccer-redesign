import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../../server/config';
import { KvStore } from '../../server/store/kv-store';
import { FsPrimitives } from '../../server/store/primitives/fs';
import { createAdminApp } from '../../server/http/hono-app';
import { seedStore } from '../../scripts/seed';
export async function adminFixture(seed = false) {
  await mkdir('.cache', { recursive: true });
  const root = await mkdtemp(resolve('.cache/psc-admin-'));
  const config = loadConfig({ DATA_DIR: root, SESSION_SECRET: 'x'.repeat(32), CRON_SECRET: 'test-cron' }, () => undefined);
  let time = new Date('2030-01-01T12:00:00Z');
  const primitives = new FsPrimitives(root);
  const store = new KvStore(primitives, { exclusive: primitives.exclusive, now: () => time });
  if (seed) await seedStore(store);
  const app = createAdminApp(() => store, { config, now: () => time });
  let cookie = '', csrf = '';
  async function req(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
    return app.request('/api/admin' + path, { method, headers: { Cookie: cookie, 'X-CSRF-Token': csrf, Origin: config.publicBaseUrl, 'Content-Type': 'application/json', 'X-Forwarded-For': '192.0.2.40', 'User-Agent': 'Admin test', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function login(username = 'Phil', password = 'Phil') {
    const response = await req('/auth/login', 'POST', { username, password });
    const data = await response.json();
    if (response.status === 200) { cookie = response.headers.get('set-cookie')!.split(';')[0]; csrf = data.csrfToken; }
    return { response, data };
  }
  return { root, config, store, app, req, login, clock: (value: string) => { time = new Date(value); }, getCookie: () => cookie };
}
