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
  async function point(x: number, y: number, type = 'click') { await act(async () => svg.dispatchEvent(new MouseEvent(type, { ...position(x, y), button: 0, bubbles: true, detail: 1 }))); }
  async function key(key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    await act(async () => svg.dispatchEvent(event)); return event;
  }
  function button(label: string) {
    const result = [...container.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label);
    if (!result) throw new Error(`Missing ${label}`); return result;
  }
  async function click(label: string) { await act(async () => button(label).click()); }
  return { svg, session, added, pending, error, render, point, key, button, click };
}

describe('mixed line and three-point arc drawing', () => {
  it.each([true, false])('connects deliberate existing-point snaps while honoring disabled snapping (%s)', async enabled => {
    const onAddPath = vi.fn();
    const h = await fixture({ onAddPath, sketch: { id: 'sketch', name: 'Sketch', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
      points: [{ id: 'a', position: ['anchorX', 3.2] }, { id: 'b', position: [22.1, 3.2] }], entities: [], relations: []
    } }, parameters: { anchorX: 2.1 } });
    if (!enabled) await h.click('Toggle snapping');
    await h.point(2.2, 3.3, 'pointermove');
    expect(container.querySelector('[data-cad-sketch-snap="a"]') !== null).toBe(enabled);
    // Space accepts the displayed snap, just as a pointer click does.
    await h.key(' '); await h.point(22.2, 3.3); await h.click('Finish path');
    expect(h.error).not.toHaveBeenCalled(); expect(h.added).not.toHaveBeenCalled(); expect(onAddPath).toHaveBeenCalledTimes(1);
    const draft = onAddPath.mock.calls[0][0];
    expect(draft.kind).toBe('ready'); expect(draft.startPointId).toBe(enabled ? 'a' : undefined);
    expect(draft.segments[0].endPointId).toBe(enabled ? 'b' : undefined);
    expect(draft.start[0]).toBeCloseTo(enabled ? 2.1 : 2.2, 10);
    expect(draft.segments[0].end[0]).toBeCloseTo(enabled ? 22.1 : 22.2, 10);
  });

  it('keeps the draft provisional and creates one exact closed path in a single undo step', async () => {
    const h = await fixture(); const original = h.session.getSnapshot();
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

  it.each([0, -Math.log(2) * 1000])('snaps to an off-grid anchor within six pixels without automatically saving at zoom %s', async deltaY => {
    const h = await fixture(); await h.click('Toggle snapping');
    await h.point(2.1, 3.2); await h.point(22.1, 3.2); await h.point(22.1, 23.2);
    await act(async () => h.svg.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true })));
    const span = Number(h.svg.getAttribute('viewBox')!.split(' ')[3]);
    await h.point(2.1 + 5 * span / 600, 3.2); expect(h.added).not.toHaveBeenCalled();
    expect(h.button('Close profile').textContent).not.toContain('Close with line');
    await h.click('Close profile'); const geometry = h.added.mock.calls[0][0];
    if (geometry.kind !== 'path') throw new Error('Expected path');
    expect(geometry.segments).toHaveLength(3);
    const first = geometry.segments[0], last = geometry.segments[2];
    if (first.kind !== 'line' || last.kind !== 'line') throw new Error('Expected straight closure');
    expect(last.end).toEqual(first.start); expect(Number(last.end[0])).toBeCloseTo(2.1); expect(Number(last.end[1])).toBeCloseTo(3.2);
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
