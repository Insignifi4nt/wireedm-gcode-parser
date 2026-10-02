import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StartWorkPanel, type StartWorkPanelProps } from '../StartWorkPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('StartWorkPanel menus and imports', () => {
  let container: HTMLDivElement;
  let root: Root;
  const defaults: StartWorkPanelProps = {
    connected: true, dxfErrorMessage: null, dxfImporting: false, interactionLocked: false,
    programErrorMessage: null, programImporting: false,
    onImportDxfFile: vi.fn(), onImportUpidFile: vi.fn(), onImportProgramFile: vi.fn(), onOpenEditor: vi.fn()
  };
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
  const render = (props: Partial<StartWorkPanelProps> = {}) => act(async () => root.render(<StartWorkPanel {...defaults} {...props} />));
  const trigger = () => container.querySelector<HTMLButtonElement>('[aria-label="More path project import options"]')!;
  const item = () => container.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
  async function key(target: HTMLElement, key: string, shiftKey = false) {
    const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    await act(async () => target.dispatchEvent(event));
    return event;
  }

  it('opens from every menu key, focuses the item, and restores the trigger on Escape', async () => {
    await render();
    for (const openKey of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) {
      await key(trigger(), openKey);
      expect(document.activeElement).toBe(item());
      expect(trigger().getAttribute('aria-controls')).toBe(item().parentElement?.id);
      for (const navigation of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
        expect((await key(item(), navigation)).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(item());
      }
      await key(item(), 'Escape');
      expect(container.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(trigger());
    }
  });

  it('dismisses on Tab without trapping native navigation, and on outside focus or pointer', async () => {
    await render();
    for (const shiftKey of [false, true]) {
      await key(trigger(), 'ArrowDown');
      expect((await key(item(), 'Tab', shiftKey)).defaultPrevented).toBe(false);
      expect(container.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(trigger());
    }
    const outside = container.querySelector<HTMLButtonElement>('button')!;
    await key(trigger(), 'ArrowDown');
    await act(async () => outside.focus());
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(outside);
    await key(trigger(), 'ArrowDown');
    await act(async () => outside.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('restores focus before the file picker, closes when busy, and announces import errors', async () => {
    await render();
    const input = container.querySelector<HTMLInputElement>('[aria-label="UPID path project file"]')!;
    const click = vi.spyOn(input, 'click').mockImplementation(() => { expect(document.activeElement).toBe(trigger()); });
    await key(trigger(), 'ArrowDown');
    await act(async () => item().click());
    expect(click).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="menu"]')).toBeNull();
    await key(trigger(), 'ArrowDown');
    await render({ interactionLocked: true, dxfErrorMessage: 'Invalid geometry', programErrorMessage: 'Invalid program' });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(trigger().disabled).toBe(true);
    expect([...container.querySelectorAll('[role="alert"]')].map(element => element.textContent)).toEqual(['Invalid geometry', 'Invalid program']);
  });

  it.each([
    ['DXF file', 'onImportDxfFile'], ['UPID path project file', 'onImportUpidFile'], ['Machine program file', 'onImportProgramFile']
  ] as const)('clears %s immediately so the same file can be retried', async (label, callback) => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const importFile = vi.fn(() => pending);
    await render({ [callback]: importFile });
    const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    const file = new File(['invalid input'], 'retry.txt');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    Object.defineProperty(input, 'value', { configurable: true, writable: true, value: 'retry.txt' });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(importFile).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
    await act(async () => finish());
  });
});
