import { test as base, expect, type BrowserContext } from '@playwright/test';
import { resolve, sep } from 'node:path';
import { KvStore } from '../../server/store/kv-store';
import { FsPrimitives } from '../../server/store/primitives/fs';

// All browser contexts share the local server's socket peer. Give each test
// its own login budget without relaxing the application's production limits.
export const test = base.extend<{ loginBudget: void }>({
  loginBudget: [async ({}, use) => {
    const directory = process.env.PSC_E2E_DATA_DIR;
    if (!directory || !resolve(directory).startsWith(resolve('.cache') + sep + 'e2e-')) throw new Error('Expected the isolated Playwright filesystem store');
    const fs = new FsPrimitives(directory);
    const store = new KvStore(fs, { exclusive: fs.exclusive });
    for (const peer of ['::1', '127.0.0.1', '::ffff:127.0.0.1']) await store.rateLimitReset(`login-ip-${peer}`);
    await use();
  }, { auto: true }],
});
export { expect };

export async function restoreSeed(context: BrowserContext) {
  // Stop pending UI timers before changing the store from outside the editor.
  await Promise.all(context.pages().map(page => page.close()));
  const me = await context.request.get('/api/admin/auth/me');
  if (!me.ok()) return;
  const { csrfToken } = await me.json();
  const restored = await context.request.post('/api/admin/publishes/1/restore', {
    headers: { 'X-CSRF-Token': csrfToken, Origin: 'http://localhost:3000' },
    data: { summary: 'Admin browser test cleanup' },
  });
  expect(restored.ok()).toBeTruthy();
}
