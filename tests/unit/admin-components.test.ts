import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toChildArray, type ComponentChildren, type VNode } from 'preact';
import { session, invalidateCache } from '../../admin/src/api.js';
import { Shell } from '../../admin/src/components/Shell.js';
import { DocEditor } from '../../admin/src/routes/DocEditor.js';
import { Form } from '../../admin/src/components/Form/index.js';
import { Preview } from '../../admin/src/components/Preview.js';
import { EditorState, editorFlush, navigationGuard } from '../../admin/src/state/autosave.js';

// Exercise the components' contracts and effect callbacks without a browser or
// a DOM dependency. Browser focus/layout remains covered by the Playwright specs.
const hooks = vi.hoisted(() => ({ cursor: 0, route: vi.fn(), memo: undefined as unknown, values: [] as unknown[], effects: [] as (() => void | (() => void))[] }));
vi.mock('preact/hooks', () => ({
  useMemo: (factory: () => unknown) => hooks.memo ??= factory(),
  useRef: () => ({ current: null }),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  // Keyboard shortcuts register in a layout effect; not exercised by these tests.
  useLayoutEffect: () => {},
}));
vi.mock('preact-iso', () => ({ useLocation: () => ({ path: '/admin/events/evt_test', route: hooks.route }) }));
function nodes(children: ComponentChildren): VNode<Record<string, unknown>>[] {
  return toChildArray(children).flatMap(child => {
    if (typeof child !== 'object') return [];
    const node = child as VNode<Record<string, unknown>>;
    return [node, ...nodes(node.props.children as ComponentChildren)];
  });
}
const original = { id: 'evt_test', collection: 'events', draft: { title: 'Original', date: '2099-01-01' }, version: 1, status: 'draft' };
const reply = (doc: unknown) => new Response(JSON.stringify({ doc }));
beforeEach(() => {
  invalidateCache(); hooks.route.mockClear(); hooks.cursor = 0; hooks.memo = undefined; hooks.values = []; hooks.effects = [];
  const storage = new Map<string, string>();
  const api = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) };
  vi.stubGlobal('sessionStorage', api); vi.stubGlobal('localStorage', api);
  vi.stubGlobal('location', { search: '', hash: '', port: '3000' });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  session.value = { user: { id: 'owner', displayName: 'Phil' } as never, csrfToken: 'csrf', passwordWeak: true, permissions: ['content.edit'] };
});
afterEach(() => { session.value = null; editorFlush.value = null; navigationGuard.value = null; vi.useRealTimers(); vi.unstubAllGlobals(); });
it('keeps counted navigation names stable and the reminder dismissible across screens', () => {
  hooks.values[3] = { events: 10 };
  const renderShell = () => { hooks.cursor = 0; return nodes(Shell({ children: null, refresh: 1, publish: vi.fn() })); };
  let rendered = renderShell();
  const event = rendered.find(node => node.type === 'a' && node.props.href === '/admin/events')!;
  expect(nodes(event).find(node => node.type === 'small')?.props).toMatchObject({ children: 10, 'aria-hidden': 'true' });
  expect(event.props.tabIndex).not.toBe(-1);
  expect(rendered.some(node => node.props['aria-label'] === 'Password security')).toBe(true);
  const dismiss = rendered.find(node => node.props['aria-label'] === 'Dismiss password reminder for this session')!;
  (dismiss.props.onClick as () => void)();
  rendered = renderShell(); expect(rendered.some(node => node.props['aria-label'] === 'Password security')).toBe(false);
  // Remounting the shell retains the dismissal for this signed-in user.
  hooks.values = []; rendered = renderShell();
  expect(rendered.some(node => node.props['aria-label'] === 'Password security')).toBe(false);
});
it('the editor publish/navigation guard waits for an in-flight clean checkpoint', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply(original)); vi.stubGlobal('fetch', fetch);
  const tree = DocEditor({ id: original.id, publish: vi.fn(), refresh: 0 });
  const cleanup = hooks.effects[0]();
  await vi.waitFor(() => expect(hooks.values[0]).toBe(true));
  let complete!: (response: Response) => void;
  fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }));
  const checkpoint = nodes(tree).find(node => node.type === 'button' && node.props.children === 'Save checkpoint')!;
  (checkpoint.props.onClick as () => void)();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  let finished = false;
  const flush = editorFlush.value!().then(ok => { finished = true; return ok; });
  await Promise.resolve(); expect(finished).toBe(false);
  complete(reply({ ...original, version: 2 }));
  expect(await flush).toBe(true); expect(fetch).toHaveBeenCalledTimes(2);
  if (cleanup) cleanup();
});
it('keeps both checkpoint controls operable during blur autosave and queues each sealed title', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply(original)); vi.stubGlobal('fetch', fetch);
  const render = () => { hooks.cursor = 0; return nodes(DocEditor({ id: original.id, publish: vi.fn(), refresh: 0 })); };
  render(); const cleanup = hooks.effects[0]();
  await vi.waitFor(() => expect(hooks.values[0]).toBe(true));
  let version = original.version;
  for (const title of ['First title', 'Second title']) {
    const form = render().find(node => (node.type as unknown) === Form)!;
    (form.props.change as (name: string, value: string) => void)('title', title);
    let finish!: (response: Response) => void;
    fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    const currentForm = render().find(node => (node.type as unknown) === Form)!;
    (currentForm.props.blur as () => void)();
    const controls = render().filter(node => node.type === 'button' && node.props.children === 'Save checkpoint');
    expect(controls).toHaveLength(2);
    expect(controls.every(node => !node.props.disabled)).toBe(true);
    const calls = fetch.mock.calls.length;
    (controls.at(-1)!.props.onClick as () => void)();
    expect(fetch).toHaveBeenCalledTimes(calls); // The checkpoint waits for autosave.
    fetch.mockResolvedValueOnce(reply({ ...original, version: version + 2, draft: { ...original.draft, title } }));
    finish(reply({ ...original, version: version + 1, draft: { ...original.draft, title } }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(calls + 1));
    expect(JSON.parse(fetch.mock.calls.at(-1)![1].body)).toMatchObject({ baseVersion: version + 1, checkpoint: true, draft: { title } });
    await editorFlush.value!(); version += 2;
  }
  if (cleanup) cleanup();
});
it('keeps the embedded preview out of sequential focus while exposing its full page link', () => {
  const tree = nodes(Preview({ version: 2, id: 'evt_test' }));
  expect(tree.find(node => node.type === 'iframe')?.props.tabIndex).toBe(-1);
  const link = tree.find(node => node.type === 'a')!;
  expect(link.props.href).toContain('?preview=1'); expect(link.props.target).toBe('_blank');
  expect(link.props.tabIndex).not.toBe(-1);
});

it('uses the complete document source schema for link and upload modes', () => {
  const tree = nodes(DocEditor({ id: 'new', collection: 'documents', publish: vi.fn(), refresh: 0 }));
  // The editor renders its form after its initial load, as it does for a new document.
  hooks.values[0] = true; hooks.cursor = 0;
  const loaded = nodes(DocEditor({ id: 'new', collection: 'documents', publish: vi.fn(), refresh: 0 }));
  const form = loaded.find(node => node.type === Form as unknown)!;
  const fields = form.props.fields as Record<string, { fields: Record<string, { options?: { value: string }[]; type: string }> }>;
  expect(fields.source.fields.mode.options?.map(option => option.value)).toEqual(['url', 'upload']);
  expect(fields.source.fields.fileId.type).toBe('file');
  expect(tree.length).toBeGreaterThan(0);
});

it('flushes keystrokes made during creation before replacing the new-document route', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const render = () => { hooks.cursor = 0; return nodes(DocEditor({ id: 'new', publish: vi.fn(), refresh: 0 })); };
  render(); const cleanup = hooks.effects[0]();
  await vi.waitFor(() => expect(hooks.values[0]).toBe(true));
  const state = hooks.memo as EditorState; state.update('title', 'First title');
  let finishCreate!: (response: Response) => void, finishSave!: (response: Response) => void;
  fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finishCreate = resolve; }))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finishSave = resolve; }));
  const create = render().find(node => node.type === 'button' && node.props.children === 'Create event')!;
  (create.props.onClick as () => void)(); state.update('title', 'Typed during creation');
  finishCreate(reply({ ...original, draft: { ...state.draft.value, title: 'First title' } }));
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(hooks.route).not.toHaveBeenCalled();
  expect(fetch.mock.calls[0][1].method).toBe('POST'); expect(fetch.mock.calls[1][1].method).toBe('PUT');
  expect(JSON.parse(fetch.mock.calls[1][1].body).draft.title).toBe('Typed during creation');
  finishSave(reply({ ...original, draft: state.draft.value, version: 2 }));
  await vi.waitFor(() => expect(hooks.route).toHaveBeenCalledWith('/admin/events/evt_test', true));
  expect(state.dirty.value).toBe(false); if (cleanup) cleanup();
});

it('signs out locally when the logout endpoint reports an expired session', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Session expired', { status: 401 })));
  const tree = nodes(Shell({ children: null, refresh: 0, publish: vi.fn() }));
  const signOut = tree.find(node => node.type === 'button' && node.props.children === 'Sign out')!;
  (signOut.props.onClick as () => void)();
  await vi.waitFor(() => expect(hooks.route).toHaveBeenCalledWith('/admin/login', true));
  expect(session.value).toBeNull();
});

it('scrolls only the preview window when highlighting a field', () => {
  const tree = nodes(Preview({ version: 2, id: original.id, focusedPath: 'title' }));
  const frame = tree.find(node => node.type === 'iframe')!;
  const view = { scrollY: 100, innerHeight: 600, scrollTo: vi.fn() };
  const node = { dataset: { edit: JSON.stringify({ collection: 'events', id: original.id, path: 'title' }) }, style: { outline: '', outlineOffset: '' }, getBoundingClientRect: () => ({ top: 500, height: 40 }), scrollIntoView: vi.fn() };
  (frame.ref as { current: unknown }).current = { contentWindow: view, contentDocument: { querySelectorAll: (selector: string) => selector === '[data-edit]' ? [node] : [] } };
  (frame.props.onLoad as () => void)();
  expect(view.scrollTo).toHaveBeenCalledWith({ top: 320, behavior: 'instant' });
  expect(node.scrollIntoView).not.toHaveBeenCalled();
});

it('inserts a paragraph break before a rich-text list', () => {
  const change = vi.fn();
  const form = nodes(Form({ fields: { body: { type: 'richtext' } }, value: { body: 'Intro' }, change }));
  const control = form.find(node => typeof node.type === 'function' && node.type.name === 'RichText')!;
  const tree = nodes((control.type as (props: unknown) => ComponentChildren)(control.props));
  const input = { selectionStart: 5, selectionEnd: 5, focus: vi.fn(), setSelectionRange: vi.fn() };
  (tree.find(node => node.type === 'textarea')!.ref as { current: unknown }).current = input;
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => callback());
  (tree.find(node => node.type === 'button' && node.props.children === 'List')!.props.onClick as () => void)();
  expect(change).toHaveBeenCalledWith('body', 'Intro\n\n- ');
});

it('skips periodic document refreshes while the tab is hidden', async () => {
  vi.useFakeTimers(); vi.stubGlobal('document', { hidden: true });
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(reply({ ...original, version: 2 }))); vi.stubGlobal('fetch', fetch);
  hooks.values[0] = true;
  DocEditor({ id: original.id, publish: vi.fn(), refresh: 0 });
  (hooks.memo as EditorState).accept(original as never);
  const cleanup = hooks.effects[5]();
  await vi.advanceTimersByTimeAsync(20000); expect(fetch).not.toHaveBeenCalled();
  vi.stubGlobal('document', { hidden: false });
  await vi.advanceTimersByTimeAsync(20000); expect(fetch).toHaveBeenCalledOnce();
  if (cleanup) cleanup(); (hooks.memo as EditorState).dispose();
});
