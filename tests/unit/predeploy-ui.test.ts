import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { toChildArray, type ComponentChildren, type VNode } from 'preact';
import { session } from '../../admin/src/api.js';
import { App } from '../../admin/src/app.js';
import { Profile } from '../../admin/src/routes/Profile.js';
import { Shell } from '../../admin/src/components/Shell.js';
import { PublishTray } from '../../admin/src/components/PublishTray.js';
import { CommandPalette } from '../../admin/src/components/CommandPalette.js';
import { commands, type Command } from '../../admin/src/state/palette.js';
const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void | (() => void))[], route: vi.fn() }));
vi.mock('preact/hooks', () => ({
  useRef: (value: unknown) => { const i = hooks.cursor++; return hooks.values[i] ??= { current: value }; },
  useState: (value: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = typeof value === 'function' ? value() : value; return [hooks.values[i], (next: unknown) => { hooks.values[i] = typeof next === 'function' ? next(hooks.values[i]) : next; }]; },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
vi.mock('preact-iso', () => ({ LocationProvider: () => null, Router: () => null, Route: () => null, useLocation: () => ({ path: '/admin/events', route: hooks.route }) }));
function nodes(children: ComponentChildren): VNode<Record<string, unknown>>[] { return toChildArray(children).flatMap(child => typeof child === 'object' ? [child as VNode<Record<string, unknown>>, ...nodes((child as VNode).props.children)] : []); }
function text(children: ComponentChildren): string { return toChildArray(children).map(child => typeof child === 'object' ? text((child as VNode).props.children) : String(child)).join(' '); }
beforeEach(() => {
  hooks.cursor = 0; hooks.values = []; hooks.effects = []; hooks.route.mockReset();
  session.value = { user: { id: 'owner', username: 'Owner', displayName: 'Owner', role: 'Owner', active: true, createdAt: '', createdBy: '', mustChangePassword: false }, csrfToken: 'csrf', passwordWeak: false, permissions: ['content.read', 'content.publish', 'users.manage'] };
  vi.stubGlobal('document', { title: '' });
  vi.stubGlobal('location', { href: 'http://localhost/admin/events', pathname: '/admin/events', search: '', hash: '', origin: 'http://localhost' });
});
afterEach(() => { vi.unstubAllGlobals(); session.value = null; });
function renderWorkspace() {
  const workspace = (App().props.children as VNode).type as () => VNode;
  hooks.cursor = 0; hooks.effects = [];
  const tree = workspace();
  return { tree, render: () => { hooks.cursor = 0; hooks.effects = []; return workspace(); } };
}
it('opens the publish tray from the palette without making any network publication', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const { render } = renderWorkspace(); hooks.values[1] = false; // Workspace loading state follows its URL ref.
  let tree = render();
  const shell = nodes(tree).find(node => node.type === Shell)!;
  (shell.props.palette as () => void)(); tree = render();
  const palette = nodes(tree).find(node => node.type === CommandPalette)!;
  expect(commands()[0]).toMatchObject({ href: '/admin', title: 'Dashboard' });
  await (palette.props.execute as (command: Command) => Promise<void>)(commands().find(command => command.id === 'publish')!);
  tree = render(); const tray = nodes(tree).find(node => node.type === PublishTray)!;
  expect(tray.props.selectedIds).toEqual([]); // The tray selects all fresh pending versions after flushing editors.
  expect(fetch).not.toHaveBeenCalled();
});
it('renders only Profile for temporary-password users and redirects deep links', () => {
  session.value!.user.mustChangePassword = true;
  const { render } = renderWorkspace(); hooks.values[1] = false;
  const tree = render();
  expect(tree.type).toBe(Shell); expect((tree as VNode<Record<string, unknown>>).props.restricted).toBe(true);
  expect(nodes(tree).some(node => node.type === Profile)).toBe(true);
  hooks.effects[3]();
  expect(hooks.route).toHaveBeenCalledWith('/admin/profile#password', true);
});
it('labels password fields for role-and-name access and explains the mandatory change', () => {
  session.value!.user.mustChangePassword = true;
  const tree = Profile();
  expect(text(tree)).toContain('Change your temporary password to continue');
  expect(text(tree)).not.toContain('Password changes are optional');
  const passwords = nodes(tree).filter(node => node.type === 'input' && node.props.type === 'password');
  expect(passwords).toHaveLength(3);
  expect(passwords.every(node => node.props.role === 'textbox' && node.props.required)).toBe(true);
});
it('scopes collapsed navigation to JavaScript at the affected breakpoint', async () => {
  const css = await readFile('public/assets/css/styles.css', 'utf8');
  const rule = css.match(/@media \(max-width: 1200px\) \{([^}]+\}[^}]+\})/s)?.[1];
  expect(rule).toContain('.js .primary-nav, .js .site-header__cta { display: none; }');
  expect(rule).toContain('.js .menu-toggle { display: inline-flex; }');
});
