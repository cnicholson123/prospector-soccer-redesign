import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toChildArray, type ComponentChildren, type VNode } from 'preact';
import { api, invalidateCache, peek, session } from '../../admin/src/api.js';
import { commands } from '../../admin/src/state/palette.js';
import { assignableRoles, canManageUser, passwordStrength, type PublicUser } from '../../admin/src/state/users.js';
import { Users } from '../../admin/src/routes/Users.js';
import { CommandPalette } from '../../admin/src/components/CommandPalette.js';
import { ReviewQueue } from '../../admin/src/components/ReviewQueue.js';
const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void | (() => void))[] }));
vi.mock('preact/hooks', () => ({
  useRef: (initial: unknown) => { const i = hooks.cursor++; return hooks.values[i] ??= { current: initial }; },
  useState: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial; return [hooks.values[i], (value: unknown) => { hooks.values[i] = typeof value === 'function' ? value(hooks.values[i]) : value; }]; },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
const owner = { id: 'owner', username: 'Phil', displayName: 'Phil', role: 'Owner', active: true } as PublicUser;
const admin = { ...owner, id: 'admin', role: 'Admin' } as PublicUser;
const contributor = { ...owner, id: 'contributor', role: 'Contributor' } as PublicUser;
function nodes(children: ComponentChildren): VNode<Record<string, unknown>>[] { return toChildArray(children).flatMap(child => typeof child === 'object' ? [child as VNode<Record<string, unknown>>, ...nodes((child as VNode).props.children)] : []); }
function words(children: ComponentChildren): string { return toChildArray(children).map(child => typeof child === 'object' ? words((child as VNode).props.children) : String(child)).join(' '); }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  hooks.cursor = 0; hooks.values = []; hooks.effects = []; invalidateCache();
  session.value = { user: owner, csrfToken: 'csrf', passwordWeak: false, permissions: ['users.manage', 'content.read', 'content.edit', 'content.publish', 'content.create'] };
  vi.stubGlobal('localStorage', { setItem: () => {}, removeItem: () => {} });
});
afterEach(() => { vi.unstubAllGlobals(); session.value = null; vi.useRealTimers(); });
it('mirrors role ceilings and exposes only permitted palette commands and all content destinations', () => {
  expect(assignableRoles(admin)).toEqual(['Viewer', 'Contributor', 'Editor']);
  expect(canManageUser(admin, owner)).toBe(false); expect(canManageUser(owner, admin)).toBe(true);
  expect(new Set(commands().map(c => c.id)).size).toBe(commands().length);
  expect(commands().find(c => c.id === 'users')?.href).toBe('/admin/users');
  expect(commands().find(c => c.id === 'new-events')?.href).toBe('/admin/events/new');
  expect(commands().find(c => c.id === 'site-seo')?.href).toBe('/admin/settings#section-seo');
  session.value!.permissions = ['content.read'];
  expect(commands().some(c => ['users','publish','audit','new-events'].includes(c.id))).toBe(false);
  expect(commands().some(c => c.id === 'events')).toBe(true);
});
it('keeps strength guidance advisory and rewards long passphrases', () => {
  expect(passwordStrength('', 'Phil').score).toBe(0); expect(passwordStrength('Phil', 'Phil').label).toBe('Weak');
  expect(passwordStrength('aaaaaaaaaaaaaaaaaaaa', 'Phil').label).toBe('Weak');
  expect(passwordStrength('Many separate words here', 'Phil').label).toBe('Strong');
});
it('hides out-of-ceiling account actions, protects the last Owner and discards the one-time password on close', async () => {
  const fetch = vi.fn().mockResolvedValue(response({ users: [owner, contributor] })); vi.stubGlobal('fetch', fetch);
  const render = () => { hooks.cursor = 0; return Users(); };
  render(); hooks.effects[0](); await vi.waitFor(() => expect(hooks.values[1]).toBe(true));
  let tree = render();
  const ownerRow = nodes(tree).find(n => n.type === 'li' && words(n).includes('Phil'))!;
  expect(nodes(ownerRow).some(n => n.type === 'button' && n.props.children === 'Deactivate')).toBe(false);
  session.value!.user = admin;
  tree = render();
  expect(words(nodes(tree).find(n => n.type === 'li' && words(n).includes('Phil')))).toContain('Only an Owner');
  expect(nodes(nodes(tree).find(n => n.type === 'li' && words(n).includes('Phil'))).some(n => n.type === 'button')).toBe(false);
  // Exercise Add -> server result -> once-only dialog -> close.
  (nodes(tree).find(n => n.type === 'button' && n.props.children === 'Add user')!.props.onClick as () => void)();
  tree = render(); const form = nodes(tree).find(n => typeof n.type === 'function' && n.props.save)!;
  fetch.mockResolvedValueOnce(response({ user: contributor, temporaryPassword: 'only-shown-in-this-dialog' }));
  await (form.props.save as (value: unknown) => Promise<void>)({ username: 'new', displayName: 'New', role: 'Contributor' });
  tree = render(); expect(words(tree)).toContain('It will not be shown again');
  expect(nodes(tree).find(n => n.props.id === 'temporary-password')?.props.value).toBe('only-shown-in-this-dialog');
  (nodes(tree).find(n => n.type === 'button' && n.props.children === 'I have saved the password')!.props.onClick as () => void)();
  expect(nodes(render()).some(n => n.props.id === 'temporary-password')).toBe(false);
  expect(fetch.mock.calls.some(call => String(call[1]?.body).includes('only-shown-in-this-dialog'))).toBe(false);
});
it('palette uses an ARIA combobox/listbox, keyboard selection, and ignores stale title-search results', async () => {
  vi.useFakeTimers();
  let finishOld!: (response: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { finishOld = r; })).mockResolvedValueOnce(response({ results: [{ collection: 'events', id: 'evt_new', title: 'New result' }] })); vi.stubGlobal('fetch', fetch);
  const execute = vi.fn().mockResolvedValue(undefined), close = vi.fn();
  const render = () => { hooks.cursor = 0; hooks.effects = []; return CommandPalette({ execute, close }); };
  let tree = render(); const input = () => nodes(tree).find(n => n.props.role === 'combobox')!;
  expect(input().props).toMatchObject({ 'aria-controls': 'command-results', 'aria-expanded': 'true', 'aria-autocomplete': 'list' });
  (input().props.onKeyDown as Function)({ key: 'Enter', preventDefault() {} }); await Promise.resolve();
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dashboard', href: '/admin' }));
  (input().props.onInput as Function)({ currentTarget: { value: 'Old result' } }); tree = render();
  const cleanup = hooks.effects[1](); await vi.advanceTimersByTimeAsync(200);
  (input().props.onInput as Function)({ currentTarget: { value: 'New result' } }); if (cleanup) cleanup(); tree = render(); hooks.effects[1](); await vi.advanceTimersByTimeAsync(200);
  finishOld(response({ results: [{ collection: 'events', id: 'evt_old', title: 'Old result' }] })); await Promise.resolve(); await Promise.resolve();
  tree = render(); expect(words(tree)).toContain('New result'); expect(words(tree)).not.toContain('Old result');
  expect(fetch.mock.calls[0][0]).toContain('title=1');
});
it('return review requires a note and a stale decision refreshes rather than publishing again', async () => {
  const doc = { id: 'evt_review', collection: 'events', version: 3, status: 'review', reviewRequestedBy: 'contributor', draft: { title: 'Review event' } };
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [doc] })).mockResolvedValueOnce(response({ error: { message: 'Conflict' } }, 409)).mockResolvedValueOnce(response({ docs: [{ ...doc, version: 4 }] })); vi.stubGlobal('fetch', fetch);
  const render = () => { hooks.cursor = 0; return ReviewQueue({ refresh: 0 }); };
  render(); hooks.effects[0](); await vi.waitFor(() => expect(hooks.values[0]).toHaveLength(1));
  (nodes(render()).find(n => n.type === 'button' && words(n.props.children as ComponentChildren).includes('Review event'))!.props.onClick as Function)();
  let tree = render(); expect(nodes(tree).find(n => n.props.children === 'Return with note')?.props.disabled).toBe(true);
  await (nodes(tree).find(n => n.props.children === 'Approve and publish')!.props.onClick as () => Promise<void>)();
  await vi.waitFor(() => expect(words(render())).toContain('This item changed.'));
  expect(fetch.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(1);
});
it('presence is throttled across remounts and leaves the document cache intact', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(response({ others: [], docs: ['cached'] }))));
  const { heartbeat } = await import('../../admin/src/state/presence.js');
  await api('/docs/events'); const before = peek('/docs/events');
  await Promise.all([heartbeat('events', 'evt_presence', 100000), heartbeat('events', 'evt_presence', 100001)]);
  await heartbeat('events', 'evt_presence', 129999); expect(fetch).toHaveBeenCalledTimes(2); expect(peek('/docs/events')).toEqual(before);
  await heartbeat('events', 'evt_presence', 130000); expect(fetch).toHaveBeenCalledTimes(3);
});
