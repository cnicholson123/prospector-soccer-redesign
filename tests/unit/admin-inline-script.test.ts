import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

it('the public bridge initializes only from its parent origin and edits plain text with Enter/Escape', async () => {
  const address = { collection: 'home', id: 'home', path: 'hero.lead' };
  class Element {
    dataset = { edit: JSON.stringify(address) };
    textContent = 'Initial'; contentEditable = '';
    attributes = new Map<string, string>();
    classList = { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() };
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    removeAttribute(key: string) { this.attributes.delete(key); }
    closest(selector: string) { return selector === '[data-edit]' ? this : null; }
    matches() { return true; }
    focus = vi.fn();
  }
  const node = new Element(), parent = { postMessage: vi.fn() };
  const events = new Map<string, Function>(), windowEvents = new Map<string, Function>();
  const document = {
    addEventListener: (type: string, fn: Function) => events.set(type, fn),
    querySelectorAll: () => [node], documentElement: { classList: { toggle: vi.fn() } },
  };
  const window = { addEventListener: (type: string, fn: Function) => windowEvents.set(type, fn) };
  runInNewContext(await readFile('public/assets/js/admin-inline.js', 'utf8'), { Element, parent, window, document, location: { origin: 'http://localhost:3000' } });
  expect(parent.postMessage).toHaveBeenCalledWith({ type: 'ready' }, 'http://localhost:3000');
  const message = (data: unknown, origin = 'http://localhost:3000', source: unknown = parent) => windowEvents.get('message')!({ origin, source, data });
  message({ type: 'initialize', editable: true }, 'https://untrusted.example');
  message({ type: 'initialize', editable: true }, 'http://localhost:3000', {});
  expect(document.documentElement.classList.toggle).not.toHaveBeenCalled();
  message({ type: 'initialize', editable: true });
  const click = { target: node, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  events.get('click')!(click);
  expect(parent.postMessage).toHaveBeenLastCalledWith({ type: 'edit', ...address }, 'http://localhost:3000');
  message({ type: 'begin', ...address, fieldType: 'text', value: '<img src=x onerror=alert(1)>', label: 'Lead' });
  expect(node.contentEditable).toBe('plaintext-only'); expect(node.textContent).toBe('<img src=x onerror=alert(1)>');
  expect(node.attributes.get('role')).toBe('textbox');
  node.textContent = 'Typing'; events.get('input')!({ target: node });
  expect(parent.postMessage).toHaveBeenLastCalledWith({ type: 'change', ...address, value: 'Typing' }, 'http://localhost:3000');
  events.get('keydown')!({ key: 'Escape', preventDefault: vi.fn() });
  expect(node.textContent).toBe('<img src=x onerror=alert(1)>');
  expect(node.attributes.has('role')).toBe(false);
  expect(parent.postMessage).toHaveBeenLastCalledWith({ type: 'cancel', ...address, value: '<img src=x onerror=alert(1)>' }, 'http://localhost:3000');
  message({ type: 'begin', ...address, fieldType: 'text', value: 'Saved', label: 'Lead' });
  node.textContent = 'Commit'; events.get('keydown')!({ key: 'Enter', preventDefault: vi.fn() });
  expect(parent.postMessage).toHaveBeenLastCalledWith({ type: 'commit', ...address, value: 'Commit' }, 'http://localhost:3000');
});
