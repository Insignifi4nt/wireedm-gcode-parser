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
    const checkbox = container.querySelector<HTMLInputElement>('[aria-label="Create relations"]');
    if (!checkbox) throw new Error('Missing relation inference control'); return checkbox;
  };
  /** Sets Create relations to the state a test needs, through the visible checkbox. */
  const relations = async (enabled: boolean) => { if (inference().checked !== enabled) await act(async () => inference().click()); expect(inference().checked).toBe(enabled); };
  const ambiguousSketch = () => ({ ...graphSketch, graph: { ...graphSketch.graph, points: [...graphSketch.graph.points,
    { id: 'ghost-a', position: [2.1, 3.2] as const }, { id: 'ghost-b', position: [22.1, 3.2] as const }] } });
  const snapChoice = (point: number) => {
    const menu = document.querySelector('[aria-label="Choose snap target actions"]');
    const item = [...menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []].find(button => new RegExp(`^Point ${point}(?:\\D|$)`).test(button.textContent ?? ''));
    if (!item) throw new Error(`Missing snap choice ${point}.`); return item;
  };
  const legacySlot = { id: 'slot', name: 'Mounting slot', construction: false,
    geometry: { kind: 'slot' as const, x: 2.1, y: 3.2, length: 12, width: 4, angle: 30 } };
  const profileChoice = (name: string) => {
    const item = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Choose snap target actions"] [role="menuitem"]')].find(button => button.textContent?.startsWith(name));
    if (!item) throw new Error(`Missing profile snap ${name}.`); return item;
  };
  it('attaches fresh points to the origin, an axis and an existing line, and names each relation before the click', async () => {
    const onAddPath = vi.fn(), h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'path', onAddPath });
    const hint = async (x: number, y: number) => {
      await h.pointer('pointermove', { ...h.position(x, y), button: 0, buttons: 0 });
      const found = container.querySelector('.cad-sketch-snap-hint'); return [found?.getAttribute('data-cad-sketch-snap-kind'), found?.getAttribute('aria-label')];
    };
    expect(inference().checked).toBe(true); expect(await hint(.05, .05)).toEqual(['origin', 'Origin · Fixed at origin']);
    await relations(false); expect(await hint(.05, .05)).toEqual(['origin', 'Origin · No relation']);
    await relations(true); expect(await hint(.05, .05)).toEqual(['origin', 'Origin · Fixed at origin']); await h.click(.05, .05);
    expect(await hint(8, 3.25)).toEqual(['on-entity', 'On line · Point on line']); await h.click(8, 3.25);
    expect(await hint(.03, 20)).toEqual(['on-axis', 'On Y axis · Fixed X at 0']); await h.click(.03, 20);
    expect(container.querySelector('[aria-label="Pending relations"]')?.textContent).toBe('3 attached');
    // Clicking the start again closes the polyline on the start itself, which keeps only its own attachment.
    expect(await hint(.05, .05)).toEqual(['draft-start', 'Close polyline']); await h.click(0, 0);
    expect(onAddPath).toHaveBeenCalledExactlyOnceWith({ kind: 'ready', mode: 'line', start: [0, 0],
      startPick: { kind: 'datum', point: [0, 0], datum: 'origin', relationIds: [expect.any(String), expect.any(String)] }, segments: [
        expect.objectContaining({ end: [expect.closeTo(8, 10), 3.2], endPick: { kind: 'on-line', point: [expect.closeTo(8, 10), 3.2], lineId: 'line', relationId: expect.any(String) } }),
        expect.objectContaining({ end: [0, expect.closeTo(20, 10)], endPick: { kind: 'datum', point: [0, expect.closeTo(20, 10)], datum: 'y-axis', relationIds: [expect.any(String)] } }),
        expect.objectContaining({ end: [0, 0] })] }, true, expect.any(AbortSignal));
    expect(onAddPath.mock.calls[0][0].segments[2]).not.toHaveProperty('endPick');
  });
  it('keeps a point placed along a circle on it only while Create relations is on', async () => {
    const onAddPath = vi.fn(), h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'path', onAddPath });
    const hint = async (x: number, y: number) => {
      await h.pointer('pointermove', { ...h.position(x, y), button: 0, buttons: 0 });
      return container.querySelector('.cad-sketch-snap-hint')?.getAttribute('aria-label');
    };
    // The circle's top lies at (12.1, 16.6) and its left at (8.7, 13.2).
    expect(await hint(12.1, 16.63)).toBe('On circle · Point on curve'); await h.click(12.1, 16.63);
    expect(container.querySelector('[data-cad-sketch-attachment="circle"] title')?.textContent).toBe('Pending point on curve');
    await relations(false); expect(await hint(8.67, 13.2)).toBe('On circle · No relation'); await h.click(8.67, 13.2);
    await h.click(30, 30); await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Finish polyline"]')?.click(); });
    expect(onAddPath).toHaveBeenCalledOnce();
    const path = onAddPath.mock.calls[0][0];
    expect(path.start).toEqual([expect.closeTo(12.1, 10), expect.closeTo(16.6, 10)]);
    // Turning the option off released the pending start attachment too.
    expect(path).not.toHaveProperty('startPick'); expect(path.segments.map((segment: object) => 'endPick' in segment)).toEqual([false, false]);
  });
  it('attaches a point placed along a circle with a point-on-curve pick', async () => {
    const onAddPath = vi.fn(), h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'path', onAddPath });
    await h.click(12.1, 16.63); await h.click(30, 30);
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Finish polyline"]')?.click(); });
    expect(onAddPath.mock.calls[0][0].startPick).toEqual({ kind: 'on-curve', point: [expect.closeTo(12.1, 10), expect.closeTo(16.6, 10)], curveId: 'circle', relationId: expect.any(String) });
  });
  it('guides new points level with or above the points already placed, and Ctrl releases the guide', async () => {
    const onAddPath = vi.fn(), h = await fixture([], { tool: 'path', onAddPath });
    const move = (x: number, y: number, init: MouseEventInit = {}) => h.pointer('pointermove', { ...h.position(x, y), button: 0, buttons: 0, ...init });
    await h.click(30, 30); await move(30.03, 50);
    // The guide comes from the active line's own start, so the line keeps it as a relation.
    expect(container.querySelector('.cad-sketch-snap-hint')?.getAttribute('aria-label')).toBe('Vertical');
    expect(container.querySelectorAll('.cad-sketch-snap-guide')).toHaveLength(1);
    await move(30.03, 50, { ctrlKey: true }); expect(container.querySelector('.cad-sketch-snap-hint')).toBeNull();
    await h.click(30.03, 50); await h.click(50, 50.04); await h.click(30, 30);
    expect(onAddPath).toHaveBeenCalledOnce();
    // The first point is free; each guided point copies its source coordinate exactly.
    const { start: first, segments: [{ end: second }, { end: third }] } = onAddPath.mock.calls[0][0];
    expect(first).toEqual([expect.closeTo(30, 10), expect.closeTo(30, 10)]);
    expect(second).toEqual([first[0], expect.closeTo(50, 10)]); expect(third).toEqual([expect.closeTo(50, 10), second[1]]);
    // The return to the start closes the polyline and keeps no inferred relation.
    expect(onAddPath.mock.calls[0][0].segments.map((segment: { inferred?: object }) => segment.inferred)).toEqual([
      { kind: 'vertical', relationId: expect.any(String) }, { kind: 'horizontal', relationId: expect.any(String) }, undefined]);
  });
  it('keeps a line drawn along its own start guide horizontal unless Ctrl or Create relations releases it', async () => {
    const onAddPath = vi.fn(), h = await fixture([], { tool: 'line', onAddPath });
    const move = (x: number, y: number, init: MouseEventInit = {}) => h.pointer('pointermove', { ...h.position(x, y), button: 0, buttons: 0, ...init });
    const hint = () => container.querySelector('.cad-sketch-snap-hint')?.getAttribute('aria-label') ?? null;
    await h.click(10, 10); await move(30, 10.03); expect(hint()).toBe('Horizontal'); await h.click(30, 10.03);
    expect(onAddPath).toHaveBeenCalledOnce();
    const [{ start, segments: [line] }, closed] = onAddPath.mock.calls[0];
    expect(closed).toBe(false); expect(line.end).toEqual([expect.closeTo(30, 10), start[1]]);
    expect(line.inferred).toEqual({ kind: 'horizontal', relationId: expect.any(String) });
    await h.click(10, 40); await h.click(30, 40.03, h.svg, { ctrlKey: true });
    expect(onAddPath.mock.calls[1][0].segments[0].end).toEqual([expect.closeTo(30, 10), expect.closeTo(40.03, 10)]);
    expect(onAddPath.mock.calls[1][0].segments[0]).not.toHaveProperty('inferred');
    await relations(false); await h.click(10, 70); await move(30, 70.03); expect(hint()).toBe('Horizontal with point · No relation'); await h.click(30, 70.03);
    // The guide still places the end level; only the relation is left out.
    expect(onAddPath.mock.calls[2][0].segments[0].end).toEqual([expect.closeTo(30, 10), onAddPath.mock.calls[2][0].start[1]]);
    expect(onAddPath.mock.calls[2][0].segments[0]).not.toHaveProperty('inferred');
  });
  it('releases the relation and attachment of a held short pick when Ctrl or Cmd is pressed before release', async () => {
    for (const modifier of ['ctrlKey', 'metaKey'] as const) {
      const onAddPath = vi.fn(), h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'line', onAddPath });
      const press = (type: string, x: number, y: number, init: MouseEventInit = {}) => h.pointer(type, { ...h.position(x, y), button: 0, buttons: type === 'pointerup' ? 0 : 1, ...init });
      const hold = async (start: readonly [number, number], end: readonly [number, number], hint: string) => {
        await h.click(...start); await h.pointer('pointermove', { ...h.position(...end), button: 0, buttons: 0 });
        expect(container.querySelector('.cad-sketch-snap-hint')?.getAttribute('aria-label')).toBe(hint);
        // Both ends lie within the press-and-hold area, so the line is placed on release.
        await press('pointerdown', ...end); await press('pointerup', ...end, { [modifier]: true }); await h.click(...end, h.svg, { [modifier]: true });
        const [line] = onAddPath.mock.calls.at(-1)![0].segments;
        expect(line.end).toEqual([expect.closeTo(end[0], 9), expect.closeTo(end[1], 9)]);
        expect(line).not.toHaveProperty('inferred'); expect(line).not.toHaveProperty('endPick');
      };
      await hold([30, 25], [30.01, 25.32], 'Vertical');
      await hold([22.1, 3.45], [22.11, 3.22], 'Coincident with Point 2');
      expect(onAddPath).toHaveBeenCalledTimes(2);
    }
  });
  it('infers only for polyline line segments and names an attachment before the relation', async () => {
    const onAddPath = vi.fn(), h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'path', onAddPath });
    const move = (x: number, y: number) => h.pointer('pointermove', { ...h.position(x, y), button: 0, buttons: 0 });
    const hint = () => container.querySelector('.cad-sketch-snap-hint')?.getAttribute('aria-label') ?? null;
    const mode = (name: string) => act(async () => { [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Segment mode"] button')].find(button => button.textContent === name)!.click(); });
    // The start's vertical guide crosses the existing line at (8, 3.2).
    await h.click(8, 30); await move(8.03, 3.23); expect(hint()).toBe('Point on line · Vertical'); await h.click(8.03, 3.23);
    await mode('3-point Arc'); await move(30, 3.23); expect(hint()).toBe('Horizontal with point · No relation');
    await h.click(30, 3.23); await h.click(19, 8);
    await mode('Line'); await h.click(30.03, 30);
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Finish polyline"]')?.click(); });
    const [line, arc, last] = onAddPath.mock.calls[0][0].segments;
    expect(line).toMatchObject({ kind: 'line', end: [8, 3.2], endPick: { kind: 'on-line', lineId: 'line' }, inferred: { kind: 'vertical' } });
    expect(arc.kind).toBe('arc'); expect(arc).not.toHaveProperty('inferred');
    expect(last).toMatchObject({ kind: 'line', end: [arc.end[0], expect.closeTo(30, 10)], inferred: { kind: 'vertical' } });
  });
  it('drops a hovered center once a parameter edit moves it, also when the sketch keeps its object', async () => {
    const sketch = { id: 'sketch', name: 'Sketch', suppressed: false, kind: 'sketch' as const, plane: 'XY' as const, offset: 0,
      profiles: [{ id: 'hole', name: 'Hole', construction: false, geometry: { kind: 'circle' as const, x: 'cx', y: 10, radius: 4 } }] };
    const h = await fixture([], { sketch, parameters: { cx: 20 }, tool: 'path', onAddPath: vi.fn() });
    const move = (x: number, y: number) => h.pointer('pointermove', { ...h.position(x, y), button: 0, buttons: 0 });
    const hint = () => container.querySelector('.cad-sketch-snap-hint')?.getAttribute('aria-label') ?? null;
    await move(20, 10); expect(hint()).toMatch(/Hole.*Center/);
    await move(20.03, 50); expect(hint()).toBe('Vertical with point · No relation');
    await h.render({ parameters: { cx: 60 } });
    await move(20.03, 50); expect(hint()).toBeNull();
  });
  it('reads out the unfinished size at the cursor and clears it once the shape is placed or cancelled', async () => {
    const h = await fixture([], { tool: 'rectangle' }), readout = () => container.querySelector('[data-cad-drawing-readout] text')?.textContent ?? null;
    const move = (x: number, y: number) => h.pointer('pointermove', { ...h.position(x, y), button: 0, buttons: 0 });
    await move(10, 10); expect(readout()).toBeNull();
    await h.click(10, 10); await move(40, 30);
    expect(readout()).toBe(`${(30).toLocaleString()} × ${(20).toLocaleString()} mm`);
    await h.click(40, 30); expect(h.added).toHaveBeenCalledOnce(); expect(readout()).toBeNull();
    await h.render({ tool: 'circle' }); await h.click(0, 0); await move(0, 10); expect(readout()).toBe(`Ø ${(20).toLocaleString()} mm`);
    await h.render({ tool: 'path' }); expect(readout()).toBeNull();
    await h.click(0, 0); await move(10, 10); expect(readout()).toBe(`${(Math.hypot(10, 10)).toLocaleString(undefined, { maximumFractionDigits: 2 })} mm · ${(45).toLocaleString()}°`);
  });
  it('draws a detached Path from a legacy-only slot center and retains its numeric start after the source moves', async () => {
    const onAddPath = vi.fn(), h = await fixture([legacySlot], { tool: 'path', onAddPath });
    await h.pointer('pointermove', { ...h.position(2.2, 3.3), buttons: 0 });
    const hint = container.querySelector('[data-cad-sketch-snap-kind="profile-position"]');
    expect(hint?.getAttribute('aria-label')).toMatch(/Mounting slot.*Center.*No relation/);
    expect(container.querySelector('[data-cad-drawing-snap-profile="slot"]')).not.toBeNull();
    await h.click(2.2, 3.3);
    await h.render({ sketch: { id: 'sketch', name: 'Sketch', suppressed: false, kind: 'sketch', plane: 'XY', offset: 0,
      profiles: [{ ...legacySlot, geometry: { ...legacySlot.geometry, x: 42.1 } }] } });
    await h.click(30, 30, h.svg, { ctrlKey: true });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Finish polyline"]')!.click());
    const draft = onAddPath.mock.calls[0]?.[0];
    expect(draft).toMatchObject({ start: [2.1, 3.2], segments: [{ kind: 'line', end: [expect.closeTo(30, 10), expect.closeTo(30, 10)] }] });
    expect(draft).not.toHaveProperty('startPick'); expect(draft.segments[0]).not.toHaveProperty('endPick');
    expect(h.selected).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled();
  });
  it('keeps legacy positions detached with inference enabled and preserves modifier bypass', async () => {
    const onAddFreshSketch = vi.fn(), h = await fixture([legacySlot], { tool: 'rectangle', onAddFreshSketch });
    await relations(true); await h.click(2.2, 3.3);
    expect(container.querySelector('[data-cad-sketch-attachment]')).toBeNull();
    await h.click(22.1, 13.2, h.svg, { ctrlKey: true });
    expect(onAddFreshSketch).toHaveBeenNthCalledWith(1, { kind: 'rectangle', first: { kind: 'position', point: [2.1, 3.2] },
      opposite: { kind: 'position', point: [expect.closeTo(22.1, 10), expect.closeTo(13.2, 10)] } }, expect.any(AbortSignal));
    await h.click(2.2, 3.3, h.svg, { ctrlKey: true }); await h.click(22.2, 13.3, h.svg, { ctrlKey: true });
    expect(onAddFreshSketch.mock.calls[1][0].first).toEqual({ kind: 'position', point: [expect.closeTo(2.2, 10), expect.closeTo(3.3, 10)] });
    expect(h.added).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled();
  });
  it('chooses among graph and legacy owners at the same position without turning the chosen profile into a graph join', async () => {
    const onAddPath = vi.fn(), source = { ...graphSketch, profiles: [legacySlot, { ...circle('bore', 2.1, 3.2, 4), name: 'Pilot bore' }] };
    const h = await fixture([], { sketch: source, parameters: { anchor: 2.1 }, tool: 'path', onAddPath });
    await h.click(2.2, 3.3); expect(snapChoice(1)).toBeDefined(); expect(profileChoice('Pilot bore')).toBeDefined();
    const slot = profileChoice('Mounting slot'); await act(async () => slot.focus());
    expect(container.querySelector('[data-cad-drawing-snap-profile="slot"]')).not.toBeNull();
    expect(container.querySelector('[data-cad-sketch-snap-kind="profile-position"]')?.getAttribute('aria-label')).toMatch(/No relation/);
    expect(h.selected).not.toHaveBeenCalled(); await act(async () => slot.click());
    await h.click(40, 30, h.svg, { ctrlKey: true }); await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Finish polyline"]')!.click());
    expect(onAddPath.mock.calls[0][0]).toMatchObject({ start: [2.1, 3.2] }); expect(onAddPath.mock.calls[0][0]).not.toHaveProperty('startPick');
    expect(h.selected).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled();
  });
  it('invalidates legacy-only ambiguous ownership on source replacement and dismisses outside without placing', async () => {
    const profiles = [legacySlot, { ...circle('bore', 2.1, 3.2, 4), name: 'Pilot bore' }], onAddPath = vi.fn();
    const h = await fixture(profiles, { tool: 'path', onAddPath, documentVersion: 'one' });
    await h.click(2.2, 3.3); const stale = profileChoice('Mounting slot');
    await h.render({ documentVersion: 'two' }); await act(async () => stale.click());
    expect(h.pending).toHaveBeenLastCalledWith(false); expect(container.querySelector('[aria-label="Finish polyline"]')).toBeNull();
    await h.click(2.2, 3.3); expect(profileChoice('Pilot bore')).toBeDefined();
    await h.pointer('pointerdown', { ...h.position(50, 50), button: 0, buttons: 1 }); await h.click(50, 50);
    expect(document.querySelector('[aria-label="Choose snap target actions"]')).toBeNull(); expect(h.pending).toHaveBeenLastCalledWith(false);
    expect(container.querySelector('[aria-label="Finish polyline"]')).toBeNull(); expect(onAddPath).not.toHaveBeenCalled();
  });
  it('attaches the chosen exact Polyline point and preserves its first point when an ambiguous endpoint is dismissed', async () => {
    const onAddPath = vi.fn(), source = ambiguousSketch(), h = await fixture([], { sketch: source, parameters: { anchor: 2.1 }, tool: 'path', onAddPath });
    await relations(true);
    const before = h.frame(); await h.click(2.2, 3.3);
    expect(document.querySelector('[aria-label="Choose snap target actions"]')).not.toBeNull(); expect(h.pending).toHaveBeenLastCalledWith(true);
    // Workbench locks camera navigation while this canvas owns a pending drawing.
    await h.render({ viewLocked: true });
    expect(document.querySelector('[aria-label="Choose snap target actions"]')).not.toBeNull();
    expect(h.frame()).not.toBe(before); expect(container.querySelector('[aria-label="Finish polyline"]')).toBeNull();
    await act(async () => snapChoice(1).focus()); expect(container.querySelector('[data-cad-drawing-snap-owner="line"]')).not.toBeNull();
    await act(async () => snapChoice(4).focus()); expect(container.querySelector('[data-cad-sketch-snap="ghost-a"]')).not.toBeNull();
    await act(async () => snapChoice(4).click()); await h.click(22.2, 3.3);
    await act(async () => snapChoice(2).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(h.svg); expect(h.pending).toHaveBeenLastCalledWith(true); expect(onAddPath).not.toHaveBeenCalled();
    await h.click(22.2, 3.3); await act(async () => snapChoice(2).click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Finish polyline"]')!.click());
    expect(onAddPath).toHaveBeenCalledWith(expect.objectContaining({ start: [2.1, 3.2],
      startPick: { kind: 'coincident', point: [2.1, 3.2], sourcePointId: 'ghost-a', relationId: expect.any(String) }, segments: [
        expect.objectContaining({ kind: 'line', end: [22.1, 3.2], endPick: { kind: 'coincident', point: [22.1, 3.2], sourcePointId: 'b', relationId: expect.any(String) } })
      ] }), false, expect.any(AbortSignal)); expect(h.error).not.toHaveBeenCalled();
  });

  it('drops an ambiguous choice after source replacement or actual SVG-frame movement without placing or outside-click fallback', async () => {
    const onAddPath = vi.fn(), h = await fixture([], { sketch: ambiguousSketch(), documentVersion: 'one', parameters: { anchor: 2.1 }, tool: 'path', onAddPath });
    await h.click(2.2, 3.3); expect(snapChoice(1)).toBeDefined();
    await h.render({ sketch: ambiguousSketch(), documentVersion: 'two' });
    expect(document.querySelector('[aria-label="Choose snap target actions"]')).toBeNull(); expect(h.pending).toHaveBeenLastCalledWith(false);
    await h.click(2.2, 3.3); const held = snapChoice(1);
    Object.assign(h.svg, { getBoundingClientRect: () => ({ left: 30, top: 20, width: 800, height: 600 }) });
    await act(async () => held.click()); expect(container.querySelector('[aria-label="Finish polyline"]')).toBeNull();
    Object.assign(h.svg, { getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 600 }) });
    await h.click(2.2, 3.3);
    await h.pointer('pointerdown', { ...h.position(50, 50), button: 0, buttons: 1 }); await h.click(50, 50);
    expect(container.querySelector('[aria-label="Finish polyline"]')).toBeNull(); expect(onAddPath).not.toHaveBeenCalled();
    expect(h.pending).toHaveBeenLastCalledWith(false);
  });

  it('attaches a chosen Circle center only with relations on, keeps radius choices position-only and Ctrl acceptance independent', async () => {
    const onAddFreshSketch = vi.fn(), h = await fixture([], { sketch: ambiguousSketch(), parameters: { anchor: 2.1 }, tool: 'circle', onAddFreshSketch });
    // Unticked, a chosen point only supplies its position.
    await relations(false); await h.click(2.2, 3.3); await act(async () => snapChoice(4).click());
    await h.click(22.2, 3.3); await act(async () => snapChoice(2).click());
    expect(onAddFreshSketch).toHaveBeenNthCalledWith(1, { kind: 'circle', center: { kind: 'position', point: [2.1, 3.2] }, radius: 20 }, expect.any(AbortSignal));
    await relations(true);
    await h.click(2.2, 3.3); await act(async () => snapChoice(1).click());
    await h.click(22.2, 3.3); await act(async () => snapChoice(5).click());
    expect(onAddFreshSketch).toHaveBeenNthCalledWith(2, { kind: 'circle', center: { kind: 'coincident', point: [2.1, 3.2], sourcePointId: 'a', relationId: expect.any(String) }, radius: 20 }, expect.any(AbortSignal));
    await h.click(2.2, 3.3, h.svg, { ctrlKey: true }); expect(document.querySelector('[aria-label="Choose snap target actions"]')).toBeNull();
    await h.click(7.2, 3.3, h.svg, { ctrlKey: true });
    expect(onAddFreshSketch).toHaveBeenNthCalledWith(3, { kind: 'circle', center: { kind: 'position', point: [expect.closeTo(2.2, 10), expect.closeTo(3.3, 10)] }, radius: expect.closeTo(5, 10) }, expect.any(AbortSignal));
  });

  it('pages every ambiguous point with bounded rendering and retains canvas focus ownership through dismissal', async () => {
    const source = { ...graphSketch, graph: { points: Array.from({ length: 30 }, (_, index) => ({ id: `point_${String(index + 1).padStart(2, '0')}`, position: [2.1, 3.2] as const })), entities: [], relations: [] } };
    const onAddPath = vi.fn(), h = await fixture([], { sketch: source, tool: 'path', onAddPath });
    await relations(true); await h.click(2.2, 3.3);
    const next = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent === 'Next candidates')!;
    expect(document.querySelectorAll('[role="menuitem"]').length).toBeLessThanOrEqual(14);
    await act(async () => next().click()); expect(document.activeElement).toBe(snapChoice(13));
    await act(async () => next().click()); expect(document.activeElement).toBe(snapChoice(25));
    await act(async () => snapChoice(30).click()); expect(document.activeElement).toBe(h.svg);
    await h.click(30, 30); await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Finish polyline"]')!.click());
    expect(onAddPath.mock.calls[0][0]).toMatchObject({ startPick: { kind: 'coincident', sourcePointId: 'point_30' }, start: [2.1, 3.2] });
  });
  it('retains deliberate first/opposite attachment roles while drawing a rectangle in reverse', async () => {
    const onAddFreshSketch = vi.fn(), original = structuredClone(graphSketch);
    const h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'rectangle', onAddFreshSketch });
    // Relations are on by default, so snapped corners attach without touching the box.
    expect(inference().checked).toBe(true);
    await h.click(12.2, 13.3); expect(container.querySelector('[data-cad-sketch-attachment="c"]')).not.toBeNull();
    await h.click(2.2, 3.3);
    expect(onAddFreshSketch).toHaveBeenCalledWith({ kind: 'rectangle',
      first: { kind: 'coincident', point: [12.1, 13.2], sourcePointId: 'c', relationId: expect.any(String) },
      opposite: { kind: 'coincident', point: [2.1, 3.2], sourcePointId: 'a', relationId: expect.any(String) }
    }, expect.any(AbortSignal));
    expect(h.added).not.toHaveBeenCalled(); expect(graphSketch).toEqual(original);
    expect(onAddFreshSketch.mock.calls[0][0].first.relationId).not.toBe(onAddFreshSketch.mock.calls[0][0].opposite.relationId);
  });
  it('places a drawing point on press and draws a rectangle by press-drag-release or by a tap followed by a tap-drag', async () => {
    const h = await fixture([], { tool: 'rectangle' }), rectangle = { kind: 'rectangle', x: expect.closeTo(2, 9), y: expect.closeTo(3, 9), width: expect.closeTo(10, 9), height: expect.closeTo(14, 9), cornerRadius: 0 };
    const press = (type: string, x: number, y: number) => h.pointer(type, { ...h.position(x, y), button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    const instruction = () => container.querySelector('.cad-sketch-viewport p')?.textContent ?? '';
    await press('pointerdown', 2, 3); expect(instruction()).toContain('Click the opposite corner');
    await press('pointermove', 7, 9); await press('pointermove', 12, 17); await press('pointerup', 12, 17);
    // The trailing click belongs to the drag and places nothing more.
    await h.click(12, 17);
    expect(h.added).toHaveBeenCalledOnce(); expect(h.added).toHaveBeenLastCalledWith(rectangle, expect.any(AbortSignal));
    // A touchpad can report the tap and the tap-drag as two presses; the second one only grabs the tapped corner.
    await press('pointerdown', 2, 3); await press('pointerup', 2, 3); await h.click(2, 3);
    await press('pointerdown', 2, 3); await press('pointermove', 12, 17); await press('pointerup', 12, 17); await h.click(12, 17);
    expect(h.added).toHaveBeenCalledTimes(2); expect(h.added).toHaveBeenLastCalledWith(rectangle, expect.any(AbortSignal));
    expect(h.error).not.toHaveBeenCalled();
  });
  it('ignores a wobble within a drawing press and draws polyline segments with press-drag-release', async () => {
    const onAddPath = vi.fn(), h = await fixture([], { tool: 'path', onAddPath });
    const press = (type: string, x: number, y: number) => h.pointer(type, { ...h.position(x, y), button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    await press('pointerdown', 2, 3); await press('pointermove', 2.5, 3.4); await press('pointerup', 2.5, 3.4); await h.click(2.5, 3.4);
    // The wobble stayed a click: only the start is placed.
    expect(container.querySelector('.cad-sketch-viewport p')?.textContent).toContain('Click the next point');
    await press('pointerdown', 2, 3); await press('pointermove', 20, 9); await press('pointerup', 20, 9); await h.click(20, 9);
    await press('pointerdown', 20, 9); await press('pointermove', 33, 27); await press('pointerup', 33, 27); await h.click(33, 27);
    await act(async () => h.svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onAddPath).toHaveBeenCalledOnce();
    const { start, segments } = onAddPath.mock.calls[0][0];
    expect(start).toEqual([expect.closeTo(2, 9), expect.closeTo(3, 9)]);
    expect(segments.map((segment: { end: readonly number[] }) => segment.end)).toEqual([[expect.closeTo(20, 9), expect.closeTo(9, 9)], [expect.closeTo(33, 9), expect.closeTo(27, 9)]]);
    expect(h.error).not.toHaveBeenCalled();
  });
  it('places a deliberate pick beside the last point on release and only grabs a press on that exact point', async () => {
    const h = await fixture([], { tool: 'rectangle' });
    const press = (type: string, x: number, y: number, init: MouseEventInit = {}) => h.pointer(type, { ...h.position(x, y), button: 0, buttons: type === 'pointerup' ? 0 : 1, ...init });
    await press('pointerdown', 2, 3); await press('pointerup', 2, 3); await h.click(2, 3);
    await press('pointerdown', 2, 3); await press('pointerup', 2, 3); await h.click(2, 3);
    expect(h.added).not.toHaveBeenCalled();
    // A short corner within the slop of the first one is placed when the press ends without a drag.
    await press('pointerdown', 2.4, 3.3, { ctrlKey: true }); expect(h.added).not.toHaveBeenCalled();
    await press('pointerup', 2.4, 3.3, { ctrlKey: true }); await h.click(2.4, 3.3, h.svg, { ctrlKey: true });
    expect(h.added).toHaveBeenCalledOnce();
    expect(h.added).toHaveBeenLastCalledWith({ kind: 'rectangle', x: expect.closeTo(2, 9), y: expect.closeTo(3, 9), width: expect.closeTo(0.4, 9), height: expect.closeTo(0.3, 9), cornerRadius: 0 }, expect.any(AbortSignal));
    expect(h.error).not.toHaveBeenCalled();
  });
  it('never retries a rejected completing press with the release point', async () => {
    const added = vi.fn(() => { throw new Error('Rejected rectangle.'); });
    const h = await fixture([], { tool: 'rectangle', onAddProfile: added });
    const press = (type: string, x: number, y: number) => h.pointer(type, { ...h.position(x, y), button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    await press('pointerdown', 2, 3); await press('pointerup', 2, 3); await h.click(2, 3);
    await press('pointerdown', 12, 17); await press('pointermove', 20, 25); await press('pointerup', 20, 25); await h.click(20, 25);
    expect(added).toHaveBeenCalledOnce(); expect(h.error).toHaveBeenCalledOnce();
    // The first corner is kept, so the next press completes the shape normally.
    expect(container.querySelector('.cad-sketch-viewport p')?.textContent).toContain('Click the opposite corner');
  });
  it('ends a press whose completing pick fails validation without saving its release', async () => {
    const h = await fixture([], { tool: 'rectangle' });
    const press = (type: string, x: number, y: number) => h.pointer(type, { ...h.position(x, y), button: 0, buttons: type === 'pointerup' ? 0 : 1, ctrlKey: true });
    await press('pointerdown', 2, 3); await press('pointerup', 2, 3);
    // A zero-width rectangle is rejected on press, and its release must not save a different one.
    await press('pointerdown', 2, 17); await press('pointermove', 12, 17); await press('pointerup', 12, 17);
    expect(h.added).not.toHaveBeenCalled(); expect(h.error).toHaveBeenCalledOnce();
  });
  it('ends a held press when Escape and a keyboard pick start the next rectangle during it', async () => {
    const h = await fixture([], { tool: 'rectangle' });
    const press = (type: string, x: number, y: number) => h.pointer(type, { ...h.position(x, y), button: 0, buttons: type === 'pointerup' ? 0 : 1, ctrlKey: true });
    const key = (key: string) => act(async () => h.svg.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
    await press('pointerdown', 2, 3); await press('pointerup', 2, 3);
    await press('pointerdown', 2.4, 3.3); await key('Escape'); await key(' ');
    expect(container.querySelector('.cad-sketch-viewport p')?.textContent).toContain('Click the opposite corner');
    await press('pointermove', 12, 17); await press('pointerup', 12, 17);
    expect(h.added).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled();
  });
  it('keeps the trailing click of a drawing press suppressed when a second contact lands', async () => {
    const h = await fixture([], { tool: 'rectangle' });
    await h.pointer('pointerdown', { ...h.position(2, 3), button: 0, buttons: 1 });
    await h.pointer('pointerdown', { ...h.position(12, 17), button: 0, buttons: 1 }, 12, false);
    await h.pointer('pointerup', { ...h.position(2.4, 3.3), button: 0, buttons: 0 }); await h.click(2.4, 3.3);
    expect(h.added).not.toHaveBeenCalled();
    expect(container.querySelector('.cad-sketch-viewport p')?.textContent).toContain('Click the opposite corner');
  });
  it('applies inference only to future picks and explicitly clears pending links when switched off', async () => {
    const onAddPath = vi.fn();
    const h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'path', onAddPath });
    await relations(false); await h.click(2.2, 3.3); await relations(true); await h.click(12.2, 13.3);
    expect(container.querySelector('[data-cad-sketch-attachment="a"]')).toBeNull(); expect(container.querySelector('[data-cad-sketch-attachment="c"]')).not.toBeNull();
    await relations(false); expect(container.querySelector('[data-cad-sketch-attachment="c"]')).toBeNull();
    await h.click(22.2, 3.3); await h.click(2.2, 3.3);
    expect(onAddPath).toHaveBeenCalledWith({ kind: 'ready', mode: 'line', start: [2.1, 3.2], segments: [expect.objectContaining({ end: [12.1, 13.2] }),
      expect.objectContaining({ end: [22.1, 3.2] }), expect.objectContaining({ end: [2.1, 3.2] })] }, true, expect.any(AbortSignal));
    expect(JSON.stringify(onAddPath.mock.calls[0][0])).not.toContain('Pick'); expect(h.added).not.toHaveBeenCalled();
  });
  it('attaches only a circle center while radius and midpoint picks remain position-only', async () => {
    const onAddFreshSketch = vi.fn(); const h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'circle', onAddFreshSketch });
    await relations(true); await h.click(12.2, 13.3); await h.click(2.2, 3.3);
    expect(onAddFreshSketch).toHaveBeenNthCalledWith(1, { kind: 'circle',
      center: { kind: 'coincident', point: [12.1, 13.2], sourcePointId: 'c', relationId: expect.any(String) }, radius: Math.sqrt(200)
    }, expect.any(AbortSignal));
    await h.click(12.2, 3.3); await h.click(17.1, 3.2, h.svg, { ctrlKey: true });
    expect(onAddFreshSketch).toHaveBeenNthCalledWith(2, { kind: 'circle', center: { kind: 'position', point: [12.1, 3.2] }, radius: expect.closeTo(5, 10) }, expect.any(AbortSignal));
  });
  it('refuses to silently drop a pending attachment if the fresh editor becomes unavailable', async () => {
    const onAddFreshSketch = vi.fn(); const h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'rectangle', onAddFreshSketch });
    await relations(true); await h.click(12.2, 13.3); await h.render({ onAddFreshSketch: undefined }); await h.click(2.2, 3.3);
    expect(onAddFreshSketch).not.toHaveBeenCalled(); expect(h.added).not.toHaveBeenCalled(); expect(h.error).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-cad-sketch-attachment="c"]')).not.toBeNull();
  });
  it.each(['sketch', 'version', 'parameters'] as const)('pins an earlier attached pick across a same-position %s replacement until its links are released', async changed => {
    const onAddFreshSketch = vi.fn();
    const h = await fixture([], { sketch: graphSketch, documentVersion: 'one', parameters: { anchor: 2.1 }, tool: 'circle', onAddFreshSketch });
    await relations(true); await h.click(2.2, 3.3);
    await h.render(changed === 'sketch' ? { sketch: structuredClone(graphSketch) } : changed === 'version' ? { documentVersion: 'two' } : { parameters: { anchor: 2.1 } });
    await h.click(12.2, 13.3);
    expect(onAddFreshSketch).not.toHaveBeenCalled(); expect(h.added).not.toHaveBeenCalled(); expect(h.error).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-cad-sketch-attachment="a"]')).not.toBeNull();
    await relations(false); await h.click(12.2, 13.3);
    expect(onAddFreshSketch).toHaveBeenCalledOnce();
    expect(onAddFreshSketch.mock.calls[0][0]).toMatchObject({ kind: 'circle', center: { kind: 'position', point: [2.1, 3.2] } });
  });
  it('accepts its own deferred attachment result after the accepted source renders without reporting stale ownership', async () => {
    let resolve: () => void = () => { throw new Error('Pending append missing.'); };
    const onAddFreshSketch = vi.fn(() => new Promise<void>(accept => { resolve = accept; }));
    const h = await fixture([], { sketch: graphSketch, documentVersion: 'one', parameters: { anchor: 2.1 }, tool: 'circle', onAddFreshSketch });
    await relations(true); await h.click(2.2, 3.3); await h.click(12.2, 13.3);
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
  it('closes a legacy polyline only on its acquired start, without swallowing a nearby fourth vertex', async () => {
    const h = await fixture([], { tool: 'path' });
    await act(async () => container.querySelector<HTMLInputElement>('input[aria-label="Snap to grid"]')!.click());
    // At the default view 7 pixels is inside the old span-based closure zone.
    await h.click(0, 0); await h.click(30, 0); await h.click(30, 30);
    const span = Number(h.svg.getAttribute('viewBox')!.split(' ')[3]);
    await h.click(7 * span / 600, 0, h.svg, { ctrlKey: true }); expect(h.added).not.toHaveBeenCalled();
    await h.click(0, 0);
    expect(h.added).toHaveBeenCalledWith({ kind: 'polygon', points: [[0, 0], [30, 0], [30, 30], [expect.closeTo(7 * span / 600, 10), 0]] }, expect.any(AbortSignal));
  });
  it('clears a borrowed point hint when the accepted source changes before keyboard placement', async () => {
    const onAddPath = vi.fn(); const h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'path', onAddPath });
    await relations(true);
    await h.pointer('pointermove', { ...h.position(2.2, 3.3), buttons: 0 });
    expect(container.querySelector('[data-cad-sketch-snap="a"]')).not.toBeNull();
    await h.render({ parameters: { anchor: 100 } });
    expect(container.querySelector('[data-cad-sketch-snap="a"]')).toBeNull();
    await act(async () => h.svg.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
    await h.click(30, 30); const finish = container.querySelector<HTMLButtonElement>('[aria-label="Finish polyline"]');
    if (!finish) throw new Error('Missing Finish polyline'); await act(async () => finish.click());
    expect(onAddPath.mock.calls[0][0]).not.toHaveProperty('startPick'); expect(h.error).not.toHaveBeenCalled();
  });
  it('retains an acquired off-grid Path endpoint after placement instead of inventing a grid segment on repeated Space', async () => {
    const onAddPath = vi.fn(); const h = await fixture([], { sketch: graphSketch, parameters: { anchor: 2.1 }, tool: 'path', onAddPath });
    await relations(true);
    await h.pointer('pointermove', { ...h.position(2.2, 3.3), buttons: 0 });
    const key = async (value: string) => act(async () => h.svg.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
    await key(' '); await key(' ');
    expect(h.error).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Finish polyline"]')?.disabled).toBe(true);
    await key('ArrowRight'); await key(' ');
    const finish = container.querySelector<HTMLButtonElement>('[aria-label="Finish polyline"]'); if (!finish) throw new Error('Missing Finish polyline.');
    await act(async () => finish.click());
    expect(onAddPath).toHaveBeenCalledOnce();
    expect(onAddPath.mock.calls[0][0]).toMatchObject({ start: [2.1, 3.2], startPick: { kind: 'coincident', sourcePointId: 'a' }, segments: [{ kind: 'line', end: [7.1, 3.2] }] });
    expect(onAddPath.mock.calls[0][0].segments[0]).not.toHaveProperty('endPick');
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
    await act(async () => container.querySelector<HTMLInputElement>('input[aria-label="Snap to grid"]')!.click());
    // The grid magnet catches clicks a few pixels from a node.
    await h.click(0.05, 0.05); expect(h.pending).toHaveBeenLastCalledWith(true);
    await h.click(10.05, 9.95);
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
