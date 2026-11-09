import { afterEach, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { adminFixture } from '../helpers/admin';
import { createRenderHandler } from '../../server/render/handler';
import { collections } from '../../shared/schema';
import type { Doc } from '../../shared/types';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const item = (doc: Doc) => ({ collection: doc.collection, id: doc.id, expectedVersion: doc.version });
it('edits and publishes board members, sponsors and nested page copy with public and history verification on FS', async () => {
  const f = await adminFixture(true); roots.push(f.root); await f.login();
  const render = createRenderHandler(f.store, f.config);
  for (const [collection, id, path, marker] of [
    ['boardMembers', 'mem_1', '/board', 'Breadth board volunteer'], ['sponsors', 'spo_1', '/sponsors', 'Breadth sponsor'], ['about', 'about', '/about', 'Breadth page copy'],
  ] as const) {
    const original = (await f.store.getDoc(collection, id))!;
    const draft = structuredClone(original.draft) as Record<string, unknown>;
    if (collection === 'about') (draft.hero as Record<string, unknown>).lead = marker; else draft.name = marker;
    const saved = await f.req(`/docs/${collection}/${id}`, 'PUT', { baseVersion: original.version, draft, checkpoint: true });
    expect(saved.status).toBe(200); const doc = (await saved.json()).doc;
    expect(await (await render(new Request(`http://localhost:3000${path}`))).text()).not.toContain(marker);
    expect((await f.req('/publish', 'POST', { items: [item(doc)] })).status).toBe(200);
    expect(await (await render(new Request(`http://localhost:3000${path}`))).text()).toContain(marker);
    const revisions = (await (await f.req(`/revisions/${collection}/${id}`)).json()).revisions;
    expect(revisions.some((rev: { action: string }) => rev.action === 'checkpoint')).toBe(true);
    expect(revisions.some((rev: { action: string }) => rev.action === 'published')).toBe(true);
  }
  const dashboard = await (await f.req('/dashboard')).json();
  expect(dashboard.counts).toMatchObject({ pages: 8, site: 1, boardMembers: 14 });
  expect(dashboard.health.filter((entry: { code: string }) => entry.code === 'missing_alt').map((entry: { id: string }) => entry.id)).toEqual(['med_hero_jpg']);
});
it('makes every breadth collection creatable, duplicable and reversible, while refusing referenced tier trash with usage', async () => {
  const f = await adminFixture(true); roots.push(f.root); await f.login();
  for (const definition of Object.values(collections).filter(d => d.kind === 'collection' && !d.systemManaged)) {
    const seed = (await f.store.listDocs(definition.name))[0];
    const duplicate = await f.req(`/docs/${definition.name}/${seed.id}/duplicate`, 'POST'); expect(duplicate.status).toBe(201);
    let doc = (await duplicate.json()).doc;
    let response = await f.req(`/docs/${definition.name}/${doc.id}/trash`, 'POST', { baseVersion: doc.version }); expect(response.status).toBe(200); doc = (await response.json()).doc;
    expect(doc.status).toBe('trashed');
    response = await f.req(`/docs/${definition.name}/${doc.id}/untrash`, 'POST', { baseVersion: doc.version }); expect(response.status).toBe(200);
  }
  const tier = (await f.store.getDoc('sponsorTiers', 'tier_gold'))!;
  const denied = await f.req('/docs/sponsorTiers/tier_gold/trash', 'POST', { baseVersion: tier.version });
  expect(denied.status).toBe(409); const failure = await denied.json();
  expect(failure.error.code).toBe('in_use'); expect(failure.error.details.usage[0]).toMatchObject({ collection: 'sponsors', path: 'tier' });
});
