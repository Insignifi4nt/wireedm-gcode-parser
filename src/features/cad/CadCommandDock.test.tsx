import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CadCommandDock, CadViewTools } from './CadCommandDock';
import { CadContextHelp } from './CadContextHelp';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

function toggle() {
  const button = container.querySelector<HTMLButtonElement>('[aria-label="View controls"]');
  if (!button) throw new Error('View tab unavailable');
  return button;
}
function drawer() {
  const panel = document.getElementById(toggle().getAttribute('aria-controls')!);
  if (!panel) throw new Error('View drawer unavailable');
  return panel;
}

it('keeps view controls beneath the commands and unavailable to keyboard focus until disclosed', async () => {
  await act(async () => root.render(<CadCommandDock toolbar={<div aria-label="CAD tools"><button>Sketch</button></div>}>
    <div aria-label="Canvas"><CadViewTools label="Viewport controls"><button>Fit model</button></CadViewTools></div>
  </CadCommandDock>));
  expect(toggle().getAttribute('aria-expanded')).toBe('false'); expect(drawer().hasAttribute('inert')).toBe(true);
  expect(container.querySelector('[aria-label="Canvas"]')?.querySelector('[aria-label="Viewport controls"]')).toBeNull();
  expect(drawer().querySelector('[aria-label="Viewport controls"]')?.textContent).toBe('Fit model');
  expect(container.querySelector('[aria-label="CAD tools"]')!.compareDocumentPosition(drawer()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await act(async () => toggle().click());
  expect(toggle().getAttribute('aria-expanded')).toBe('true'); expect(drawer().hasAttribute('inert')).toBe(false);
});

it('retains the live viewport and control state across disclosure, with Escape returning focus to the View tab', async () => {
  const mounted = vi.fn(), unmounted = vi.fn(), fit = vi.fn();
  function Viewport() {
    const [grid, setGrid] = useState(true);
    useEffect(() => { mounted(); return unmounted; }, []);
    return <CadViewTools label="Viewport controls"><button aria-pressed={grid} onClick={() => setGrid(!grid)}>Grid</button><button onClick={fit}>Fit</button></CadViewTools>;
  }
  await act(async () => root.render(<CadCommandDock toolbar={<button>Sketch</button>}><Viewport /></CadCommandDock>));
  await act(async () => toggle().click());
  const grid = drawer().querySelector<HTMLButtonElement>('[aria-pressed]')!;
  await act(async () => grid.click()); expect(grid.getAttribute('aria-pressed')).toBe('false');
  await act(async () => toggle().click()); await act(async () => toggle().click());
  expect(drawer().querySelector('[aria-pressed]')).toBe(grid); expect(grid.getAttribute('aria-pressed')).toBe('false');
  grid.focus(); const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  await act(async () => grid.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(true); expect(toggle().getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(toggle());
  expect(mounted).toHaveBeenCalledTimes(1); expect(unmounted).not.toHaveBeenCalled(); expect(fit).not.toHaveBeenCalled();
});

it('replaces the contextual controls without retaining obsolete model commands', async () => {
  function Harness() {
    const [sketch, setSketch] = useState(false);
    return <CadCommandDock toolbar={<button onClick={() => setSketch(!sketch)}>Change context</button>}>
      {sketch ? <CadViewTools label="Sketch controls"><input aria-label="Grid spacing" defaultValue="5" /></CadViewTools>
        : <CadViewTools label="Viewport controls"><select aria-label="Named view"><option>Top</option></select></CadViewTools>}
    </CadCommandDock>;
  }
  await act(async () => root.render(<Harness />)); await act(async () => toggle().click());
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Change context')!.click());
  expect(toggle().getAttribute('aria-expanded')).toBe('true'); expect(drawer().querySelector('[aria-label="Named view"]')).toBeNull();
  expect(drawer().querySelector<HTMLInputElement>('[aria-label="Grid spacing"]')?.value).toBe('5');
});

it('retains standalone viewport controls when no shared command dock is mounted', async () => {
  await act(async () => root.render(<CadViewTools label="Viewport controls"><button>Fit model</button></CadViewTools>));
  expect(container.querySelector('[aria-label="Viewport controls"]')?.textContent).toBe('Fit model');
});

it.each([{ group: 'Viewport controls', help: 'Model navigation' }, { group: 'Sketch controls', help: 'Sketch navigation' }])(
  'dismisses pinned $help when its View owner closes from the keyboard and retains control state on reopen', async ({ group, help }) => {
    const mounted = vi.fn(), unmounted = vi.fn(), disclosure = vi.fn();
    function Grid() {
      const [grid, setGrid] = useState(true);
      useEffect(() => { mounted(); return unmounted; }, []);
      return <button aria-label="Grid state" aria-pressed={grid} onClick={() => setGrid(!grid)}>Grid</button>;
    }
    await act(async () => root.render(<CadCommandDock toolbar={<button>Sketch</button>}>
      <CadViewTools label={group}><Grid /><CadContextHelp label={help} onOpenChange={disclosure}>Navigation explanation</CadContextHelp></CadViewTools>
    </CadCommandDock>));
    await act(async () => toggle().click());
    const grid = drawer().querySelector<HTMLButtonElement>('[aria-label="Grid state"]')!;
    const trigger = drawer().querySelector<HTMLButtonElement>(`[aria-label="${help} help"]`)!;
    await act(async () => grid.click());
    await act(async () => { trigger.focus(); trigger.click(); }); // detail0 is keyboard activation.
    const dialog = document.querySelector(`[role="dialog"][aria-label="${help} help"]`);
    expect(dialog).not.toBeNull(); expect(drawer().contains(dialog)).toBe(false);
    expect(document.activeElement).toBe(dialog?.querySelector('button'));
    toggle().focus(); await act(async () => toggle().click());
    expect(drawer().hasAttribute('inert')).toBe(true);
    expect(document.querySelector(`[role="dialog"][aria-label="${help} help"]`)).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false'); expect(disclosure).toHaveBeenLastCalledWith(false);
    expect(document.activeElement).toBe(toggle());
    await act(async () => trigger.click()); // A hidden retained trigger cannot reopen its portal.
    expect(disclosure.mock.calls).toEqual([[true], [false]]);
    await act(async () => toggle().click());
    expect(drawer().querySelector('[aria-label="Grid state"]')).toBe(grid);
    expect(grid.getAttribute('aria-pressed')).toBe('false'); expect(mounted).toHaveBeenCalledOnce(); expect(unmounted).not.toHaveBeenCalled();
    expect(document.querySelector(`[role="dialog"][aria-label="${help} help"]`)).toBeNull();
    await act(async () => { trigger.focus(); trigger.click(); });
    expect(document.querySelector(`[role="dialog"][aria-label="${help} help"]`)).not.toBeNull();
    expect(disclosure.mock.calls).toEqual([[true], [false], [true]]);
  }
);

it('clears a pending help hover-dismiss timer when the owner closes, so a fresh preview survives reopening', async () => {
  vi.useFakeTimers();
  try {
    await act(async () => root.render(<CadCommandDock toolbar={<button>Sketch</button>}>
      <CadViewTools label="Viewport controls"><CadContextHelp label="Model navigation">Navigation explanation</CadContextHelp></CadViewTools>
    </CadCommandDock>));
    await act(async () => toggle().click());
    const help = drawer().querySelector<HTMLButtonElement>('[aria-label="Model navigation help"]')!;
    await act(async () => help.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(document.querySelector('[role="dialog"][aria-label="Model navigation help"]')).not.toBeNull();
    await act(async () => help.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: toggle() })));
    await act(async () => toggle().click());
    expect(document.querySelector('[role="dialog"][aria-label="Model navigation help"]')).toBeNull();
    await act(async () => toggle().click());
    await act(async () => help.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(document.querySelector('[role="dialog"][aria-label="Model navigation help"]')).not.toBeNull();
  } finally { vi.useRealTimers(); }
});

it('keeps canvas help independent of View disclosure when it is outside the View controls', async () => {
  await act(async () => root.render(<CadCommandDock toolbar={<button>Sketch</button>}>
    <CadContextHelp label="Selected profile">Profile explanation</CadContextHelp>
    <CadViewTools label="Viewport controls"><button>Fit model</button></CadViewTools>
  </CadCommandDock>));
  const help = container.querySelector<HTMLButtonElement>('[aria-label="Selected profile help"]')!;
  await act(async () => { help.focus(); help.click(); });
  expect(document.querySelector('[role="dialog"][aria-label="Selected profile help"]')).not.toBeNull();
  toggle().focus(); await act(async () => toggle().click()); await act(async () => toggle().click());
  expect(drawer().hasAttribute('inert')).toBe(true);
  expect(document.querySelector('[role="dialog"][aria-label="Selected profile help"]')).not.toBeNull();
  const close = document.querySelector<HTMLButtonElement>('[aria-label="Close Selected profile help"]')!;
  await act(async () => { close.focus(); close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  expect(document.querySelector('[role="dialog"][aria-label="Selected profile help"]')).toBeNull();
  expect(document.activeElement).toBe(help);
});
