import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toChildArray, type ComponentChildren, type VNode } from 'preact';
import { editPath, setEditValue } from '../../shared/edit-path.js';
import { session } from '../../admin/src/api.js';
import { PublishTray, publishConflictMessage } from '../../admin/src/components/PublishTray.js';
import { PublishButton } from '../../admin/src/components/PublishButton.js';
import { InlineEditor } from '../../admin/src/components/InlineEditor.js';
import { EditorState, editorFlush, navigationGuard } from '../../admin/src/state/autosave.js';

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void | (() => void))[] }));
vi.mock('preact/hooks', () => ({
  useRef: (initial: unknown) => {
    const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = { current: initial };
    return hooks.values[i];
  },
  useState: (initial: unknown) => {
    const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[i], (value: unknown) => { hooks.values[i] = typeof value === 'function' ? value(hooks.values[i]) : value; }];
  },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
function nodes(children: ComponentChildren): VNode<Record<string, unknown>>[] {
  return toChildArray(children).flatMap(child => typeof child === 'object' ? [child as VNode<Record<string, unknown>>, ...nodes((child as VNode).props.children)] : []);
}
function words(children: ComponentChildren): string {
  return toChildArray(children).map(child => typeof child === 'object' ? words((child as VNode).props.children) : String(child)).join(' ');
}
const pending = (version = 2) => ({ id: 'home', collection: 'home', version, draft: { hero: { lead: `Draft ${version}` } }, published: { hero: { lead: 'Live' } }, status: 'changed', diff: [{ path: 'hero.lead', label: 'Hero / Lead', before: 'Live', after: `Draft ${version}` }] });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  hooks.cursor = 0; hooks.values = []; hooks.effects = [];
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('location', { origin: 'http://localhost:3000', port: '3000' });
  session.value = { user: { id: 'owner' } as never, csrfToken: 'csrf', passwordWeak: false, permissions: ['content.read', 'content.edit', 'content.publish'] };
});
afterEach(() => { session.value = null; editorFlush.value = null; navigationGuard.value = null; vi.useRealTimers(); vi.unstubAllGlobals(); });

it('resolves stable keyed fields after a reorder and rejects undeclared or dangerous paths', () => {
  const data = { programs: [{ _key: 'second', title: 'Second' }, { _key: 'first', title: 'First' }] };
  const found = editPath('home', data, 'programs[first].title')!;
  expect(found).toMatchObject({ value: 'First', keys: ['programs', 1, 'title'], formPath: 'programs[1].title', field: { type: 'richtext' } });
  expect(setEditValue(data, found.keys, 'Changed').programs).toEqual([{ _key: 'second', title: 'Second' }, { _key: 'first', title: 'Changed' }]);
  expect(data.programs[1].title).toBe('First');
  for (const path of ['__proto__.polluted', 'hero.constructor', 'programs[missing].title', 'programs[0].notAField']) expect(editPath('home', data, path)).toBeNull();
});
it('refreshes a real publish conflict, keeps the note, clears selection, and retries only reviewed versions', async () => {
  const close = vi.fn(), published = vi.fn();
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [pending()] }))
    .mockResolvedValueOnce(response({ error: { message: 'Someone else saved this. Reload and compare' } }, 409))
    .mockResolvedValueOnce(response({ docs: [pending(3)] }))
    .mockResolvedValueOnce(response({ siteVersion: 8, purged: false }));
  vi.stubGlobal('fetch', fetch);
  const render = () => { hooks.cursor = 0; return PublishTray({ close, published }); };
  render(); hooks.effects[0](); await vi.waitFor(() => expect(hooks.values[0]).toHaveLength(1));
  let tree = render();
  const note = nodes(tree).find(n => n.props.id === 'publish-note')!;
  (note.props.onInput as Function)({ currentTarget: { value: 'Club update' } });
  tree = render();
  const button = () => nodes(render()).find(n => n.type === 'button' && words(n.props.children as ComponentChildren).startsWith('Publish 1'))!;
  (button().props.onClick as Function)();
  await vi.waitFor(() => expect(hooks.values[0]).toEqual([pending(3)]));
  tree = render(); expect(words(tree)).toContain(publishConflictMessage);
  expect(nodes(tree).find(n => n.props.id === 'publish-note')?.props.value).toBe('Club update');
  expect(nodes(tree).find(n => n.props.type === 'checkbox')?.props.checked).toBe(false);
  expect(close).not.toHaveBeenCalled(); expect(published).not.toHaveBeenCalled();
  (nodes(tree).find(n => n.props.type === 'checkbox')!.props.onChange as Function)({ currentTarget: { checked: true } });
  (button().props.onClick as Function)();
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ items: [{ collection: 'home', id: 'home', expectedVersion: 3 }], summary: 'Club update' });
});
it('keeps failed conflict refreshes visible and blocks publishing stale selections', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [pending()] }))
    .mockResolvedValueOnce(response({ error: { message: 'Conflict' } }, 409))
    .mockRejectedValueOnce(new Error('Network unavailable'));
  vi.stubGlobal('fetch', fetch);
  const render = () => { hooks.cursor = 0; return PublishTray({ close: vi.fn(), published: vi.fn() }); };
  render(); hooks.effects[0](); await vi.waitFor(() => expect(hooks.values[0]).toHaveLength(1));
  (nodes(render()).find(n => n.type === 'button' && words(n.props.children as ComponentChildren).startsWith('Publish 1'))!.props.onClick as Function)();
  await vi.waitFor(() => expect(words(render())).toContain('Network unavailable'));
  expect(words(render())).toContain(publishConflictMessage);
  expect(nodes(render()).find(n => n.type === 'button' && words(n.props.children as ComponentChildren).startsWith('Publish 0'))?.props.disabled).toBe(true);
});
it('offers Contributors review requests but neither publication nor scheduling, and Viewers read-only diffs', () => {
  session.value!.permissions = ['content.read', 'content.edit'];
  let tree = PublishButton({ open: vi.fn() }); expect(words(tree)).toContain('Request review'); expect(words(tree)).not.toContain('Review & publish');
  hooks.values = []; hooks.cursor = 0;
  tree = PublishTray({ close: vi.fn(), published: vi.fn() });
  expect(nodes(tree).filter(n => n.type === 'option').map(n => n.props.value)).toEqual(['review']);
  session.value!.permissions = ['content.read']; hooks.values = []; hooks.cursor = 0;
  tree = PublishTray({ close: vi.fn(), published: vi.fn() });
  expect(words(tree)).toContain('Your role can review changes'); expect(nodes(tree).some(n => n.props.id === 'publish-action')).toBe(false);
});
it('accepts only messages from its own same-origin frame and autosaves through EditorState', async () => {
  const listeners = new Map<string, Function>();
  vi.stubGlobal('window', { addEventListener: (name: string, fn: Function) => listeners.set(name, fn), removeEventListener: vi.fn() });
  const doc = pending(); const state = new EditorState('home', 'home'); state.accept(doc as never);
  const fetch = vi.fn().mockImplementation((_path: string, init: RequestInit) => response({ doc: { ...doc, version: 3, draft: JSON.parse(String(init.body)).draft } }));
  vi.stubGlobal('fetch', fetch);
  const source = { postMessage: vi.fn() };
  InlineEditor({ state, close: vi.fn() });
  (hooks.values[0] as { current: unknown }).current = { contentWindow: source };
  const cleanup = hooks.effects[0](); const listener = listeners.get('message')!;
  const target = { collection: 'home', id: 'home', path: 'hero.lead' };
  await listener({ origin: 'https://foreign.test', source, data: { type: 'edit', ...target } });
  await listener({ origin: location.origin, source: {}, data: { type: 'edit', ...target } });
  expect(source.postMessage).not.toHaveBeenCalled();
  await listener({ origin: location.origin, source, data: { type: 'edit', ...target } });
  expect(source.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'begin', fieldType: 'text', value: 'Draft 2' }), location.origin);
  await listener({ origin: location.origin, source, data: { type: 'change', ...target, value: 'Inline text' } });
  expect(state.draft.value).toEqual({ hero: { lead: 'Inline text' } });
  expect(await editorFlush.value!()).toBe(true);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ baseVersion: 2, draft: { hero: { lead: 'Inline text' } } });
  await listener({ origin: location.origin, source, data: { type: 'cancel', ...target, value: 'ignored' } });
  expect(state.draft.value).toEqual(doc.draft); // Escape also restores an already autosaved edit.
  if (cleanup) cleanup(); state.dispose();
});
it('a failed shared-document load never becomes an accidental create during a later flush', async () => {
  const listeners = new Map<string, Function>();
  vi.stubGlobal('window', { addEventListener: (name: string, fn: Function) => listeners.set(name, fn), removeEventListener: vi.fn() });
  const state = new EditorState('home', 'home'); state.accept(pending() as never);
  const fetch = vi.fn().mockResolvedValue(response({ error: { message: 'Temporarily unavailable' } }, 503));
  vi.stubGlobal('fetch', fetch);
  const source = { postMessage: vi.fn() };
  InlineEditor({ state, close: vi.fn() });
  (hooks.values[0] as { current: unknown }).current = { contentWindow: source };
  const cleanup = hooks.effects[0]();
  await listeners.get('message')!({ origin: location.origin, source, data: { type: 'edit', collection: 'site', id: 'site', path: 'footer.blurb' } });
  // Site settings are denied for this session before even attempting a read.
  expect(fetch).not.toHaveBeenCalled();
  await listeners.get('message')!({ origin: location.origin, source, data: { type: 'edit', collection: 'boardMembers', id: 'mem_1', path: 'name' } });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await editorFlush.value!()).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
  if (cleanup) cleanup(); state.dispose();
});
