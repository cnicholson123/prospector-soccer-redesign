import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditorState } from '../../admin/src/state/autosave.js';
import type { EventDoc } from '../../admin/src/state/autosave.js';
import { session, invalidateCache } from '../../admin/src/api.js';
import { eventDiff } from '../../admin/src/components/DiffView.js';
const original: EventDoc = { id: 'evt_sample', collection: 'events', draft: { title: 'Original', date: '2099-01-01', showOnHome: true }, version: 1, status: 'draft', createdAt: '', createdBy: 'a', updatedAt: '', updatedBy: 'a' };
let storage: Map<string, string>;
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  invalidateCache();
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  session.value = { user: { id: 'usr_test' } as never, csrfToken: 'csrf', permissions: ['content.edit'], passwordWeak: false };
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); session.value = null; });
it('preserves edits typed while an earlier autosave is in flight and flushes the latest draft', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply({ doc: original })); vi.stubGlobal('fetch', fetch);
  const state = new EditorState(original.id); await state.load();
  let complete!: (value: Response) => void;
  fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }));
  state.update('title', 'First edit'); const saving = state.save(); state.update('title', 'Later edit');
  complete(reply({ doc: { ...original, draft: { ...original.draft, title: 'First edit' }, version: 2 } }));
  expect(await saving).toBe(true); expect(state.draft.value.title).toBe('Later edit'); expect(state.dirty.value).toBe(true);
  fetch.mockResolvedValueOnce(reply({ doc: { ...original, draft: state.draft.value, version: 3 } }));
  expect(await state.flush()).toBe(true); expect(state.dirty.value).toBe(false); expect(storage.size).toBe(0);
  expect(JSON.parse(fetch.mock.calls[2][1].body).baseVersion).toBe(2);
  state.dispose();
});
it('keeps local work on 409 and retries Keep mine as a checkpoint at the new version', async () => {
  const current = { ...original, draft: { ...original.draft, title: 'Other editor' }, version: 2 };
  const fetch = vi.fn().mockResolvedValueOnce(reply({ doc: original })).mockResolvedValueOnce(reply({ error: { message: 'Someone else saved this. Reload and compare', details: { current } } }, 409));
  vi.stubGlobal('fetch', fetch); const state = new EditorState(original.id); await state.load(); state.update('title', 'My edit');
  expect(await state.save()).toBe(false); expect(state.conflict.value).toEqual(current); expect(state.draft.value.title).toBe('My edit');
  fetch.mockResolvedValueOnce(reply({ doc: { ...current, draft: state.draft.value, version: 3 } })); await state.keepMine();
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({ baseVersion: 2, checkpoint: true, draft: { title: 'My edit' } });
  expect(state.conflict.value).toBeNull(); state.dispose();
});
it('offers recovery per user/document and blocks saving until the editor chooses', async () => {
  storage.set('psc_draft_usr_test_events_evt_sample', JSON.stringify({ draft: { ...original.draft, title: 'Recovered' } }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ doc: original })));
  const state = new EditorState(original.id); await state.load(); expect(state.recovery.value?.title).toBe('Recovered'); expect(await state.save()).toBe(false);
  state.recover(); expect(state.draft.value.title).toBe('Recovered'); expect(state.dirty.value).toBe(true); state.dispose();
});
it('validates schema fields and shows labelled conflict differences', async () => {
  const state = new EditorState('new'); expect(await state.save(true)).toBe(false); expect(state.errors.value.some(e => e.path === 'title')).toBe(true);
  expect(eventDiff({ showOnHome: true }, { showOnHome: false })[0]).toMatchObject({ path: 'showOnHome', before: true, after: false }); state.dispose();
});
it('ignores a delayed refresh that predates a local save', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply({ doc: original }));
  vi.stubGlobal('fetch', fetch);
  const state = new EditorState(original.id); await state.load();
  let complete!: (value: Response) => void;
  fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }));
  const refreshing = state.refresh();
  state.update('location', 'Club fields');
  const saved = { ...original, version: 3, draft: state.draft.value };
  fetch.mockResolvedValueOnce(reply({ doc: saved }));
  expect(await state.save()).toBe(true);
  complete(reply({ doc: { ...original, version: 2 } }));
  expect(await refreshing).toBe(false);
  expect(state.doc.value).toEqual(saved); expect(state.draft.value.location).toBe('Club fields');
  expect(state.status.value).toMatch(/^Saved/); expect(state.dirty.value).toBe(false);
  state.dispose();
});
it('ignores refreshes after a new keystroke or disposal, but accepts a newer idle version', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply({ doc: original })); vi.stubGlobal('fetch', fetch);
  const state = new EditorState(original.id); await state.load();
  let complete!: (value: Response) => void;
  fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }));
  const refreshing = state.refresh(); state.update('location', 'My unsaved field');
  complete(reply({ doc: { ...original, version: 2 } }));
  expect(await refreshing).toBe(false); expect(state.draft.value.location).toBe('My unsaved field');
  state.accept(original);
  const newer = { ...original, version: 2, status: 'published' as const };
  fetch.mockResolvedValueOnce(reply({ doc: newer })); expect(await state.refresh()).toBe('updated');
  fetch.mockResolvedValueOnce(reply({ doc: original })); expect(await state.refresh()).toBe(false);
  expect(state.doc.value?.version).toBe(2);
  fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }));
  const pending = state.refresh(); state.dispose(); complete(reply({ doc: { ...newer, version: 3 } }));
  expect(await pending).toBe(false); expect(state.doc.value?.version).toBe(2);
});
it('waits for a clean-draft checkpoint before preparing a publish or navigation', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply({ doc: original })); vi.stubGlobal('fetch', fetch);
  const state = new EditorState(original.id); await state.load();
  let complete!: (value: Response) => void;
  fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }));
  const checkpoint = state.save(true);
  expect(state.dirty.value).toBe(false); expect(state.saving.value).toBe(true);
  let flushed = false;
  const flush = state.flush().then(result => { flushed = true; return result; });
  await Promise.resolve(); expect(flushed).toBe(false);
  complete(reply({ doc: { ...original, version: 2 } }));
  expect(await checkpoint).toBe(true); expect(await flush).toBe(true); expect(state.doc.value?.version).toBe(2);
  expect(fetch).toHaveBeenCalledTimes(2); state.dispose();
});

it('keeps flushing when edits arrive during each of two successive saves', async () => {
  const state = new EditorState(original.id); state.accept(original);
  const finishes: ((response: Response) => void)[] = [];
  const fetch = vi.fn(() => new Promise<Response>(resolve => { finishes.push(resolve); }));
  vi.stubGlobal('fetch', fetch);
  state.update('title', 'First'); const flush = state.flush();
  state.update('title', 'Second'); finishes[0](reply({ doc: { ...original, version: 2, draft: { ...original.draft, title: 'First' } } }));
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  state.update('title', 'Third'); finishes[1](reply({ doc: { ...original, version: 3, draft: { ...original.draft, title: 'Second' } } }));
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  finishes[2](reply({ doc: { ...original, version: 4, draft: { ...original.draft, title: 'Third' } } }));
  expect(await flush).toBe(true); expect(state.dirty.value).toBe(false);
  expect(state.doc.value?.draft.title).toBe('Third'); state.dispose();
});

it('never creates a document when flushing an untouched new form or an existing record still loading', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const fresh = new EditorState('new', 'products'); await fresh.load();
  expect(fresh.isNew).toBe(true); expect(fresh.dirty.value).toBe(false);
  expect(await fresh.flush()).toBe(true); expect(fetch).not.toHaveBeenCalled();
  let finish!: (value: Response) => void;
  fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  const existing = new EditorState('prod_existing', 'products'); const loading = existing.load();
  expect(existing.isNew).toBe(false); expect(existing.loading.value).toBe(true);
  expect(existing.dirty.value).toBe(false); expect(await existing.flush()).toBe(true);
  expect(await existing.save(true)).toBe(false); expect(fetch).toHaveBeenCalledTimes(1);
  existing.dispose(); finish(reply({ doc: { ...original, collection: 'products', id: 'prod_existing' } })); await loading;
  expect(existing.doc.value).toBeNull(); fresh.dispose();
});

it('never creates after a failed existing-record load', async () => {
  const fetch = vi.fn().mockResolvedValue(reply({ error: { message: 'Unavailable' } }, 503)); vi.stubGlobal('fetch', fetch);
  const state = new EditorState(original.id);
  await expect(state.load()).rejects.toThrow('Unavailable');
  state.update('title', 'Local edit');
  expect(await state.save(true)).toBe(false); expect(fetch).toHaveBeenCalledTimes(1); state.dispose();
});

it('stores the base version and warns before recovering a draft older than the current server version', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply({ doc: original })).mockResolvedValueOnce(reply({ doc: { ...original, version: 3 } })); vi.stubGlobal('fetch', fetch);
  const first = new EditorState(original.id); await first.load(); first.update('title', 'Unsaved local title');
  expect(JSON.parse(storage.get('psc_draft_usr_test_events_evt_sample')!)).toMatchObject({ format: 1, baseVersion: 1, docId: original.id });
  first.dispose(); invalidateCache();
  const next = new EditorState(original.id); await next.load();
  expect(next.recoveryVersion.value).toBe(1); expect(next.recoveryWarning.value).toContain('server has changed');
  expect(await next.flush()).toBe(false); next.recover();
  expect(next.doc.value?.version).toBe(3); expect(next.draft.value.title).toBe('Unsaved local title'); next.dispose();
});

it('reopens an interrupted creation by its server id and saves later keystrokes with PUT', async () => {
  const first = new EditorState('new'); await first.load(); first.update('title', 'First title');
  let finish!: (value: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetch);
  const creating = first.save(true); first.update('title', 'Later title');
  finish(reply({ doc: { ...original, draft: { ...first.draft.value, title: 'First title' } } })); expect(await creating).toBe(true);
  expect(first.dirty.value).toBe(true); first.dispose();
  const saved = { ...original, draft: { ...first.draft.value, title: 'First title' } };
  fetch.mockResolvedValueOnce(reply({ doc: saved }));
  const next = new EditorState('new'); await next.load();
  expect(next.doc.value?.id).toBe(original.id); expect(next.recovery.value?.title).toBe('Later title'); next.recover();
  fetch.mockResolvedValueOnce(reply({ doc: { ...saved, draft: next.draft.value, version: 2 } }));
  expect(await next.flush()).toBe(true);
  expect(fetch.mock.calls.map(call => call[1].method)).toEqual(['POST', 'GET', 'PUT']);
  expect(fetch.mock.calls[2][0]).toBe(`/api/admin/docs/events/${original.id}`);
  next.dispose();
});

it.each([413, 502])('keeps non-JSON status %s failures local and bounds automatic retries', async status => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('<html>proxy error</html>', { status }))); vi.stubGlobal('fetch', fetch);
  const state = new EditorState(original.id); state.accept(original); state.update('title', 'Unsaved edit');
  expect(await state.save()).toBe(false); await vi.runAllTimersAsync();
  expect(fetch).toHaveBeenCalledTimes(status === 413 ? 1 : 4);
  expect(state.dirty.value).toBe(true); expect(state.status.value).toBe('Request failed. Please try again.');
  expect(JSON.parse(storage.get('psc_draft_usr_test_events_evt_sample')!).draft.title).toBe('Unsaved edit');
  state.dispose();
});
