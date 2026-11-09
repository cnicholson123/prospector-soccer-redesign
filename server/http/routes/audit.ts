import type { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { collectionNames, type CollectionName } from '../../../shared/schema';
import type { AuditQuery } from '../../store/types';
import type { AdminContext, AdminEnv } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { ApiError } from '../middleware/errors';
function query(c: AdminContext): AuditQuery {
  const q = c.req.query(), limit = Number(q.limit ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || q.collection && !collectionNames.includes(q.collection as CollectionName) || [q.from, q.to].some(v => v && !Number.isFinite(Date.parse(v)))) throw new ApiError(422, 'validation', 'Invalid audit filter');
  return { limit, actorId: q.actor, action: q.action, collection: q.collection as CollectionName | undefined, docId: q.docId, from: q.from, to: q.to, text: q.q, cursor: q.cursor };
}
export function auditRoutes(app: Hono<AdminEnv>) {
  app.get('/api/admin/audit', requirePermission('audit.read'), async c => c.json(await c.get('store').queryAudit(query(c))));
  app.get('/api/admin/audit/export', requirePermission('audit.export'), async c => {
    const format = c.req.query('format') ?? 'csv';
    if (!['csv', 'json'].includes(format)) throw new ApiError(422, 'validation', 'Invalid export format');
    const q = query(c);
    if (q.cursor) await c.get('store').queryAudit({ ...q, limit: 1 });
    c.header('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json');
    c.header('Content-Disposition', `attachment; filename="audit.${format}"`);
    const columns = ['at', 'actorName', 'action', 'collection', 'docId', 'targetTitle', 'ip', 'userAgent', 'meta'] as const;
    // Defang spreadsheet formulas even when a field is quoted.
    const csv = (value: unknown) => { const text = typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''); return '"' + (/^(?:\s*[=+@-]|[\t\r])/.test(text) ? "'" : '') + text.replaceAll('"', '""') + '"'; };
    return stream(c, async stream => {
      await stream.write(format === 'csv' ? columns.join(',') + '\r\n' : '[');
      let cursor = q.cursor, first = true;
      do {
        const page = await c.get('store').queryAudit({ ...q, cursor, limit: 1000 });
        for (const row of page.items) { await stream.write(format === 'csv' ? columns.map(key => csv(row[key])).join(',') + '\r\n' : (first ? '' : ',') + JSON.stringify(row)); first = false; }
        cursor = page.cursor;
      } while (cursor);
      if (format === 'json') await stream.write(']');
    });
  });
}
