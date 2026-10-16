import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { CadSketchGraphLayer } from './CadSketchGraphLayer';
import { prepareCadSketchGraphInteraction } from './cadSketchGraphInteraction';

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred operation unavailable.'); };
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
type Props = ComponentProps<typeof CadSketchGraphLayer>;
async function fixture(overrides: Partial<Props> = {}) {
  const document = parseCadDocument({ ...createCadDocument('Graph controls', 'graph-controls'), schemaVersion: 2, parameters: { x: 3 }, features: [{
    id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [],
    graph: { points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 5] }, { id: 'mixed', position: [' x ', 7] }],
      entities: [{ id: 'edge', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: [] }
  }] });
  const sketch = document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Sketch fixture missing.');
  const selected = vi.fn(), edited = vi.fn(), previewed = vi.fn(), pending = vi.fn(), error = vi.fn();
  const parentPointer = vi.fn(), parentClick = vi.fn();
  let props: Props = { controls: { document, selection: [], onSelect: selected, onEditMany: edited, onPreviewDocument: previewed },
    sketch, version: 'one', prepared: prepareCadSketchGraphInteraction(sketch.graph, document.parameters), center: [0, 0],
    scaleX: 1, scaleY: 1, gridStep: 5, snap: false, active: true, locked: false, cancelSignal: 0, onPendingChange: pending, onError: error, ...overrides };
  const captures = new Map<Element, Set<number>>();
  const capture = vi.fn(), release = vi.fn();
  const render = async (next: Partial<Props> = {}) => {
    props = { ...props, ...next };
    await act(async () => root.render(<svg onPointerDown={parentPointer} onClick={parentClick}><CadSketchGraphLayer {...props} /></svg>));
    for (const point of container.querySelectorAll<SVGGElement>('[data-cad-sketch-point]')) if (!captures.has(point)) {
      const owned = new Set<number>(); captures.set(point, owned);
      Object.assign(point, { focus: vi.fn(), setPointerCapture: (id: number) => { owned.add(id); capture(point.dataset.cadSketchPoint, id); },
        hasPointerCapture: (id: number) => owned.has(id), releasePointerCapture: (id: number) => { owned.delete(id); release(point.dataset.cadSketchPoint, id); } });
    }
    for (const edge of container.querySelectorAll<SVGGElement>('[data-cad-sketch-entity]')) Object.assign(edge, { focus: vi.fn() });
  };
  await render();
  const point = (id = 'a') => { const found = container.querySelector<SVGGElement>(`[data-cad-sketch-point="${id}"]`); if (!found) throw new Error('Point missing.'); return found; };
  const edge = () => { const found = container.querySelector<SVGGElement>('[data-cad-sketch-entity]'); if (!found) throw new Error('Edge missing.'); return found; };
  const pointer = async (target: Element, type: string, init: MouseEventInit = {}, pointerId = 11, primary = true) => {
    const event = new MouseEvent(type, { button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: 100, clientY: 100, bubbles: true, cancelable: true, ...init });
    Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: primary } });
    await act(async () => target.dispatchEvent(event));
  };
  const key = async (target: Element, value: string, shiftKey = false) => act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })));
  const source = async (next: CadDocument) => {
    const sketch = next.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Changed sketch missing.');
    await render({ controls: { ...props.controls, document: next }, sketch, version: 'two', prepared: prepareCadSketchGraphInteraction(sketch.graph, next.parameters) });
  };
  return { document, props: () => props, render, source, point, edge, pointer, key, selected, edited, previewed, pending, error, capture, release, parentPointer, parentClick };
}

describe('graph point interaction ownership', () => {
  it('snaps a captured drag to accepted geometry before grid and rechecks key-only suppression and final release', async () => {
    const h = await fixture({ snap: true });
    await h.pointer(h.point(), 'pointerdown');
    await h.pointer(h.point(), 'pointermove', { clientX: 102, clientY: 92 });
    expect(h.point('mixed').classList.contains('is-pick-highlighted')).toBe(true);
    expect(container.querySelector('.cad-sketch-drag-target')?.getAttribute('cx')).toBe('3');
    expect(container.querySelector('.cad-sketch-drag-target')?.getAttribute('cy')).toBe('7');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true })));
    expect(h.point('mixed').classList.contains('is-pick-highlighted')).toBe(false);
    expect(container.querySelector('.cad-sketch-drag-target')?.getAttribute('cx')).toBe('2');
    expect(container.querySelector('.cad-sketch-drag-target')?.getAttribute('cy')).toBe('8');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' })));
    expect(h.point('mixed').classList.contains('is-pick-highlighted')).toBe(true);
    expect(h.edited).not.toHaveBeenCalled();
    await h.pointer(h.point(), 'pointerup', { clientX: 102, clientY: 92, metaKey: true });
    expect(h.edited).toHaveBeenCalledExactlyOnceWith([{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'a', translation: [2, 8] }], expect.any(AbortSignal));
    expect(h.document.features[0]).toMatchObject({ graph: { points: expect.arrayContaining([{ id: 'a', position: [0, 0] }]) } });
  });

  it('confirms only the current solved snap, never a coincident last preview from an older drag request', async () => {
    vi.useFakeTimers();
    const h = await fixture({ snap: true });
    const sketch = h.document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Sketch missing.');
    const source = parseCadDocument({ ...h.document, features: [{ ...sketch, graph: { ...sketch.graph,
      points: [...sketch.graph.points, { id: 'first', position: [12, 12] }, { id: 'second', position: [20, 20] }],
      entities: [...sketch.graph.entities, { id: 'reference', kind: 'line', construction: true, startPointId: 'first', endPointId: 'second' }] } }] });
    await h.source(source);
    const first = deferred<CadDocument>(), second = deferred<CadDocument>();
    const prepare = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await h.render({ controls: { ...h.props().controls, onPrepareEdits: prepare } });
    const reference = source.features[0]; if (reference.kind !== 'sketch' || !reference.graph) throw new Error('Reference sketch missing.');
    const projected = parseCadDocument({ ...source, features: [{ ...reference, graph: { ...reference.graph,
      points: reference.graph.points.map(point => point.id === 'a' ? { ...point, position: [20, 20] } : point) } }] });
    await h.pointer(h.point(), 'pointerdown');
    await h.pointer(h.point(), 'pointermove', { clientX: 111, clientY: 89 });
    await act(async () => { vi.advanceTimersByTime(20); });
    await act(async () => first.resolve(projected));
    const hint = () => container.querySelector('[data-cad-sketch-snap]');
    expect(hint()?.getAttribute('data-cad-sketch-snap')).toBe('first');
    expect(container.querySelector('[data-cad-sketch-entity="reference"]')?.classList.contains('is-pick-highlighted')).toBe(true);
    expect(hint()?.classList.contains('is-attained')).toBe(false);
    expect(hint()?.getAttribute('aria-label')).toContain('Constraints limit movement');
    await h.pointer(h.point(), 'pointermove', { clientX: 119, clientY: 81 });
    expect(hint()?.getAttribute('data-cad-sketch-snap')).toBe('second');
    expect(h.point().querySelector('.cad-sketch-point-mark')?.getAttribute('cx')).toBe('20');
    expect(hint()?.classList.contains('is-attained')).toBe(false);
    await act(async () => { vi.advanceTimersByTime(20); });
    await act(async () => second.resolve(projected));
    expect(hint()?.classList.contains('is-attained')).toBe(true);
    expect(h.edited).not.toHaveBeenCalled();
    await h.key(h.point(), 'Escape'); expect(hint()).toBeNull();
  });

  it('excludes the moving joint and its dependent midpoint, and only advertises reachable driven-axis targets', async () => {
    const h = await fixture({ snap: true });
    const sketch = h.document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Sketch missing.');
    const source = parseCadDocument({ ...h.document, features: [{ ...sketch, graph: { ...sketch.graph,
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'mixed', position: [' x ', 7] },
        { id: 'alias', position: [0, 0] }, { id: 'reachable', position: [3, 20] }],
      relations: [{ id: 'joint', kind: 'coincident', pointIds: ['a', 'alias'] }] } }] });
    await h.source(source);
    await h.pointer(h.point(), 'pointerdown');
    await h.pointer(h.point(), 'pointermove', { clientX: 105, clientY: 100 });
    expect(container.querySelector('[data-cad-sketch-snap]')).toBeNull();
    expect(container.querySelector('.cad-sketch-drag-target')?.getAttribute('cx')).toBe('5');
    await h.key(h.point(), 'Escape');
    await h.pointer(h.point('mixed'), 'pointerdown');
    await h.pointer(h.point('mixed'), 'pointermove', { clientX: 116, clientY: 106 });
    expect(container.querySelector('[data-cad-sketch-snap]')).toBeNull();
    expect(container.querySelector('.cad-sketch-drag-target')?.getAttribute('cx')).toBe('3');
    await h.pointer(h.point('mixed'), 'pointermove', { clientX: 101, clientY: 88 });
    expect(container.querySelector('[data-cad-sketch-snap]')?.getAttribute('data-cad-sketch-snap')).toBe('reachable');
    await h.pointer(h.point('mixed'), 'pointerup', { clientX: 101, clientY: 88 });
    expect(h.edited).toHaveBeenCalledExactlyOnceWith([{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'mixed', translation: [0, 13] }], expect.any(AbortSignal));
    expect(source.features[0]).toMatchObject({ graph: { points: expect.arrayContaining([{ id: 'mixed', position: [' x ', 7] }]) } });
  });

  it('highlights candidate diagnostic operands independently of accepted relation identity and selection', async () => {
    const h = await fixture();
    await h.render({ controls: { ...h.props().controls, selection: [{ kind: 'point', id: 'mixed' }], inspection: { pointIds: ['a', 'b'], entityIds: [] } } });
    expect(h.point('a').classList.contains('is-relation-highlighted')).toBe(true);
    expect(h.point('b').classList.contains('is-relation-highlighted')).toBe(true);
    expect(h.edge().classList.contains('is-relation-highlighted')).toBe(true);
    expect(h.point('mixed').getAttribute('aria-pressed')).toBe('true'); expect(h.selected).not.toHaveBeenCalled();
    expect(h.edited).not.toHaveBeenCalled(); expect(h.pending).not.toHaveBeenCalledWith(true);
    await h.render({ controls: { ...h.props().controls, inspection: null } });
    expect(h.edge().classList.contains('is-relation-highlighted')).toBe(false);
    expect(h.point('mixed').getAttribute('aria-pressed')).toBe('true');
  });

  it('does not infer point freedom from unrelated sketch freedom and keeps driven coordinates protected', async () => {
    const h = await fixture();
    const document = parseCadDocument({ ...h.document, features: [{ ...h.document.features[0], graph: {
      points: [{ id: 'a', position: [' 0 ', ' 0 '] }, { id: 'b', position: [40, 0] }, { id: 'c', position: [50, 20] }],
      entities: [{ id: 'edge', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
      relations: [{ id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'distance', kind: 'distance', pointIds: ['a', 'b'], value: 40 }]
    } }] });
    await h.source(document);
    await h.render({ controls: { ...h.props().controls, degreesOfFreedom: 2 } });
    expect(h.point('a').classList.contains('is-locked')).toBe(true);
    expect(h.point('b').classList.contains('is-locked')).toBe(false);
    expect(h.point('b').querySelector('title')?.textContent).toContain('Movement follows dimensions and relations');
    await h.key(h.point('a'), 'ArrowRight'); expect(h.edited).not.toHaveBeenCalled();
    await h.key(h.point('b'), 'ArrowRight');
    expect(h.edited).toHaveBeenLastCalledWith([{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'b', translation: [5, 0] }], expect.any(AbortSignal));
    await h.render({ controls: { ...h.props().controls, degreesOfFreedom: null } });
    await h.key(h.point('c'), 'ArrowUp');
    expect(h.edited).toHaveBeenLastCalledWith([{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'c', translation: [0, 5] }], expect.any(AbortSignal));
  });

  it('uses the prepared hit ranking rather than the SVG target, without dragging a different point implicitly', async () => {
    const pickAt = vi.fn(() => ({ kind: 'point' as const, id: 'mixed' }));
    const h = await fixture({ pickAt });
    await h.pointer(h.point('b'), 'pointerdown'); await h.pointer(h.point('b'), 'pointerup');
    expect(pickAt).toHaveBeenCalledWith(expect.objectContaining({ clientX: 100, clientY: 100 }));
    expect(h.selected).toHaveBeenLastCalledWith({ kind: 'point', id: 'mixed' });
    expect(h.point('mixed').focus).toHaveBeenCalledOnce(); expect(h.point('b').focus).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled(); expect(h.edited).not.toHaveBeenCalled();
    await h.key(h.point('mixed'), 'Enter'); expect(h.selected).toHaveBeenLastCalledWith({ kind: 'point', id: 'mixed' });
  });
  it('keeps excluded kinds selected visually while removing their keyboard action and tab stop', async () => {
    const h = await fixture({ filter: 'edges' });
    await h.render({ controls: { ...h.props().controls, selection: [{ kind: 'point', id: 'a' }] } });
    expect(h.point().getAttribute('aria-pressed')).toBe('true'); expect(h.point().getAttribute('tabindex')).toBe('-1');
    await h.key(h.point(), 'Enter'); await h.key(h.point(), 'ArrowRight'); await h.key(h.point(), 'Delete');
    expect(h.selected).not.toHaveBeenCalled(); expect(h.edited).not.toHaveBeenCalled();
    await h.key(h.edge(), 'Enter'); expect(h.selected).toHaveBeenLastCalledWith({ kind: 'entity', id: 'edge' });
  });
  it('lets a filtered empty pointer click reach the canvas clear or box owner', async () => {
    const h = await fixture({ filter: 'points', pickAt: () => null });
    await h.pointer(h.edge(), 'pointerdown');
    await act(async () => h.edge().dispatchEvent(new MouseEvent('click', { button: 0, detail: 1, bubbles: true })));
    expect(h.parentPointer).toHaveBeenCalledOnce(); expect(h.parentClick).toHaveBeenCalledOnce();
    expect(h.selected).not.toHaveBeenCalled();
  });
  it('toggles point and edge selection with Shift without capturing, moving or claiming an edit', async () => {
    const h = await fixture();
    await h.pointer(h.point('b'), 'pointerdown', { shiftKey: true });
    await h.pointer(h.point('b'), 'pointermove', { shiftKey: true, clientX: 150 });
    await h.pointer(h.point('b'), 'pointerup', { shiftKey: true, clientX: 150 });
    expect(h.selected).toHaveBeenLastCalledWith({ kind: 'point', id: 'b' }, true);
    await h.key(h.point('a'), 'Enter', true);
    expect(h.selected).toHaveBeenLastCalledWith({ kind: 'point', id: 'a' }, true);
    await h.pointer(h.edge(), 'pointerdown', { shiftKey: true });
    expect(h.selected).toHaveBeenLastCalledWith({ kind: 'entity', id: 'edge' }, true);
    expect(h.capture).not.toHaveBeenCalled(); expect(h.edited).not.toHaveBeenCalled(); expect(h.pending).not.toHaveBeenCalledWith(true);
    expect(h.parentPointer).not.toHaveBeenCalled();
  });

  it('highlights the complete set and requires a singleton before a point gesture can move geometry', async () => {
    const h = await fixture();
    await h.render({ controls: { ...h.props().controls, selection: [{ kind: 'point', id: 'a' }, { kind: 'point', id: 'b' }] } });
    expect(h.point('a').getAttribute('aria-pressed')).toBe('true');
    expect(h.point('b').getAttribute('aria-pressed')).toBe('true');
    await h.key(h.point('b'), 'ArrowRight');
    await h.pointer(h.point('b'), 'pointerdown');
    await h.pointer(h.point('b'), 'pointermove', { clientX: 150 });
    await h.pointer(h.point('b'), 'pointerup', { clientX: 150 });
    expect(h.selected).toHaveBeenLastCalledWith({ kind: 'point', id: 'b' });
    expect(h.capture).not.toHaveBeenCalled(); expect(h.edited).not.toHaveBeenCalled();
    await h.render({ controls: { ...h.props().controls, selection: [{ kind: 'point', id: 'b' }] } });
    await h.key(h.point('b'), 'ArrowRight');
    expect(h.edited).toHaveBeenCalledExactlyOnceWith([{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'b', translation: [5, 0] }], expect.any(AbortSignal));
  });
  it('keeps fully constrained points selectable for inspection and corner tools without advertising movement', async () => {
    const h = await fixture();
    await h.render({ controls: { ...h.props().controls, degreesOfFreedom: 0 } });
    expect(h.point().getAttribute('aria-disabled')).not.toBe('true');
    expect(h.point().classList.contains('is-locked')).toBe(true);
    await h.pointer(h.point(), 'pointerdown'); await h.pointer(h.point(), 'pointerup');
    await h.key(h.point(), 'Enter'); await h.key(h.point(), 'ArrowRight');
    expect(h.selected).toHaveBeenLastCalledWith({ kind: 'point', id: 'a' });
    expect(h.capture).not.toHaveBeenCalled(); expect(h.edited).not.toHaveBeenCalled();
  });

  it('rejects secondary starts and preserves the initiating pointer through a competing primary pointer', async () => {
    const h = await fixture();
    await h.pointer(h.point('b'), 'pointerdown', {}, 22, false);
    expect(h.capture).not.toHaveBeenCalled(); expect(h.selected).not.toHaveBeenCalled();
    await h.pointer(h.point(), 'pointerdown');
    await h.pointer(h.point('b'), 'pointerdown', {}, 22, true);
    expect(h.capture.mock.calls).toEqual([['a', 11]]);
    await h.pointer(h.point(), 'pointermove', { clientX: 105, clientY: 90 });
    await h.pointer(h.point(), 'pointerup', { clientX: 105, clientY: 90 });
    expect(h.edited).toHaveBeenCalledExactlyOnceWith([{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'a', translation: [5, 10] }], expect.any(AbortSignal));
    expect(h.release.mock.calls).toEqual([['a', 11]]); expect(h.pending).toHaveBeenLastCalledWith(false);
    await act(async () => h.point().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, button: 0 })));
    expect(h.parentClick).not.toHaveBeenCalled();
  });

  it('blocks pointer, keyboard and synthetic activation commands while externally locked', async () => {
    const h = await fixture({ locked: true });
    for (const target of [h.point(), h.edge()]) {
      await h.pointer(target, 'pointerdown'); await h.key(target, 'Enter'); await h.key(target, 'ArrowRight');
      await act(async () => target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0, button: 0 })));
    }
    expect(h.capture).not.toHaveBeenCalled(); expect(h.edited).not.toHaveBeenCalled(); expect(h.selected).not.toHaveBeenCalled();
  });

  it.each(['escape', 'blur', 'locked', 'source', 'cancelSignal', 'frame', 'unmount'])('aborts a released asynchronous edit on %s and ignores its late completion', async ending => {
    const operation = deferred<void>(), h = await fixture();
    h.edited.mockReturnValue(operation.promise);
    await h.pointer(h.point(), 'pointerdown');
    await h.pointer(h.point(), 'pointermove', { clientX: 105, clientY: 90 });
    await h.pointer(h.point(), 'pointerup', { clientX: 105, clientY: 90 });
    const signal: unknown = h.edited.mock.calls[0]?.[1];
    expect(signal).toBeInstanceOf(AbortSignal); if (!(signal instanceof AbortSignal)) throw new Error('Submission signal missing.');
    expect(signal.aborted).toBe(false); expect(h.pending).toHaveBeenLastCalledWith(true);
    if (ending === 'escape') await h.key(h.point(), 'Escape');
    else if (ending === 'blur') await act(async () => window.dispatchEvent(new Event('blur')));
    else if (ending === 'locked') await h.render({ locked: true });
    else if (ending === 'source') await h.source(parseCadDocument({ ...h.document, name: 'Changed accepted source' }));
    else if (ending === 'cancelSignal') await h.render({ cancelSignal: 1 });
    else if (ending === 'frame') await h.render({ center: [3, 4], scaleX: 2, scaleY: 3 });
    else await act(async () => root.render(null));
    expect(signal.aborted).toBe(true); expect(h.pending).toHaveBeenLastCalledWith(false);
    await act(async () => operation.resolve(undefined));
    expect(h.edited).toHaveBeenCalledOnce(); expect(h.pending).toHaveBeenLastCalledWith(false); expect(h.error).not.toHaveBeenCalled();
    expect(h.document.features[0]).toMatchObject({ graph: { points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 5] }, { id: 'mixed', position: [' x ', 7] }] } });
  });

  it('cancels a captured snap and pending preview when its projection frame changes', async () => {
    vi.useFakeTimers();
    const operation = deferred<CadDocument>(), h = await fixture({ snap: true });
    const prepare = vi.fn((_edits: readonly CadEdit[], _signal: AbortSignal) => operation.promise);
    await h.render({ controls: { ...h.props().controls, onPrepareEdits: prepare } });
    await h.pointer(h.point(), 'pointerdown');
    await h.pointer(h.point(), 'pointermove', { clientX: 102, clientY: 92 });
    await act(async () => { vi.advanceTimersByTime(20); });
    const signal = prepare.mock.calls[0]?.[1]; if (!signal) throw new Error('Preview signal missing.');
    await h.render({ scaleX: 2 });
    expect(signal.aborted).toBe(true); expect(h.release.mock.calls).toEqual([['a', 11]]);
    expect(h.point('mixed').classList.contains('is-pick-highlighted')).toBe(false);
    await act(async () => operation.resolve(h.document));
    await h.pointer(h.point(), 'pointerup', { clientX: 102, clientY: 92 });
    expect(h.edited).not.toHaveBeenCalled(); expect(h.previewed).not.toHaveBeenCalledWith(h.document);
    expect(h.pending).toHaveBeenLastCalledWith(false);
  });

  it('cancels a pending solved preview when source version changes and never publishes its late candidate', async () => {
    vi.useFakeTimers();
    const operation = deferred<CadDocument>(), h = await fixture();
    const prepare = vi.fn((_edits: readonly CadEdit[], _signal: AbortSignal) => operation.promise);
    await h.render({ controls: { ...h.props().controls, onPrepareEdits: prepare } });
    await h.pointer(h.point(), 'pointerdown');
    await h.pointer(h.point(), 'pointermove', { clientX: 105, clientY: 90 });
    await act(async () => { vi.advanceTimersByTime(20); });
    expect(prepare).toHaveBeenCalledOnce();
    const signal = prepare.mock.calls[0]?.[1]; if (!signal) throw new Error('Preview signal missing.');
    expect(signal.aborted).toBe(false);
    await h.source(parseCadDocument({ ...h.document, name: 'New accepted document' }));
    expect(signal.aborted).toBe(true); expect(h.release.mock.calls).toEqual([['a', 11]]);
    const stale = parseCadDocument({ ...h.document, name: 'Late stale preview' });
    await act(async () => operation.resolve(stale));
    expect(h.previewed).not.toHaveBeenCalledWith(stale); expect(h.edited).not.toHaveBeenCalled();
    expect(h.pending).toHaveBeenLastCalledWith(false);
    expect(h.selected).toHaveBeenLastCalledWith({ kind: 'point', id: 'a' });
  });

  it('preserves the per-axis expression driver for pointer targets and keyboard nudges', async () => {
    const h = await fixture();
    await h.key(h.point('mixed'), 'ArrowRight'); expect(h.edited).not.toHaveBeenCalled();
    await h.key(h.point('mixed'), 'ArrowUp');
    expect(h.edited).toHaveBeenLastCalledWith([{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'mixed', translation: [0, 5] }], expect.any(AbortSignal));
    await h.pointer(h.point('mixed'), 'pointerdown');
    await h.pointer(h.point('mixed'), 'pointermove', { clientX: 140, clientY: 90 });
    await h.pointer(h.point('mixed'), 'pointerup', { clientX: 140, clientY: 90 });
    expect(h.edited).toHaveBeenLastCalledWith([{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'mixed', translation: [0, 10] }], expect.any(AbortSignal));
    const sketch = h.document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Sketch missing.');
    expect(sketch.graph?.points[2].position).toEqual([' x ', 7]);
  });

  it.each(['pointercancel', 'lostpointercapture'])('only lets the initiating pointer cancel a drag through %s', async ending => {
    const h = await fixture();
    await h.pointer(h.point(), 'pointerdown');
    await h.pointer(h.point(), 'pointermove', { clientX: 105, clientY: 90 });
    await h.pointer(h.point(), ending, {}, 22);
    expect(h.pending).toHaveBeenLastCalledWith(true); expect(h.release).not.toHaveBeenCalled();
    await h.pointer(h.point(), ending);
    expect(h.pending).toHaveBeenLastCalledWith(false); expect(h.release.mock.calls).toEqual([['a', 11]]);
    await h.pointer(h.point(), 'pointerup', { clientX: 105, clientY: 90 });
    expect(h.edited).not.toHaveBeenCalled();
  });

  it('consumes the final release coordinates, rejects concurrent key nudges and cancels lost-button movement', async () => {
    const h = await fixture();
    await h.pointer(h.point(), 'pointerdown'); await h.key(h.point(), 'ArrowRight');
    expect(h.edited).not.toHaveBeenCalled(); expect(h.pending).toHaveBeenLastCalledWith(true);
    await h.pointer(h.point(), 'pointerup', { clientX: 105, clientY: 90 });
    expect(h.edited).toHaveBeenCalledExactlyOnceWith([{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'a', translation: [5, 10] }], expect.any(AbortSignal));
    await h.pointer(h.point(), 'pointerdown');
    await h.pointer(h.point(), 'pointermove', { clientX: 110, clientY: 90, buttons: 0 });
    expect(h.pending).toHaveBeenLastCalledWith(false);
    await h.pointer(h.point(), 'pointerup', { clientX: 110, clientY: 90 });
    expect(h.edited).toHaveBeenCalledOnce(); expect(h.release.mock.calls).toEqual([['a', 11], ['a', 11]]);
  });
});
