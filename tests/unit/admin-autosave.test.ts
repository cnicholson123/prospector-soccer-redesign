import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditorState } from '../../admin/src/state/autosave';
import type { EventDoc } from '../../admin/src/state/autosave';
import { session } from '../../admin/src/api';
import { eventDiff } from '../../admin/src/components/DiffView';
const original: EventDoc = { id: 'evt_sample', collection: 'events', draft: { title: 'Original', date: '2099-01-01', showOnHome: true }, version: 1, status: 'draft', createdAt: '', createdBy: 'a', updatedAt: '', updatedBy: 'a' };
let storage: Map<string, string>;
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  session.value = { user: { id: 'usr_test' } as never, csrfToken: 'csrf', permissions: ['content.edit'], passwordWeak: false };
});
afterEach(() => { vi.unstubAllGlobals(); session.value = null; });
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
  const state = new EditorState('new'); expect(await state.save()).toBe(false); expect(state.errors.value.some(e => e.path === 'title')).toBe(true);
  expect(eventDiff({ showOnHome: true }, { showOnHome: false })[0]).toMatchObject({ path: 'showOnHome', before: true, after: false }); state.dispose();
});
