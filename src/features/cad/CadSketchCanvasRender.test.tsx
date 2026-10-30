import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadSketchFeature } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { cadSketchLinearPatternLockReason } from '@/domain/cad/cadSketchLinearPattern';
import { cadSketchGraphBoundary } from '@/domain/cad/compileCadSketchGeometry';
import { CadSketchCanvas } from './CadSketchCanvas';
import { cadArcSvgPath } from './cadSketchSvg';
import { cadSketchDimensionSelectionStatus, cadSketchPointIdentity, createCadSketchHighlightStore } from './cadSketchDimensionSelection';
import { cadSketchDefinitionMarks } from './cadSketchDefinitionMarks';
import { createCadSketchPointerStore } from './CadSketchDimensionPreview';
import { planCadSketchDimension } from './cadSketchDimensionPlacement';
import { cadSketchGraphDimensionLabel } from './cadSketchGraphDimensionLayout';
import { cadSketchRelationGlyphPlate } from './cadSketchRelationGlyphLayout';
import { joinedPathData } from './cadSketchRelationGlyphDrawing';
import { CAD_SKETCH_RELATION_GLYPH_REVEAL_MS } from './CadSketchRelationGlyphs';
import type { CadRenderedViewControls } from './cadViewportControls';

// Every graph point row asks for its pattern lock reason once per render, so the call count tracks row renders.
vi.mock('@/domain/cad/cadSketchLinearPattern', async importOriginal => {
  const original = await importOriginal<typeof import('@/domain/cad/cadSketchLinearPattern')>();
  return { ...original, cadSketchLinearPatternLockReason: vi.fn(original.cadSketchLinearPatternLockReason) };
});
// The canvas root reads the dimension status line once per render in the select tool, and the relation glyph layer resolves Coincident identity once per render.
vi.mock('./cadSketchDimensionSelection', async importOriginal => {
  const original = await importOriginal<typeof import('./cadSketchDimensionSelection')>();
  return { ...original, cadSketchDimensionSelectionStatus: vi.fn(original.cadSketchDimensionSelectionStatus), cadSketchPointIdentity: vi.fn(original.cadSketchPointIdentity) };
});
const rowRenders = vi.mocked(cadSketchLinearPatternLockReason), canvasRenders = vi.mocked(cadSketchDimensionSelectionStatus), glyphLayerRenders = vi.mocked(cadSketchPointIdentity);
// Each graph edge row draws its boundary once per render; presses and drawing previews that also ask stay out of these tests.
vi.mock('@/domain/cad/compileCadSketchGeometry', async importOriginal => {
  const original = await importOriginal<typeof import('@/domain/cad/compileCadSketchGeometry')>();
  return { ...original, cadSketchGraphBoundary: vi.fn(original.cadSketchGraphBoundary) };
});
const edgeRenders = vi.mocked(cadSketchGraphBoundary);
// A pending chain's arcs draw their path once per render of the drawn segments, which the rubber band never asks for.
vi.mock('./cadSketchSvg', async importOriginal => {
  const original = await importOriginal<typeof import('./cadSketchSvg')>();
  return { ...original, cadArcSvgPath: vi.fn(original.cadArcSvgPath) };
});
const arcPaths = vi.mocked(cadArcSvgPath);
// The dimensions layer formats each label once per render.
vi.mock('./cadSketchGraphDimensionLayout', async importOriginal => {
  const original = await importOriginal<typeof import('./cadSketchGraphDimensionLayout')>();
  return { ...original, cadSketchGraphDimensionLabel: vi.fn(original.cadSketchGraphDimensionLabel) };
});
const dimensionRenders = vi.mocked(cadSketchGraphDimensionLabel);
// Each relation glyph row places itself once per render, and the hover ring places each glyph it lights.
vi.mock('./cadSketchRelationGlyphLayout', async importOriginal => {
  const original = await importOriginal<typeof import('./cadSketchRelationGlyphLayout')>();
  return { ...original, cadSketchRelationGlyphPlate: vi.fn(original.cadSketchRelationGlyphPlate) };
});
const glyphRenders = vi.mocked(cadSketchRelationGlyphPlate);
// Counts each shared path the glyph layer joins from placed glyphs.
vi.mock('./cadSketchRelationGlyphDrawing', async importOriginal => {
  const original = await importOriginal<typeof import('./cadSketchRelationGlyphDrawing')>();
  return { ...original, joinedPathData: vi.fn(original.joinedPathData) };
});
const pathJoins = vi.mocked(joinedPathData);
// Each picker the canvas prepares counts its queries, so a test can bound the work one pointer move does.
const picks = vi.hoisted(() => ({ graph: 0, profile: 0, edge: 0, grip: 0 }));
vi.mock('./cadSketchGraphInteraction', async importOriginal => {
  const original = await importOriginal<typeof import('./cadSketchGraphInteraction')>();
  return { ...original, prepareCadSketchGraphInteraction: (...args: Parameters<typeof original.prepareCadSketchGraphInteraction>) => {
    const prepared = original.prepareCadSketchGraphInteraction(...args);
    return { ...prepared, pick: (...query: Parameters<typeof prepared.pick>) => { picks.graph += 1; return prepared.pick(...query); } };
  } };
});
vi.mock('./cadSketchPicking', async importOriginal => {
  const original = await importOriginal<typeof import('./cadSketchPicking')>();
  return { ...original,
    createCadSketchProfilePicker: (...args: Parameters<typeof original.createCadSketchProfilePicker>) => {
      const picker = original.createCadSketchProfilePicker(...args);
      return { ...picker, pick: (...query: Parameters<typeof picker.pick>) => { picks.profile += 1; return picker.pick(...query); },
        edgeNear: (...query: Parameters<typeof picker.edgeNear>) => { picks.edge += 1; return picker.edgeNear(...query); } };
    },
    createCadSketchHandlePicker: (...args: Parameters<typeof original.createCadSketchHandlePicker>) => {
      const picker = original.createCadSketchHandlePicker(...args);
      return { ...picker, pick: (...query: Parameters<typeof picker.pick>) => { picks.grip += 1; return picker.pick(...query); } };
    } };
});
const renderedPoints = () => rowRenders.mock.calls.map(([, target]) => target.id);
const renderedEdges = () => edgeRenders.mock.calls.map(([segment]) => segment.id);
const clearRenders = () => { rowRenders.mockClear(); edgeRenders.mockClear(); };

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function mountCanvas(graph: NonNullable<CadSketchFeature['graph']>, initial: Partial<ComponentProps<typeof CadSketchCanvas>>) {
  const sketch: CadSketchFeature = { id: 'sketch', name: 'Sketch', suppressed: false, kind: 'sketch', plane: 'XY', offset: 0, profiles: [], graph };
  const document = { ...createCadDocument('Cursor rendering'), schemaVersion: 2 as const, features: [sketch] };
  let controls: CadRenderedViewControls | null = null;
  let props: ComponentProps<typeof CadSketchCanvas> = { sketch, parameters: {}, documentVersion: 'one', tool: 'rectangle', selectedProfileId: null,
    onSelectProfile: vi.fn(), onAddProfile: vi.fn(), onPendingChange: vi.fn(), onError: vi.fn(), cancelSignal: 0, onControlsReady: value => { controls = value; },
    graphControls: { document, selection: [], onSelect: vi.fn(), onSelectSet: vi.fn(), onDelete: vi.fn(), onEditMany: vi.fn() }, ...initial };
  const show = async (next: Partial<typeof props> = {}) => { props = { ...props, ...next }; await act(async () => root.render(<CadSketchCanvas {...props} />)); };
  await show();
  const svg = container.querySelector<SVGSVGElement>('svg.cad-sketch-canvas'); if (!svg) throw new Error('Missing sketch canvas');
  let captured: number | null = null;
  Object.assign(svg, { getBoundingClientRect: () => ({ left: 10, top: 20, right: 810, bottom: 620, width: 800, height: 600, x: 10, y: 20, toJSON: () => ({}) }),
    setPointerCapture: (id: number) => { captured = id; }, hasPointerCapture: (id: number) => captured === id, releasePointerCapture: () => { captured = null; } });
  const pointer = async (type: string, x: number, y: number, target: Element = svg, buttons = type === 'pointerdown' ? 1 : 0) => {
    const box = svg.getAttribute('viewBox')!.split(' ').map(Number), state = controls?.getState();
    if (!state || state.mode === 'solid') throw new Error('Sketch frame missing');
    const event = new MouseEvent(type, { button: 0, buttons, clientX: 10 + (x - state.centerMm[0] - box[0]) / box[2] * 800, clientY: 20 + (state.centerMm[1] - y - box[1]) / box[3] * 600, bubbles: true });
    Object.defineProperties(event, { pointerId: { value: 3 }, isPrimary: { value: true } });
    await act(async () => target.dispatchEvent(event));
  };
  return { props: () => props, show, pointer, move: (x: number, y: number, target?: Element) => pointer('pointermove', x, y, target), view: () => controls?.getState() };
}

// 51 squares with Horizontal and Vertical on each side draw 204 glyphs, past the limit of 200. Square n's corners are sNa to sNd from its
// lower left, counterclockwise, its sides sNe0 to sNe3 from the bottom, and side k carries relation sNrk.
function cappedSquares() {
  const points: { id: string; position: [number, number] }[] = [], entities: { id: string; kind: 'line'; construction: false; startPointId: string; endPointId: string }[] = [];
  const relations: { id: string; kind: 'horizontal' | 'vertical'; pointIds: [string, string] }[] = [];
  for (let square = 0; square < 51; square++) {
    const x = square % 10 * 14, y = Math.floor(square / 10) * 14, ids = ['a', 'b', 'c', 'd'].map(corner => `s${square}${corner}`);
    [[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10]].forEach(([px, py], corner) => points.push({ id: ids[corner], position: [px, py] }));
    ids.forEach((id, side) => {
      entities.push({ id: `s${square}e${side}`, kind: 'line', construction: false, startPointId: id, endPointId: ids[(side + 1) % 4] });
      relations.push({ id: `s${square}r${side}`, kind: side % 2 ? 'vertical' : 'horizontal', pointIds: [id, ids[(side + 1) % 4]] });
    });
  }
  return { points, entities, relations };
}
const shownGlyphs = () => [...container.querySelectorAll('[data-cad-sketch-relation-glyph]')].map(glyph => glyph.getAttribute('data-cad-sketch-relation-glyph'));
const pointerOver = (target: Element) => act(async () => target.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));
const elapse = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });

describe('sketch canvas cursor rendering', () => {
  it('moves the drawing cursor without rendering unchanged graph rows again', async () => {
    const { props, show, pointer, move } = await mountCanvas({
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'c', position: [20, 10] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'bc', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' }],
      relations: [] }, {});
    expect(renderedPoints()).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    const readout = () => container.querySelector('[data-cad-drawing-readout] text')?.textContent ?? null;

    clearRenders(); await move(5, 5); await move(8, 6); await move(12, 4);
    expect(renderedPoints()).toEqual([]); expect(renderedEdges()).toEqual([]);
    // Hovering a point re-renders only that row for its highlight, and leaving it does the same.
    await move(20, 0); expect(renderedPoints()).toEqual(['b']);
    rowRenders.mockClear(); await move(10, 5); expect(renderedPoints()).toEqual(['b']);

    // With a first corner down, the size readout follows every move while the rows keep their earlier render.
    await pointer('pointerdown', -10, 15); await pointer('pointerup', -10, 15);
    clearRenders(); await move(5, 5); const first = readout(); await move(8, 6); await move(12, 4);
    expect(first).not.toBeNull(); expect(readout()).not.toBe(first);
    expect(renderedPoints()).toEqual([]); expect(renderedEdges()).toEqual([]);

    rowRenders.mockClear(); await show({ graphControls: { ...props().graphControls!, selection: [{ kind: 'point', id: 'c' }] } });
    expect(renderedPoints()).toEqual(['c']);
  });

  it('moves the drawing cursor, hovers relation glyphs and extends a line chain without rendering a glyph row', async () => {
    const line = (id: string, startPointId: string, endPointId: string) => ({ id, kind: 'line' as const, construction: false, startPointId, endPointId });
    const { props, show, pointer, move } = await mountCanvas({
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [40, 0] }, { id: 'c', position: [40, 20] }, { id: 'd', position: [0, 20] }],
      entities: [line('bottom', 'a', 'b'), line('right', 'b', 'c'), line('top', 'c', 'd'), line('left', 'd', 'a')],
      relations: [{ id: 'h1', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'v1', kind: 'vertical', pointIds: ['b', 'c'] }, { id: 'h2', kind: 'horizontal', pointIds: ['c', 'd'] },
        { id: 'v2', kind: 'vertical', pointIds: ['d', 'a'] }, { id: 'across', kind: 'parallel', lineIds: ['bottom', 'top'] }, { id: 'fix', kind: 'fixed-point', pointId: 'a', position: [0, 0] }] }, {});
    await show({ graphControls: { ...props().graphControls!, onSelectRelations: vi.fn() } });
    const glyphs = () => [...container.querySelectorAll('[data-cad-sketch-relation-glyph]')];
    expect(glyphs()).toHaveLength(7); expect(glyphs().every(glyph => glyph.getAttribute('pointer-events') === 'none')).toBe(true);
    // The glyphs lie beneath the dimension lines' hit layer, so a dimension line over a glyph takes the pointer by element order.
    expect(container.querySelector('.cad-sketch-relation-glyphs')!.compareDocumentPosition(container.querySelector('.cad-sketch-graph-dimension-hits')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The drawing cursor follows the pointer, across the glyphs too, and a first corner's size readout with it, while no glyph row renders again.
    const readout = () => container.querySelector('[data-cad-drawing-readout] text')?.textContent ?? null;
    glyphRenders.mockClear(); clearRenders();
    await move(5, 5); await move(20, 10); await pointer('pointerdown', -10, 30); await pointer('pointerup', -10, 30);
    await move(20, 19); const first = readout(); await move(38, 2);
    expect(first).not.toBeNull(); expect(readout()).not.toBe(first); expect(glyphRenders).not.toHaveBeenCalled(); expect(renderedPoints()).toEqual([]);

    // In Select, hovering a glyph only rings it and its sibling through the highlight store: two placements, none for a row, and none for moves on it.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); await show({ tool: 'select' });
    const across = glyphs().filter(glyph => glyph.getAttribute('data-cad-sketch-relation-glyph') === 'across');
    glyphRenders.mockClear(); clearRenders(); canvasRenders.mockClear(); glyphLayerRenders.mockClear();
    await move(20, 10, across[0]); await move(20.2, 10.1, across[0]); await move(20.4, 10.2, across[0]);
    expect(container.querySelectorAll('[data-cad-highlight-glyph="across"]')).toHaveLength(2);
    expect(glyphRenders).toHaveBeenCalledTimes(2); expect(renderedPoints()).toEqual([]); expect(canvasRenders).not.toHaveBeenCalled();
    // Below the glyph limit the layer itself never follows hover, however long the pointer rests; only its ring subscribes to the store.
    await elapse(CAD_SKETCH_RELATION_GLYPH_REVEAL_MS * 2); expect(glyphLayerRenders).not.toHaveBeenCalled();
    expect(across.every(glyph => glyph.isConnected)).toBe(true);
    // Hovering geometry or a dock row that names it renders no glyph row either: only the rings of the relations it names place their glyphs.
    const store = createCadSketchHighlightStore();
    await show({ graphControls: { ...props().graphControls!, onSelectRelations: vi.fn(), highlight: store } });
    glyphRenders.mockClear(); clearRenders(); glyphLayerRenders.mockClear();
    await act(async () => container.querySelector('[data-cad-sketch-point="b"]')!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));
    await act(async () => store.show('row', { kind: 'geometry', pointIds: ['a', 'b'], entityIds: ['bottom'], datums: [], relationIds: ['h1'] })); await elapse(CAD_SKETCH_RELATION_GLYPH_REVEAL_MS * 2);
    expect(container.querySelectorAll('[data-cad-highlight-glyph="h1"]')).toHaveLength(1); expect(glyphRenders).toHaveBeenCalledTimes(1); expect(glyphLayerRenders).not.toHaveBeenCalled();
    await act(async () => store.hide('row'));

    // A pending line chain keeps every glyph inert and renders none while the rubber band follows the pointer.
    await show({ tool: 'line' });
    await pointer('pointerdown', -10, 30); await pointer('pointerup', -10, 30); await pointer('pointerdown', 10, 30); await pointer('pointerup', 10, 30);
    glyphRenders.mockClear(); clearRenders();
    await move(15, 25); await move(20, 10, across[0]); await move(30, 26);
    expect(glyphRenders).not.toHaveBeenCalled(); expect(renderedPoints()).toEqual([]);
    expect(glyphs().every(glyph => glyph.getAttribute('pointer-events') === 'none' && glyph.getAttribute('tabindex') === '-1')).toBe(true);
  });

  it('draws only the glyphs on selected geometry, and on what the pointer rests on, above the glyph limit and says so in Select', async () => {
    const { props, show } = await mountCanvas(cappedSquares(), { tool: 'select' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const rest = CAD_SKETCH_RELATION_GLYPH_REVEAL_MS, status = () => container.querySelector('[data-cad-dimension-status]')?.textContent ?? null;
    await show({ graphControls: { ...props().graphControls!, onSelectRelations: vi.fn() } });
    expect(shownGlyphs()).toEqual([]); expect(status()).toBe('Relations shown on selected or hovered geometry · 204 marks in this sketch');
    // The selection shows its glyphs at once.
    await show({ graphControls: { ...props().graphControls!, selection: [{ kind: 'entity', id: 's7e1' }], dimensionSelection: ['s30r2'] } });
    expect(shownGlyphs()).toEqual(['s7r1', 's30r2']);
    // A relations-list row the pointer rests on shows its relation's glyphs, and its geometry hover shows nothing more.
    const store = createCadSketchHighlightStore();
    await show({ graphControls: { ...props().graphControls!, highlight: store } });
    await act(async () => store.show('row', { kind: 'geometry', pointIds: ['s40a', 's40b'], entityIds: ['s40e0'], datums: [], relationIds: ['s40r0'] }));
    expect(shownGlyphs()).toEqual(['s7r1', 's30r2']);
    await elapse(rest); expect(shownGlyphs()).toEqual(['s7r1', 's30r2', 's40r0']);
    await act(async () => store.hide('row')); await elapse(rest); expect(shownGlyphs()).toEqual(['s7r1', 's30r2']);
    // Resting on a corner shows both edge marks that hold it, though neither sits on the corner; the pointer can cross to a shown glyph and keep them.
    await pointerOver(container.querySelector('[data-cad-sketch-point="s45a"]')!);
    await elapse(rest); expect(shownGlyphs()).toEqual(['s7r1', 's30r2', 's45r0', 's45r3']);
    await pointerOver(container.querySelector('[data-cad-sketch-relation-glyph="s45r3"]')!);
    await elapse(450); expect(shownGlyphs()).toEqual(['s7r1', 's30r2', 's45r0', 's45r3']);
    // Empty canvas lets them go after a moment, and leaving the canvas at once.
    const canvas = container.querySelector('svg.cad-sketch-canvas')!;
    // Leaving the hovered glyph for empty canvas, which lets go of the glyph's own hover too.
    await act(async () => container.querySelector('[data-cad-sketch-relation-glyph="s45r3"]')!.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: canvas })));
    await pointerOver(canvas); expect(shownGlyphs()).toEqual(['s7r1', 's30r2', 's45r0', 's45r3']);
    await elapse(450); expect(shownGlyphs()).toEqual(['s7r1', 's30r2']);
    await pointerOver(container.querySelector('[data-cad-sketch-entity="s46e1"]')!); await elapse(rest); expect(shownGlyphs()).toEqual(['s7r1', 's30r2', 's46r1']);
    await act(async () => canvas.dispatchEvent(new MouseEvent('pointerleave')));
    expect(shownGlyphs()).toEqual(['s7r1', 's30r2']);
    // A drawing tool keeps the limit but leaves the status line to the drawing.
    await show({ tool: 'line' });
    expect(shownGlyphs()).toEqual(['s7r1', 's30r2']); expect(status()).toBeNull();
  });

  it('reveals hover above the glyph limit once the pointer rests on one target, and drops a pending reveal when the target, the tool, the sketch, the setting, the canvas or a drag changes', async () => {
    const graph = cappedSquares();
    const { props, show, pointer } = await mountCanvas(graph, { tool: 'select' });
    await show({ graphControls: { ...props().graphControls!, onSelectRelations: vi.fn() } });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const set = vi.spyOn(globalThis, 'setTimeout'), clear = vi.spyOn(globalThis, 'clearTimeout');
    const rest = CAD_SKETCH_RELATION_GLYPH_REVEAL_MS, canvas = container.querySelector('svg.cad-sketch-canvas')!;
    const corner = (id: string) => container.querySelector(`[data-cad-sketch-point="${id}"]`)!;
    const leave = () => act(async () => canvas.dispatchEvent(new MouseEvent('pointerleave')));
    const cleared = (timer: unknown) => clear.mock.calls.some(([value]) => value === timer);
    // Rests half the delay on a corner and returns the reveal that armed, still pending.
    const arm = async (id: string) => {
      const before = set.mock.calls.length;
      await pointerOver(corner(id)); await elapse(rest / 2);
      const index = set.mock.calls.map(([, delay]) => delay).lastIndexOf(rest);
      expect(index).toBeGreaterThanOrEqual(before); expect(cleared(set.mock.results[index].value)).toBe(false);
      return set.mock.results[index].value;
    };

    // Nothing shows before the pointer has rested, and the corner's marks once it has.
    await pointerOver(corner('s45a')); await elapse(rest - 1); expect(shownGlyphs()).toEqual([]);
    await elapse(1); expect(shownGlyphs()).toEqual(['s45r0', 's45r3']);
    // Each new target starts the wait again, so passing over corners shows none of them, and the first corner's marks stay until then.
    await pointerOver(corner('s46a')); await elapse(rest - 1);
    await pointerOver(corner('s47a')); await elapse(rest - 1); expect(shownGlyphs()).toEqual(['s45r0', 's45r3']);
    await elapse(1); expect(shownGlyphs()).toEqual(['s47r0', 's47r3']);
    // Moving onto a shown glyph before another target has rested drops that reveal and keeps the shown geometry's glyphs.
    await pointerOver(container.querySelector('[data-cad-sketch-entity="s46e1"]')!); await elapse(rest / 2);
    await pointerOver(container.querySelector('[data-cad-sketch-relation-glyph="s47r3"]')!); await elapse(rest * 2);
    expect(shownGlyphs()).toEqual(['s47r0', 's47r3']);

    // Leaving the canvas drops what is shown and what is pending.
    await leave(); expect(shownGlyphs()).toEqual([]);
    let pending = await arm('s48a'); await leave();
    expect(cleared(pending)).toBe(true); await elapse(rest * 2); expect(shownGlyphs()).toEqual([]);
    // So does a change of tool, even back to Select before the delay is up.
    pending = await arm('s48a'); await show({ tool: 'line' }); await show({ tool: 'select' });
    expect(cleared(pending)).toBe(true); await elapse(rest * 2); expect(shownGlyphs()).toEqual([]);
    // And an edit to the sketch.
    const sketch = props().sketch; if (sketch.kind !== 'sketch') throw new Error('Sketch missing.');
    pending = await arm('s48a'); await show({ sketch: { ...sketch, graph: { ...graph, points: graph.points.map(point => ({ ...point })) } } });
    expect(cleared(pending)).toBe(true); await elapse(rest * 2); expect(shownGlyphs()).toEqual([]);
    // And turning the relations off.
    pending = await arm('s48a'); await show({ graphControls: { ...props().graphControls!, showRelations: false } });
    expect(container.querySelector('.cad-sketch-relation-glyphs')).toBeNull(); expect(cleared(pending)).toBe(true);
    await show({ graphControls: { ...props().graphControls!, showRelations: true } }); await elapse(rest * 2); expect(shownGlyphs()).toEqual([]);
    // And a drag, from its press to its release.
    const pressed = corner('s46b'); let captured: number | null = null;
    Object.assign(pressed, { setPointerCapture: (id: number) => { captured = id; }, hasPointerCapture: (id: number) => captured === id, releasePointerCapture: () => { captured = null; } });
    pending = await arm('s48a'); await pointer('pointerdown', 94, 56, pressed);
    expect(cleared(pending)).toBe(true); await elapse(rest * 2); expect(shownGlyphs()).toEqual([]);
    await pointer('pointermove', 95, 57, pressed, 1); await pointer('pointerup', 95, 57, pressed); await elapse(rest * 2); expect(shownGlyphs()).toEqual([]);
    // And unmounting the canvas.
    pending = await arm('s48a'); await act(async () => root.render(<></>)); expect(cleared(pending)).toBe(true);
  });

  it('drags geometry without rendering the relation glyphs it does not move, when the drag starts or ends', async () => {
    const line = (id: string, startPointId: string, endPointId: string) => ({ id, kind: 'line' as const, construction: false, startPointId, endPointId });
    const { props, show, pointer } = await mountCanvas({
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [40, 0] }, { id: 'c', position: [40, 20] }, { id: 'd', position: [0, 20] },
        { id: 'e', position: [10, 8] }, { id: 'f', position: [16, 8] }],
      entities: [line('bottom', 'a', 'b'), line('right', 'b', 'c'), line('top', 'c', 'd'), line('left', 'd', 'a'), line('loose', 'e', 'f')],
      relations: [{ id: 'h1', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'v1', kind: 'vertical', pointIds: ['b', 'c'] }, { id: 'across', kind: 'parallel', lineIds: ['bottom', 'top'] }] }, { tool: 'select' });
    await show({ graphControls: { ...props().graphControls!, onSelectRelations: vi.fn() } });
    const loose = container.querySelector<SVGGElement>('[data-cad-sketch-entity="loose"]'), layer = container.querySelector('.cad-sketch-graph');
    if (!loose || !layer) throw new Error('Loose edge missing.');
    let captured: number | null = null;
    Object.assign(loose, { setPointerCapture: (id: number) => { captured = id; }, hasPointerCapture: (id: number) => captured === id, releasePointerCapture: () => { captured = null; } });
    // The loose edge moves inside the sketch's bounds, so no glyph changes place: neither the drag, its dragging state nor the edit it submits renders a glyph row.
    glyphRenders.mockClear();
    await pointer('pointerdown', 13, 8, loose); await pointer('pointermove', 14, 9, loose, 1); await pointer('pointermove', 15, 10, loose, 1);
    expect(layer.classList.contains('is-dragging')).toBe(true); expect(glyphRenders).not.toHaveBeenCalled();
    // The drag turns the whole glyph layer inert, while each glyph stays a tab stop.
    expect(container.querySelector('.cad-sketch-relation-glyphs')?.getAttribute('pointer-events')).toBe('none');
    await pointer('pointerup', 15, 10, loose);
    expect(layer.classList.contains('is-dragging')).toBe(false); expect(glyphRenders).not.toHaveBeenCalled();
    expect(props().graphControls!.onEditMany).toHaveBeenCalledTimes(1);
    expect([...container.querySelectorAll('[data-cad-sketch-relation-glyph]')].every(glyph => glyph.getAttribute('tabindex') === '0')).toBe(true);
  });

  it('drags the glyphs a drag moves as paths of their own, hiding their rows in place, on a layer composited apart, so later frames render no glyph row and join no shared path', async () => {
    const line = (id: string, startPointId: string, endPointId: string) => ({ id, kind: 'line' as const, construction: false, startPointId, endPointId });
    const { props, show, pointer } = await mountCanvas({
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [40, 0] }, { id: 'c', position: [40, 20] }, { id: 'd', position: [0, 20] }],
      entities: [line('bottom', 'a', 'b'), line('right', 'b', 'c'), line('top', 'c', 'd'), line('left', 'd', 'a')],
      relations: [{ id: 'h1', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'v1', kind: 'vertical', pointIds: ['b', 'c'] }, { id: 'v2', kind: 'vertical', pointIds: ['d', 'a'] }] }, { tool: 'select' });
    await show({ graphControls: { ...props().graphControls!, onSelectRelations: vi.fn() } });
    const corner = container.querySelector<SVGGElement>('[data-cad-sketch-point="c"]'); if (!corner) throw new Error('Corner missing.');
    let captured: number | null = null;
    Object.assign(corner, { setPointerCapture: (id: number) => { captured = id; }, hasPointerCapture: (id: number) => captured === id, releasePointerCapture: () => { captured = null; } });
    const rows = () => [...container.querySelectorAll('[data-cad-sketch-relation-glyph]')];
    const hidden = () => rows().filter(row => row.getAttribute('visibility') === 'hidden').map(row => row.getAttribute('data-cad-sketch-relation-glyph'));
    const data = (selector: string) => [...container.querySelectorAll(selector)].map(path => path.getAttribute('d')!);
    // The glyphs at rest draw as the layer's shared plate and icon paths, and the moved ones as paths of their own beside it.
    const shared = () => data('.cad-sketch-relation-glyphs > path'), moved = () => data('.cad-sketch-relation-glyphs-moved path');
    const plates = () => container.querySelector('.cad-sketch-relation-glyphs > .cad-sketch-relation-glyph-plates')?.getAttribute('d')?.match(/M/g)?.length ?? 0;
    // While a drag runs the layer has a compositor layer of its own, so the sketch repainting each frame leaves the glyphs alone.
    const composited = () => container.querySelector('.cad-sketch-relation-glyphs')!.classList.contains('is-dragging');
    const before = rows(), resting = shared();
    expect(composited()).toBe(false); expect(resting).toHaveLength(2); expect(plates()).toBe(3); expect(moved()).toEqual([]);
    // Moving the corner straight up carries the right edge's Vertical: its row hides once, it leaves the shared paths, which are joined
    // again once, and its plate and icon draw apart.
    glyphRenders.mockClear(); pathJoins.mockClear();
    await pointer('pointerdown', 40, 20, corner); await pointer('pointermove', 40, 22, corner, 1);
    expect(hidden()).toEqual(['v1']); expect(glyphRenders).toHaveBeenCalledTimes(1); expect(composited()).toBe(true);
    const first = shared(), firstMoved = moved();
    expect(plates()).toBe(2); expect(first).toHaveLength(2); expect(first).not.toEqual(resting); expect(firstMoved).toHaveLength(2);
    expect(pathJoins).toHaveBeenCalledTimes(4);
    // The moved glyphs draw beside the composited layer, which keeps only its rows and shared paths, so the drag leaves it as it was.
    expect(container.querySelectorAll('.cad-sketch-relation-glyphs path')).toHaveLength(2);
    glyphRenders.mockClear(); pathJoins.mockClear();
    const sharedPaths = [...container.querySelectorAll('.cad-sketch-relation-glyphs > path')];
    await pointer('pointermove', 40, 24, corner, 1);
    expect(glyphRenders).not.toHaveBeenCalled(); expect(hidden()).toEqual(['v1']);
    // Only the moved glyphs' two paths are joined again and change; the shared paths keep their elements and data.
    expect(pathJoins).toHaveBeenCalledTimes(2);
    expect(shared()).toEqual(first); expect(moved()).not.toEqual(firstMoved);
    expect([...container.querySelectorAll('.cad-sketch-relation-glyphs > path')].every((path, index) => path === sharedPaths[index])).toBe(true);
    // The rows keep their elements, so focus and tab order hold, and the glyph returns to the shared paths where it lay once the drag ends.
    await pointer('pointerup', 40, 24, corner);
    expect(hidden()).toEqual([]); expect(shared()).toEqual(resting); expect(moved()).toEqual([]); expect(composited()).toBe(false);
    expect(container.querySelector('.cad-sketch-relation-glyphs-moved')).toBeNull();
    expect(rows().every((row, index) => row === before[index])).toBe(true);
  });

  it('draws the glyphs at rest as shared paths and a lit, selected or focused glyph on its own, and joins the paths again only when the glyphs they hold or the view change', async () => {
    const line = (id: string, startPointId: string, endPointId: string) => ({ id, kind: 'line' as const, construction: false, startPointId, endPointId });
    const { props, show, move } = await mountCanvas({
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [40, 0] }, { id: 'c', position: [40, 20] }, { id: 'd', position: [0, 20] }],
      entities: [line('bottom', 'a', 'b'), line('right', 'b', 'c'), line('top', 'c', 'd'), line('left', 'd', 'a')],
      relations: [{ id: 'h1', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'v1', kind: 'vertical', pointIds: ['b', 'c'] }, { id: 'h2', kind: 'horizontal', pointIds: ['c', 'd'] },
        { id: 'v2', kind: 'vertical', pointIds: ['d', 'a'] }, { id: 'across', kind: 'parallel', lineIds: ['bottom', 'top'] }, { id: 'fix', kind: 'fixed-point', pointId: 'a', position: [0, 0] }] }, { tool: 'select' });
    const store = createCadSketchHighlightStore(), canvas = container.querySelector('svg.cad-sketch-canvas')!;
    await show({ graphControls: { ...props().graphControls!, onSelectRelations: vi.fn(), highlight: store } });
    const layer = () => container.querySelector('.cad-sketch-relation-glyphs')!;
    // Each plate's data is one closed figure, so a shared plate path holds as many glyphs as it has moves.
    const held = (selector: string) => [...container.querySelectorAll(selector)].reduce((sum, path) => sum + (path.getAttribute('d')?.match(/M/g)?.length ?? 0), 0);
    const shared = (state = 'plain') => held(`.cad-sketch-relation-glyphs > .cad-sketch-relation-glyph-plates.is-${state}`);
    const rows = () => [...container.querySelectorAll<SVGGElement>('[data-cad-sketch-relation-glyph]')];
    const row = (id: string) => rows().filter(item => item.getAttribute('data-cad-sketch-relation-glyph') === id);
    // A row draws its own plate and icon, rather than an unpainted plate, only for a glyph out of the shared paths.
    const own = () => rows().filter(item => item.querySelector('rect')?.getAttribute('visibility') !== 'hidden').map(item => item.getAttribute('data-cad-sketch-relation-glyph'));
    const ownIcons = () => rows().flatMap(item => item.querySelector('path.cad-sketch-relation-glyph-icons') ? [item.getAttribute('data-cad-sketch-relation-glyph')] : []);
    const lit = () => held('.cad-sketch-relation-glyphs-lit .cad-sketch-relation-glyph-plates'), rings = () => container.querySelectorAll('[data-cad-highlight-glyph]').length;
    const leave = (target: Element) => act(async () => target.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: canvas })));

    // At rest the seven glyphs paint as one plate path and one icon path; their rows paint nothing.
    expect(rows()).toHaveLength(7); expect(shared()).toBe(7); expect(layer().querySelectorAll(':scope > path')).toHaveLength(2);
    expect(own()).toEqual([]); expect(ownIcons()).toEqual([]);
    // Moving over empty canvas and geometry joins nothing and leaves the shared paths' elements and data as they were.
    const paths = [...layer().querySelectorAll(':scope > path')], data = paths.map(path => path.getAttribute('d'));
    pathJoins.mockClear(); await move(5, 5); await move(20, 10); await move(40, 10); await move(30, 15);
    expect(pathJoins).not.toHaveBeenCalled();
    expect([...layer().querySelectorAll(':scope > path')].every((path, index) => path === paths[index] && path.getAttribute('d') === data[index])).toBe(true);

    // Hovering a Parallel glyph lights both of its glyphs: they leave the shared paths, joined again once, and draw on their own with their rings.
    const across = row('across');
    await move(20, 10, across[0]);
    expect(shared()).toBe(5); expect(lit()).toBe(2); expect(rings()).toBe(2); expect(pathJoins).toHaveBeenCalledTimes(2);
    pathJoins.mockClear(); await move(20.2, 10.1, across[0]); await move(20.4, 10.2, across[0]); expect(pathJoins).not.toHaveBeenCalled();
    await leave(across[0]); expect(shared()).toBe(7); expect(lit()).toBe(0); expect(rings()).toBe(0);
    // A dock row naming geometry alone lights no glyph, so it joins nothing.
    pathJoins.mockClear(); await act(async () => store.show('row', { kind: 'geometry', pointIds: ['a'], entityIds: ['bottom'], datums: [] }));
    expect(pathJoins).not.toHaveBeenCalled(); expect(shared()).toBe(7); await act(async () => store.hide('row'));

    // A selected glyph draws in its row, in the selected state, and leaves the shared paths.
    await show({ graphControls: { ...props().graphControls!, dimensionSelection: ['h1'] } });
    expect(own()).toEqual(['h1']); expect(ownIcons()).toEqual(['h1']); expect(row('h1')[0].querySelector('path')?.classList.contains('is-selected')).toBe(true); expect(shared()).toBe(6);
    // A lit glyph that already draws on its own keeps one drawing and gains only its ring.
    await act(async () => store.show('row', { kind: 'geometry', pointIds: [], entityIds: [], datums: [], relationIds: ['h1', 'h2'] }));
    expect(lit()).toBe(1); expect(rings()).toBe(2); expect(shared()).toBe(5); expect(own()).toEqual(['h1']);
    await act(async () => store.hide('row')); expect(shared()).toBe(6);
    // A focused glyph draws in its row, so its focus ring shows, and returns to the shared paths once focus leaves it.
    await act(async () => row('v1')[0].focus()); expect(own()).toEqual(['h1', 'v1']); expect(shared()).toBe(5);
    await act(async () => row('v1')[0].blur()); expect(own()).toEqual(['h1']); expect(shared()).toBe(6);

    // Glyphs related to selected geometry stay in the shared paths, in a path of their own state.
    await show({ graphControls: { ...props().graphControls!, dimensionSelection: [], selection: [{ kind: 'entity', id: 'bottom' }] } });
    const related = rows().filter(item => item.classList.contains('is-related')).length;
    expect(related).toBeGreaterThan(0); expect(shared('related')).toBe(related); expect(shared()).toBe(7 - related); expect(own()).toEqual([]);

    // A zoom places every glyph again, so the shared paths are joined again, and keep their elements.
    pathJoins.mockClear(); const zoomed = [...layer().querySelectorAll(':scope > path')], before = zoomed.map(path => path.getAttribute('d'));
    await act(async () => canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: 400, clientY: 300, bubbles: true, cancelable: true })));
    expect(pathJoins.mock.calls.length).toBeGreaterThan(0); expect(held('.cad-sketch-relation-glyphs > .cad-sketch-relation-glyph-plates')).toBe(7);
    expect([...layer().querySelectorAll(':scope > path')].map(path => path.getAttribute('d'))).not.toEqual(before);
    expect([...layer().querySelectorAll(':scope > path')].every((path, index) => path === zoomed[index])).toBe(true);
  });

  it('picks a glyph drawn in the shared paths through its row: of two that overlap, the later is drawn and picked on top, and a moved glyph stands aside while the one beside it keeps its place', async () => {
    const line = (id: string, startPointId: string, endPointId: string) => ({ id, kind: 'line' as const, construction: false, startPointId, endPointId });
    const onSelectRelations = vi.fn();
    // Two fixed points 0.4 mm apart, whose glyphs overlap, and a short vertical edge beside the rectangle's right edge.
    const { props, show, pointer } = await mountCanvas({
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [40, 0] }, { id: 'c', position: [40, 20] }, { id: 'd', position: [0, 20] },
        { id: 'e', position: [10, 30] }, { id: 'g', position: [10.4, 30] }, { id: 'i', position: [43, 8] }, { id: 'j', position: [43, 12] }],
      entities: [line('bottom', 'a', 'b'), line('right', 'b', 'c'), line('top', 'c', 'd'), line('left', 'd', 'a'), line('post', 'i', 'j')],
      relations: [{ id: 'h1', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'v1', kind: 'vertical', pointIds: ['b', 'c'] }, { id: 'pin', kind: 'fixed-point', pointId: 'e', position: [10, 30] },
        { id: 'peg', kind: 'fixed-point', pointId: 'g', position: [10.4, 30] }, { id: 'v3', kind: 'vertical', pointIds: ['i', 'j'] }] }, { tool: 'select' });
    await show({ graphControls: { ...props().graphControls!, onSelectRelations } });
    const row = (id: string) => container.querySelector<SVGGElement>(`[data-cad-sketch-relation-glyph="${id}"]`)!;
    const box = (id: string) => ['x', 'y', 'width', 'height'].map(name => Number(row(id).querySelector('rect')!.getAttribute(name)));
    // Where a glyph's plate starts in the shared plate path: its first move is 2 px in from its row's plate corner.
    const format = (value: number) => String(Math.round(value * 100) / 100 + 0);
    const plateAt = (id: string) => { const [x, y] = box(id); return container.querySelector('.cad-sketch-relation-glyphs > .cad-sketch-relation-glyph-plates')!.getAttribute('d')!.indexOf(`M${format(x + 2)} ${format(y)}`); };
    // A press and click in empty canvas, as the cover test sees it, on a glyph's row.
    const press = async (id: string) => {
      await pointer('pointerdown', 20, 10, row(id));
      await act(async () => row(id).dispatchEvent(new MouseEvent('click', { button: 0, detail: 1, bubbles: true, cancelable: true })));
    };
    const picked = () => onSelectRelations.mock.lastCall?.[0]?.map((pick: { readonly id: string }) => pick.id);

    // Each glyph picks its own relation, though its row paints nothing. A press focuses the glyph, which then draws in its row until focus leaves it.
    const ids = ['h1', 'v1', 'pin', 'peg', 'v3'], painted = (id: string) => row(id).querySelector('rect')?.getAttribute('visibility') !== 'hidden';
    expect(ids.filter(painted)).toEqual([]);
    for (const id of ids) { await press(id); expect(picked()).toEqual([id]); expect(ids.filter(painted)).toEqual([id]); }
    await act(async () => container.querySelector<SVGSVGElement>('svg.cad-sketch-canvas')!.focus()); expect(ids.filter(painted)).toEqual([]);
    // The two Fixed glyphs of the close points overlap. The shared path paints the plates in the rows' order, the reverse of the
    // order the pointer finds the rows in, so the one drawn on top is the one a press there picks.
    const [pinX, pinY, width, height] = box('pin'), [pegX, pegY] = box('peg');
    expect(Math.abs(pinX - pegX) < width && Math.abs(pinY - pegY) < height).toBe(true);
    const order = [...container.querySelectorAll('[data-cad-sketch-relation-glyph]')].map(item => item.getAttribute('data-cad-sketch-relation-glyph')!);
    const starts = order.map(plateAt);
    expect(starts.every(start => start >= 0)).toBe(true); expect(starts).toEqual([...starts].sort((first, second) => first - second));

    // Dragging the rectangle's top right corner up moves the right edge's Vertical. Its row stands aside, hidden and out of picks, while the
    // short edge's Vertical beside it keeps its row, its place and its place in the shared paths, and the drag keeps every glyph inert.
    const corner = container.querySelector<SVGGElement>('[data-cad-sketch-point="c"]')!; let captured: number | null = null;
    Object.assign(corner, { setPointerCapture: (id: number) => { captured = id; }, hasPointerCapture: (id: number) => captured === id, releasePointerCapture: () => { captured = null; } });
    const beside = box('v3');
    await pointer('pointerdown', 40, 20, corner); await pointer('pointermove', 40, 24, corner, 1);
    expect(row('v1').getAttribute('visibility')).toBe('hidden'); expect(row('v1').classList.contains('is-moved')).toBe(true); expect(plateAt('v1')).toBe(-1);
    expect(row('v3').classList.contains('is-moved')).toBe(false); expect(box('v3')).toEqual(beside); expect(plateAt('v3')).toBeGreaterThanOrEqual(0);
    onSelectRelations.mockClear(); await press('v3'); expect(onSelectRelations).not.toHaveBeenCalled();
    await pointer('pointerup', 40, 24, corner);
    // Once the drag ends the moved glyph is back in its row, and both pick their own relations.
    expect(row('v1').classList.contains('is-moved')).toBe(false); expect(plateAt('v1')).toBeGreaterThanOrEqual(0);
    await press('v3'); expect(picked()).toEqual(['v3']); await press('v1'); expect(picked()).toEqual(['v1']);
  });

  it('highlights the measured geometry on dimension hover and selection without rendering rows or the canvas again', async () => {
    const sketch: CadSketchFeature = { id: 'sketch', name: 'Sketch', suppressed: false, kind: 'sketch', plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'c', position: [20, 10] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'bc', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' }],
      relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 20 }, { id: 'rise', kind: 'axis-distance', pointIds: ['b', 'c'], axis: 'y', value: 10 }] } };
    const document = { ...createCadDocument('Dimension hover'), schemaVersion: 2 as const, features: [sketch] };
    const graphControls = { document, selection: [], onSelect: vi.fn(), onSelectSet: vi.fn(), onDelete: vi.fn(), onEditMany: vi.fn(), onConfigureRelation: vi.fn(), onSelectDimension: vi.fn() };
    const props: ComponentProps<typeof CadSketchCanvas> = { sketch, parameters: {}, documentVersion: 'one', tool: 'select', selectedProfileId: null,
      onSelectProfile: vi.fn(), onAddProfile: vi.fn(), onPendingChange: vi.fn(), onError: vi.fn(), cancelSignal: 0, graphControls };
    await act(async () => root.render(<CadSketchCanvas {...props} />));
    const annotation = (id: string) => container.querySelector(`[data-cad-sketch-dimension="${id}"] .cad-sketch-graph-dimension-hit`)!;
    const highlighted = () => [...container.querySelectorAll('[data-cad-highlight-point], [data-cad-highlight-entity]')]
      .map(element => element.getAttribute('data-cad-highlight-point') ?? element.getAttribute('data-cad-highlight-entity')).sort();
    // The pointer moves between the canvas background and a dimension; it never leaves the canvas.
    const svg = container.querySelector('svg.cad-sketch-canvas')!;
    // React derives enter and leave inside its root from the out event of the element the pointer leaves.
    const hover = (target: Element, entered: boolean) => act(async () => {
      (entered ? svg : target).dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: entered ? target : svg }));
    });
    Object.assign(svg, { getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) }) });
    const parts = (id: string) => [annotation(id), ...container.querySelectorAll(`[data-cad-sketch-dimension-hit="${id}"] :is(line, path, polygon)`)];
    // The pointer crosses each part of the annotation at a few positions, as a real pointer does.
    const sweep = async (id: string) => {
      for (const [index, part] of parts(id).entries()) for (const offset of [0, 3, 7]) await act(async () => {
        const event = new MouseEvent('pointermove', { bubbles: true, clientX: 300 + index * 10 + offset, clientY: 200 + offset }); Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
        part.dispatchEvent(event);
      });
    };
    expect(annotation('length')).not.toBeNull(); expect(highlighted()).toEqual([]);
    expect(container.querySelectorAll('[data-cad-sketch-dimension="length"] .cad-sketch-graph-dimension-arrow').length).toBeGreaterThan(0);

    clearRenders(); canvasRenders.mockClear();
    await hover(annotation('length'), true); await sweep('length');
    expect(highlighted()).toEqual(['a', 'ab', 'b']);
    await hover(annotation('length'), false); await hover(annotation('rise'), true); await sweep('rise');
    expect(highlighted()).toEqual(['b', 'bc', 'c']);
    await hover(annotation('rise'), false);
    expect(highlighted()).toEqual([]);
    // Only the overlay draws the measured edges, once for each highlight; no point or edge row renders again.
    expect(renderedPoints()).toEqual([]); expect(renderedEdges()).toEqual(['ab', 'bc']); expect(canvasRenders).not.toHaveBeenCalled();
    // The same move over the open canvas does update the cursor.
    await act(async () => {
      const event = new MouseEvent('pointermove', { bubbles: true, clientX: 600, clientY: 500 }); Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
      svg.dispatchEvent(event);
    });
    expect(canvasRenders).toHaveBeenCalled();

    // A selected dimension keeps its geometry highlighted and draws in the selection colour; the rows stay as they were.
    clearRenders();
    await act(async () => root.render(<CadSketchCanvas {...props} graphControls={{ ...graphControls, dimensionSelection: ['rise'] }} />));
    expect(renderedPoints()).toEqual([]); expect(renderedEdges()).toEqual(['bc']); expect(highlighted()).toEqual(['b', 'bc', 'c']);
    expect(container.querySelector('[data-cad-sketch-dimension="rise"]')?.classList.contains('is-selected')).toBe(true);
    expect(container.querySelector('[data-cad-dimension-status]')?.textContent).toBe('Vertical distance selected · Double-click or Enter edits · Delete removes');
  });

  it('renders only the rows whose definition changed, and none for hover away from them', async () => {
    const { props, show, move } = await mountCanvas({
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'c', position: [20, 10] }, { id: 'd', position: [0, 10] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'bc', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' },
        { id: 'cd', kind: 'line', construction: true, startPointId: 'c', endPointId: 'd' }],
      relations: [] }, { tool: 'select' });
    const definition = (pointIds: string[], entityIds: string[]) => cadSketchDefinitionMarks({ definedPointIds: pointIds, underDefinedPointIds: [], definedEntityIds: entityIds, underDefinedEntityIds: [] });
    const first = definition(['a', 'b'], ['ab']);
    await show({ graphControls: { ...props().graphControls!, definition: first, definitionLocked: true } });
    const marked = (kind: 'point' | 'entity', mark: string) => [...container.querySelectorAll(`[data-cad-sketch-${kind}].is-${mark}`)].map(item => item.getAttribute(`data-cad-sketch-${kind}`));
    expect(marked('entity', 'defined')).toEqual(['ab']); expect(marked('point', 'defined')).toEqual(['a', 'b']);
    clearRenders(); await move(10, 30); await move(12, 32); await move(-15, 25);
    expect(renderedPoints()).toEqual([]); expect(renderedEdges()).toEqual([]);
    // An equal definition from a newer analysis renders nothing; a changed one renders exactly the rows that changed state.
    clearRenders(); await show({ graphControls: { ...props().graphControls!, definition: cadSketchDefinitionMarks({ definedPointIds: ['a', 'b'], underDefinedPointIds: [], definedEntityIds: ['ab'], underDefinedEntityIds: [] }, first) } });
    expect(renderedPoints()).toEqual([]); expect(renderedEdges()).toEqual([]);
    clearRenders(); await show({ graphControls: { ...props().graphControls!, definition: definition(['a', 'b', 'c', 'd'], ['ab', 'cd']) } });
    expect(renderedPoints().sort()).toEqual(['c', 'd']); expect(renderedEdges()).toEqual(['cd']);
    expect(marked('entity', 'defined')).toEqual(['ab', 'cd']);
  });

  it('hovers over a long pending line chain without rendering graph rows or its drawn segments again', async () => {
    const onAddPath = vi.fn(), onPendingChange = vi.fn();
    const { pointer, move } = await mountCanvas({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: [] }, { tool: 'line', onAddPath, onPendingChange });
    const tap = async (x: number, y: number) => { await pointer('pointerdown', x, y); await pointer('pointerup', x, y); };
    const mode = async (label: string) => { const control = [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === label); if (!control) throw new Error(`Missing ${label}`); await act(async () => control.click()); };
    // Thirty zigzag lines, then a three-point arc, then a line, all away from the saved graph.
    for (let index = 0; index <= 30; index++) await tap(-45 + index * 3, 30 + index % 2 * 5);
    await mode('3-point Arc'); await tap(52, 30); await tap(48.5, 33); await mode('Line'); await tap(55, 24);
    expect(container.querySelectorAll('[data-cad-path-segments] > *')).toHaveLength(32);
    clearRenders(); arcPaths.mockClear();
    await move(10, 18); await move(14, 20); await move(-20, 15); await move(40, 12);
    expect(renderedPoints()).toEqual([]); expect(renderedEdges()).toEqual([]); expect(arcPaths).not.toHaveBeenCalled();
    // Nothing is saved or solved while the chain is pending.
    expect(onAddPath).not.toHaveBeenCalled(); expect(onPendingChange).toHaveBeenLastCalledWith(true);
  });

  it('highlights the axis under the pointer anywhere along it without rendering graph rows again', async () => {
    const graph: NonNullable<CadSketchFeature['graph']> = { points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 10] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: [] };
    const { props, show, move } = await mountCanvas(graph, { tool: 'select' });
    await show({ graphControls: { ...props().graphControls!, onSelectDatum: vi.fn() } });
    const highlighted = () => [...container.querySelectorAll('[data-cad-sketch-datum].is-pick-highlighted')].map(item => item.getAttribute('data-cad-sketch-datum'));
    clearRenders();
    await move(15, 0.02); expect(highlighted()).toEqual(['x-axis']);
    await move(0.02, 8); expect(highlighted()).toEqual(['y-axis']);
    await move(12, 8); expect(highlighted()).toEqual([]);
    expect(renderedPoints()).toEqual([]); expect(renderedEdges()).toEqual([]);
  });

  it('answers axis hover from the hit tests the move already makes, querying each picker at most once and never the graph', async () => {
    const graph: NonNullable<CadSketchFeature['graph']> = { points: [{ id: 'a', position: [10, 0] }, { id: 'b', position: [20, 10] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: [] };
    const { props, show, move } = await mountCanvas(graph, { tool: 'select' });
    const box = (id: string, x: number, y: number, width: number, height: number) => ({ id, name: id, construction: false, geometry: { kind: 'rectangle' as const, x, y, width, height, cornerRadius: 0 } });
    const sketch = props().sketch; if (sketch.kind !== 'sketch') throw new Error('Sketch missing.');
    await show({ sketch: { ...sketch, profiles: [box('across', -30, -5, 10, 10), box('above', -4, 20, 12, 4)] }, onMoveHandle: vi.fn(), graphControls: { ...props().graphControls!, onSelectDatum: vi.fn() } });
    const highlighted = () => [...container.querySelectorAll('[data-cad-sketch-datum].is-pick-highlighted')].map(item => item.getAttribute('data-cad-sketch-datum'));
    const hover = async (x: number, y: number, target?: Element) => { Object.assign(picks, { graph: 0, profile: 0, edge: 0, grip: 0 }); await move(x, y, target); return { ...picks }; };
    // Open axis: the grip test the move already made, then one pruned edge query.
    expect(await hover(40, 0.02)).toEqual({ graph: 0, profile: 0, edge: 1, grip: 1 }); expect(highlighted()).toEqual(['x-axis']);
    // Inside a rectangle the axis still answers; at a side grip, and on an edge away from its grips, the profile keeps the pointer.
    expect(await hover(-25, 0.02)).toEqual({ graph: 0, profile: 0, edge: 1, grip: 1 }); expect(highlighted()).toEqual(['x-axis']);
    expect(await hover(-20, 0.02)).toEqual({ graph: 0, profile: 0, edge: 0, grip: 1 }); expect(highlighted()).toEqual([]);
    expect(await hover(0.02, 20)).toEqual({ graph: 0, profile: 0, edge: 1, grip: 1 }); expect(highlighted()).toEqual([]);
    // Over sketch geometry on the axis, the graph layer's own hit area answers without any picker.
    expect(await hover(10, 0, container.querySelector('[data-cad-sketch-point="a"]')!)).toEqual({ graph: 0, profile: 0, edge: 0, grip: 0 }); expect(highlighted()).toEqual([]);
    // Away from both axes nothing beyond the grip test runs.
    expect(await hover(40, 30)).toEqual({ graph: 0, profile: 0, edge: 0, grip: 1 }); expect(highlighted()).toEqual([]);
  });

  it('moves the Dimension preview with the pointer, rendering only the preview: no row, no placed dimension and not the canvas', async () => {
    const graph: NonNullable<CadSketchFeature['graph']> = { points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'c', position: [20, 10] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'bc', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' }],
      relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 20 }] };
    const { props, show, move } = await mountCanvas(graph, { tool: 'select' });
    let next = 0;
    const pointer = createCadSketchPointerStore(), plan = planCadSketchDimension(graph, {}, [{ kind: 'point', id: 'a' }, { kind: 'point', id: 'c' }], () => `new-${++next}`);
    const onPick = vi.fn(), onConfirm = vi.fn();
    await show({ graphControls: { ...props().graphControls!, onSelectDimension: vi.fn(), onConfigureRelation: vi.fn(), geometryPick: {
      eligibleEntityIds: [], eligiblePointIds: [], eligibleDatums: [], label: 'Distance', onPick, onConfirm, onCancel: vi.fn(), pointer, dimensionPreview: plan } } });
    const preview = () => container.querySelector('[data-cad-dimension-preview]'), caption = () => container.querySelector('.cad-view-caption')?.textContent;
    clearRenders(); canvasRenders.mockClear(); dimensionRenders.mockClear(); Object.assign(picks, { graph: 0, profile: 0, edge: 0, grip: 0 });
    // Between the two points the preview is aligned; above or below them it is horizontal, and beside them vertical.
    await move(10, 5); expect(preview()?.getAttribute('data-cad-dimension-preview')).toBe('aligned'); expect(caption()).toBe('10, 5 mm');
    await move(12, 30); expect(preview()?.getAttribute('data-cad-dimension-preview')).toBe('horizontal');
    await move(12, -15); expect(preview()?.getAttribute('data-cad-dimension-preview')).toBe('horizontal');
    await move(45, 6); expect(preview()?.getAttribute('data-cad-dimension-preview')).toBe('vertical'); expect(caption()).toBe('45, 6 mm');
    expect(preview()?.textContent).toBe('ΔY 10 mm');
    // Each move lays out the preview's one label; the placed length, the rows, the canvas and the graph pickers do no work for it.
    expect(dimensionRenders).toHaveBeenCalledTimes(4); expect(renderedPoints()).toEqual([]); expect(renderedEdges()).toEqual([]); expect(canvasRenders).not.toHaveBeenCalled();
    expect(picks).toEqual({ graph: 0, profile: 0, edge: 0, grip: 0 }); expect(onPick).not.toHaveBeenCalled(); expect(onConfirm).not.toHaveBeenCalled();
  });

  it('draws the drawing that follows the pointer in its overlay, so pointer moves change nothing in the canvas SVG', async () => {
    const graph: NonNullable<CadSketchFeature['graph']> = { points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'c', position: [10, -10] }, { id: 'd', position: [10, 10] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'cd', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' }], relations: [] };
    const { props, show, pointer, move } = await mountCanvas(graph, { tool: 'select' });
    const svg = container.querySelector('svg.cad-sketch-canvas')!, overlay = container.querySelector('svg[data-cad-sketch-overlay="pointer"]')!;
    // The overlay is a sibling of the canvas in the same frame, so the canvas keeps every pick.
    expect(overlay.parentElement).toBe(svg.parentElement); expect(svg.contains(overlay)).toBe(false);
    expect(overlay.getAttribute('viewBox')).toBe(svg.getAttribute('viewBox')); expect(overlay.getAttribute('aria-hidden')).toBe('true');
    // Observers deliver their records between the awaited moves, so each one counts what it saw since the last check.
    const seen = { canvas: 0, overlay: 0 }, options = { subtree: true, childList: true, attributes: true, characterData: true };
    const canvasChanges = new MutationObserver(records => { seen.canvas += records.length; }), overlayChanges = new MutationObserver(records => { seen.overlay += records.length; });
    canvasChanges.observe(svg, options); overlayChanges.observe(overlay, options);
    const changes = () => { const counted = { canvas: seen.canvas + canvasChanges.takeRecords().length, overlay: seen.overlay + overlayChanges.takeRecords().length > 0 }; Object.assign(seen, { canvas: 0, overlay: 0 }); return counted; };
    const tap = async (x: number, y: number) => { await pointer('pointerdown', x, y); await pointer('pointerup', x, y); };

    // The Dimension preview of a line follows the pointer.
    const store = createCadSketchPointerStore(), plan = planCadSketchDimension(graph, {}, [{ kind: 'entity', id: 'ab' }], () => 'new');
    await show({ graphControls: { ...props().graphControls!, onSelectDimension: vi.fn(), onConfigureRelation: vi.fn(), geometryPick: {
      eligibleEntityIds: [], eligiblePointIds: [], eligibleDatums: [], label: 'Distance', onPick: vi.fn(), onConfirm: vi.fn(), onCancel: vi.fn(), pointer: store, dimensionPreview: plan } } });
    await move(4, 6); changes();
    await move(6, 9); await move(14, -7); await move(3, 12);
    expect(overlay.querySelector('[data-cad-dimension-preview]')).not.toBeNull(); expect(changes()).toEqual({ canvas: 0, overlay: true });

    // Trim previews the piece under the pointer, here on each side of the crossing.
    await show({ tool: 'trim', graphControls: { ...props().graphControls!, geometryPick: undefined } }); changes();
    await move(4, 0.1); expect(overlay.querySelector('[aria-label="Trim preview"]')).not.toBeNull();
    await move(16, 0.1); await move(10.1, 5); await move(10.1, -5);
    expect(overlay.querySelector('[aria-label="Trim preview"]')).not.toBeNull(); expect(changes()).toEqual({ canvas: 0, overlay: true });

    // A rectangle's rubber band and size readout follow the pointer after its first corner.
    await show({ tool: 'rectangle' }); await move(-30, 20); await tap(-30, 20); changes();
    await move(-24, 26); await move(-18, 30); await move(-26, 34);
    expect(overlay.querySelector('[data-cad-drawing-readout]')).not.toBeNull(); expect(overlay.querySelector('.cad-profile-preview')).not.toBeNull();
    expect(changes()).toEqual({ canvas: 0, overlay: true });
    canvasChanges.disconnect(); overlayChanges.disconnect();
  });

  it('answers hover over a dimension line from one query of each picker, rendering neither rows nor dimensions for it', async () => {
    const { props, show, move, view } = await mountCanvas({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 20 }] }, { tool: 'select' });
    await show({ onMoveHandle: vi.fn(), graphControls: { ...props().graphControls!, onSelectDatum: vi.fn(), onSelectDimension: vi.fn(), onConfigureRelation: vi.fn() } });
    const state = view(); if (!state || state.mode === 'solid') throw new Error('Sketch frame missing');
    const line = () => container.querySelector('[data-cad-sketch-dimension-hit="length"] line')!, value = (name: string) => Number(line().getAttribute(name));
    // The graph layer draws relative to the view center; the line starts above a, on the Y axis.
    const along = (share: number) => [state.centerMm[0] + value('x1') + (value('x2') - value('x1')) * share, state.centerMm[1] + value('y1') + (value('y2') - value('y1')) * share] as const;
    const datums = () => [...container.querySelectorAll('[data-cad-sketch-datum].is-pick-highlighted')].map(item => item.getAttribute('data-cad-sketch-datum'));
    const pointed = () => container.querySelector('[data-cad-sketch-dimension="length"]')!.classList.contains('is-pointed');
    const hover = async (share: number) => { Object.assign(picks, { graph: 0, profile: 0, edge: 0, grip: 0 }); await move(...along(share), line()); return { ...picks }; };
    expect(value('x1')).toBeCloseTo(-state.centerMm[0], 9);
    clearRenders(); dimensionRenders.mockClear();
    // Along the line, the cover test's grip and edge queries serve the canvas hover too, and the line marks its own dimension.
    expect(await hover(.5)).toEqual({ graph: 0, profile: 0, edge: 1, grip: 1 }); expect(pointed()).toBe(true); expect(datums()).toEqual([]);
    expect(await hover(.6)).toEqual({ graph: 0, profile: 0, edge: 1, grip: 1 }); expect(pointed()).toBe(true);
    // Where it crosses the Y axis, the axis takes the hover from the same queries.
    expect(await hover(0)).toEqual({ graph: 0, profile: 0, edge: 1, grip: 1 }); expect(pointed()).toBe(false); expect(datums()).toEqual(['y-axis']);
    expect(await hover(.5)).toEqual({ graph: 0, profile: 0, edge: 1, grip: 1 }); expect(pointed()).toBe(true); expect(datums()).toEqual([]);
    // Only the overlay draws the measured edge, once for each time the line takes the hover; no row or dimension renders again.
    expect(renderedPoints()).toEqual([]); expect(renderedEdges()).toEqual(['ab', 'ab']); expect(dimensionRenders).not.toHaveBeenCalled();
    // A window that loses focus sends no pointer leave; it still drops the mark and the measured edge.
    expect(container.querySelector('[data-cad-highlight-entity="ab"]')).not.toBeNull();
    await act(async () => { window.dispatchEvent(new Event('blur')); });
    expect(pointed()).toBe(false); expect(container.querySelector('[data-cad-highlight-entity]')).toBeNull();
  });
});
