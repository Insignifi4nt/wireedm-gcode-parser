import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCadSketchGraph, type CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { createCadSketchCornerTreatment } from '@/domain/cad/cadSketchCornerTreatment';
import { CadSketchGraphDimensions, type CadSketchGraphDimensionsProps } from './CadSketchGraphDimensions';
import { createCadSketchHighlightStore } from './cadSketchDimensionSelection';

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: ['length', 0] }], entities: [],
  relations: [{ id: 'dimension', kind: 'distance', pointIds: ['a', 'b'], value: ' length ' }] });
const key = (target: Element, key: string, init: KeyboardEventInit = {}) => act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })); });
const click = (target: Element, init: MouseEventInit = {}) => act(async () => { target.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true, detail: 1, ...init })); });
// React derives enter and leave from over and out events.
const hover = (target: Element, entered: boolean) => act(async () => {
  target.dispatchEvent(new MouseEvent(entered ? 'pointerover' : 'pointerout', { bubbles: true, relatedTarget: entered ? null : document.body }));
});
const doubleClick = (target: Element) => act(async () => { target.dispatchEvent(new MouseEvent('dblclick', { button: 0, bubbles: true, cancelable: true, detail: 2 })); });
async function pointer(target: Element, type: string, button = 0) {
  const event = new MouseEvent(type, { button, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'isPrimary', { value: true });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}

function mount(source: CadSketchGraph, parameters: Record<string, number>, props: Partial<CadSketchGraphDimensionsProps> = {}) {
  const handlers = { configure: vi.fn(), select: vi.fn(), remove: vi.fn(), menu: vi.fn(), parent: vi.fn() };
  const render = (overrides: Partial<CadSketchGraphDimensionsProps> = {}) => root.render(<svg onPointerDown={handlers.parent} onClick={handlers.parent} onDoubleClick={handlers.parent} onKeyDown={handlers.parent}>
    <g transform="scale(1,-1)"><CadSketchGraphDimensions graph={source} parameters={parameters} center={[7, 2]} mmPerPixel={.1} interactive
      onConfigure={handlers.configure} onSelect={handlers.select} onDelete={handlers.remove} onMenu={handlers.menu} {...props} {...overrides} /></g>
  </svg>);
  return { ...handlers, render };
}

describe('graph dimension selection and editing', () => {
  it.each(['x', 'y'] as const)('names the exact signed or zero %s driver with its From/To roles; Space selects and Enter edits', async axis => {
    for (const value of [axis === 'x' ? -30 : 20, 0]) {
      const source = parseCadSketchGraph({ points: [{ id: 'to', position: axis === 'x' ? [30 + value, 40] : [0, 20 + value] },
        { id: 'from', position: [30, 20] }], entities: [],
        relations: [{ id: 'offset', kind: 'axis-distance', pointIds: ['from', 'to'], axis, value: ' offset ' }] });
      const before = JSON.stringify(source), view = mount(source, { offset: value });
      await act(async () => view.render());
      const label = container.querySelector<SVGGElement>('[data-cad-sketch-dimension="offset"] [role="button"]');
      if (!label) throw new Error('Axis dimension label missing.');
      expect(label.textContent).toBe(`Δ${axis.toUpperCase()} ${value} mm`);
      expect(label.getAttribute('aria-label')).toBe(`Dimension ${axis === 'x' ? 'horizontal' : 'vertical'} distance ${value} mm, From Point 2 → To Point 1, press Enter to edit`);
      expect(label.getAttribute('transform')).toContain('scale(0.1 -0.1)');
      await key(label, ' ');
      expect(view.select).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'offset' }), false); expect(view.configure).not.toHaveBeenCalled();
      await key(label, 'Enter');
      expect(view.configure).toHaveBeenCalledExactlyOnceWith(source.relations[0]); expect(view.parent).not.toHaveBeenCalled();
      await act(async () => view.render({ interactive: false })); view.configure.mockClear(); view.select.mockClear();
      await click(label); await doubleClick(label); await key(label, 'Enter'); await key(label, 'Delete');
      expect(view.configure).not.toHaveBeenCalled(); expect(view.select).not.toHaveBeenCalled(); expect(view.remove).not.toHaveBeenCalled();
      expect(view.parent).not.toHaveBeenCalled(); expect(JSON.stringify(source)).toBe(before);
    }
  });

  it.each(['radius', 'diameter'] as const)('selects a circle %s on click and opens its exact driver only on double-click', async quantity => {
    const source = parseCadSketchGraph({ points: [{ id: 'center', position: ['0', '0'] }],
      entities: [{ id: 'circle', kind: 'circle', centerPointId: 'center', radius: 5, construction: false }],
      relations: [{ id: 'size', kind: 'radial-size', entityId: 'circle', quantity, value: quantity === 'radius' ? ' size ' : 'size * 2' }] });
    const view = mount(source, { size: 5 });
    await act(async () => view.render());
    const label = container.querySelector<SVGGElement>('[role="button"]');
    if (!label) throw new Error('Radial dimension label missing.');
    await click(label);
    expect(view.select).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'size' }), false); expect(view.configure).not.toHaveBeenCalled();
    // The second click of a double-click does not select again; the double-click opens the editor.
    await click(label, { detail: 2 }); await doubleClick(label);
    expect(view.select).toHaveBeenCalledOnce(); expect(view.configure).toHaveBeenCalledExactlyOnceWith(source.relations[0]);
    expect(view.parent).not.toHaveBeenCalled();
    await act(async () => view.render({ selectedIds: ['size'] }));
    expect(label.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-cad-sketch-dimension="size"]')?.classList.contains('is-selected')).toBe(true);
  });

  it('owns its pointer and keyboard events: Shift toggles, Delete and Backspace remove, Escape clears and the menu key opens the menu', async () => {
    const view = mount(graph, { length: 20 });
    await act(async () => view.render());
    const label = container.querySelector<SVGGElement>('[role="button"]'), annotation = container.querySelector('[data-cad-sketch-dimension="dimension"]');
    if (!label || !annotation) throw new Error('Dimension label missing.');
    const focus = vi.fn(); Object.assign(label, { focus });
    const press = await pointer(label, 'pointerdown');
    expect(press.defaultPrevented).toBe(true); expect(focus).toHaveBeenCalledOnce();
    // A right press belongs to the canvas, which opens the menu on a still release.
    const right = await pointer(label, 'pointerdown', 2);
    expect(right.defaultPrevented).toBe(false); expect(view.parent).toHaveBeenCalledOnce(); view.parent.mockClear();
    await click(label, { shiftKey: true });
    expect(view.select).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'dimension' }), true);
    await key(label, 'Delete'); await key(label, 'Backspace');
    expect(view.remove.mock.calls.map(([dimension]) => dimension.id)).toEqual(['dimension', 'dimension']);
    // With nothing selected, Escape passes on to the canvas and the workbench.
    await key(label, 'Escape');
    expect(view.select).toHaveBeenCalledTimes(1); expect(view.parent).toHaveBeenCalledOnce(); view.parent.mockClear();
    await act(async () => view.render({ selectedIds: ['dimension'] }));
    await key(label, 'Escape');
    expect(view.select).toHaveBeenLastCalledWith(null, false);
    await key(label, 'ContextMenu'); await key(label, 'F10', { shiftKey: true });
    expect(view.menu).toHaveBeenCalledTimes(2); expect(view.menu.mock.calls[0][0].id).toBe('dimension');
    expect(view.menu.mock.calls[0][1]).toEqual({ clientX: expect.any(Number), clientY: expect.any(Number) });
    expect(view.configure).not.toHaveBeenCalled(); expect(view.parent).not.toHaveBeenCalled();
    expect(graph.relations[0]).toMatchObject({ value: ' length ' });
  });

  it('highlights the measured geometry while hovered and only while picks are accepted', async () => {
    const highlight = createCadSketchHighlightStore(), view = mount(graph, { length: 20 }, { highlight });
    await act(async () => view.render());
    const annotation = container.querySelector('[data-cad-sketch-dimension="dimension"]');
    if (!annotation) throw new Error('Dimension missing.');
    await hover(annotation, true);
    expect(highlight.getSnapshot()).toEqual({ kind: 'relation', relationId: 'dimension' });
    await hover(annotation, false);
    expect(highlight.getSnapshot()).toBeNull();
    await hover(annotation, true);
    await act(async () => view.render({ interactive: false }));
    expect(highlight.getSnapshot()).toBeNull();
    await hover(annotation, true);
    expect(highlight.getSnapshot()).toBeNull();
    await act(async () => view.render());
    await hover(annotation, true);
    act(() => root.unmount()); root = createRoot(container);
    expect(highlight.getSnapshot()).toBeNull();
  });

  it('draws a reference dimension dimmer, in parentheses, and names it as a reference', async () => {
    const source = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [12, 0] }],
      entities: [{ id: 'edge', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }],
      relations: [{ id: 'measure', kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'edge' } }] });
    await act(async () => mount(source, {}).render());
    const annotation = container.querySelector('[data-cad-sketch-dimension="measure"]'), label = annotation?.querySelector('[role="button"]');
    expect(annotation?.classList.contains('is-reference')).toBe(true);
    expect(label?.textContent).toBe('(12 mm)');
    expect(label?.getAttribute('aria-label')).toBe('Reference dimension distance 12 mm, press Enter to edit');
    // No label box: the text sits on a transparent hit target only.
    expect(annotation?.querySelectorAll('rect')).toHaveLength(1);
    expect(annotation?.querySelector('rect')?.classList.contains('cad-sketch-graph-dimension-hit')).toBe(true);
  });

  it.each(['fillet', 'chamfer'] as const)('selects and edits the exact existing %s relation from every native annotation', async kind => {
    let next = 0;
    const source = parseCadSketchGraph({ points: [{ id: 'v', position: [0, 0] }, { id: 'a', position: [20, 0] }, { id: 'b', position: [0, 20] }],
      entities: [{ id: 'line-a', kind: 'line', construction: false, startPointId: 'v', endPointId: 'a' },
        { id: 'line-b', kind: 'line', construction: false, startPointId: 'v', endPointId: 'b' }], relations: [] });
    const { graph: corner } = createCadSketchCornerTreatment({ graph: source, parameters: { radius: 2, setback: 3 }, pointId: 'v',
      treatment: kind === 'fillet' ? { kind, radius: ' radius ' } : { kind, setbacks: ['radius', ' setback '] }, createId: () => `corner-${++next}` });
    const relation = corner.relations[0], before = JSON.stringify(corner), view = mount(corner, { radius: 2, setback: 3 }, { selectedRelationId: relation.id });
    await act(async () => view.render());
    const labels = container.querySelectorAll<SVGGElement>('[role="button"]'); expect(labels).toHaveLength(kind === 'fillet' ? 1 : 2);
    for (const label of labels) {
      Object.assign(label, { focus: vi.fn() });
      expect((await pointer(label, 'pointerdown')).defaultPrevented).toBe(true);
      await click(label); await key(label, 'Enter');
      // The relation open in the editor draws like a selected dimension.
      expect(label.getAttribute('aria-pressed')).toBe('true');
    }
    expect(view.select.mock.calls).toEqual([...labels].map(() => [expect.objectContaining({ id: relation.id }), false]));
    expect(view.configure).toHaveBeenCalledTimes(labels.length); expect(view.configure.mock.calls.every(([value]) => value === relation)).toBe(true);
    expect(view.parent).not.toHaveBeenCalled(); expect(JSON.stringify(corner)).toBe(before);
  });
});
