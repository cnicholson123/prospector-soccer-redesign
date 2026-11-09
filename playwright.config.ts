import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', use: { baseURL: 'http://localhost:3000', browserName: 'chromium', channel: process.env.PW_CHANNEL ?? 'chrome' },
  webServer: { command: 'npm run start', url: 'http://localhost:3000/api/admin/healthz', reuseExistingServer: false },
});
