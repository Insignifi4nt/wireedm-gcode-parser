import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CadContextMenu, type CadContextMenuItem } from './CadContextMenu';

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Harness({ items }: { items: readonly CadContextMenuItem[] }) {
  const [open, setOpen] = useState(false);
  return <><svg tabIndex={0} aria-label="Sketch canvas" onKeyDown={event => { if (event.key === 'ContextMenu') setOpen(true); }} />
    {open && <CadContextMenu anchor={{ x: 20, y: 30 }} title="Sketch" items={items} onClose={() => setOpen(false)} />}</>;
}
async function open(items: readonly CadContextMenuItem[]) {
  await act(async () => root.render(<Harness items={items} />));
  const canvas = container.querySelector('svg'); if (!canvas) throw new Error('Missing SVG canvas'); canvas.focus();
  await act(async () => canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true })));
  return canvas;
}
it('restores focus to the SVG modeling canvas after keyboard dismissal', async () => {
  const action = vi.fn(), canvas = await open([{ label: 'Fit sketch', onSelect: action }]);
  expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="menu"]')).toBeNull(); expect(document.activeElement).toBe(canvas); expect(action).not.toHaveBeenCalled();
});
it('lets a menu with only unavailable actions receive keyboard dismissal', async () => {
  const action = vi.fn(), canvas = await open([{ label: 'Unavailable', disabled: true, onSelect: action }]);
  expect(document.activeElement?.getAttribute('role')).toBe('menu');
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="menu"]')).toBeNull(); expect(document.activeElement).toBe(canvas); expect(action).not.toHaveBeenCalled();
});
it('navigates available actions and removes the popup before invoking a selected action', async () => {
  const action = vi.fn(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  await open([{ label: 'First', onSelect: vi.fn() }, { label: 'Disabled', disabled: true, onSelect: vi.fn() }, { kind: 'separator' }, { label: 'Last', onSelect: action }]);
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  expect(document.activeElement?.textContent).toBe('Last');
  const focused = document.activeElement; if (!(focused instanceof HTMLButtonElement)) throw new Error('Menu action missing');
  await act(async () => focused.click()); expect(action).toHaveBeenCalledTimes(1);
});
