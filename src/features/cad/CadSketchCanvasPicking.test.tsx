import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadSketchProfile } from '@/domain/cad/cadDocument';
import { CadSketchCanvas } from './CadSketchCanvas';
import type { CadRenderedViewControls } from './cadViewportControls';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const circle = (id: string, x: number, y: number, radius: number): CadSketchProfile => ({ id, name: id, construction: false, geometry: { kind: 'circle', x, y, radius } });

async function fixture(profiles: readonly CadSketchProfile[], overrides: Partial<ComponentProps<typeof CadSketchCanvas>> = {}) {
  const selected = vi.fn(); const added = vi.fn(); const pending = vi.fn(); const error = vi.fn();
  let controls: CadRenderedViewControls | null = null;
  let props: ComponentProps<typeof CadSketchCanvas> = {
    sketch: { id: 'sketch', name: 'Sketch', suppressed: false, kind: 'sketch', plane: 'XY', offset: 0, profiles },
    parameters: {}, tool: 'select', selectedProfileId: null, onSelectProfile: selected, onAddProfile: added,
    onPendingChange: pending, onError: error, cancelSignal: 0, onControlsReady: value => { controls = value; }, ...overrides
  };
  async function render(next: Partial<typeof props> = {}) { props = { ...props, ...next }; await act(async () => root.render(<CadSketchCanvas {...props} />)); }
  await render();
  const found = container.querySelector<SVGSVGElement>('svg.cad-sketch-canvas');
  if (!found) throw new Error('Missing sketch canvas');
  const svg: SVGSVGElement = found;
  let captured: number | null = null;
  const capture = vi.fn((id: number) => { captured = id; });
  const release = vi.fn(() => { captured = null; });
  Object.assign(svg, { getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 600 }), setPointerCapture: capture,
    hasPointerCapture: (id: number) => captured === id, releasePointerCapture: release });
  function position(x: number, y: number) {
    const box = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const state = controls?.getState(); if (!state || state.mode === 'solid') throw new Error('Sketch frame missing');
    return { clientX: 10 + (x - state.centerMm[0] - box[0]) / box[2] * 800, clientY: 20 + (state.centerMm[1] - y - box[1]) / box[3] * 600 };
  }
  const frame = () => { if (!controls) throw new Error('Sketch frame missing'); return JSON.stringify(controls.getState()); };
  // Real Chromium mouse click PointerEvents have isPrimary=false, unlike down/up.
  async function click(x: number, y: number, target: Element = svg, init: MouseEventInit = {}, primary = false) {
    const event = new MouseEvent('click', { ...position(x, y), bubbles: true, button: 0, detail: 1, ...init });
    Object.defineProperty(event, 'isPrimary', { value: primary });
    await act(async () => target.dispatchEvent(event));
  }
  async function pointer(type: string, init: MouseEventInit = {}, pointerId = 11, primary = true) {
    const event = new MouseEvent(type, { button: 2, buttons: 2, clientX: 410, clientY: 320, bubbles: true, ...init });
    Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: primary } });
    await act(async () => svg.dispatchEvent(event));
  }
  return { svg, selected, added, pending, error, render, position, click, pointer, capture, release, frame };
}

describe('sketch canvas profile picking', () => {
  const graphSketch = { id: 'snaps', name: 'Snap references', suppressed: false, kind: 'sketch' as const, plane: 'XY' as const, offset: 0, profiles: [], graph: {
    points: [{ id: 'a', position: ['anchor', 3.2] as const }, { id: 'b', position: [22.1, 3.2] as const }, { id: 'c', position: [12.1, 13.2] as const }],
    entities: [{ id: 'line', kind: 'line' as const, startPointId: 'a', endPointId: 'b', construction: false }, { id: 'circle', kind: 'circle' as const, centerPointId: 'c', radius: 3.4, construction: false }], relations: []
  } };
  const inference = () => {
    const checkbox = container.querySelector<HTMLInputElement>('[aria-label="Create coincident relations"]');
    if (!checkbox) throw new Error('Missing relation inference control'); return checkbox;
  };
  it('retains deliberate first/opposite attachment roles while drawing a rectangle in reverse', async () => {
    const onAddFreshSketch = vi.fn(), original = structuredClone(graphSketch);
    const h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'rectangle', onAddFreshSketch });
    expect(inference().checked).toBe(false); await act(async () => inference().click());
    await h.click(12.2, 13.3); expect(container.querySelector('[data-cad-sketch-attachment="c"]')).not.toBeNull();
    await h.click(2.2, 3.3);
    expect(onAddFreshSketch).toHaveBeenCalledWith({ kind: 'rectangle',
      first: { kind: 'coincident', point: [12.1, 13.2], sourcePointId: 'c', relationId: expect.any(String) },
      opposite: { kind: 'coincident', point: [2.1, 3.2], sourcePointId: 'a', relationId: expect.any(String) }
    }, expect.any(AbortSignal));
    expect(h.added).not.toHaveBeenCalled(); expect(graphSketch).toEqual(original);
    expect(onAddFreshSketch.mock.calls[0][0].first.relationId).not.toBe(onAddFreshSketch.mock.calls[0][0].opposite.relationId);
  });
  it('applies inference only to future picks and explicitly clears pending links when switched off', async () => {
    const onAddFreshSketch = vi.fn();
    const h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'polygon', onAddFreshSketch });
    await h.click(2.2, 3.3); await act(async () => inference().click()); await h.click(12.2, 13.3);
    expect(container.querySelector('[data-cad-sketch-attachment="a"]')).toBeNull(); expect(container.querySelector('[data-cad-sketch-attachment="c"]')).not.toBeNull();
    await act(async () => inference().click()); expect(container.querySelector('[data-cad-sketch-attachment="c"]')).toBeNull();
    await h.click(22.2, 3.3); await h.click(2.2, 3.3);
    expect(onAddFreshSketch).toHaveBeenCalledWith({ kind: 'polygon', vertices: [
      { kind: 'position', point: [2.1, 3.2] }, { kind: 'position', point: [12.1, 13.2] }, { kind: 'position', point: [22.1, 3.2] }
    ] }, expect.any(AbortSignal)); expect(h.added).not.toHaveBeenCalled();
  });
  it('attaches only a circle center while radius and midpoint picks remain position-only', async () => {
    const onAddFreshSketch = vi.fn(); const h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'circle', onAddFreshSketch });
    await act(async () => inference().click()); await h.click(12.2, 13.3); await h.click(2.2, 3.3);
    expect(onAddFreshSketch).toHaveBeenNthCalledWith(1, { kind: 'circle',
      center: { kind: 'coincident', point: [12.1, 13.2], sourcePointId: 'c', relationId: expect.any(String) }, radius: Math.sqrt(200)
    }, expect.any(AbortSignal));
    await h.click(12.2, 3.3); await h.click(17.1, 3.2, h.svg, { ctrlKey: true });
    expect(onAddFreshSketch).toHaveBeenNthCalledWith(2, { kind: 'circle', center: { kind: 'position', point: [12.1, 3.2] }, radius: expect.closeTo(5, 10) }, expect.any(AbortSignal));
  });
  it('refuses to silently drop a pending attachment if the fresh editor becomes unavailable', async () => {
    const onAddFreshSketch = vi.fn(); const h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'rectangle', onAddFreshSketch });
    await act(async () => inference().click()); await h.click(12.2, 13.3); await h.render({ onAddFreshSketch: undefined }); await h.click(2.2, 3.3);
    expect(onAddFreshSketch).not.toHaveBeenCalled(); expect(h.added).not.toHaveBeenCalled(); expect(h.error).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-cad-sketch-attachment="c"]')).not.toBeNull();
  });
  it.each(['sketch', 'version', 'parameters'] as const)('pins an earlier attached pick across a same-position %s replacement until its links are released', async changed => {
    const onAddFreshSketch = vi.fn();
    const h = await fixture([], { sketch: graphSketch, documentVersion: 'one', parameters: { anchor: 2.1 }, tool: 'circle', onAddFreshSketch });
    await act(async () => inference().click()); await h.click(2.2, 3.3);
    await h.render(changed === 'sketch' ? { sketch: structuredClone(graphSketch) } : changed === 'version' ? { documentVersion: 'two' } : { parameters: { anchor: 2.1 } });
    await h.click(12.2, 13.3);
    expect(onAddFreshSketch).not.toHaveBeenCalled(); expect(h.added).not.toHaveBeenCalled(); expect(h.error).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-cad-sketch-attachment="a"]')).not.toBeNull();
    await act(async () => inference().click()); await h.click(12.2, 13.3);
    expect(onAddFreshSketch).toHaveBeenCalledOnce();
    expect(onAddFreshSketch.mock.calls[0][0]).toMatchObject({ kind: 'circle', center: { kind: 'position', point: [2.1, 3.2] } });
  });
  it('accepts its own deferred attachment result after the accepted source renders without reporting stale ownership', async () => {
    let resolve: () => void = () => { throw new Error('Pending append missing.'); };
    const onAddFreshSketch = vi.fn(() => new Promise<void>(accept => { resolve = accept; }));
    const h = await fixture([], { sketch: graphSketch, documentVersion: 'one', parameters: { anchor: 2.1 }, tool: 'circle', onAddFreshSketch });
    await act(async () => inference().click()); await h.click(2.2, 3.3); await h.click(12.2, 13.3);
    expect(onAddFreshSketch).toHaveBeenCalledOnce();
    await h.render({ sketch: structuredClone(graphSketch), documentVersion: 'two' });
    await act(async () => resolve());
    expect(h.error).not.toHaveBeenCalled(); expect(h.pending).toHaveBeenLastCalledWith(false);
    expect(container.querySelector('[data-cad-sketch-attachment]')).toBeNull();
  });
  it('places rectangle corners on actual endpoint and center targets without borrowing graph identities', async () => {
    const original = structuredClone(graphSketch);
    const h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'rectangle' });
    await h.pointer('pointermove', { ...h.position(2.2, 3.3), buttons: 0 });
    expect(container.querySelector('[data-cad-sketch-snap="a"]')).not.toBeNull();
    await h.click(2.2, 3.3); await h.click(12.2, 13.3);
    expect(h.added).toHaveBeenCalledWith({ kind: 'rectangle', x: 2.1, y: 3.2, width: 10, height: 10, cornerRadius: 0 }, expect.any(AbortSignal));
    expect(graphSketch).toEqual(original); expect(h.error).not.toHaveBeenCalled();
  });
  it('uses the analytic line midpoint for a circle center and suppresses magnets on the committing click', async () => {
    const h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'circle' });
    await h.pointer('pointermove', { ...h.position(12.2, 3.3), buttons: 0 });
    expect(container.querySelector('[data-cad-sketch-snap-kind="midpoint"]')).not.toBeNull();
    await h.click(12.2, 3.3); await h.click(17.1, 3.2, h.svg, { ctrlKey: true });
    expect(h.added).toHaveBeenCalledWith(expect.objectContaining({ kind: 'circle', x: 12.1, y: 3.2, radius: expect.closeTo(5, 10) }), expect.any(AbortSignal));
  });
  it.each(['ctrlKey', 'metaKey'] as const)('temporarily suppresses geometry and grid on %s without changing the stored setting', async modifier => {
    const h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'circle' });
    await h.pointer('pointermove', { ...h.position(2.2, 3.3), buttons: 0 });
    expect(container.querySelector('[data-cad-sketch-snap="a"]')).not.toBeNull();
    await h.click(2.2, 3.3, h.svg, { [modifier]: true }); await h.click(7.2, 3.3, h.svg, { [modifier]: true });
    expect(h.added).toHaveBeenCalledWith(expect.objectContaining({ kind: 'circle', x: expect.closeTo(2.2, 10), y: expect.closeTo(3.3, 10), radius: expect.closeTo(5, 10) }), expect.any(AbortSignal));
    expect(container.querySelector('[aria-label="Toggle snapping"]')?.getAttribute('aria-pressed')).toBe('true');
  });
  it('updates a stationary inference on modifier changes and invalidates captures when its visible meaning changes', async () => {
    const h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'rectangle' });
    await h.pointer('pointermove', { ...h.position(2.2, 3.3), buttons: 0 }); const before = h.frame();
    expect(container.querySelector('[data-cad-sketch-snap="a"]')).not.toBeNull();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, bubbles: true })));
    expect(container.querySelector('[data-cad-sketch-snap="a"]')).toBeNull(); expect(h.frame()).not.toBe(before);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true })));
    expect(container.querySelector('[data-cad-sketch-snap="a"]')).not.toBeNull();
    await act(async () => window.dispatchEvent(new Event('blur')));
    expect(container.querySelector('[data-cad-sketch-snap="a"]')).toBeNull(); expect(h.added).not.toHaveBeenCalled();
  });
  it('closes a polygon only on its acquired start, without swallowing a nearby fourth vertex', async () => {
    const h = await fixture([], { tool: 'polygon' });
    // At the default view 7 pixels is inside the old span-based closure zone.
    await h.click(0, 0); await h.click(30, 0); await h.click(30, 30);
    const span = Number(h.svg.getAttribute('viewBox')!.split(' ')[3]);
    await h.click(7 * span / 600, 0, h.svg, { ctrlKey: true }); expect(h.added).not.toHaveBeenCalled();
    await h.click(0, 0);
    expect(h.added).toHaveBeenCalledWith({ kind: 'polygon', points: [[0, 0], [30, 0], [30, 30], [expect.closeTo(7 * span / 600, 10), 0]] }, expect.any(AbortSignal));
  });
  it('clears a borrowed point hint when the accepted source changes before keyboard placement', async () => {
    const onAddPath = vi.fn(); const h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'path', onAddPath });
    await h.pointer('pointermove', { ...h.position(2.2, 3.3), buttons: 0 });
    expect(container.querySelector('[data-cad-sketch-snap="a"]')).not.toBeNull();
    await h.render({ parameters: { anchor: 100 } });
    expect(container.querySelector('[data-cad-sketch-snap="a"]')).toBeNull();
    await act(async () => h.svg.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
    await h.click(30, 30); const finish = container.querySelector<HTMLButtonElement>('[aria-label="Finish path"]');
    if (!finish) throw new Error('Missing Finish path'); await act(async () => finish.click());
    expect(onAddPath.mock.calls[0][0]).not.toHaveProperty('startPointId'); expect(h.error).not.toHaveBeenCalled();
  });
  it('retains an acquired off-grid Path endpoint after placement instead of inventing a grid segment on repeated Space', async () => {
    const onAddPath = vi.fn(); const h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'path', onAddPath });
    await h.pointer('pointermove', { ...h.position(2.2, 3.3), buttons: 0 });
    const key = async (value: string) => act(async () => h.svg.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
    await key(' '); await key(' ');
    expect(h.error).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Finish path"]')?.disabled).toBe(true);
    await key('ArrowRight'); await key(' ');
    const finish = container.querySelector<HTMLButtonElement>('[aria-label="Finish path"]'); if (!finish) throw new Error('Missing Finish path.');
    await act(async () => finish.click());
    expect(onAddPath).toHaveBeenCalledOnce();
    expect(onAddPath.mock.calls[0][0]).toMatchObject({ start: [2.1, 3.2], startPointId: 'a', segments: [{ kind: 'line', end: [7.1, 3.2] }] });
    expect(onAddPath.mock.calls[0][0].segments[0]).not.toHaveProperty('endPointId');
  });
  it('keeps pointer focus on the canvas while allowing profile keyboard activation', async () => {
    const h = await fixture([circle('circle', 0, 0, 10)]);
    const group = container.querySelector('[aria-label="Select circle profile"]');
    if (!group) throw new Error('Missing circle profile');
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    await act(async () => group.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(h.svg);
    await h.click(0, 0, group); expect(h.selected).toHaveBeenLastCalledWith('circle');
    await act(async () => group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(h.selected).toHaveBeenCalledTimes(2);
  });
  it('selects a tiny interior using raw coordinates even with grid snapping enabled', async () => {
    const profiles = [circle('tiny', 2, 2, 0.5)];
    const h = await fixture(profiles); await h.click(2, 2);
    expect(h.selected).toHaveBeenLastCalledWith('tiny');
    expect(h.added).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled();
    expect(profiles[0].geometry).toEqual({ kind: 'circle', x: 2, y: 2, radius: 0.5 });
  });

  it('selects an inner contour even when the physical event target is the selected outer fill', async () => {
    const h = await fixture([circle('outer', 0, 0, 30), circle('inner', 0, 0, 10)], { selectedProfileId: 'outer' });
    const outer = container.querySelector('[aria-label="Select outer profile"] circle')!;
    await h.click(0, 0, outer); expect(h.selected).toHaveBeenLastCalledWith('inner');
    await h.click(20, 0, outer); expect(h.selected).toHaveBeenLastCalledWith('outer');
    await h.click(40, 0); expect(h.selected).toHaveBeenLastCalledWith(null);
  });

  it('uses the updated pan and zoom transform with six screen pixels of outline tolerance', async () => {
    const h = await fixture([{ ...circle('guide', 0, 0, 10), construction: true }]);
    const initialBox = h.frame(); const initialSpan = Number(h.svg.getAttribute('viewBox')!.split(' ')[3]);
    await act(async () => h.svg.dispatchEvent(new MouseEvent('pointerdown', { button: 2, clientX: 410, clientY: 320, bubbles: true })));
    await act(async () => h.svg.dispatchEvent(new MouseEvent('pointermove', { buttons: 2, clientX: 510, clientY: 380, bubbles: true })));
    await act(async () => h.svg.dispatchEvent(new MouseEvent('pointerup', { button: 2, bubbles: true })));
    expect(h.frame()).not.toBe(initialBox);
    await h.click(10 + 5 * initialSpan / 600, 0); expect(h.selected).toHaveBeenLastCalledWith('guide');
    await act(async () => h.svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -Math.log(2) * 1000, bubbles: true })));
    expect(Number(h.svg.getAttribute('viewBox')!.split(' ')[3])).toBeCloseTo(initialSpan / 2);
    await h.click(10 + 5 * initialSpan / 2 / 600, 0); expect(h.selected).toHaveBeenLastCalledWith('guide');
    await h.click(10 + 7 * initialSpan / 2 / 600, 0); expect(h.selected).toHaveBeenLastCalledWith(null);
  });

  it('keeps keyboard and assistive activation while rejecting locked and non-left clicks', async () => {
    const h = await fixture([circle('circle', 0, 0, 10)]);
    const group = container.querySelector('[aria-label="Select circle profile"]')!;
    await h.click(0, 0, h.svg, { button: 2 });
    expect(h.selected).not.toHaveBeenCalled();
    await act(async () => group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(h.selected).toHaveBeenLastCalledWith('circle');
    await h.click(0, 0, group, { detail: 0 }); expect(h.selected).toHaveBeenCalledTimes(2);
    await h.render({ interactionLocked: true });
    await h.click(0, 0); await act(async () => group.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
    expect(h.selected).toHaveBeenCalledTimes(2);
  });

  it('preserves snapped drawing and pending state while selection creates no draft geometry', async () => {
    const h = await fixture([], { tool: 'rectangle' });
    await h.click(2, 2); expect(h.pending).toHaveBeenLastCalledWith(true);
    await h.click(12, 12);
    expect(h.added).toHaveBeenCalledWith({ kind: 'rectangle', x: 0, y: 0, width: 10, height: 10, cornerRadius: 0 }, expect.any(AbortSignal));
    expect(h.pending).toHaveBeenLastCalledWith(false); expect(h.selected).not.toHaveBeenCalled();
    await h.render({ tool: 'select' }); await h.click(2, 2);
    expect(h.added).toHaveBeenCalledTimes(1); expect(h.selected).toHaveBeenLastCalledWith(null);
  });
});

describe('sketch pan lifecycle', () => {
  it.each([{ button: 2, buttons: 2 }, { button: 1, buttons: 4 }])('stops when the original button is released ($button)', async ({ button, buttons }) => {
    const h = await fixture([]); const initial = h.frame();
    await h.pointer('pointerdown', { button, buttons });
    await h.pointer('pointermove', { clientX: 510, button, buttons });
    const moved = h.frame(); expect(moved).not.toBe(initial);
    await h.pointer('pointermove', { clientX: 610, buttons: 1 });
    await h.pointer('pointermove', { clientX: 710, button, buttons });
    expect(h.frame()).toBe(moved); expect(h.release).toHaveBeenCalledWith(11);
    expect(h.added).not.toHaveBeenCalled(); expect(h.selected).not.toHaveBeenCalled();
  });

  it('stops on window blur and allows a fresh drag', async () => {
    const h = await fixture([]); await h.pointer('pointerdown'); await h.pointer('pointermove', { clientX: 510 });
    const moved = h.frame();
    await act(async () => window.dispatchEvent(new Event('blur')));
    expect(h.release).toHaveBeenCalledWith(11); await h.pointer('pointermove', { clientX: 610 });
    expect(h.frame()).toBe(moved);
    await h.pointer('pointerdown'); await h.pointer('pointermove', { clientX: 510 });
    expect(h.frame()).not.toBe(moved);
  });

  it.each(['pointerup', 'pointercancel', 'lostpointercapture'])('only the active pointer may move or end pan on %s', async ending => {
    const h = await fixture([]); const initial = h.frame();
    await h.pointer('pointerdown'); await h.pointer('pointerdown', { clientX: 600 }, 22);
    expect(h.capture).toHaveBeenCalledTimes(1);
    await h.pointer('pointermove', { clientX: 700 }, 22); expect(h.frame()).toBe(initial);
    await h.pointer(ending, {}, 22); expect(h.release).not.toHaveBeenCalled();
    await h.pointer('pointermove', { clientX: 510 }); const moved = h.frame(); expect(moved).not.toBe(initial);
    await h.pointer(ending); await h.pointer('pointermove', { clientX: 710 });
    expect(h.frame()).toBe(moved); expect(h.release).toHaveBeenCalledTimes(1);
  });

  it('rejects secondary pointer starts and releases active capture when the canvas unmounts', async () => {
    const h = await fixture([]); const initial = h.frame();
    await h.pointer('pointerdown', {}, 22, false); await h.pointer('pointermove', { clientX: 510 }, 22, false);
    expect(h.frame()).toBe(initial); expect(h.capture).not.toHaveBeenCalled();
    await h.pointer('pointerdown'); await act(async () => root.render(null));
    expect(h.release).toHaveBeenCalledWith(11);
  });

  it('does not start an uncaptured drag if native capture fails', async () => {
    const h = await fixture([]); const initial = h.frame();
    h.capture.mockImplementationOnce(() => { throw new DOMException('Pointer no longer active', 'NotFoundError'); });
    await h.pointer('pointerdown'); await h.pointer('pointermove', { clientX: 510 });
    expect(h.frame()).toBe(initial); expect(h.error).not.toHaveBeenCalled();
  });
});

describe('sketch target context menus', () => {
  it('targets the innermost analytic profile without selecting it or adding geometry', async () => {
    const menu = vi.fn(); const h = await fixture([circle('outer', 0, 0, 30), circle('bore', 0, 0, 10)], { ...{ onContextMenu: menu } });
    const coordinates = h.position(2, 3);
    await h.pointer('pointerdown', coordinates); await h.pointer('pointerup', coordinates);
    expect(menu).toHaveBeenCalledExactlyOnceWith({ ...coordinates, trigger: 'pointer', profileId: 'bore', pointMm: [2, 3] });
    expect(h.selected).not.toHaveBeenCalled(); expect(h.added).not.toHaveBeenCalled();
  });
  it('keeps right drag as pan and requires the initiating pointer for a stationary menu', async () => {
    const menu = vi.fn(); const h = await fixture([circle('circle', 0, 0, 10)], { ...{ onContextMenu: menu } });
    const original = h.frame(); await h.pointer('pointerdown'); await h.pointer('pointerup', {}, 22);
    expect(menu).not.toHaveBeenCalled(); await h.pointer('pointerup'); expect(menu).toHaveBeenCalledTimes(1); menu.mockClear();
    await h.pointer('pointerdown'); await h.pointer('pointermove', { clientX: 510 }); expect(h.frame()).not.toBe(original);
    await h.pointer('pointermove', { clientX: 410 }); await h.pointer('pointerup'); expect(menu).not.toHaveBeenCalled();
  });
  it.each(['pointercancel', 'lostpointercapture', 'blur', 'document', 'cancelSignal', 'locked'] as const)('cancels stationary context ownership on %s', async cancellation => {
    const menu = vi.fn(); const h = await fixture([circle('circle', 0, 0, 10)], { ...{ onContextMenu: menu } });
    await h.pointer('pointerdown');
    if (cancellation === 'blur') await act(async () => window.dispatchEvent(new Event('blur')));
    else if (cancellation === 'document') await h.render({ sketch: { id: 'new_sketch', name: 'New', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [] } });
    else if (cancellation === 'cancelSignal') await h.render({ cancelSignal: 1 });
    else if (cancellation === 'locked') { await h.render({ interactionLocked: true }); await h.render({ interactionLocked: false }); }
    else await h.pointer(cancellation);
    await h.pointer('pointerup'); expect(menu).not.toHaveBeenCalled(); expect(h.added).not.toHaveBeenCalled();
  });
  it('supports profile keyboard menus, discards missing/invalid selection and respects workflow locks', async () => {
    const menu = vi.fn(); const h = await fixture([circle('circle', 0, 0, 10), { ...circle('invalid', 0, 0, 1), geometry: { kind: 'circle', x: 0, y: 0, radius: 'missing_radius' } }], { selectedProfileId: 'circle', ...{ onContextMenu: menu } });
    const key = async (key: string, shiftKey = false) => act(async () => h.svg.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })));
    await key('ContextMenu'); expect(menu).toHaveBeenLastCalledWith({ clientX: 410, clientY: 320, trigger: 'keyboard', profileId: 'circle', pointMm: [0, 0] });
    await key('F10', true); expect(menu).toHaveBeenCalledTimes(2);
    await h.render({ selectedProfileId: 'missing' }); await key('ContextMenu'); expect(menu.mock.calls.at(-1)?.[0].profileId).toBeNull();
    await h.render({ selectedProfileId: 'invalid' }); await key('ContextMenu'); expect(menu.mock.calls.at(-1)?.[0].profileId).toBeNull();
    await h.render({ interactionLocked: true }); const count = menu.mock.calls.length; await key('ContextMenu'); await h.pointer('pointerdown'); await h.pointer('pointerup'); expect(menu).toHaveBeenCalledTimes(count);
  });
});
