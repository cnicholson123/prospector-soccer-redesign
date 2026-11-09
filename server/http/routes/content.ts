import { collectIncoming } from '../../media.js';
import type { Hono } from 'hono';
import { safeEqual } from '../../auth/csrf.js';
import { documentId } from '../../store/identifiers.js';
import { collectionNames, collections, type CollectionName } from '../../../shared/schema.js';
import { allDocs, pending, publishDocuments, title, commitSnapshot, type Item } from '../../content/publish.js';
import { diff } from '../../content/diff.js';
import { scheduleDocuments, settleSchedules } from '../../content/schedule.js';
import { findRevision, restoreRevision, restoreSite } from '../../content/restore.js';
import { health } from '../../content/health.js';
import { search } from '../../content/search.js';
import { checkLinks } from '../../content/links.js';
import { audit } from '../../audit.js';
import { can } from '../../permissions.js';
import { actor, type AdminEnv } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { ApiError, object, string, version } from '../middleware/errors.js';
import { collection } from './docs.js';
function items(input: unknown): Item[] {
  if (!Array.isArray(input) || !input.length || input.length > 1000) throw new ApiError(422, 'validation', 'Select versioned items to publish');
  return input.map(value => {
    const item = object(value), col = item.collection as CollectionName;
    if (!collectionNames.includes(col)) throw new ApiError(422, 'validation', 'Invalid collection');
    return { collection: col, id: documentId(string(item.id, 'id')), expectedVersion: version(item.expectedVersion) };
  });
}
export function contentRoutes(app: Hono<AdminEnv>) {
  for (const name of ['publish', 'unpublish'] as const) app.post(`/api/admin/${name}`, requirePermission('content.publish'), async c => {
    const input = object(await c.req.json());
    const selected = items(input.items);
    if (input.all === true) {
      const all = pending(await allDocs(c.get('store')));
      if (all.length !== selected.length || all.some(d => !selected.some(s => s.id === d.id && s.collection === d.collection))) throw new ApiError(409, 'conflict', 'Pending documents changed. Reload and compare', { current: all });
    }
    return c.json(await publishDocuments(c.get('store'), selected, actor(c), c.get('now'), input.summary === undefined ? undefined : string(input.summary, 'summary', 1000), name === 'unpublish'));
  });
  app.post('/api/admin/schedule', requirePermission('content.publish'), async c => {
    const input = object(await c.req.json());
    return c.json(await scheduleDocuments(c.get('store'), items(input.items), string(input.at, 'at'), actor(c), c.get('now'), input.summary === undefined ? undefined : string(input.summary, 'summary', 1000)));
  });
  app.delete('/api/admin/schedule/:collection/:id', requirePermission('content.publish'), async c => {
    const input = object(await c.req.json());
    return c.json(await scheduleDocuments(c.get('store'), [{ collection: collection(c), id: c.req.param('id'), expectedVersion: version(input.baseVersion) }], null, actor(c), c.get('now')));
  });
  app.get('/api/admin/pending', requirePermission('content.read'), async c => c.json({ docs: pending(await allDocs(c.get('store'))).map(doc => ({ ...doc, diff: diff(doc.collection, doc.published, doc.draft) })) }));
  app.get('/api/admin/revisions/:collection/:id', requirePermission('history.read'), async c => {
    const limit = Number(c.req.query('limit') ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new ApiError(422, 'validation', 'Invalid limit');
    const revisions = await c.get('store').listRevisions(collection(c), c.req.param('id'), limit, c.req.query('before'));
    return c.json({ revisions, before: revisions.length === limit ? revisions.at(-1)?.id : undefined });
  });
  app.get('/api/admin/revisions/:revId', requirePermission('history.read'), async c => {
    const rev = await findRevision(c.get('store'), c.req.param('revId'), c.req.query('docId'));
    if (!rev) throw new ApiError(404, 'not_found', 'Revision not found');
    const previous = (await c.get('store').listRevisions(rev.collection, rev.docId, 1, rev.id))[0];
    return c.json({ revision: rev, diff: diff(rev.collection, previous?.data, rev.data) });
  });
  app.post('/api/admin/revisions/:revId/restore', requirePermission('content.edit'), async c => {
    const input = object(await c.req.json());
    const rev = await findRevision(c.get('store'), c.req.param('revId'), c.req.query('docId'));
    if (!rev) throw new ApiError(404, 'not_found', 'Revision not found');
    if (rev.collection === 'media') throw new ApiError(403, 'forbidden', 'Use the media editing flow');
    if (!can(c.get('user'), 'content.edit', { collection: rev.collection }) || input.publish === true && !can(c.get('user'), 'content.publish')) throw new ApiError(403, 'forbidden', 'You do not have permission for this restore');
    if (input.publish !== undefined && typeof input.publish !== 'boolean') throw new ApiError(422, 'validation', 'Invalid publish flag');
    return c.json(await restoreRevision(c.get('store'), rev.id, version(input.baseVersion), actor(c), c.get('now'), input.publish === true, rev.docId));
  });
  app.get('/api/admin/publishes', requirePermission('history.read'), async c => {
    const limit = Number(c.req.query('limit') ?? 50), before = c.req.query('before');
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || before && !Number.isSafeInteger(Number(before))) throw new ApiError(422, 'validation', 'Invalid pagination');
    return c.json({ publishes: await c.get('store').listPublishes(limit, before ? Number(before) : undefined) });
  });
  app.get('/api/admin/publishes/:siteVersion', requirePermission('history.read'), async c => {
    const record = await c.get('store').getPublish(version(Number(c.req.param('siteVersion'))));
    if (!record) throw new ApiError(404, 'not_found', 'Site version not found');
    const changes = [];
    if (c.req.query('diff') === '1') {
      const current = await c.get('store').getSnapshot();
      for (const entry of record.manifest) {
        const rev = await c.get('store').getRevision(entry.id, entry.revId), doc = current?.docs[entry.collection]?.find(d => d.id === entry.id);
        changes.push({ collection: entry.collection, id: entry.id, diff: diff(entry.collection, rev?.data, doc?.data), order: { before: entry.order, after: doc?.order } });
      }
      for (const doc of Object.values(current?.docs ?? {}).flatMap(d => d ?? [])) if (!record.manifest.some(e => e.id === doc.id && e.collection === doc.collection)) changes.push({ collection: doc.collection, id: doc.id, diff: diff(doc.collection, undefined, doc.data), order: { before: undefined, after: doc.order } });
    }
    return c.json({ publish: record, ...(c.req.query('diff') === '1' ? { changes } : {}) });
  });
  app.post('/api/admin/publishes/:siteVersion/restore', requirePermission('site.restore'), async c => {
    const input = object(await c.req.json());
    return c.json(await restoreSite(c.get('store'), version(Number(c.req.param('siteVersion'))), actor(c), c.get('now'), input.summary === undefined ? undefined : string(input.summary, 'summary', 1000)));
  });
  app.post('/api/admin/rebuild', requirePermission('content.publish'), async c => c.json(await commitSnapshot(c.get('store'), await c.get('store').capturePublication(), [], actor(c), c.get('now'), { kind: 'rebuild' })));
  app.get('/api/admin/search', requirePermission('content.read'), async c => c.json({ results: await search(c.get('store'), c.req.query('q') ?? '') }));
  app.get('/api/admin/dashboard', requirePermission('content.read'), async c => {
    const docs = await allDocs(c.get('store'));
    return c.json({ counts: Object.fromEntries([...collectionNames.map(name => [name, docs.filter(d => d.collection === name && !d.trashedAt).length]), ['pages', collectionNames.filter(name => collections[name].kind === 'singleton' && name !== 'site').length]]), pendingCount: pending(docs).length, reviewCount: docs.filter(d => d.reviewRequestedBy).length, scheduled: (await c.get('store').getSnapshot())?.scheduled ?? [], linkChecks: await c.get('store').getMeta('link-checks'), health: await health(c.get('store'), c.get('now'), c.get('config').tzName, c.get('user')), recent: can(c.get('user'), 'audit.read') ? (await c.get('store').queryAudit({ limit: 15 })).items : [], titles: docs.map(d => ({ id: d.id, title: title(d) })) });
  });
  app.get('/api/admin/export/content', requirePermission('site.export'), async c => {
    c.header('Content-Disposition', 'attachment; filename="content.json"'); return c.json({ docs: await allDocs(c.get('store')), snapshot: await c.get('store').getSnapshot() });
  });
  app.post('/api/admin/health/links', requirePermission('content.manage'), async c => {
    const urls = new Set<string>();
    function walk(value: unknown) {
      if (typeof value === 'string') { for (const match of value.matchAll(/https?:\/\/[^\s<>"')]+/g)) urls.add(match[0]); }
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    }
    for (const doc of await allDocs(c.get('store'))) walk(doc.draft);
    const result = { at: c.get('now').toISOString(), links: await checkLinks([...urls]) };
    await c.get('store').setMeta('link-checks', result);
    await c.get('store').recordAudit(audit(actor(c), 'health.links', { meta: { count: result.links.length } }, c.get('now')));
    return c.json(result);
  });
}
export function cronRoutes(app: Hono<AdminEnv>) {
  for (const method of ['get', 'post'] as const) app[method]('/api/admin/cron/settle', async c => {
    const secret = c.get('config').cronSecret, authorization = c.req.header('authorization') ?? '';
    const expected = `Bearer ${secret}`;
    if (!secret || !safeEqual(authorization, expected)) throw new ApiError(401, 'unauthenticated', 'Invalid cron credential');
    await collectIncoming(c.get('blobs'), c.get('now'));
    await c.get('store').deleteExpiredSessions(c.get('now').toISOString());
    return c.json(await settleSchedules(c.get('store'), c.get('now')));
  });
}
