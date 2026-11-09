import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toChildArray, type ComponentChildren, type VNode } from 'preact';
import { session } from '../../admin/src/api.js';
import { Timeline } from '../../admin/src/components/Timeline.js';
import { DiffView, contentDiff } from '../../admin/src/components/DiffView.js';
import { auditParams, useHistoryPages } from '../../admin/src/state/history.js';
import type { EventDoc } from '../../admin/src/state/autosave.js';
const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void | (() => void))[] }));
vi.mock('preact/hooks', () => ({
  useRef: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = { current: initial }; return hooks.values[i]; },
  useState: (initial: unknown) => {
    const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[i], (value: unknown) => { hooks.values[i] = typeof value === 'function' ? value(hooks.values[i]) : value; }];
  },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
const nodes = (children: ComponentChildren): VNode<Record<string, unknown>>[] => toChildArray(children).flatMap(child => typeof child === 'object' ? [child as VNode<Record<string, unknown>>, ...nodes((child as VNode).props.children)] : []);
const text = (children: ComponentChildren): string => toChildArray(children).map(child => typeof child === 'object' ? text((child as VNode).props.children) : String(child)).join(' ');
const response = (body: unknown) => new Response(JSON.stringify(body));
beforeEach(() => {
  hooks.cursor = 0; hooks.values = []; hooks.effects = [];
  vi.stubGlobal('location', { search: '', origin: 'http://localhost:3000' });
  session.value = { user: { id: 'owner' } as never, permissions: ['history.read', 'content.edit', 'content.publish'], csrfToken: 'csrf', passwordWeak: false };
});
afterEach(() => { session.value = null; vi.unstubAllGlobals(); });
it('keeps Pacific date filters inclusive through daylight-saving changes and shares export parameters', () => {
  const q = new URLSearchParams(auditParams({ actor: 'owner', actionGroup: 'content', collection: 'home', q: 'club & team', from: '2030-03-10', to: '2030-03-10' }));
  expect(q.get('from')).toBe('2030-03-10T08:00:00.000Z'); expect(q.get('to')).toBe('2030-03-11T06:59:59.999Z');
  expect(q.get('q')).toBe('club & team'); expect(q.has('cursor')).toBe(false);
});
it('ignores old filter responses, serializes pagination and retries a failed cursor without losing rows', async () => {
  let finishOld!: (response: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValueOnce(response({ items: [{ id: 'new' }], cursor: 'next' }))
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce(response({ items: [{ id: 'new' }, { id: 'last' }] }));
  vi.stubGlobal('fetch', fetch);
  const render = (path: string) => { hooks.cursor = 0; return useHistoryPages<{ id: string }>(path); };
  render('/audit?actor=old'); const cleanup = hooks.effects[0]();
  if (cleanup) cleanup();
  render('/audit?actor=new'); hooks.effects[1]();
  await vi.waitFor(() => expect(render('/audit?actor=new').rows).toEqual([{ id: 'new' }]));
  finishOld(response({ items: [{ id: 'old' }] })); await Promise.resolve(); await Promise.resolve();
  expect(render('/audit?actor=new').rows).toEqual([{ id: 'new' }]);
  let page = render('/audit?actor=new'); await page.load(page.cursor);
  page = render('/audit?actor=new'); expect(page.error).toBe('Offline'); expect(page.cursor).toBe('next');
  const pending = page.load(page.cursor); await page.load(page.cursor); await pending;
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(render('/audit?actor=new').rows).toEqual([{ id: 'new' }, { id: 'last' }]);
  expect(fetch.mock.calls[3][0]).toContain('cursor=next');
});
it('shows list moves as human positions, keeps edited moved fields, and labels word additions/removals', () => {
  const changes = contentDiff('home', { programs: [{ _key: 'first', title: 'Old team' }, { _key: 'next', title: 'Next' }] }, { programs: [{ _key: 'next', title: 'Next' }, { _key: 'first', title: 'New team' }] });
  const tree = DiffView({ changes });
  expect(text(tree).replace(/\s+/g, ' ')).toContain('Moved from position 1 to 2'); expect(text(tree)).toContain('Added:'); expect(text(tree)).toContain('Removed:');
  expect(changes.some(change => change.path === 'programs[first].title' && change.kind === 'changed')).toBe(true);
  const keys = nodes(tree).filter(node => node.props.class === 'diff-row').map(node => node.key); expect(new Set(keys).size).toBe(keys.length);
});
it('preserves a successful draft restore when optional publication fails and sends the latest prepared version', async () => {
  const doc = { id: 'evt_test', collection: 'events', version: 3, draft: { title: 'Current' }, status: 'draft', createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z', createdBy: 'owner', updatedBy: 'owner' } satisfies EventDoc;
  const revision = { id: 'rev_first', docVersion: 1, action: 'created', authorName: 'Phil', at: '2030-01-01T00:00:00Z', data: { title: 'First' } };
  const restore = vi.fn(), prepare = vi.fn().mockResolvedValue({ ...doc, version: 5 });
  const fetch = vi.fn().mockImplementation((path: string, init: RequestInit) => init.method === 'POST' ? Promise.resolve(response({ doc: { ...doc, version: 6, draft: revision.data }, published: false, publishError: { message: 'Reference missing' } })) : Promise.resolve(response({ revisions: [revision] })));
  vi.stubGlobal('fetch', fetch);
  const render = () => { hooks.cursor = 0; return Timeline({ doc, restore, prepare }); };
  render(); hooks.values[2] = revision; hooks.values[6] = true; hooks.values[7] = true;
  const apply = nodes(render()).find(node => node.type === 'button' && text(node.props.children as ComponentChildren) === 'Restore and publish')!;
  await (apply.props.onClick as () => Promise<void>)();
  await vi.waitFor(() => expect(restore).toHaveBeenCalled());
  expect(JSON.parse(fetch.mock.calls.find(call => call[1].method === 'POST')![1].body as string)).toEqual({ baseVersion: 5, publish: true });
  expect(text(render())).toContain('Revision restored to draft. Publication failed: Reference missing');
  expect(prepare).toHaveBeenCalledOnce();
});
