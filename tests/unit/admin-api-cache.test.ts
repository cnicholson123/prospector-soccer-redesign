import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
it('validates a session once and coalesces simultaneous page reads', async () => {
  const fetch = vi.fn().mockResolvedValue(response({ user: { id: 'u' }, permissions: [], csrfToken: 'csrf' }));
  vi.stubGlobal('fetch', fetch);
  const { loadSession, api } = await import('../../admin/src/api.js');
  await Promise.all([loadSession(), loadSession()]); await loadSession();
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockImplementation(() => Promise.resolve(response({ docs: [] })));
  await Promise.all([api('/docs/events'), api('/docs/events')]);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('renders stale data immediately and delivers refreshed data in the background', async () => {
  const fetch = vi.fn().mockResolvedValue(response({ docs: ['cached'] })); vi.stubGlobal('fetch', fetch);
  const { api, cachedApi } = await import('../../admin/src/api.js');
  await api('/docs/events');
  let resolve!: (value: Response) => void;
  fetch.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
  const updated = vi.fn();
  expect(await cachedApi('/docs/events', updated)).toEqual({ docs: ['cached'] });
  expect(updated).not.toHaveBeenCalled();
  resolve(response({ docs: ['fresh'] }));
  await vi.waitFor(() => expect(updated).toHaveBeenCalledWith({ docs: ['fresh'] }));
});
it('invalidates on mutations and refuses a delayed read from a previous epoch', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const { api, peek } = await import('../../admin/src/api.js');
  let resolve!: (value: Response) => void;
  fetch.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  const oldRead = api('/docs/events');
  fetch.mockResolvedValueOnce(response({ ok: true }));
  await api('/docs/events/evt_a', 'PUT', { draft: {} });
  resolve(response({ docs: ['old'] })); await oldRead;
  expect(peek('/docs/events')).toBeUndefined();
  fetch.mockResolvedValueOnce(response({ docs: ['new'] })); await api('/docs/events');
  expect(peek('/docs/events')).toEqual({ docs: ['new'] });
});
it('clears private cached data on sign-out or account change', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(response({ docs: ['private'] }))));
  const { api, peek, setSession } = await import('../../admin/src/api.js');
  await api('/docs/events'); setSession(null); expect(peek('/docs/events')).toBeUndefined();
});

it('preserves page data prefetched in parallel with the first session validation', async () => {
  let finishSession!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/auth/me')
    ? new Promise<Response>(resolve => { finishSession = resolve; })
    : Promise.resolve(response({ docs: ['prefetched'] }))));
  const { loadSession, api, peek } = await import('../../admin/src/api.js');
  const validation = loadSession();
  await api('/docs/events');
  finishSession(response({ user: { id: 'u' }, csrfToken: 'csrf', permissions: [] }));
  await validation;
  expect(peek('/docs/events')).toEqual({ docs: ['prefetched'] });
});

it('never coalesces pending snapshots, including a read started before a mutation', async () => {
  let finishOld!: (value: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }))
    .mockResolvedValueOnce(response({ docs: ['fresh'] }))
    .mockResolvedValueOnce(response({ ok: true }))
    .mockResolvedValueOnce(response({ docs: ['saved'] }));
  vi.stubGlobal('fetch', fetch);
  const { api } = await import('../../admin/src/api.js');
  const old = api('/pending');
  // Also bypass a read from the same epoch, since uploads can use raw XHR.
  expect(await api('/pending')).toEqual({ docs: ['fresh'] });
  await api('/docs/sponsors/spo_1', 'PUT', { draft: {} });
  expect(await api('/pending')).toEqual({ docs: ['saved'] });
  finishOld(response({ docs: [] })); expect(await old).toEqual({ docs: [] });
  expect(fetch).toHaveBeenCalledTimes(4);
});

it.each([200, 409])('keeps deduplication within a mutation epoch after status %s, even when the old GET finishes last', async status => {
  let finishOld!: (value: Response) => void, finishFresh!: (value: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }))
    .mockResolvedValueOnce(response({ ok: true, error: { message: 'Conflict' } }, status))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finishFresh = resolve; }));
  vi.stubGlobal('fetch', fetch);
  const { api, peek } = await import('../../admin/src/api.js');
  const old = api('/docs/events');
  await api('/docs/events/evt_a', 'PUT', {}).catch(() => {});
  const fresh = api('/docs/events');
  expect(fresh).not.toBe(old);
  finishOld(response({ docs: ['stale'] })); await old;
  expect(peek('/docs/events')).toBeUndefined();
  // Old cleanup cannot evict the fresh in-flight entry.
  expect(api('/docs/events')).toBe(fresh);
  finishFresh(response({ docs: ['current'] })); await fresh;
  expect(peek('/docs/events')).toEqual({ docs: ['current'] });
  expect(fetch).toHaveBeenCalledTimes(3);
});
