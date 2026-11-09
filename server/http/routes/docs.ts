import type { Hono } from 'hono';
import { collectionNames, collections, type CollectionName } from '../../../shared/schema.js';
import type { Doc } from '../../../shared/types.js';
import { documentId } from '../../store/identifiers.js';
import { createId } from '../../content/ids.js';
import { createDocument, documentTitle } from '../../content/documents.js';
import { saveDraft, revision, conflict } from '../../content/revisions.js';
import { audit } from '../../audit.js';
import { actor, type AdminEnv, type AdminContext } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { ApiError, object, version, string } from '../middleware/errors.js';
export function collection(c: AdminContext): CollectionName {
  const value = c.req.param('collection') as CollectionName;
  if (!collectionNames.includes(value)) throw new ApiError(404, 'not_found', 'Collection not found');
  return value;
}
export async function document(c: AdminContext) {
  const doc = await c.get('store').getDoc(collection(c), documentId(c.req.param('id')!));
  if (!doc) throw new ApiError(404, 'not_found', 'Document not found');
  return doc;
}
export async function create(c: AdminContext, draft: unknown, action: 'created' | 'duplicated' = 'created') {
  const col = collection(c);
  if (col === 'media') throw new ApiError(403, 'forbidden', 'Use the media upload flow');
  const now = c.get('now'), user = actor(c), id = createId(col);
  if (await c.get('store').getDoc(col, id)) throw new ApiError(409, 'conflict', 'Document already exists');
  const doc: Doc = { id, collection: col, draft, version: 1, status: 'draft', createdAt: now.toISOString(), updatedAt: now.toISOString(), createdBy: user.id, updatedBy: user.id, order: (await c.get('store').listDocs(col)).length };
  return createDocument(c.get('store'), { doc, revision: revision(doc, user, action, now), audit: audit(user, action === 'duplicated' ? 'content.duplicate' : 'content.create', { collection: col, docId: id, targetTitle: documentTitle(doc) }, now) });
}
export function docRoutes(app: Hono<AdminEnv>) {
  app.get('/api/admin/docs/:collection', requirePermission('content.read'), async c => c.json({ docs: await c.get('store').listDocs(collection(c), { includeTrashed: c.req.query('trashed') === '1' }) }));
  app.get('/api/admin/docs/:collection/:id', requirePermission('content.read'), async c => {
    const doc = await document(c), etag = `W/"${doc.version}"`;
    c.header('ETag', etag);
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    return c.json({ doc });
  });
  app.post('/api/admin/docs/:collection', requirePermission('content.create'), async c => {
    const input = object(await c.req.json()); return c.json({ doc: await create(c, input.draft) }, 201);
  });
  app.put('/api/admin/docs/:collection/:id', requirePermission('content.edit'), async c => {
    if (collection(c) === 'media') throw new ApiError(403, 'forbidden', 'Use the media editing flow');
    const input = object(await c.req.json());
    if (input.checkpoint !== undefined && typeof input.checkpoint !== 'boolean') throw new ApiError(422, 'validation', 'Invalid checkpoint');
    return c.json({ doc: await saveDraft(c.get('store'), await document(c), version(input.baseVersion), input.draft, actor(c), c.get('now'), { checkpoint: input.checkpoint as boolean | undefined, summary: input.summary === undefined ? undefined : string(input.summary, 'summary', 1000) }) });
  });
  app.post('/api/admin/docs/:collection/:id/duplicate', requirePermission('content.create'), async c => {
    if (collections[collection(c)].kind === 'singleton') throw new ApiError(422, 'validation', 'Singletons cannot be duplicated');
    return c.json({ doc: await create(c, (await document(c)).draft, 'duplicated') }, 201);
  });
  for (const action of ['trash', 'untrash'] as const) app.post(`/api/admin/docs/:collection/:id/${action}`, requirePermission('content.manage'), async c => {
    const doc = await document(c), input = object(await c.req.json());
    if (!collections[doc.collection].trashable) throw new ApiError(422, 'validation', 'Singletons cannot be trashed');
    if (doc.scheduledAt) throw new ApiError(409, 'conflict', 'Cancel the schedule before trashing');
    const trash = action === 'trash';
    return c.json({ doc: await saveDraft(c.get('store'), doc, version(input.baseVersion), doc.draft, actor(c), c.get('now'), { action: trash ? 'trashed' : 'untrashed', patch: { trashedAt: trash ? c.get('now').toISOString() : undefined, trashedBy: trash ? c.get('user').id : undefined, status: trash ? 'trashed' : doc.published === undefined ? 'draft' : 'changed' } }) });
  });
  for (const method of ['post', 'delete'] as const) app[method]('/api/admin/docs/:collection/:id/review', requirePermission('content.edit'), async c => {
    const doc = await document(c), input = object(await c.req.json());
    return c.json({ doc: await saveDraft(c.get('store'), doc, version(input.baseVersion), doc.draft, actor(c), c.get('now'), { auditAction: method === 'post' ? 'content.review_request' : 'content.review_return', patch: { reviewRequestedBy: method === 'post' ? c.get('user').id : undefined, reviewNote: input.note === undefined ? undefined : string(input.note, 'note', 1000), status: method === 'post' ? 'review' : doc.published === undefined ? 'draft' : 'changed' } }) });
  });
  app.post('/api/admin/docs/:collection/reorder', requirePermission('content.manage'), async c => {
    const col = collection(c), input = object(await c.req.json());
    if (!collections[col].orderable || !Array.isArray(input.items)) throw new ApiError(422, 'validation', 'An orderable collection and versioned items are required');
    const docs = await c.get('store').listDocs(col), items = input.items.map(v => { const x = object(v); return { id: documentId(string(x.id, 'id')), version: version(x.baseVersion) }; });
    if (new Set(items.map(x => x.id)).size !== docs.length || items.length !== docs.length || items.some(x => !docs.some(d => d.id === x.id))) throw new ApiError(422, 'validation', 'Reorder must include every active document exactly once');
    for (const item of items) { const doc = docs.find(d => d.id === item.id)!; if (doc.version !== item.version) conflict(doc); }
    const mutations = items.flatMap((item, order) => { const doc = docs.find(d => d.id === item.id)!; return doc.order === order ? [] : [{ collection: col, id: doc.id, expectedVersion: doc.version, patch: { order, updatedAt: c.get('now').toISOString(), updatedBy: c.get('user').id } }]; });
    const [first, ...rest] = mutations;
    const ok = !first ? true : await c.get('store').mutateDoc({ ...first, guardVersions: items.map(item => ({ id: item.id, expectedVersion: item.version })), relatedOrder: rest.map(m => ({ id: m.id, expectedVersion: m.expectedVersion, order: m.patch.order })), audit: audit(actor(c), 'content.reorder', { collection: col, meta: { items } }, c.get('now')) });
    if (ok === 'conflict') throw new ApiError(409, 'conflict', 'Someone else saved this. Reload and compare', { current: await c.get('store').listDocs(col) });
    return c.json({ docs: await c.get('store').listDocs(col) });
  });
}
