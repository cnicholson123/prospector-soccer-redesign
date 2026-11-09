import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

const source = readFileSync('public/assets/js/main.js', 'utf8');
// Execute the early registration block without requiring unrelated page widgets.
const early = source.slice(0, source.indexOf('  // A local hint')) + '\n})();';
it('registers transition handlers early and opts out before an admin navigation', () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const styles: { textContent?: string; remove: () => void }[] = [];
  const document = {
    documentElement: { classList: { add: vi.fn() } },
    querySelector: vi.fn(), querySelectorAll: () => [],
    addEventListener: (name: string, handler: (event: unknown) => void, capture: boolean) => {
      expect(capture).toBe(true); listeners.set(name, handler);
    },
    createElement: () => ({ remove: vi.fn() }),
    head: { appendChild: (style: typeof styles[number]) => styles.push(style) },
  };
  runInNewContext(early, { document, URL, location: new URL('https://club.example/'), window: {
    matchMedia: () => ({ matches: false }),
    addEventListener: (name: string, handler: (event: unknown) => void) => listeners.set(name, handler),
  } });
  expect([...listeners.keys()]).toEqual(['click', 'pageswap', 'pagereveal']);
  const click = (href: string, extra = {}) => listeners.get('click')!({
    button: 0, target: { closest: () => ({ href, target: '', hasAttribute: () => false }) }, ...extra,
  });
  click('https://club.example/admin/pages/home');
  expect(styles[0].textContent).toBe('@view-transition { navigation: none; }');
  const catches = [vi.fn(), vi.fn(), vi.fn()];
  const skipTransition = vi.fn();
  const viewTransition = { skipTransition, ready: { catch: catches[0] }, finished: { catch: catches[1] }, updateCallbackDone: { catch: catches[2] } };
  // The click flag works even when Chrome supplies no activation destination.
  listeners.get('pageswap')!({ viewTransition });
  expect(skipTransition).toHaveBeenCalledOnce();
  expect(catches.every(catchPromise => catchPromise.mock.calls.length === 1)).toBe(true);
  listeners.get('pagereveal')!({ viewTransition });
  expect(styles[0].remove).toHaveBeenCalled();
  skipTransition.mockClear();
  click('https://club.example/recreational');
  listeners.get('pageswap')!({ viewTransition });
  expect(skipTransition).not.toHaveBeenCalled();
  click('https://club.example/admin', { ctrlKey: true });
  expect(styles).toHaveLength(1);
  listeners.get('pageswap')!({ viewTransition, activation: { entry: { url: 'https://club.example/api/admin' } } });
  expect(skipTransition).toHaveBeenCalledOnce();
});

it('retains public page transitions and excludes private preview speculation', () => {
  expect(source).toContain('if (!inAdminPreview && HTMLScriptElement.supports?.("speculationrules")');
  expect(source).toContain('const inAdminPreview = window.top !== window.self');
});
