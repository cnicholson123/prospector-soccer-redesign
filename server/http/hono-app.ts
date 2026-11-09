import { Hono } from 'hono';
export const adminApp = new Hono();
adminApp.get('/api/admin/healthz', (c) => c.json({ ok: true }));
adminApp.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));
