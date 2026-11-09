import { defineConfig } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
mkdirSync('.cache', { recursive: true });
const dataDir = process.env.PSC_E2E_DATA_DIR ??= mkdtempSync(resolve('.cache/e2e-'));
export default defineConfig({
  testDir: './tests/e2e', use: { baseURL: 'http://localhost:3000', browserName: 'chromium', channel: process.env.PW_CHANNEL ?? 'chrome' },
  webServer: { command: 'npm run start', url: 'http://localhost:3000/api/admin/healthz', reuseExistingServer: false, env: { DATA_DIR: dataDir, STORE_DRIVER: 'fs', CACHE_SMAXAGE: '0', CACHE_SWR: '0' } },
});
