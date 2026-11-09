import { adminPassword, chrisPassword, reminderPassword } from './tests/e2e/credentials.js';
import { hashPassword } from './server/auth/password.js';
import { defineConfig } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
mkdirSync('.cache', { recursive: true });
const dataDir = process.env.PSC_E2E_DATA_DIR ??= mkdtempSync(resolve('.cache/e2e-'));
const bootstrapUsers = JSON.stringify(await Promise.all([['Phil', adminPassword], ['Chris', chrisPassword], ['Reminder', reminderPassword]].map(async ([username, password]) => ({ username, displayName: username, role: 'Owner', passwordHash: await hashPassword(password) }))));
export default defineConfig({
  // All specs share one server + DATA_DIR; parallel workers interfere through publish-all, so run serially.
  workers: 1,
  testDir: './tests/e2e', use: { baseURL: 'http://localhost:3000', browserName: 'chromium', channel: process.env.PW_CHANNEL ?? 'chrome' },
  webServer: { command: 'npm run start', url: 'http://localhost:3000/api/admin/healthz', reuseExistingServer: false, env: { DATA_DIR: dataDir, STORE_DRIVER: 'fs', CACHE_SMAXAGE: '0', CACHE_SWR: '0', ADMIN_BOOTSTRAP_USERS: bootstrapUsers, ADMIN_FORCE_PASSWORD_CHANGE: 'false' } },
});
