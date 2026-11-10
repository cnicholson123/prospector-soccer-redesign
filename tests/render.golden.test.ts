import { beforeAll, describe, expect, it } from 'vitest';
import { access, readFile } from 'node:fs/promises';
import { loadSeed, seedSnapshot } from '../scripts/seed.js';
import { renderPage } from '../server/render/handler.js';
import { pageNames } from '../shared/schema.js';
import type { Snapshot } from '../shared/types.js';
import { normalizeHtml } from './normalize.js';
let snapshot: Snapshot;
beforeAll(async () => { snapshot = seedSnapshot(await loadSeed()); });
describe('published seed matches all legacy pages plus concept navigation', () => {
  it.each(pageNames.filter(p => p !== 'shop'))('%s', async page => {
    const golden = await readFile(`tests/golden/${page === 'home' ? 'index' : page}.html`, 'utf8');
    const rendered = renderPage(snapshot, page, { now: new Date('2026-11-09T12:00:00Z') });
    const conceptLink = '<li><a href="/shop">Merch (concept)</a></li>';
    expect(rendered.split(conceptLink)).toHaveLength(3); // Desktop and mobile only.
    expect(normalizeHtml(rendered.replaceAll(conceptLink, ''))).toBe(normalizeHtml(golden));
  });
});

it('uses the CMS build with the retired static pipeline absent', async () => {
  // docs/ now holds the volunteer manual. Keep every retired static page absent.
  const retiredPages = pageNames.filter(page => page !== 'shop').map(page => `docs/${page === 'home' ? 'index' : page}.html`);
  for (const path of ['build.py', 'src', 'assets', 'scripts/export-golden.ts', ...retiredPages]) {
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
  }
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const deployment = JSON.parse(await readFile('vercel.json', 'utf8'));
  expect(pkg.scripts['export:golden']).toBeUndefined();
  expect(deployment.buildCommand).toBe('npm run build');
  expect(deployment.outputDirectory).toBe('public');
  expect(Object.keys(deployment.functions).sort()).toEqual(['api/admin.ts', 'api/render.ts', 'api/shop.ts']);
});
