import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadSketchFeature } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { cadSketchLinearPatternLockReason } from '@/domain/cad/cadSketchLinearPattern';
import { cadSketchGraphBoundary } from '@/domain/cad/compileCadSketchGeometry';
import { CadSketchCanvas } from './CadSketchCanvas';
import { cadArcSvgPath } from './cadSketchSvg';
import { cadSketchDimensionSelectionStatus } from './cadSketchDimensionSelection';
import { cadSketchDefinitionMarks } from './cadSketchDefinitionMarks';
import { cadSketchGraphDimensionLabel } from './cadSketchGraphDimensionLayout';
import type { CadRenderedViewControls } from './cadViewportControls';

// Every graph point row asks for its pattern lock reason once per render, so the call count tracks row renders.
vi.mock('@/domain/cad/cadSketchLinearPattern', async importOriginal => {
  const original = await importOriginal<typeof import('@/domain/cad/cadSketchLinearPattern')>();
  return { ...original, cadSketchLinearPatternLockReason: vi.fn(original.cadSketchLinearPatternLockReason) };
});
// The canvas root reads the dimension status line once per render in the select tool.
vi.mock('./cadSketchDimensionSelection', async importOriginal => {
  const original = await importOriginal<typeof import('./cadSketchDimensionSelection')>();
  return { ...original, cadSketchDimensionSelectionStatus: vi.fn(original.cadSketchDimensionSelectionStatus) };
});
const rowRenders = vi.mocked(cadSketchLinearPatternLockReason), canvasRenders = vi.mocked(cadSketchDimensionSelectionStatus);
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
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
  const pointer = async (type: string, x: number, y: number, target: Element = svg) => {
    const box = svg.getAttribute('viewBox')!.split(' ').map(Number), state = controls?.getState();
    if (!state || state.mode === 'solid') throw new Error('Sketch frame missing');
    const event = new MouseEvent(type, { button: 0, buttons: type === 'pointerdown' ? 1 : 0, clientX: 10 + (x - state.centerMm[0] - box[0]) / box[2] * 800, clientY: 20 + (state.centerMm[1] - y - box[1]) / box[3] * 600, bubbles: true });
    Object.defineProperties(event, { pointerId: { value: 3 }, isPrimary: { value: true } });
    await act(async () => target.dispatchEvent(event));
  };
  return { props: () => props, show, pointer, move: (x: number, y: number, target?: Element) => pointer('pointermove', x, y, target), view: () => controls?.getState() };
}

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
