import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toChildArray, type ComponentChildren, type VNode } from 'preact';
import { invalidateCache, session } from '../../admin/src/api.js';
import { checkFile, filterMedia, fitImage, uploadMedia, type MediaDoc } from '../../admin/src/state/media.js';
import { MediaField } from '../../admin/src/components/MediaPicker.js';
import { MediaLibrary } from '../../admin/src/components/MediaLibrary.js';
import { MediaDetails } from '../../admin/src/routes/Media.js';
import { Form } from '../../admin/src/components/Form/index.js';
import { FocalPoint } from '../../admin/src/components/FocalPoint.js';
const state = vi.hoisted(() => ({ index: 0, values: [] as unknown[], effects: [] as (() => void | (() => void))[] }));
const sdk = vi.hoisted(() => ({ upload: vi.fn().mockResolvedValue({}) }));
vi.mock('@vercel/blob/client', () => sdk);
vi.mock('preact/hooks', () => ({
  useState: (initial: unknown) => { const i = state.index++; if (!(i in state.values)) state.values[i] = typeof initial === 'function' ? initial() : initial; return [state.values[i], (v: unknown) => { state.values[i] = typeof v === 'function' ? v(state.values[i]) : v; }]; },
  useEffect: (effect: () => void | (() => void)) => { state.effects.push(effect); },
  useRef: (value: unknown) => { const i = state.index++; if (!(i in state.values)) state.values[i] = { current: value }; return state.values[i]; },
}));
const nodes = (children: ComponentChildren): VNode<Record<string, unknown>>[] => toChildArray(children).flatMap(child => typeof child === 'object' ? [child as VNode<Record<string, unknown>>, ...nodes((child as VNode).props.children)] : []);
const text = (children: ComponentChildren): string => toChildArray(children).map(child => typeof child === 'object' ? text((child as VNode).props.children) : String(child)).join(' ');
const doc: MediaDoc = { id: 'media_test', collection: 'media', version: 1, status: 'draft', createdAt: '2030-01-01', updatedAt: '2030-01-01', createdBy: 'owner', updatedBy: 'owner', draft: { filename: 'field.jpg', mime: 'image/jpeg', size: 100, uploadedBy: 'owner', alt: 'Field', caption: 'Club', focal: { x: 0.2, y: 0.8 }, variants: { original: '/original.jpg', web: '/web.webp' } } };
const response = (data: unknown) => new Response(JSON.stringify(data));
beforeEach(() => {
  state.index = 0; state.values = []; state.effects = []; invalidateCache(); vi.clearAllMocks();
  session.value = { user: { id: 'owner', role: 'Owner' } as never, csrfToken: 'csrf', passwordWeak: false, permissions: ['media.upload', 'media.edit', 'content.manage'] };
});
afterEach(() => { vi.unstubAllGlobals(); session.value = null; });
it('caps either orientation at 2000px without enlarging small images and filters by kind/text', () => {
  expect(fitImage(2600, 1300)).toEqual({ width: 2000, height: 1000 });
  expect(fitImage(600, 3000)).toEqual({ width: 400, height: 2000 });
  expect(fitImage(200, 100)).toEqual({ width: 200, height: 100 });
  expect(filterMedia([doc, { ...doc, id: 'pdf', draft: { mime: 'application/pdf', filename: 'guide.pdf' } }], 'images', ' club ')).toEqual([doc]);
  expect(filterMedia([doc], 'documents', '')).toEqual([]);
  expect(() => checkFile({ type: 'image/svg+xml', size: 5 })).toThrow('SVG');
  expect(() => checkFile({ type: 'image/jpeg', size: 8 * 1024 * 1024 + 1 })).toThrow('8 MB');
});
it('encodes WebP with canvas, uploads both quarantined files and submits only signed tickets', async () => {
  const bitmap = { width: 2600, height: 1300, close: vi.fn() }, drawImage = vi.fn();
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: (done: (blob: Blob) => void, mime: string) => done(new Blob(['webp'], { type: mime })) };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap)); vi.stubGlobal('document', { createElement: () => canvas });
  const fetch = vi.fn().mockResolvedValueOnce(response({ ticket: 'original-ticket', local: false, pathname: 'media/incoming/a/original.jpg', handleUploadUrl: '/grant?a' }))
    .mockResolvedValueOnce(response({ ticket: 'web-ticket', local: false, pathname: 'media/incoming/b/original.webp', handleUploadUrl: '/grant?b' })).mockResolvedValueOnce(response({ doc }));
  vi.stubGlobal('fetch', fetch); const progress = vi.fn();
  expect(await uploadMedia(new File(['jpeg'], 'field.jpg', { type: 'image/jpeg' }), progress, new AbortController().signal)).toEqual(doc);
  expect(canvas).toMatchObject({ width: 2000, height: 1000 }); expect(bitmap.close).toHaveBeenCalled();
  expect(sdk.upload.mock.calls[0][2]).toMatchObject({ access: 'private', headers: { 'X-CSRF-Token': 'csrf' }, handleUploadUrl: '/grant?a' });
  expect(sdk.upload.mock.calls[1][1].type).toBe('image/webp');
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ ticket: 'original-ticket', webTicket: 'web-ticket' });
  expect(progress).toHaveBeenLastCalledWith({ percent: 100, stage: 'Uploaded' });
});
it('does not finalize when conversion or quarantine transfer fails; supports PDFs through the FS binary endpoint', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('Cannot decode image')));
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(uploadMedia(new File(['bad'], 'bad.jpg', { type: 'image/jpeg' }), vi.fn(), new AbortController().signal)).rejects.toThrow('decode');
  expect(fetch).not.toHaveBeenCalled();
  const requests: { headers: Record<string, string>; url?: string; body?: Blob }[] = [];
  class Xhr {
    headers: Record<string, string> = {}; upload = {}; status = 200; onload = () => {}; onerror = () => {}; onabort = () => {};
    open(_method: string, url: string) { requests.push({ headers: this.headers, url }); }
    setRequestHeader(name: string, value: string) { this.headers[name] = value; }
    send(body: Blob) { requests.at(-1)!.body = body; this.onload(); }
    abort() { this.onabort(); }
  }
  vi.stubGlobal('XMLHttpRequest', Xhr);
  fetch.mockResolvedValueOnce(response({ local: true, uploadUrl: '/api/admin/media/local-upload?ticket=t', ticket: 't' })).mockResolvedValueOnce(response({ doc }));
  await uploadMedia(new File(['%PDF-1.7'], 'file.pdf', { type: 'application/pdf' }), vi.fn(), new AbortController().signal);
  expect(requests[0].headers).toEqual({ 'X-CSRF-Token': 'csrf', 'Content-Type': 'application/pdf' });
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ ticket: 't' });
  expect(sdk.upload).not.toHaveBeenCalled();
});
it('uses a picker for image/file fields, preserves per-use alt and hides inactive document-source controls', () => {
  const fields = nodes(Form({ fields: { logo: { type: 'image' }, file: { type: 'file' } }, value: {}, change: vi.fn() }));
  expect(fields.filter(node => node.type === MediaField as unknown)).toHaveLength(2);
  const changed = vi.fn();
  const tree = nodes(MediaField({ id: 'logo', type: 'image', value: { mediaId: doc.id, alt: 'Per-use text' }, change: changed, disabled: false }));
  const alt = tree.find(node => node.props.id === 'logo-alt')!;
  (alt.props.onInput as (event: unknown) => void)({ currentTarget: { value: 'Different context' } });
  expect(changed).toHaveBeenCalledWith({ mediaId: doc.id, alt: 'Different context' });
  const source = nodes(Form({ fields: { mode: { type: 'select', options: [] }, url: { type: 'url' }, fileId: { type: 'file' } }, value: { mode: 'upload' }, prefix: 'source', change: vi.fn() }));
  expect(source.some(node => node.props.id === 'field-source.url')).toBe(false);
  expect(source.some(node => node.props.type === 'file')).toBe(true);
});
it('offers keyboard focal sliders and honors contributor ownership and viewer read-only controls', () => {
  const change = vi.fn(), point = nodes(FocalPoint({ doc, change }));
  const slider = point.find(node => node.props['aria-label'] === 'Horizontal focal position')!;
  (slider.props.onInput as (event: unknown) => void)({ currentTarget: { value: '0' } });
  expect(change).toHaveBeenCalledWith({ x: 0, y: 0.8 });
  state.values = [doc, [], true, 'Field', 'Club', { x: 0.2, y: 0.8 }]; state.index = 0;
  session.value = { ...session.value!, user: { ...session.value!.user, id: 'other', role: 'Contributor' } };
  let tree = MediaDetails({ id: doc.id, close: vi.fn(), updated: vi.fn() });
  expect(nodes(tree).find(node => node.props.id === 'media-alt')!.props.disabled).toBe(true);
  expect(text(tree)).not.toContain('Save media details');
  session.value = { ...session.value!, permissions: [] }; state.values = []; state.index = 0;
  tree = MediaLibrary({ choose: vi.fn() });
  expect(nodes(tree).some(node => typeof node.type === 'function' && node.type.name === 'MediaUpload')).toBe(false);
});
it('ignores stale library responses when filters change', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(response({ docs: [doc] })));
  const render = () => { state.index = 0; return MediaLibrary({ choose: vi.fn() }); };
  render(); const cancel = state.effects[0](); if (cancel) cancel();
  state.values[3] = 'missing'; render(); state.effects[1]();
  await vi.waitFor(() => expect(state.values[0]).toEqual([doc]));
  finish(response({ docs: [] })); await Promise.resolve(); await Promise.resolve();
  expect(state.values[0]).toEqual([doc]);
});

it.each(['logo', 'hero.image'])('saves a picker selection, per-use alt changes and clearing through the %s form path', async path => {
  const { EditorState } = await import('../../admin/src/state/autosave.js');
  const { MediaLibrary } = await import('../../admin/src/components/MediaLibrary.js');
  const collection = path === 'logo' ? 'sponsors' : 'home';
  const draft = collection === 'sponsors' ? { name: 'Club sponsor', tier: 'tier_gold' } : { hero: { image: { mediaId: 'old_image', alt: 'Old alt' } } };
  const initialDraft = structuredClone(draft);
  const saved = { ...doc, id: collection === 'sponsors' ? 'spo_test' : 'home', collection, draft };
  const editor = new EditorState(saved.id, collection); editor.accept(saved as never);
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    return response({ doc: { ...saved, version: body.baseVersion + 1, draft: body.draft } });
  });
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  const form = () => {
    let tree = nodes(Form({ fields: collection === 'sponsors' ? { logo: { type: 'image' } } : { hero: { type: 'object', fields: { image: { type: 'image' } } } }, value: editor.draft.value, change: (name, value) => editor.update(name, value) }));
    if (collection === 'home') {
      const nested = tree.find(node => node.type === Form as unknown)!;
      tree = nodes(Form(nested.props as unknown as Parameters<typeof Form>[0]));
    }
    return tree.find(node => node.type === MediaField as unknown)!;
  };
  try {
    const props = form().props as unknown as Parameters<typeof MediaField>[0];
    const render = () => { state.index = 0; return nodes(MediaField(props)); };
    (render().find(node => node.type === 'button')!.props.onClick as () => void)();
    const picker = render().find(node => node.type === MediaLibrary as unknown)!;
    (picker.props.choose as (doc: MediaDoc) => void)(doc);
    expect(editor.dirty.value).toBe(true); expect(editor.status.value).toBe('Unsaved changes');
    // Selection must replace objects immutably, including a nested image.
    expect(saved.draft).toEqual(initialDraft);
    expect(editor.draft.value).not.toBe(saved.draft);
    expect(await editor.flush()).toBe(true); expect(editor.dirty.value).toBe(false);
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toMatchObject({ baseVersion: 1, draft: collection === 'sponsors' ? { logo: { mediaId: doc.id, alt: 'Field' } } : { hero: { image: { mediaId: doc.id, alt: 'Field' } } } });
    state.index = 0;
    const field = nodes(MediaField(form().props as unknown as Parameters<typeof MediaField>[0]));
    (field.find(node => node.props.id === `${props.id}-alt`)!.props.onInput as (event: unknown) => void)({ currentTarget: { value: 'Per-use alt' } });
    expect(editor.dirty.value).toBe(true); expect(await editor.flush()).toBe(true);
    expect(doc.draft.alt).toBe('Field');
    // The form's Clear action follows the same change/flush contract.
    const fields = { [collection === 'sponsors' ? 'logo' : 'image']: { type: 'image' as const } };
    const tree = nodes(Form({ fields, value: collection === 'sponsors' ? editor.draft.value : editor.draft.value.hero as Record<string, unknown>, change: (name, value) => collection === 'sponsors' ? editor.update(name, value) : editor.update('hero', { image: value }) }));
    (tree.find(node => node.type === 'button' && text(node.props.children as ComponentChildren).startsWith('Clear'))!.props.onClick as () => void)();
    expect(editor.dirty.value).toBe(true); expect(await editor.flush()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  } finally { editor.dispose(); }
});

it('registers media details with the global flush and waits for an existing metadata save', async () => {
  const { editorFlush } = await import('../../admin/src/state/autosave.js');
  state.values = [doc, [], true, 'Changed alt', 'Club', { x: 0.2, y: 0.8 }];
  const updated = vi.fn();
  const render = () => { state.index = 0; return nodes(MediaDetails({ id: doc.id, close: vi.fn(), updated })); };
  let finish!: (value: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetch);
  const tree = render();
  const unregister = state.effects[1]();
  try {
    (tree.find(node => node.type === 'button' && text(node.props.children as ComponentChildren) === 'Save media details')!.props.onClick as () => void)();
    let completed = false;
    const flushing = editorFlush.value!().then(value => { completed = true; return value; });
    await Promise.resolve(); expect(completed).toBe(false); expect(fetch).toHaveBeenCalledTimes(1);
    finish(response({ doc: { ...doc, version: 2, draft: { ...doc.draft, alt: 'Changed alt' } } }));
    expect(await flushing).toBe(true); expect(updated).toHaveBeenCalledOnce();
    render(); expect(await editorFlush.value!()).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
  } finally { if (unregister) unregister(); }
});
