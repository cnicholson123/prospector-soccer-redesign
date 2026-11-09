import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toChildArray, type ComponentChildren, type VNode } from 'preact';
import { session } from '../../admin/src/api.js';
import { Shell } from '../../admin/src/components/Shell.js';
import { DocEditor } from '../../admin/src/routes/DocEditor.js';
import { editorFlush, navigationGuard } from '../../admin/src/state/autosave.js';

// Exercise the components' contracts and effect callbacks without a browser or
// a DOM dependency. Browser focus/layout remains covered by the Playwright specs.
const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void | (() => void))[] }));
vi.mock('preact/hooks', () => ({
  useMemo: (factory: () => unknown) => factory(),
  useRef: () => ({ current: null }),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
vi.mock('preact-iso', () => ({ useLocation: () => ({ path: '/admin/events/evt_test', route: vi.fn() }) }));
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
  hooks.cursor = 0; hooks.values = []; hooks.effects = [];
  const storage = new Map<string, string>();
  const api = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) };
  vi.stubGlobal('sessionStorage', api); vi.stubGlobal('localStorage', api);
  vi.stubGlobal('location', { search: '', hash: '' });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  session.value = { user: { id: 'owner', displayName: 'Phil' } as never, csrfToken: 'csrf', passwordWeak: true, permissions: ['content.edit'] };
});
afterEach(() => { session.value = null; editorFlush.value = null; navigationGuard.value = null; vi.unstubAllGlobals(); });
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
