import { afterEach, expect, it, vi } from 'vitest';
import { Dialog } from '../../admin/src/components/ConfirmDialog.js';

vi.mock('preact/hooks', () => ({ useRef: () => ({ current: null }), useEffect: () => {} }));
afterEach(() => vi.unstubAllGlobals());

// Native layout/tab traversal is covered in Playwright. These fixtures exercise
// the dialog's boundary policy without adding a DOM/browser dependency.
function control({ hidden = false, disabled = false, tabIndex = 0 } = {}) {
  return { tabIndex, getClientRects: () => hidden ? [] : [{}], matches: () => disabled, closest: () => null, focus: vi.fn() };
}
function press(active: unknown, controls: ReturnType<typeof control>[], shiftKey = false) {
  vi.stubGlobal('document', { activeElement: active });
  const dialog = { querySelectorAll: () => controls, focus: vi.fn() };
  const event = { key: 'Tab', shiftKey, altKey: false, ctrlKey: false, metaKey: false, defaultPrevented: false, currentTarget: dialog, preventDefault: vi.fn() };
  const tree = Dialog({ title: 'Activity details', close: vi.fn(), children: null });
  expect(tree.props.onKeyDown).toBeTypeOf('function');
  (tree.props.onKeyDown as (event: unknown) => void)(event);
  return { event, dialog };
}
it('wraps forward and backward at the visible enabled dialog controls', () => {
  const first = control(), last = control(), hidden = control({ hidden: true }), disabled = control({ disabled: true }), skipped = control({ tabIndex: -1 });
  const controls = [hidden, first, disabled, last, skipped];
  expect(press(last, controls).event.preventDefault).toHaveBeenCalledOnce();
  expect(first.focus).toHaveBeenCalledOnce();
  expect(press(first, controls, true).event.preventDefault).toHaveBeenCalledOnce();
  expect(last.focus).toHaveBeenCalledOnce();
  expect(hidden.focus).not.toHaveBeenCalled(); expect(disabled.focus).not.toHaveBeenCalled(); expect(skipped.focus).not.toHaveBeenCalled();
});
it('lets native tabbing handle interior controls and contains a dialog with one or no controls', () => {
  const first = control(), middle = control(), last = control();
  expect(press(middle, [first, middle, last]).event.preventDefault).not.toHaveBeenCalled();
  press(first, [first]); expect(first.focus).toHaveBeenCalledOnce();
  const empty = press(null, []); expect(empty.event.preventDefault).toHaveBeenCalledOnce(); expect(empty.dialog.focus).toHaveBeenCalledOnce();
});
