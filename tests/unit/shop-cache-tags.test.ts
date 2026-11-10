import { afterEach, expect, it, vi } from 'vitest';
import { addCacheTag } from '@vercel/functions';
import { createRenderHandler } from '../../server/render/handler.js';
import { loadConfig } from '../../server/config.js';
import { catalogFixture } from '../shop/fixtures.js';
import type { Store } from '../../server/store/types.js';

vi.mock('@vercel/functions', () => ({ addCacheTag: vi.fn(), dangerouslyDeleteByTag: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('waits for both public shop cache tags before completing the HTTP response', async () => {
  const fixture = await catalogFixture();
  let finishShop!: () => void;
  const tagged = new Promise<void>(resolve => { finishShop = resolve; });
  vi.mocked(addCacheTag).mockImplementation(async tag => { if (tag === 'shop') await tagged; });
  vi.stubEnv('VERCEL', '1');
  const config = loadConfig({ SESSION_SECRET: 's'.repeat(32) }, () => {});
  const handler = createRenderHandler({ getSnapshot: async () => fixture.snapshot } as unknown as Store, config);
  let finished = false;
  const response = handler(new Request('http://localhost:3000/shop')).then(result => { finished = true; return result; });
  await vi.waitFor(() => expect(addCacheTag).toHaveBeenCalledWith('shop'));
  expect(addCacheTag).toHaveBeenCalledWith('content');
  expect(finished).toBe(false);
  finishShop();
  expect((await response).status).toBe(200);
});
