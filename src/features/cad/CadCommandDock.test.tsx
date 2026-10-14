import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CadCommandDock, CadViewTools } from './CadCommandDock';

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
