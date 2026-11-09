import type { Hono } from 'hono';
import { requirePermission } from '../middleware/permission.js';
import type { AdminEnv } from '../middleware/auth.js';
import { document } from './docs.js';

/** Advisory, instance-local presence: never persisted and never written by GET. */
export function presenceRoutes(app: Hono<AdminEnv>) {
  const entries = new Map<string, { document: string; session: string; userId: string; name: string; at: number }>();
  app.post('/api/admin/docs/:collection/:id/presence', requirePermission('content.read'), async c => {
    const doc = await document(c), now = c.get('now').getTime();
    for (const [key, value] of entries) if (now - value.at >= 75000) entries.delete(key);
    const documentKey = `${doc.collection}/${doc.id}`, session = c.get('session').hash, user = c.get('user');
    const key = `${documentKey}/${session}`, previous = entries.get(key);
    if (!previous || now - previous.at >= 30000) {
      if (entries.size >= 5000) entries.delete(entries.keys().next().value!);
      entries.set(key, { document: documentKey, session, userId: user.id, name: user.displayName, at: now });
    }
    const others = [...new Map([...entries.values()].filter(e => e.document === documentKey && e.userId !== user.id).map(e => [e.userId, { id: e.userId, name: e.name }])).values()];
    return c.json({ others });
  });
}
