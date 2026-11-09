import { randomBytes } from 'node:crypto';
// Inherited by Playwright workers and its isolated server. Never print these.
export const adminPassword = process.env.PSC_E2E_PASSWORD ??= randomBytes(24).toString('base64url');
export const chrisPassword = process.env.PSC_E2E_CHRIS_PASSWORD ??= randomBytes(24).toString('base64url');
export const reminderPassword = process.env.PSC_E2E_REMINDER_PASSWORD ??= randomBytes(4).toString('hex');
