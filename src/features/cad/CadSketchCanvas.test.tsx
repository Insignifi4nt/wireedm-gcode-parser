import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadCurveFeature, CadSketchFeature } from '@/domain/cad/cadDocument';
import { importCadDxfSketch } from '@/domain/cad/cadDxfImport';
import type { EditorPreviewCapture } from '@/features/webmcp/previewCapture';
import { CadSketchCanvas } from './CadSketchCanvas';
import type { CadRenderedViewControls } from './cadViewportControls';

const rasterize = vi.hoisted(() => vi.fn());
vi.mock('@/features/editor/captureEditorPreview', () => ({ captureSvgPreview: rasterize }));
let root: Root;
let container: HTMLDivElement;
let controls: CadRenderedViewControls | null;
let notifyResize: () => void;
let width: number;
let height: number;
const image: EditorPreviewCapture = { dataUrl: 'data:image/png;base64,AA==', width: 1000, height: 500, source: '2d' };
const sketch: CadSketchFeature = { id: 'sketch', kind: 'sketch', name: 'Sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [] };
function currentControls() { if (!controls) throw new Error('Sketch controls unavailable'); return controls; }
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred not initialized'); };
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}
beforeEach(() => {
  width = 1000; height = 500; controls = null; rasterize.mockReset();
  notifyResize = () => { throw new Error('Resize observer not initialized'); };
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { notifyResize = callback; } observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () { return width; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () { return height; });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(feature = sketch, parameters: Readonly<Record<string, number>> = {}, tool: 'select' | 'circle' = 'select', onAddProfile = vi.fn()) {
  await act(async () => root.render(<CadSketchCanvas sketch={feature} parameters={parameters} tool={tool} selectedProfileId={null}
    onSelectProfile={vi.fn()} onAddProfile={onAddProfile} onPendingChange={vi.fn()} onError={vi.fn()} cancelSignal={0}
    onControlsReady={value => { controls = value; }} />));
}
describe('sketch preview capture layout', () => {
  it('renders a datum Curve in unchanged local coordinates and publishes a frozen accepted reference', async () => {
    const feature: CadCurveFeature = { id: 'rail', name: 'Rail', kind: 'curve', suppressed: false, plane: { kind: 'datum-plane', featureId: 'mount' }, offset: 4,
      segments: [{ kind: 'line', start: [2, 3], end: [12, 3] }] };
    await act(async () => root.render(<CadSketchCanvas sketch={feature} parameters={{}} placementLabel="Mount" tool="select" selectedProfileId={null}
      onSelectProfile={vi.fn()} onAddProfile={vi.fn()} onPendingChange={vi.fn()} onError={vi.fn()} cancelSignal={0} onControlsReady={value => { controls = value; }} />));
    expect(container.querySelector('.cad-plane-label')?.textContent).toBe('Mount');
    expect(container.querySelector('.cad-profile line')?.getAttribute('x1')).toBe('2');
    const state = currentControls().getState(); expect(state).toMatchObject({ mode: 'curve', plane: feature.plane, centerMm: [7, 3] });
    if (state.mode === 'solid') throw new Error('Curve view unavailable'); expect(Object.isFrozen(state.plane)).toBe(true);
    rasterize.mockResolvedValue(image); await expect(currentControls().capture(new AbortController().signal)).resolves.toBe(image);
  });
  it('measures the visible aspect before publishing controls so initial observer delivery cannot stale capture', async () => {
    await mount(); expect(currentControls().getState().available).toBe(true);
    const rendered = container.querySelector('svg');
    expect(rendered?.getAttribute('viewBox')).toBe('-160 -80 320 160');
    const pending = deferred<EditorPreviewCapture>(); rasterize.mockReturnValue(pending.promise);
    const operation = currentControls().capture(new AbortController().signal);
    await act(async () => notifyResize());
    pending.resolve(image); await expect(operation).resolves.toBe(image);
  });
  it('still rejects a real resize while SVG pixels are rasterizing', async () => {
    await mount(); const pending = deferred<EditorPreviewCapture>(); rasterize.mockReturnValue(pending.promise);
    const operation = currentControls().capture(new AbortController().signal);
    await act(async () => { width = 1200; notifyResize(); });
    pending.resolve(image); await expect(operation).rejects.toMatchObject({ code: 'STALE_VIEW' });
  });
  it('still rejects a grid change while SVG pixels are rasterizing', async () => {
    await mount(); const pending = deferred<EditorPreviewCapture>(); rasterize.mockReturnValue(pending.promise);
    const operation = currentControls().capture(new AbortController().signal);
    await act(async () => currentControls().setGrid(false));
    pending.resolve(image); await expect(operation).rejects.toMatchObject({ code: 'STALE_VIEW' });
  });
});

describe('saved Sketch initial fit', () => {
  it.each(['sketch', 'curve'] as const)('fits far-origin %s contours inside current free pixels and does not reframe on inspector changes', async kind => {
    width = 900; height = 800;
    const feature: CadSketchFeature | CadCurveFeature = kind === 'sketch' ? imported() : { id: 'far-curve', kind: 'curve', name: 'Far curve', suppressed: false, plane: 'XY', offset: 0,
      segments: [{ kind: 'line', start: [100000000, 100000000], end: [100000100, 100000010] }] };
    let area = { left: 0, top: 0, width: 560, height: 800 };
    const getFitArea = () => area;
    const render = async () => act(async () => root.render(<CadSketchCanvas sketch={feature} parameters={{}} tool="select" selectedProfileId={null}
      onSelectProfile={vi.fn()} onAddProfile={vi.fn()} onPendingChange={vi.fn()} onError={vi.fn()} cancelSignal={0} getFitArea={getFitArea}
      onControlsReady={value => { controls = value; }} />));
    await render();
    const check = () => {
      const state = currentControls().getState(); if (state.mode === 'solid') throw new Error('Expected sketch view');
      const scale = height / state.heightSpanMm;
      const x = (mm: number) => width / 2 + (mm - state.centerMm[0]) * scale;
      const y = (mm: number) => height / 2 - (mm - state.centerMm[1]) * scale;
      expect(x(100000000)).toBeGreaterThanOrEqual(area.left);
      expect(x(100000100)).toBeLessThanOrEqual(area.left + area.width);
      expect(y(100000000)).toBeLessThanOrEqual(area.top + area.height);
      expect(y(100000010)).toBeGreaterThanOrEqual(area.top);
    };
    check(); const before = currentControls().getState();
    area = { left: 0, top: 35, width: 900, height: 765 }; await render();
    expect(currentControls().getState()).toEqual(before);
    await act(async () => currentControls().fit()); check();
    area = { left: 0, top: 0, width: 900, height: 800 }; const minimized = currentControls().getState(); await render();
    expect(currentControls().getState()).toEqual(minimized);
    await act(async () => currentControls().fit()); check();
    expect(currentControls().getState()).toMatchObject({ centerMm: [100000050, 100000005] });
  });
  const original = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '90', '4', '70', '1',
    '10', '100000000', '20', '100000000', '10', '100000100', '20', '100000000', '10', '100000100', '20', '100000010', '10', '100000000', '20', '100000010', '0', 'ENDSEC', '0', 'EOF', ''].join('\r\n');
  const imported = () => importCadDxfSketch({ fileName: 'Far.dxf', text: original, units: 'mm', sketchId: 'far' }).sketch;
  it.each([[1000, 500], [300, 700]])('fits imported far-origin contours using the measured %s×%s aspect before first capture', async (w, h) => {
    width = w; height = h; const feature = imported(); await mount(feature);
    const state = currentControls().getState(); expect(state).toMatchObject({ mode: 'sketch', centerMm: [100000050, 100000005], available: true });
    if (state.mode === 'solid') throw new Error('Sketch view missing'); expect(state.heightSpanMm).toBeCloseTo(Math.max(20, 10, 100 / (w / h)) * 1.25);
    const pending = deferred<EditorPreviewCapture>(); rasterize.mockReturnValue(pending.promise); const capture = currentControls().capture(new AbortController().signal);
    await act(async () => notifyResize()); pending.resolve(image); await expect(capture).resolves.toBe(image);
    expect(feature.source?.text).toBe(original);
  });
  it('positions the initial keyboard cursor in the fitted Sketch and creates a visible numeric circle', async () => {
    const feature = imported(); const added = vi.fn(); await mount(feature); await mount(feature, {}, 'circle', added);
    const svg = container.querySelector('svg.cad-sketch-canvas'); if (!svg) throw new Error('Canvas missing');
    for (const key of [' ', 'ArrowRight', ' ']) await act(async () => svg.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    expect(added).toHaveBeenCalledWith({ kind: 'circle', x: 100000050, y: 100000005, radius: 5 }); expect(feature.source?.text).toBe(original);
  });
  it('retains the view and keyboard cursor on dimension changes, resize and manual Fit', async () => {
    const feature: CadSketchFeature = { ...sketch, profiles: [{ id: 'rectangle', name: 'Rectangle', construction: false,
      geometry: { kind: 'rectangle', x: 100000000, y: 100000000, width: 'width', height: 10, cornerRadius: 0 } }] };
    const added = vi.fn(); await mount(feature, { width: 20 }, 'circle', added); const before = currentControls().getState();
    await mount(feature, { width: 400 }, 'circle', added); expect(currentControls().getState()).toEqual(before);
    await act(async () => { width = 300; height = 700; notifyResize(); }); const resized = currentControls().getState();
    expect(resized).toMatchObject({ centerMm: [100000010, 100000005], heightSpanMm: 25 });
    await act(async () => currentControls().fit()); expect(currentControls().getState()).toMatchObject({ centerMm: [100000200, 100000005] });
    const svg = container.querySelector('svg.cad-sketch-canvas'); if (!svg) throw new Error('Canvas missing');
    for (const key of [' ', 'ArrowRight', ' ']) await act(async () => svg.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    expect(added).toHaveBeenCalledWith({ kind: 'circle', x: 100000010, y: 100000005, radius: 5 });
  });
  it('keeps new empty sketches at the original view when their first contour is accepted', async () => {
    await mount(); const before = currentControls().getState();
    await mount({ ...sketch, profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 5000, y: 6000, radius: 2 } }] });
    expect(currentControls().getState()).toEqual(before); await act(async () => currentControls().fit()); expect(currentControls().getState()).toMatchObject({ centerMm: [5000, 6000] });
  });
});

describe('sketch mouse and trackpad navigation', () => {
  async function harness() {
    const add = vi.fn(), select = vi.fn();
    const show = async (navigationMode: 'mouse' | 'trackpad' = 'mouse', viewLocked = false) => act(async () => root.render(<CadSketchCanvas sketch={sketch} parameters={{}} tool="circle" selectedProfileId={null}
      {...{ navigationMode }} viewLocked={viewLocked} onSelectProfile={select} onAddProfile={add} onPendingChange={vi.fn()} onError={vi.fn()} cancelSignal={0} onControlsReady={value => { controls = value; }} />));
    await show(); const canvas = container.querySelector<SVGSVGElement>('.cad-sketch-canvas'); if (!canvas) throw new Error('Sketch canvas missing');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, right: 1010, bottom: 520, width: 1000, height: 500, x: 10, y: 20, toJSON: () => ({}) });
    const wheel = async (init: WheelEventInit, target: Element = canvas) => { const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 760, clientY: 145, ...init }); await act(async () => target.dispatchEvent(event)); return event; };
    const state = () => { const state = currentControls().getState(); if (state.mode === 'solid') throw new Error('Sketch state missing'); return state; };
    return { show, canvas, wheel, state, add, select };
  }
  it('pans two-finger wheel at sketch scale, normalizes line/page units and never creates drawing geometry', async () => {
    const h = await harness(); await h.show('trackpad');
    await h.wheel({ deltaX: 25, deltaY: 10 }); expect(h.state()).toMatchObject({ centerMm: [8, -3.2], heightSpanMm: 160 });
    await h.wheel({ deltaX: -25, deltaY: -10 }); expect(h.state().centerMm).toEqual([0, 0]);
    await h.wheel({ deltaX: 1, deltaY: 1, deltaMode: 1 }); expect(h.state().centerMm).toEqual([5.12, -5.12]);
    await h.wheel({ deltaX: -.016, deltaY: -.032, deltaMode: 2, altKey: true }); expect(h.state().centerMm).toEqual([0, 0]);
    expect(h.add).not.toHaveBeenCalled(); expect(h.select).not.toHaveBeenCalled();
  });
  it('keeps sketch coordinates beneath the cursor fixed while pinching and preserves mouse-wheel zoom', async () => {
    const h = await harness(); await h.show('trackpad'); const initial = h.state();
    const pointUnderCursor = () => { const state = h.state(); return [state.centerMm[0] + state.heightSpanMm * .5, state.centerMm[1] + state.heightSpanMm * .25]; };
    const anchor = pointUnderCursor(); const event = await h.wheel({ deltaY: -30, ctrlKey: true });
    expect(event.defaultPrevented).toBe(true); expect(h.state().heightSpanMm).toBeLessThan(initial.heightSpanMm);
    pointUnderCursor().forEach((value, index) => expect(value).toBeCloseTo(anchor[index], 10));
    await h.show(); const before = h.state(); await h.wheel({ deltaY: 100 }); expect(h.state().heightSpanMm).toBeGreaterThan(before.heightSpanMm);
    pointUnderCursor().forEach((value, index) => expect(value).toBeCloseTo(anchor[index], 10));
  });
  it('keeps locked views stable and leaves panel scrolling alone, with wheel changes invalidating captures', async () => {
    const h = await harness(); await h.show('trackpad', true); const locked = h.state();
    await h.wheel({ deltaY: -30, ctrlKey: true }); await h.wheel({ deltaX: 20, deltaY: 20 }); expect(h.state()).toEqual(locked);
    await h.show('trackpad'); const outside = await h.wheel({ deltaY: 20 }, container); expect(outside.defaultPrevented).toBe(false); expect(h.state()).toEqual(locked);
    const pending = deferred<EditorPreviewCapture>(); rasterize.mockReturnValue(pending.promise); const capture = currentControls().capture(new AbortController().signal);
    await h.wheel({ deltaX: 20 }); pending.resolve(image); await expect(capture).rejects.toMatchObject({ code: 'STALE_VIEW' });
  });
});
