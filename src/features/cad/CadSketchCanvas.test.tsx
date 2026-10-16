import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadCurveFeature, CadSketchFeature } from '@/domain/cad/cadDocument';
import { importCadDxfSketch } from '@/domain/cad/cadDxfImport';
import type { EditorPreviewCapture } from '@/features/webmcp/previewCapture';
import { CadSketchCanvas } from './CadSketchCanvas';
import type { CadRenderedViewControls } from './cadViewportControls';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import type { CadSketchGraphSelection } from './cadSketchGraphSelection';

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
    expect(container.querySelector('.cad-profile line')?.getAttribute('x1')).toBe('0');
    expect(container.querySelector('.cad-profile line')?.getAttribute('x2')).toBe('10');
    expect(container.querySelector('[data-cad-path-segments]')?.getAttribute('transform')).toBe('translate(-5,0)');
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
  it('fits an isolated graph point at its evaluated coordinates even without an edge', async () => {
    await mount({ ...sketch, graph: { points: [{ id: 'anchor', position: ['origin', 20] }], entities: [], relations: [] } }, { origin: 100000000 });
    expect(currentControls().getState()).toMatchObject({ mode: 'sketch', centerMm: [100000000, 20], heightSpanMm: 25 });
  });
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
    expect(added).toHaveBeenCalledWith({ kind: 'circle', x: 100000050, y: 100000005, radius: 5 }, expect.any(AbortSignal)); expect(feature.source?.text).toBe(original);
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
    expect(added).toHaveBeenCalledWith({ kind: 'circle', x: 100000010, y: 100000005, radius: 5 }, expect.any(AbortSignal));
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

describe('graph spatial selection', () => {
  async function spatialFixture(pointCount?: number) {
    const feature: CadSketchFeature = { ...sketch, graph: { points: pointCount
      ? Array.from({ length: pointCount }, (_, i) => ({ id: `p${i}`, position: [i, 0] }))
      : [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [30, 20] }],
    entities: pointCount ? [] : [
      { id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
      { id: 'bc', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' },
    ], relations: [] } };
    const document = { ...createCadDocument('Spatial selection'), schemaVersion: 2 as const, features: [feature] };
    const selected = vi.fn(), selectedSet = vi.fn(), edited = vi.fn(), deleted = vi.fn(), pending = vi.fn(), error = vi.fn();
    let props: ComponentProps<typeof CadSketchCanvas> = { sketch: feature, parameters: document.parameters, documentVersion: 'one', tool: 'select', selectedProfileId: null,
      onSelectProfile: vi.fn(), onAddProfile: vi.fn(), onPendingChange: pending, onError: error, cancelSignal: 0,
      onControlsReady: value => { controls = value; }, graphControls: { document, selection: [], onSelect: selected, onSelectSet: selectedSet, onDelete: deleted, onEditMany: edited } };
    const show = async (next: Partial<typeof props> = {}) => { props = { ...props, ...next }; await act(async () => root.render(<CadSketchCanvas {...props} />)); };
    await show();
    const canvas = container.querySelector<SVGSVGElement>('.cad-sketch-canvas'); if (!canvas) throw new Error('Canvas missing.');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, right: 1010, bottom: 520, width: 1000, height: 500, x: 10, y: 20, toJSON: () => ({}) });
    const held = new Set<number>(), release = vi.fn();
    Object.assign(canvas, { setPointerCapture: (id: number) => held.add(id), hasPointerCapture: (id: number) => held.has(id),
      releasePointerCapture: (id: number) => { held.delete(id); release(id); } });
    const pointer = async (type: string, x: number, y: number, shiftKey = false, pointerId = 7, button = 0) => {
      const state = currentControls().getState(); if (state.mode === 'solid') throw new Error('Sketch state missing.');
      const event = new MouseEvent(type, { button, buttons: type === 'pointerup' ? 0 : button === 2 ? 2 : 1, bubbles: true, cancelable: true, shiftKey,
        clientX: 510 + (x - state.centerMm[0]) / (state.heightSpanMm * 2) * 1000,
        clientY: 270 - (y - state.centerMm[1]) / state.heightSpanMm * 500 });
      Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true } });
      await act(async () => canvas.dispatchEvent(event));
    };
    return { feature, props: () => props, show, canvas, pointer, selected, selectedSet, edited, deleted, pending, error, release };
  }
  it('previews containment then publishes one complete set on release without creating an edit', async () => {
    const h = await spatialFixture();
    await h.pointer('pointerdown', -2, -2); await h.pointer('pointermove', 12, 2);
    expect(h.selectedSet).not.toHaveBeenCalled(); expect(h.pending).toHaveBeenLastCalledWith(true);
    await h.pointer('pointerup', 12, 2);
    expect(h.selectedSet).toHaveBeenCalledExactlyOnceWith([{ kind: 'point', id: 'a' }, { kind: 'point', id: 'b' }, { kind: 'entity', id: 'ab' }]);
    expect(h.edited).not.toHaveBeenCalled(); expect(h.pending).toHaveBeenLastCalledWith(false);
    await act(async () => h.canvas.dispatchEvent(new MouseEvent('click', { button: 0, detail: 1, bubbles: true })));
    expect(h.selected).not.toHaveBeenCalled();
    await h.show({ graphControls: { ...h.props().graphControls!, selection: h.selectedSet.mock.calls[0][0] } });
    await act(async () => h.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })));
    expect(h.deleted).toHaveBeenCalledExactlyOnceWith({ kind: 'entity', id: 'ab' });
  });
  it('invalidates an in-flight capture when diagnostic operand highlighting changes', async () => {
    const h = await spatialFixture();
    const pending = deferred<EditorPreviewCapture>(); rasterize.mockReturnValue(pending.promise);
    const capture = currentControls().capture(new AbortController().signal);
    await h.show({ graphControls: { ...h.props().graphControls!, inspection: { pointIds: ['a', 'b'], entityIds: ['ab'] } } });
    pending.resolve(image); await expect(capture).rejects.toMatchObject({ code: 'STALE_VIEW' });
    expect(h.selectedSet).not.toHaveBeenCalled(); expect(h.edited).not.toHaveBeenCalled();
  });
  it('invalidates a pre-drag capture even when a snapped gesture cancels before rasterization finishes', async () => {
    const h = await spatialFixture();
    await h.show({ graphControls: { ...h.props().graphControls!, selection: [{ kind: 'point', id: 'a' }], onPrepareEdits: () => new Promise(() => {}) } });
    const point = container.querySelector<SVGGElement>('[data-cad-sketch-point="a"]'); if (!point) throw new Error('Graph point missing.');
    let held = false;
    Object.assign(point, { setPointerCapture: () => { held = true; }, hasPointerCapture: () => held, releasePointerCapture: () => { held = false; } });
    const pointer = async (type: string, x: number, y: number) => {
      const state = currentControls().getState(); if (state.mode === 'solid') throw new Error('Sketch frame missing.');
      const event = new MouseEvent(type, { button: 0, buttons: 1, bubbles: true, cancelable: true,
        clientX: 510 + (x - state.centerMm[0]) / (state.heightSpanMm * 2) * 1000,
        clientY: 270 - (y - state.centerMm[1]) / state.heightSpanMm * 500 });
      Object.defineProperties(event, { pointerId: { value: 11 }, isPrimary: { value: true } });
      await act(async () => point.dispatchEvent(event));
    };
    const pending = deferred<EditorPreviewCapture>(); rasterize.mockReturnValue(pending.promise);
    const capture = currentControls().capture(new AbortController().signal);
    await pointer('pointerdown', 0, 0); await pointer('pointermove', 29.9, 20.1);
    expect(container.querySelector('[data-cad-sketch-snap="c"]')).not.toBeNull();
    await act(async () => point.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(h.pending).toHaveBeenLastCalledWith(false); expect(h.edited).not.toHaveBeenCalled();
    pending.resolve(image); await expect(capture).rejects.toMatchObject({ code: 'STALE_VIEW' });
  });
  it('uses right-to-left crossing and toggles against the captured base only once', async () => {
    const h = await spatialFixture();
    await h.show({ graphControls: { ...h.props().graphControls!, selection: [{ kind: 'point', id: 'a' }] } });
    await h.pointer('pointerdown', 12, 3, true); await h.pointer('pointermove', -2, -2, true); await h.pointer('pointermove', -2, -2, true);
    await h.pointer('pointerup', -2, -2, true);
    expect(h.selectedSet).toHaveBeenCalledExactlyOnceWith([{ kind: 'point', id: 'b' }, { kind: 'entity', id: 'ab' }, { kind: 'entity', id: 'bc' }]);
  });
  it('cancels on Escape, source change and spatial resize without publishing a partial selection', async () => {
    const h = await spatialFixture();
    for (const ending of ['escape', 'source', 'resize'] as const) {
      await h.pointer('pointerdown', -2, -2); await h.pointer('pointermove', 12, 2);
      if (ending === 'escape') await act(async () => h.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
      else if (ending === 'source') await h.show({ documentVersion: 'two' });
      else await act(async () => { width = 800; notifyResize(); });
      await h.pointer('pointerup', 12, 2);
      await act(async () => h.canvas.dispatchEvent(new MouseEvent('click', { button: 0, detail: 1, bubbles: true })));
      expect(h.selectedSet).not.toHaveBeenCalled(); expect(h.pending).toHaveBeenLastCalledWith(false);
      expect(h.selected).not.toHaveBeenCalled();
    }
    expect(h.release).toHaveBeenCalledTimes(3);
  });
  it('filters box operands without clearing the prior selection and exposes the same rendered control', async () => {
    const h = await spatialFixture();
    await act(async () => currentControls().setSketchPickFilter?.('points'));
    expect(currentControls().getState()).toMatchObject({ sketchPickFilter: 'points' });
    expect(h.selectedSet).not.toHaveBeenCalled();
    await h.pointer('pointerdown', -2, -2); await h.pointer('pointermove', 12, 2); await h.pointer('pointerup', 12, 2);
    expect(h.selectedSet).toHaveBeenCalledExactlyOnceWith([{ kind: 'point', id: 'a' }, { kind: 'point', id: 'b' }]);
  });
  it('keeps legacy profiles visible but prevents their grip and keyboard editing in a point-only filter', async () => {
    const h = await spatialFixture(), selectProfile = vi.fn(), move = vi.fn();
    const profile = { id: 'legacy', name: 'Legacy rectangle', construction: false, geometry: { kind: 'rectangle' as const, x: -30, y: 0, width: 10, height: 10, cornerRadius: 0 } };
    await h.show({ sketch: { ...h.feature, profiles: [profile] }, selectedProfileId: profile.id, onSelectProfile: selectProfile, onMoveHandle: move });
    await act(async () => currentControls().setSketchPickFilter?.('points'));
    const element = container.querySelector('[aria-label="Select Legacy rectangle profile"]'); if (!element) throw new Error('Legacy geometry missing.');
    expect(element.getAttribute('tabindex')).toBe('-1');
    await act(async () => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(selectProfile).not.toHaveBeenCalled(); expect(move).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[data-cad-sketch-grip]')).toHaveLength(0);
    await h.pointer('pointerdown', -5, -5); await h.pointer('pointerup', -5, -5);
    await act(async () => h.canvas.dispatchEvent(new MouseEvent('click', { button: 0, detail: 1, bubbles: true, clientX: 100, clientY: 100 })));
    expect(selectProfile).toHaveBeenCalledExactlyOnceWith(null);
  });
  it('cancels a box when a competing pointer starts without accepting either gesture', async () => {
    const h = await spatialFixture();
    await h.pointer('pointerdown', -2, -2); await h.pointer('pointermove', 12, 2);
    await h.pointer('pointerdown', 20, 15, false, 8); await h.pointer('pointerup', 12, 2);
    expect(h.selectedSet).not.toHaveBeenCalled(); expect(h.release).toHaveBeenCalledOnce();
    expect(h.pending).toHaveBeenLastCalledWith(false);
  });
  it('rejects an oversized box atomically instead of truncating its targets', async () => {
    const h = await spatialFixture(65);
    await h.pointer('pointerdown', -1, -1); await h.pointer('pointermove', 65, 1); await h.pointer('pointerup', 65, 1);
    expect(h.selectedSet).not.toHaveBeenCalled(); expect(h.error).toHaveBeenCalledWith(expect.stringContaining('64'));
    expect(h.pending).toHaveBeenLastCalledWith(false); expect(h.edited).not.toHaveBeenCalled();
  });
  it('validates the final Shift result without rejecting a temporary intermediate count', async () => {
    const h = await spatialFixture(65);
    const selection: readonly CadSketchGraphSelection[] = Array.from({ length: 64 }, (_, i) => ({ kind: 'point', id: `p${i + 1}` }));
    await h.show({ graphControls: { ...h.props().graphControls!, selection } });
    await h.pointer('pointerdown', -1, -1, true); await h.pointer('pointermove', 1.4, .8, true); await h.pointer('pointerup', 1.4, .8, true);
    expect(h.selectedSet).toHaveBeenCalledExactlyOnceWith([...selection.slice(1), { kind: 'point', id: 'p0' }]);
    expect(h.error).not.toHaveBeenCalled();
  });
  it('offers exact overlapping operands on right click and commits only the chosen target', async () => {
    const h = await spatialFixture();
    await h.pointer('pointerdown', 10, 0, true, 7, 2); await h.pointer('pointerup', 10, 0, true, 7, 2);
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const edge = items.find(item => item.textContent?.startsWith('Line 2'));
    expect(edge).toBeDefined(); expect(h.pending).toHaveBeenLastCalledWith(true);
    expect(h.selected).not.toHaveBeenCalled(); expect(h.selectedSet).not.toHaveBeenCalled();
    await act(async () => edge?.focus());
    expect(container.querySelector('[data-cad-sketch-entity="bc"]')?.classList.contains('is-pick-highlighted')).toBe(true);
    await act(async () => edge?.click());
    expect(h.selected).toHaveBeenCalledExactlyOnceWith({ kind: 'entity', id: 'bc' }, true);
    expect(document.activeElement).toBe(container.querySelector('[data-cad-sketch-entity="bc"]'));
    expect(h.pending).toHaveBeenLastCalledWith(false); expect(h.edited).not.toHaveBeenCalled();
  });
  it('previews an exact off-grid split at the owned cursor and submits the same named joint once', async () => {
    const h = await spatialFixture(), original = structuredClone(h.feature), operation = deferred<void>(); h.edited.mockReturnValue(operation.promise);
    await h.pointer('pointerdown', 5.3, .1, false, 7, 2); await h.pointer('pointerup', 5.3, .1, false, 7, 2);
    const split = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === 'Split here');
    expect(split).toBeDefined(); expect(split?.disabled).toBe(false); expect(h.edited).not.toHaveBeenCalled();
    const joint = container.querySelector('[data-cad-sketch-split-point]'); expect(joint).not.toBeNull();
    const pointId = joint?.getAttribute('data-cad-sketch-split-point');
    await act(async () => split?.click());
    expect(h.edited).toHaveBeenCalledExactlyOnceWith([{ kind: 'split-sketch-entity', sketchId: h.feature.id, split: {
      kind: 'line', entityId: 'ab', parameter: expect.closeTo(.53, 12), splitPointId: pointId,
      newEntityId: expect.any(String), supportRelationId: expect.any(String)
    } }], expect.any(AbortSignal));
    const graphControls = h.props().graphControls; if (!graphControls) throw new Error('Graph controls missing.');
    const acceptedDocument = applyCadEdits(graphControls.document, h.edited.mock.calls[0][0]), feature = acceptedDocument.features[0];
    if (feature.kind !== 'sketch') throw new Error('Accepted sketch missing.');
    await h.show({ sketch: feature, documentVersion: 'accepted', graphControls: { ...graphControls, document: acceptedDocument } });
    expect(h.edited.mock.calls[0][1].aborted).toBe(false); expect(h.selected).not.toHaveBeenCalled();
    await act(async () => operation.resolve(undefined));
    expect(h.feature).toEqual(original); expect(h.pending).toHaveBeenLastCalledWith(false);
    expect(h.selected).toHaveBeenLastCalledWith({ kind: 'point', id: pointId });
  });
  async function trimFixture() {
    const h = await spatialFixture(), graph = h.feature.graph!;
    const feature: CadSketchFeature = { ...h.feature, graph: { ...graph,
      points: [...graph.points, { id: 'fence-start', position: [4, -5] }, { id: 'fence-end', position: [4, 5] }],
      entities: [...graph.entities, { id: 'fence', kind: 'line', construction: true, startPointId: 'fence-start', endPointId: 'fence-end' }] } };
    await h.show({ sketch: feature, graphControls: { ...h.props().graphControls!, document: { ...h.props().graphControls!.document, features: [feature] } } });
    const open = async () => { await h.pointer('pointerdown', 2, .1, false, 7, 2); await h.pointer('pointerup', 2, .1, false, 7, 2); };
    return { ...h, feature, open };
  }
  it('previews end Trim separately from Split and commits its pinned intersection once', async () => {
    const h = await trimFixture(), operation = deferred<void>(); h.edited.mockReturnValue(operation.promise);
    await h.open();
    const trim = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === 'Trim here');
    expect(trim).toBeDefined(); expect(trim?.disabled).toBe(false); expect(h.edited).not.toHaveBeenCalled();
    await act(async () => trim?.focus());
    expect(container.querySelector('[data-cad-sketch-split-point]')).toBeNull();
    const preview = container.querySelector('[aria-label="Trim preview"]'); expect(preview).not.toBeNull();
    const view = currentControls().getState(); if (view.mode === 'solid') throw new Error('Sketch view missing.');
    expect(Number(preview?.querySelector('.is-removed')?.getAttribute('x2')) + view.centerMm[0]).toBe(4);
    expect(Number(preview?.querySelector('.is-retained')?.getAttribute('x1')) + view.centerMm[0]).toBe(4);
    const pointId = preview?.querySelector('[data-cad-sketch-trim-point]')?.getAttribute('data-cad-sketch-trim-point');
    expect(trim?.getAttribute('aria-description')).toMatch(/one-time|one time/i);
    await act(async () => trim?.click());
    expect(h.edited).toHaveBeenCalledExactlyOnceWith([{ kind: 'trim-sketch-entity', sketchId: h.feature.id, trim: {
      kind: 'end', entityId: 'ab', parameter: expect.closeTo(.2, 12), end: 'start', cutPointId: pointId,
      boundary: { entityId: 'fence', index: 0, parameter: .4, position: [4, 0] }
    } }], expect.any(AbortSignal));
    const acceptedDocument = applyCadEdits(h.props().graphControls!.document, h.edited.mock.calls[0][0]), accepted = acceptedDocument.features[0];
    if (accepted.kind !== 'sketch') throw new Error('Accepted trim missing.');
    expect(accepted.graph?.entities[0]).toMatchObject({ id: 'ab', startPointId: pointId, endPointId: 'b' });
    expect(accepted.graph?.points.slice(0, 5)).toEqual(h.feature.graph?.points);
    await h.show({ sketch: accepted, documentVersion: 'accepted', graphControls: { ...h.props().graphControls!, document: acceptedDocument } });
    await act(async () => operation.resolve(undefined));
    expect(h.selected).toHaveBeenLastCalledWith({ kind: 'point', id: pointId }); expect(h.pending).toHaveBeenLastCalledWith(false);
  });
  it('previews no-hit Trim as complete edge removal and retains source after dismissal', async () => {
    const h = await spatialFixture();
    await h.pointer('pointerdown', 5, .1, false, 7, 2); await h.pointer('pointerup', 5, .1, false, 7, 2);
    const trim = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === 'Trim here');
    expect(trim).toBeDefined(); await act(async () => trim?.focus());
    expect(container.querySelector('[aria-label="Trim preview"] .is-removed')).not.toBeNull();
    expect(container.querySelector('[aria-label="Trim preview"] .is-retained')).toBeNull();
    expect(trim?.getAttribute('aria-description')).toMatch(/whole edge/i);
    await act(async () => document.querySelector('[role="menu"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(h.edited).not.toHaveBeenCalled(); expect(h.selected).not.toHaveBeenCalled(); expect(h.pending).toHaveBeenLastCalledWith(false);
  });
  it('blocks end Trim with the actual detached endpoint owner and cancels a late trim receipt on blur', async () => {
    const h = await trimFixture(), feature = { ...h.feature, graph: { ...h.feature.graph!, relations: [{ id: 'anchor', kind: 'fixed-axis' as const, pointId: 'a', axis: 'x' as const, value: 0 }] } };
    await h.show({ sketch: feature, graphControls: { ...h.props().graphControls!, document: { ...h.props().graphControls!.document, features: [feature] } } });
    await h.open();
    let trim = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === 'Trim here');
    expect(trim).toBeDefined(); expect(trim?.disabled).toBe(true); expect(trim?.getAttribute('aria-description')).toMatch(/Point 1/);
    await act(async () => document.querySelector('[role="menu"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await h.show({ sketch: h.feature, graphControls: { ...h.props().graphControls!, document: { ...h.props().graphControls!.document, features: [h.feature] } } });
    const operation = deferred<void>(); h.edited.mockReturnValue(operation.promise); await h.open();
    trim = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === 'Trim here');
    await act(async () => trim?.click());
    const signal: unknown = h.edited.mock.calls[0]?.[1]; expect(signal).toBeInstanceOf(AbortSignal);
    await act(async () => window.dispatchEvent(new Event('blur')));
    expect((signal as AbortSignal).aborted).toBe(true); await act(async () => operation.resolve(undefined));
    expect(h.selected).not.toHaveBeenCalled(); expect(h.pending).toHaveBeenLastCalledWith(false);
  });
  it('does not apply a cut after the actual SVG frame moves while its menu is open', async () => {
    const h = await spatialFixture();
    await h.pointer('pointerdown', 5, .1, false, 7, 2); await h.pointer('pointerup', 5, .1, false, 7, 2);
    const split = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === 'Split here');
    expect(split).toBeDefined();
    vi.mocked(h.canvas.getBoundingClientRect).mockReturnValue({ left: 20, top: 20, right: 1020, bottom: 520, width: 1000, height: 500, x: 20, y: 20, toJSON: () => ({}) });
    await act(async () => split?.click()); expect(h.edited).not.toHaveBeenCalled(); expect(h.pending).toHaveBeenLastCalledWith(false);
  });
  it.each(['frame', 'blur', 'lock'] as const)('cancels an applying split on %s and ignores its late joint selection', async ending => {
    const h = await spatialFixture(), resize = notifyResize, operation = deferred<void>(); h.edited.mockReturnValue(operation.promise);
    await h.pointer('pointerdown', 5, .1, false, 7, 2); await h.pointer('pointerup', 5, .1, false, 7, 2);
    const split = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === 'Split here');
    if (!split) throw new Error('Split action missing.');
    await act(async () => split.click());
    const signal: unknown = h.edited.mock.calls[0]?.[1]; if (!(signal instanceof AbortSignal)) throw new Error('Split signal missing.');
    expect(signal.aborted).toBe(false);
    if (ending === 'frame') await act(async () => { width = 800; resize(); });
    else if (ending === 'blur') await act(async () => window.dispatchEvent(new Event('blur')));
    else await h.show({ interactionLocked: true });
    expect(signal.aborted).toBe(true); expect(h.pending).toHaveBeenLastCalledWith(false);
    await act(async () => operation.resolve(undefined));
    expect(h.selected).not.toHaveBeenCalled(); expect(h.edited).toHaveBeenCalledOnce(); expect(h.error).not.toHaveBeenCalled();
  });
  it('requires an owned pointer location for Split here and drops a pending cut on source replacement', async () => {
    const h = await spatialFixture(), edge = container.querySelector('[data-cad-sketch-entity="ab"]'); if (!edge) throw new Error('Missing edge.');
    await act(async () => edge.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true })));
    expect([...document.querySelectorAll('[role="menuitem"]')].some(item => item.textContent === 'Split here')).toBe(false);
    await act(async () => document.querySelector('[role="menu"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await h.pointer('pointerdown', 5, .1, false, 7, 2); await h.pointer('pointerup', 5, .1, false, 7, 2);
    expect(container.querySelector('[data-cad-sketch-split-point]')).not.toBeNull();
    await h.show({ documentVersion: 'two' }); expect(container.querySelector('[data-cad-sketch-split-point]')).toBeNull();
    expect(h.edited).not.toHaveBeenCalled(); expect(h.pending).toHaveBeenLastCalledWith(false);
  });
  it('identifies the owning relation when an otherwise valid edge cut is blocked', async () => {
    const h = await spatialFixture(), graph = h.feature.graph; if (!graph) throw new Error('Graph missing.');
    const feature = { ...h.feature, graph: { ...graph, points: [...graph.points, { id: 'p', position: [0, 10] as const }, { id: 'q', position: [10, 10] as const }],
      entities: [...graph.entities, { id: 'guide', kind: 'line' as const, construction: true, startPointId: 'p', endPointId: 'q' }],
      relations: [{ id: 'whole-owner', kind: 'parallel' as const, lineIds: ['ab', 'guide'] as const }] } };
    await h.show({ sketch: feature, graphControls: { ...h.props().graphControls!, document: { ...h.props().graphControls!.document, features: [feature] } } });
    await h.pointer('pointerdown', 5, .1, false, 7, 2); await h.pointer('pointerup', 5, .1, false, 7, 2);
    const split = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === 'Split here');
    expect(split?.disabled).toBe(true);
    expect(split?.getAttribute('aria-description')).toMatch(/Parallel relation 1.*Line 1 and Line 3/);
    await act(async () => split?.click());
    expect(h.edited).not.toHaveBeenCalled(); expect(container.querySelector('[data-cad-sketch-split-point]')).toBeNull();
  });
  it('dismisses overlap preview on Escape or a changed source without changing the accepted selection', async () => {
    const h = await spatialFixture();
    for (const ending of ['escape', 'source', 'outside'] as const) {
      await h.pointer('pointerdown', 10, 0, false, 7, 2); await h.pointer('pointerup', 10, 0, false, 7, 2);
      const menu = document.querySelector('[aria-label="Select other actions"]'); if (!menu) throw new Error('Overlap chooser missing.');
      if (ending === 'escape') await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
      else if (ending === 'source') await h.show({ documentVersion: 'two' });
      else {
        await h.pointer('pointerdown', -5, -5); await h.pointer('pointerup', -5, -5);
        await act(async () => h.canvas.dispatchEvent(new MouseEvent('click', { button: 0, detail: 1, bubbles: true })));
      }
      expect(document.querySelector('[aria-label="Select other actions"]')).toBeNull();
      expect(h.selected).not.toHaveBeenCalled(); expect(h.selectedSet).not.toHaveBeenCalled();
      expect(h.pending).toHaveBeenLastCalledWith(false);
    }
  });
});
