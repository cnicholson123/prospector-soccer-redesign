import type { Hono } from 'hono';
import { actor, type AdminEnv } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { ApiError, object, string, version } from '../middleware/errors.js';
import { finalizeMedia, prepareMedia, readBounded, readGrant, uploadGrant } from '../../media.js';
import { rateLimit } from '../../auth/ratelimit.js';
import { validate, ValidationError } from '../../content/validate.js';
import { revision } from '../../content/revisions.js';
import { audit } from '../../audit.js';
import { referenceUsage } from '../../content/references.js';
import { can } from '../../permissions.js';
/** SDK callbacks are signed by Blob, carry no user cookie and cannot create metadata. */
export function mediaCallbacks(app: Hono<AdminEnv>) {
  app.post('/api/admin/cron/blob-upload', async (c, next) => {
    const body = object(await c.req.raw.clone().json());
    if (body.type !== 'blob.upload-completed') throw new ApiError(422, 'validation', 'Invalid upload callback');
    try { return c.json(await c.get('blobs').clientUpload(c.req.raw, body)); }
    catch { throw new ApiError(403, 'forbidden', 'Invalid upload callback'); }
  });
}
export function mediaRoutes(app: Hono<AdminEnv>) {
  app.post('/api/admin/media/upload-url', requirePermission('media.upload'), async c => {
    const body = object(await c.req.json()), config = c.get('config'), blobs = c.get('blobs'), now = c.get('now');
    if (body.type === 'blob.generate-client-token') {
      const grant = readGrant(c.req.query('ticket') ?? '', c.get('user').id, config, now);
      return c.json(await blobs.clientUpload(c.req.raw, body, { path:grant.path, mime:grant.mime, size:grant.size, expires:grant.expires }));
    }
    await rateLimit(c.get('store'), 'uploads-' + c.get('user').id, 60, 3600, now);
    const { ticket, grant } = uploadGrant(body, c.get('user').id, config, now);
    const endpoint = '/api/admin/media/upload-url?ticket=' + encodeURIComponent(ticket);
    return c.json({ ticket, pathname: grant.path, access: 'private',
      handleUploadUrl: endpoint, uploadUrl: '/api/admin/media/local-upload?ticket=' + encodeURIComponent(ticket),
      local: config.storeDriver === 'fs', expiresAt: new Date(grant.expires).toISOString() });
  });
  app.put('/api/admin/media/local-upload', requirePermission('media.upload'), async c => {
    if (c.get('config').storeDriver !== 'fs') throw new ApiError(404,'not_found','Route not found');
    const grant = readGrant(c.req.query('ticket') ?? '', c.get('user').id, c.get('config'), c.get('now'));
    if (!c.req.raw.body) throw new ApiError(422,'validation','Upload body is required');
    if (c.req.header('content-type') !== grant.mime) throw new ApiError(422,'validation','MIME type differs from ticket');
    const bytes = await readBounded(c.req.raw.body, grant.size);
    if (bytes.length!==grant.size) throw new ApiError(422,'validation','Size differs from ticket');
    let result;
    try { result = await c.get('blobs').put(grant.path,bytes,{contentType:grant.mime}); }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'conflict') throw new ApiError(409,'conflict','Upload already exists'); throw error; }
    return c.json(result);
  });
  app.post('/api/admin/media', requirePermission('media.upload'), async c => {
    const input = object(await c.req.json());
    const grant = readGrant(string(input.ticket,'ticket',4096),c.get('user').id,c.get('config'),c.get('now'));
    // Client URLs and dimensions are deliberately ignored; only the ticket path is read.
    return c.json({ doc:await finalizeMedia(c.get('store'),c.get('blobs'),grant,input,actor(c),c.get('now'), input.webTicket ? readGrant(string(input.webTicket,'webTicket',4096),c.get('user').id,c.get('config'),c.get('now')) : undefined) },201);
  });
  app.post('/api/admin/media/:id/replace', requirePermission('media.upload'), async c => {
    const store = c.get('store'), doc = await store.getDoc('media', c.req.param('id'));
    if (!doc || doc.trashedAt) throw new ApiError(404, 'not_found', 'Media not found');
    const current = doc.draft as Record<string, unknown>;
    if (!can(c.get('user'), 'media.edit', { uploadedBy: current.uploadedBy as string })) throw new ApiError(403, 'forbidden', 'You cannot replace this media');
    const input = object(await c.req.json()), expected = version(input.baseVersion);
    if (expected !== doc.version) throw new ApiError(409, 'conflict', 'Someone else saved this. Reload and compare', { current: doc });
    const grant = readGrant(string(input.ticket, 'ticket', 4096), c.get('user').id, c.get('config'), c.get('now'));
    if (String(current.mime).startsWith('image/') !== grant.mime.startsWith('image/')) throw new ApiError(422, 'validation', 'Replace with the same kind of media');
    const web = input.webTicket ? readGrant(string(input.webTicket, 'webTicket', 4096), c.get('user').id, c.get('config'), c.get('now')) : undefined;
    const prepared = await prepareMedia(c.get('blobs'), grant, web);
    const draft = { ...current, ...prepared.data, uploadedBy: current.uploadedBy, uploadedAt: c.get('now').toISOString() };
    const checked = validate('media', draft); if (!checked.valid) throw new ValidationError(checked.errors);
    const next = { ...doc, draft, version: doc.version + 1 };
    const updated = await store.mutateDoc({ collection: 'media', id: doc.id, expectedVersion: expected,
      patch: { draft, status: doc.published ? 'changed' : 'draft', updatedBy: c.get('user').id, updatedAt: c.get('now').toISOString() },
      revision: { append: revision(next, actor(c), 'edited', c.get('now')) }, audit: audit(actor(c), 'media.replace', { collection: 'media', docId: doc.id }, c.get('now')) });
    if (updated === 'conflict') throw new ApiError(409, 'conflict', 'Someone else saved this. Reload and compare', { current: await store.getDoc('media', doc.id) });
    await prepared.cleanup();
    return c.json({ doc: updated });
  });
  app.get('/api/admin/media', requirePermission('content.read'), async c => {
    const docs = await c.get('store').listDocs('media');
    const capture = c.req.query('unused') === '1' ? await c.get('store').capturePublication() : undefined;
    return c.json({ docs:docs.filter(doc => (c.req.query('missingAlt')!=='1' || String((doc.draft as {mime?:string}).mime).startsWith('image/') && !String((doc.draft as {alt?:string}).alt ?? '').trim()) && (c.req.query('unused')!=='1' || !referenceUsage(capture!.docs,'media',doc.id,capture!.snapshot?.scheduled).length)) });
  });
  app.get('/api/admin/media/:id/usage', requirePermission('content.read'), async c => {
    const capture = await c.get('store').capturePublication();
    return c.json({ usage: referenceUsage(capture.docs, 'media', c.req.param('id'), capture.snapshot?.scheduled) });
  });
  app.get('/api/admin/media/:id', requirePermission('content.read'), async c => {
    const doc = await c.get('store').getDoc('media',c.req.param('id'));
    if (!doc) throw new ApiError(404,'not_found','Media not found'); return c.json({doc});
  });
  app.patch('/api/admin/media/:id', async c => {
    const store=c.get('store'), doc=await store.getDoc('media',c.req.param('id'));
    if (!doc) throw new ApiError(404,'not_found','Media not found');
    const current=doc.draft as Record<string,unknown>;
    if (!can(c.get('user'),'media.edit',{uploadedBy:current.uploadedBy as string})) throw new ApiError(403,'forbidden','You cannot edit this media');
    const input=object(await c.req.json());
    if (Object.keys(input).some(key=>!['alt','caption','focal','baseVersion'].includes(key))) throw new ApiError(422,'validation','Only alt, caption and focal can be edited');
    const draft={...current,...Object.fromEntries(Object.entries(input).filter(([key])=>key!=='baseVersion'))};
    const result=validate('media',draft); if (!result.valid) throw new ValidationError(result.errors);
    const next={...doc,draft,version:doc.version+1};
    const updated=await store.mutateDoc({collection:'media',id:doc.id,expectedVersion:version(input.baseVersion),patch:{draft,status:doc.published?'changed':'draft',updatedBy:c.get('user').id,updatedAt:c.get('now').toISOString()},revision:{append:revision(next,actor(c),'edited',c.get('now'))},audit:audit(actor(c),'media.edit',{collection:'media',docId:doc.id},c.get('now'))});
    if (updated==='conflict') throw new ApiError(409,'conflict','Someone else saved this. Reload and compare',{current:await store.getDoc('media',doc.id)});
    return c.json({doc:updated});
  });
  app.delete('/api/admin/media/:id', requirePermission('content.manage'), async c => {
    const store=c.get('store'), doc=await store.getDoc('media',c.req.param('id'));
    if (!doc) throw new ApiError(404,'not_found','Media not found');
    const input=object(await c.req.json());
    const updated=await store.mutateDoc({collection:'media',id:doc.id,expectedVersion:version(input.baseVersion),patch:{status:'trashed',trashedAt:c.get('now').toISOString(),trashedBy:c.get('user').id},audit:audit(actor(c),'media.trash',{collection:'media',docId:doc.id},c.get('now'))});
    if (updated==='conflict') throw new ApiError(409,'conflict','Someone else saved this. Reload and compare',{current:await store.getDoc('media',doc.id)});
    return c.json({doc:updated});
  });
}
