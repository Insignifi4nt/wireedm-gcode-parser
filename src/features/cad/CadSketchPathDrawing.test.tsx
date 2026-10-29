import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadProfile, CadSketchFeature } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import * as sketchGeometry from '@/domain/cad/cadSketchGeometry';
import { CadSession } from './cadSession';
import { CadSketchCanvas } from './CadSketchCanvas';
import type { CadRenderedViewControls } from './cadViewportControls';

let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function fixture(overrides: Partial<ComponentProps<typeof CadSketchCanvas>> = {}) {
  let controls: CadRenderedViewControls | null = null;
  const sketch: CadSketchFeature = overrides.sketch?.kind === 'sketch' ? overrides.sketch : { id: 'sketch', name: 'Sketch', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [] };
  const session = new CadSession({ ...createCadDocument(), schemaVersion: sketch.graph ? 2 : 1, parameters: overrides.parameters ?? {}, features: [sketch] });
  const added = vi.fn((geometry: CadProfile) => session.edit([{ kind: 'update-feature', feature: {
    ...sketch, profiles: [...sketch.profiles, { id: 'drawn', name: 'Path', construction: false, geometry }]
  } }]));
  const pending = vi.fn((open: boolean) => session.setWorkflowOpen(open)); const error = vi.fn();
  let props: ComponentProps<typeof CadSketchCanvas> = { sketch, parameters: {}, tool: 'path', selectedProfileId: null,
    onSelectProfile: vi.fn(), onAddProfile: added, onPendingChange: pending, onError: error, cancelSignal: 0, onControlsReady: value => { controls = value; }, ...overrides };
  async function render(next: Partial<typeof props> = {}) { props = { ...props, ...next }; await act(async () => root.render(<CadSketchCanvas {...props} />)); }
  await render();
  const svg = container.querySelector<SVGSVGElement>('svg.cad-sketch-canvas')!;
  Object.assign(svg, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) });
  function position(x: number, y: number) {
    const box = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const state = controls?.getState(); if (!state || state.mode === 'solid') throw new Error('Sketch frame missing');
    return { clientX: (x - state.centerMm[0] - box[0]) / box[2] * 800, clientY: (state.centerMm[1] - y - box[1]) / box[3] * 600 };
  }
  async function point(x: number, y: number, type = 'click', detail = 1) { await act(async () => svg.dispatchEvent(new MouseEvent(type, { ...position(x, y), button: 0, bubbles: true, detail }))); }
  async function pointer(type: string, x: number, y: number) {
    const event = new MouseEvent(type, { ...position(x, y), button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true });
    Object.defineProperties(event, { pointerId: { value: 7 }, isPrimary: { value: true } });
    await act(async () => svg.dispatchEvent(event));
  }
  /** A mouse click: its press places the point and its trailing click is suppressed. A double-click's second click has detail 2. */
  async function tap(x: number, y: number, detail = 1) { await pointer('pointerdown', x, y); await pointer('pointerup', x, y); await point(x, y, 'click', detail); }
  async function drag(from: readonly [number, number], to: readonly [number, number]) {
    await pointer('pointerdown', ...from); await pointer('pointermove', ...to); await pointer('pointerup', ...to); await point(...to);
  }
  const instruction = () => (container.querySelector('p.cad-sr-only')?.textContent ?? '').split(' Keyboard:')[0];
  async function key(key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    await act(async () => svg.dispatchEvent(event)); return event;
  }
  function button(label: string) {
    const result = [...container.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label);
    if (!result) throw new Error(`Missing ${label}`); return result;
  }
  async function click(label: string) { await act(async () => button(label).click()); }
  return { svg, session, added, pending, error, render, point, key, button, click, tap, drag, instruction };
}

const graphSketch: CadSketchFeature = { id: 'sketch', name: 'Sketch', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: { points: [], entities: [], relations: [] } };
const idleLine = 'Click the line start, or drag to draw one line.';

describe('line chains', () => {
  it('saves the same open chain from a double-click, Enter, Finish or Escape, and keeps the tool for the next one', async () => {
    const onAddPath = vi.fn(); const h = await fixture({ sketch: graphSketch, tool: 'line', onAddPath });
    const finishers = [() => h.tap(30, 30, 2), () => h.key('Enter'), () => h.click('Finish chain'), () => h.key('Escape')];
    for (const [index, finish] of finishers.entries()) {
      await h.tap(10, 10); await h.tap(30, 10); await h.tap(30, 30);
      // Two clicks no longer save a line: the chain stays pending until it is finished.
      expect(onAddPath).toHaveBeenCalledTimes(index); expect(h.pending).toHaveBeenLastCalledWith(true);
      await finish(); expect(onAddPath).toHaveBeenCalledTimes(index + 1); expect(h.instruction()).toBe(idleLine);
    }
    const [[draft, closed], ...rest] = onAddPath.mock.calls;
    expect(closed).toBe(false); expect(draft.kind).toBe('ready'); expect(draft.segments.map((segment: { kind: string }) => segment.kind)).toEqual(['line', 'line']);
    // Each save mints fresh ids for its inferred horizontal and vertical relations.
    const shape = (value: unknown) => JSON.parse(JSON.stringify(value).replace(/"relationId":"[^"]+"/g, '"relationId":"fresh"'));
    for (const call of rest) expect(shape(call.slice(0, 2))).toEqual(shape([draft, false]));
    expect(h.error).not.toHaveBeenCalled(); expect(h.pending).toHaveBeenLastCalledWith(false);
  });

  it.each([['on the last point', [30, 30]], ['on empty space', [30, 50]]] as const)('finishes on a double-click %s after a pause, saving once without a zero-length segment', async (_label, [x, y]) => {
    const onAddPath = vi.fn(); const h = await fixture({ sketch: graphSketch, tool: 'line', onAddPath });
    await h.tap(10, 10); await h.tap(30, 10); await h.tap(30, 30);
    // Longer than a double-click, so the click that placed the last point cannot pair with the next.
    await act(() => new Promise(resolve => setTimeout(resolve, 600)));
    await h.tap(x, y); await h.tap(x, y, 2);
    expect(onAddPath).toHaveBeenCalledTimes(1); expect(h.error).not.toHaveBeenCalled(); expect(h.instruction()).toBe(idleLine);
    const ends = onAddPath.mock.calls[0][0].segments.map((segment: { end: readonly number[] }) => segment.end.map(Math.round));
    expect(ends).toEqual(y === 30 ? [[30, 10], [30, 30]] : [[30, 10], [30, 30], [30, 50]]);
  });

  it('finishes on a double-click beyond the drag slop whose guides snap back onto the last point', async () => {
    const onAddPath = vi.fn(); const h = await fixture({ sketch: graphSketch, tool: 'line', onAddPath });
    await h.tap(10, 10); await h.tap(30, 10); await h.tap(30, 30);
    // Within the 6 px guide reach of the last point on each axis, but 8.2 px from it, past the 8 px drag slop.
    const offset = 5.8 * Number(h.svg.getAttribute('viewBox')!.split(' ')[2]) / 800;
    await h.tap(30 + offset, 30 + offset); await h.tap(30 + offset, 30 + offset, 2);
    expect(onAddPath).toHaveBeenCalledTimes(1); expect(h.error).not.toHaveBeenCalled();
    expect(onAddPath.mock.calls[0][0].segments.map((segment: { end: readonly number[] }) => segment.end.map(Math.round))).toEqual([[30, 10], [30, 30]]);
  });

  it.each(['Enter', 'Finish', 'double-click', 'Escape'] as const)('saves the completed segments and drops a pending arc endpoint on %s', async finisher => {
    const onAddPath = vi.fn(); const h = await fixture({ sketch: graphSketch, tool: 'line', onAddPath });
    await h.tap(10, 10); await h.tap(30, 10); await h.click('3-point Arc'); await h.tap(40, 20);
    // The arc waits for its through-point; nothing is saved yet.
    expect(onAddPath).not.toHaveBeenCalled(); expect(h.button('Finish chain').disabled).toBe(false);
    if (finisher === 'double-click') { await act(() => new Promise(resolve => setTimeout(resolve, 600))); await h.tap(40, 20); await h.tap(40, 20, 2); }
    else if (finisher === 'Finish') await h.click('Finish chain'); else await h.key(finisher);
    expect(onAddPath).toHaveBeenCalledTimes(1); expect(h.error).not.toHaveBeenCalled();
    const [draft, closed] = onAddPath.mock.calls[0];
    expect(closed).toBe(false); expect(draft.kind).toBe('ready');
    expect(draft.segments.map((segment: { kind: string; end: readonly number[] }) => [segment.kind, segment.end.map(Math.round)])).toEqual([['line', [30, 10]]]);
  });

  it('draws and finishes a chain from the keyboard alone', async () => {
    const onAddPath = vi.fn(); const h = await fixture({ sketch: graphSketch, tool: 'line', onAddPath });
    await h.key(' '); for (let step = 0; step < 4; step++) await h.key('ArrowRight');
    await h.key(' '); for (let step = 0; step < 4; step++) await h.key('ArrowUp');
    await h.key(' '); expect(onAddPath).not.toHaveBeenCalled();
    expect((await h.key('Escape')).defaultPrevented).toBe(true);
    expect(onAddPath).toHaveBeenCalledTimes(1); expect(onAddPath.mock.calls[0][1]).toBe(false);
    expect(onAddPath.mock.calls[0][0].segments.map((segment: { kind: string }) => segment.kind)).toEqual(['line', 'line']);
    expect((await h.key('Escape')).defaultPrevented).toBe(false);
  });

  it('saves one line from a drag with nothing pending, while a drag during a chain adds to it', async () => {
    const onAddPath = vi.fn(); const h = await fixture({ sketch: graphSketch, tool: 'line', onAddPath });
    await h.drag([10, 10], [30, 14]);
    expect(onAddPath).toHaveBeenCalledTimes(1); expect(onAddPath.mock.calls[0][1]).toBe(false); expect(onAddPath.mock.calls[0][0].segments).toHaveLength(1);
    expect(h.instruction()).toBe(idleLine);
    await h.tap(10, 30); await h.drag([10, 30], [30, 34]); await h.drag([30, 34], [40, 20]);
    expect(onAddPath).toHaveBeenCalledTimes(1); expect(h.button('Finish chain').disabled).toBe(false);
    await h.key('Enter'); expect(onAddPath.mock.calls[1][0].segments).toHaveLength(2);
  });

  it('discards a lone start on Escape and leaves a further Escape unhandled, so it can return to Select', async () => {
    const onAddPath = vi.fn(); const h = await fixture({ sketch: graphSketch, tool: 'line', onAddPath });
    await h.tap(10, 10); expect(h.instruction()).toBe('Click the line end.'); expect(h.button('Finish chain').disabled).toBe(true);
    expect((await h.key('Escape')).defaultPrevented).toBe(true);
    expect(onAddPath).not.toHaveBeenCalled(); expect(h.instruction()).toBe(idleLine); expect(h.pending).toHaveBeenLastCalledWith(false);
    expect((await h.key('Escape')).defaultPrevented).toBe(false);
    // A double-click on the start alone draws nothing.
    await h.tap(10, 10); await h.tap(10, 10, 2); expect(onAddPath).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled(); expect(h.instruction()).toBe('Click the line end.');
  });

  it.each(['arc', 'rectangle', 'circle', 'slot'] as const)('discards a pending %s on Escape and leaves a further Escape unhandled', async tool => {
    const h = await fixture({ sketch: graphSketch, tool, onAddPath: vi.fn() });
    await h.tap(10, 10); expect(h.pending).toHaveBeenLastCalledWith(true);
    expect((await h.key('Escape')).defaultPrevented).toBe(true); expect(h.pending).toHaveBeenLastCalledWith(false);
    expect((await h.key('Escape')).defaultPrevented).toBe(false); expect(h.added).not.toHaveBeenCalled();
  });

  it('keeps the drawn chain and the tool when its save is rejected, so Escape or Enter can retry it', async () => {
    const onAddPath = vi.fn(() => { throw new Error('The chain crosses a locked edge.'); }); const h = await fixture({ sketch: graphSketch, tool: 'line', onAddPath });
    await h.tap(10, 10); await h.tap(30, 10);
    expect((await h.key('Escape')).defaultPrevented).toBe(true); expect(h.error).toHaveBeenLastCalledWith('The chain crosses a locked edge.');
    expect(h.instruction()).toMatch(/^Click the next point./); expect(h.button('Finish chain').disabled).toBe(false); expect(h.pending).toHaveBeenLastCalledWith(true);
    await h.key('Enter'); expect(onAddPath).toHaveBeenCalledTimes(2); expect(onAddPath.mock.calls[1].slice(0, 2)).toEqual(onAddPath.mock.calls[0].slice(0, 2));
  });

  it('leaves the tool once a chain save that an Escape interrupted is accepted, without aborting the save', async () => {
    let accept = () => {};
    const onAddPath = vi.fn((_draft: unknown, _closed: boolean, _signal?: AbortSignal) => new Promise<void>(resolve => { accept = resolve; }));
    const onExitTool = vi.fn(); const h = await fixture({ sketch: graphSketch, tool: 'line', onAddPath, onExitTool });
    await h.tap(10, 10); await h.tap(30, 10); await h.key('Enter'); expect(onAddPath).toHaveBeenCalledTimes(1);
    expect((await h.key('Escape')).defaultPrevented).toBe(true);
    expect(onAddPath.mock.calls[0][2]?.aborted).toBe(false); expect(onExitTool).not.toHaveBeenCalled();
    await act(async () => accept()); expect(onExitTool).toHaveBeenCalledTimes(1); expect(h.instruction()).toBe(idleLine);
  });

  it('keeps the explicit close of a sketch that holds only closed profiles', async () => {
    const h = await fixture({ tool: 'line' });
    // A drag from idle starts a profile rather than saving a line, and a double-click adds nothing.
    await h.drag([10, 10], [30, 10]); await h.tap(30, 30); await h.tap(30, 30, 2);
    expect(h.added).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled();
    expect(container.querySelector('button[aria-label="Finish chain"]')).toBeNull(); expect(h.instruction()).toBe('Click the next endpoint; Close profile to finish.');
    await h.key('Escape'); expect(h.added).not.toHaveBeenCalled(); expect(h.instruction()).toBe('Click the chain start.');
    await h.tap(10, 10); await h.tap(30, 10); await h.tap(30, 30); await h.key('Enter');
    expect(h.added).toHaveBeenCalledTimes(1); expect(h.added.mock.calls[0][0]).toMatchObject({ kind: 'polygon' });
  });

  it('keeps a new curve pending through a drag from idle and a double-click until Finish curve', async () => {
    const onAddCurve = vi.fn(), onCancelCurve = vi.fn();
    const h = await fixture({ sketch: { id: 'rail', name: 'Rail', kind: 'curve', plane: 'XZ', offset: 0, suppressed: false, segments: [] }, curveCreation: true, onAddCurve, onCancelCurve });
    await h.drag([10, 10], [30, 10]); await h.tap(30, 30); await h.tap(30, 30, 2);
    expect(onAddCurve).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled(); expect(h.instruction()).toBe('Click the next endpoint; Finish curve to save.');
    await h.click('Finish curve'); expect(onAddCurve).toHaveBeenCalledTimes(1); expect(onAddCurve.mock.calls[0][0]).toHaveLength(2);
  });
});

describe('mixed line and three-point arc drawing', () => {
  it.each([true, false])('attaches deliberate existing-point snaps while honoring disabled snapping (%s)', async enabled => {
    const onAddPath = vi.fn();
    const h = await fixture({ onAddPath, sketch: { id: 'sketch', name: 'Sketch', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
      points: [{ id: 'a', position: ['anchorX', 3.2] }, { id: 'b', position: [22.1, 3.2] },
        { id: 'bottom', position: ['anchorX', 0] }, { id: 'top', position: ['anchorX', 6.4] }],
      entities: [{ id: 'fence', kind: 'line', construction: true, startPointId: 'bottom', endPointId: 'top' }], relations: []
    } }, parameters: { anchorX: 2.1 } });
    // Relations are on by default, so an accepted snap attaches without touching the box.
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Create relations"]')!.checked).toBe(true);
    if (!enabled) await h.click('Toggle snapping');
    await h.point(2.2, 3.3, 'pointermove');
    expect(container.querySelector('[data-cad-sketch-snap="a"]') !== null).toBe(enabled);
    // Space accepts the displayed snap, just as a pointer click does.
    await h.key(' '); await h.point(22.2, 3.3); await h.click('Finish chain');
    expect(h.error).not.toHaveBeenCalled(); expect(h.added).not.toHaveBeenCalled(); expect(onAddPath).toHaveBeenCalledTimes(1);
    const draft = onAddPath.mock.calls[0][0];
    expect(draft.kind).toBe('ready'); expect(draft.startPick?.sourcePointId).toBe(enabled ? 'a' : undefined);
    expect(draft.segments[0].endPick?.sourcePointId).toBe(enabled ? 'b' : undefined);
    expect(draft.start[0]).toBeCloseTo(enabled ? 2.1 : 2.2, 10);
    expect(draft.segments[0].end[0]).toBeCloseTo(enabled ? 22.1 : 22.2, 10);
  });

  it('keeps the draft provisional and creates one exact closed path in a single undo step', async () => {
    const h = await fixture(); const original = h.session.getSnapshot();
    await act(async () => container.querySelector<HTMLInputElement>('input[aria-label="Snap to grid"]')!.click());
    await h.point(0, 0); await h.point(20, 0); await h.click('3-point Arc'); await h.point(20, 20);
    expect(h.button('Line').disabled).toBe(true); expect(h.button('Close profile').disabled).toBe(true);
    expect(h.session.getSnapshot()).toMatchObject({ document: original.document, version: original.version, workflowOpen: true, canUndo: false });
    await h.point(30, 10); await h.click('Line'); await h.point(0, 20);
    expect(h.button('Close profile').textContent).toContain('Close with line');
    await h.click('Close profile');
    expect(h.error).not.toHaveBeenCalled(); expect(h.added).toHaveBeenCalledTimes(1);
    const feature = h.session.getSnapshot().document.features[0];
    if (feature.kind !== 'sketch') throw new Error('Expected sketch');
    const geometry = feature.profiles[0].geometry;
    if (geometry.kind !== 'path') throw new Error('Expected analytic path');
    expect(geometry.segments).toHaveLength(4);
    expect(geometry.segments[1]).toMatchObject({ kind: 'arc', center: [20, 10], radius: 10, startAngle: -90, sweep: 180 });
    expect(feature.profiles[0]).not.toHaveProperty('role'); expect(h.session.getSnapshot().workflowOpen).toBe(false);
    h.session.undo(); expect(h.session.getSnapshot().document).toEqual(original.document); expect(h.session.getSnapshot().canUndo).toBe(false);
  });

  it('retains an invalid arc endpoint and undoes it before removing the preceding segment', async () => {
    const h = await fixture(); await h.point(0, 0); await h.point(20, 0); await h.click('3-point Arc'); await h.point(20, 20);
    await h.point(20, 10); expect(h.error).toHaveBeenCalled(); expect(h.added).not.toHaveBeenCalled();
    expect(h.button('Line').disabled).toBe(true);
    await h.click('Undo last'); expect(h.button('Line').disabled).toBe(false); expect(document.activeElement).toBe(h.svg);
    await h.key('Backspace'); expect(h.session.getSnapshot().workflowOpen).toBe(true);
    await h.key('Backspace'); expect(h.session.getSnapshot().workflowOpen).toBe(false); expect(h.session.getSnapshot().canUndo).toBe(false);
  });

  it('keeps every segment after invalid closure and permits correcting the draft without document mutation', async () => {
    const h = await fixture(); const before = h.session.getSnapshot();
    for (const [x, y] of [[0, 0], [20, 20], [0, 20], [20, 0]]) await h.point(x, y);
    await h.click('Close profile');
    expect(h.error).toHaveBeenCalled(); expect(h.session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
    await h.click('Undo last'); await h.click('Close profile');
    expect(h.session.getSnapshot().canUndo).toBe(true); expect(h.session.getSnapshot().workflowOpen).toBe(false);
  });

  it('retains the complete draft when the shared document operation rejects contact with another profile', async () => {
    const sketch: CadSketchFeature = { id: 'sketch', name: 'Sketch', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false,
      profiles: [{ id: 'existing', name: 'Existing', construction: false, geometry: { kind: 'circle', x: 10, y: 10, radius: 4 } }] };
    const h = await fixture({ sketch }); const before = h.session.getSnapshot();
    await h.point(0, 0); await h.point(20, 0); await h.point(0, 20); await h.click('Close profile');
    expect(h.added).toHaveBeenCalledTimes(1); expect(h.error).toHaveBeenCalled();
    expect(h.session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
    await h.click('Undo last'); await h.point(0, -20); await h.click('Close profile');
    expect(h.session.getSnapshot().workflowOpen).toBe(false);
    const accepted = h.session.getSnapshot().document.features[0];
    if (accepted.kind !== 'sketch') throw new Error('Expected sketch');
    expect(accepted.profiles).toHaveLength(2); expect(accepted.profiles[0]).toEqual(sketch.profiles[0]);
  });

  it('renders and persists a clockwise major arc without replacing it by the minor arc', async () => {
    const h = await fixture(); await h.click('3-point Arc'); await h.point(5, 0); await h.point(0, 5); await h.point(-5, 0);
    expect(container.querySelector('[data-cad-path-segments] path')?.getAttribute('d')).toContain('A 5 5 0 1 0');
    await h.click('Close profile'); const profile = h.added.mock.calls[0][0];
    if (profile.kind !== 'path') throw new Error('Expected path');
    expect(profile.segments[0]).toMatchObject({ kind: 'arc', radius: 5, sweep: -270 }); expect(h.error).not.toHaveBeenCalled();
  });

  it('accepts an arc through-point with Enter and supports arrow/Space placement while ignoring IME and native undo', async () => {
    const h = await fixture(); await h.key(' '); await h.key('ArrowRight'); await h.key('ArrowRight'); await h.key(' ');
    await h.click('3-point Arc'); await h.point(10, 10); await h.point(15, 5, 'pointermove');
    const composing = await h.key('Enter', { isComposing: true }); expect(composing.defaultPrevented).toBe(false);
    expect(h.button('Line').disabled).toBe(true);
    await h.key('Enter'); expect(h.button('Line').disabled).toBe(false); expect(h.added).not.toHaveBeenCalled();
    expect((await h.key('z', { ctrlKey: true })).defaultPrevented).toBe(false);
    await h.key('Enter'); expect(h.added).toHaveBeenCalledTimes(1); expect(h.error).not.toHaveBeenCalled();
  });

  it.each([0, -Math.log(2) * 1000])('closes on its off-grid start within six pixels at zoom %s', async deltaY => {
    const h = await fixture(); await h.click('Toggle snapping');
    await h.point(2.1, 3.2); await h.point(22.1, 3.2); await h.point(22.1, 23.2);
    await act(async () => h.svg.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true })));
    const span = Number(h.svg.getAttribute('viewBox')!.split(' ')[3]);
    expect(h.button('Close profile').textContent).toContain('Close with line');
    await h.point(2.1 + 7 * span / 600, 3.2); expect(h.added).not.toHaveBeenCalled();
    await h.click('Undo last'); await h.point(2.1 + 5 * span / 600, 3.2);
    // Clicking the start saves the closed shape; a sketch of profiles keeps straight edges as an editable polygon.
    expect(h.added).toHaveBeenCalledTimes(1); expect(h.error).not.toHaveBeenCalled();
    const geometry = h.added.mock.calls[0][0];
    if (geometry.kind !== 'polygon') throw new Error('Expected polygon');
    expect(geometry.points).toHaveLength(3);
    expect(Number(geometry.points[0][0])).toBeCloseTo(2.1); expect(Number(geometry.points[0][1])).toBeCloseTo(3.2);
    expect(h.session.getSnapshot().workflowOpen).toBe(false);
  });

  it('cancels the entire local draft on Escape or external cancellation and preserves property locks', async () => {
    const h = await fixture(); const before = h.session.getSnapshot();
    await h.point(0, 0); await h.point(20, 0); await h.key('Escape'); expect(h.session.getSnapshot()).toEqual(before);
    await h.point(0, 0); await h.click('3-point Arc'); await h.point(20, 0); await h.render({ cancelSignal: 1 });
    expect(h.session.getSnapshot()).toEqual(before);
    await h.render({ interactionLocked: true }); await h.point(0, 0); await h.key(' ');
    expect(h.session.getSnapshot()).toEqual(before); expect(h.svg.getAttribute('tabindex')).toBe('-1'); expect(h.added).not.toHaveBeenCalled();
  });

  it('does not trap keyboard movement inside the anchor snap radius at a distant zoom', async () => {
    const h = await fixture(); await h.key(' ');
    await act(async () => h.svg.dispatchEvent(new WheelEvent('wheel', { deltaY: Math.log(20) * 1000, bubbles: true })));
    await h.key('ArrowRight'); await h.key(' ');
    expect(h.error).not.toHaveBeenCalled(); expect(h.button('Close profile').disabled).toBe(false);
  });

  it('does not reevaluate saved analytic geometry or committed arcs while the pointer moves', async () => {
    const resolve = vi.spyOn(sketchGeometry, 'resolveCadProfile');
    const profile = { id: 'saved', name: 'Saved', construction: false, geometry: { kind: 'path' as const, segments: [
      { kind: 'line' as const, start: [40, 0] as const, end: [50, 0] as const },
      { kind: 'arc' as const, center: [45, 0] as const, radius: 5, startAngle: 0, sweep: 180 }
    ] } };
    const h = await fixture({ sketch: { id: 'sketch', name: 'Sketch', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [profile] } });
    await h.point(0, 0); await h.click('3-point Arc'); await h.point(20, 0); await h.point(10, 10); await h.click('Line');
    const count = resolve.mock.calls.length; const committed = container.querySelector('[data-cad-path-segments]')!.innerHTML;
    for (let x = 5; x < 20; x++) await h.point(x, 20, 'pointermove');
    expect(resolve.mock.calls.length).toBe(count); expect(container.querySelector('[data-cad-path-segments]')!.innerHTML).toBe(committed);
  });
});
