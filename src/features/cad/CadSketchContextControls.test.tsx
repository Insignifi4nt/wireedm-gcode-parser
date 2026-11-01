import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCadDocument, createCadDocument } from '@/domain/cad/cadSchema';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { cadSketchRelationOffers, type CadSketchRelationOffer } from '@/domain/cad/sketch-relations/cadSketchRelationOffers';
import { CadSketchContextHeader } from './CadSketchContextHeader';
import { CadSketchRelationList, CAD_SKETCH_RELATION_ROW_HEIGHT, cadSketchRelationRow, type CadSketchRelationListProps } from './CadSketchRelationList';
import { CadSketchSelectionActions, cadSketchCenterSymmetryOffer, cadSketchSelectionActions, placeCadSketchSelectionActions, type CadSketchSelectionActionsModel } from './CadSketchSelectionActions';
import { createCadSketchHighlightStore } from './cadSketchDimensionSelection';
import { cadSketchIssuesStandInForD1, type CadSketchIssues } from './cadSketchIssues';

let container: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const graphOf = (graph: object, parameters: Record<string, number> = {}): CadSketchGraph => {
  const document = parseCadDocument({ ...createCadDocument('Part', 'part'), schemaVersion: 2, parameters, features: [{ id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph }] });
  const sketch = document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Sketch missing.'); return sketch.graph;
};
const line = (id: string, startPointId: string, endPointId: string) => ({ id, kind: 'line', startPointId, endPointId, construction: false });
const key = (target: Element, name: string, init: KeyboardEventInit = {}) => act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init })));
const buttons = (scope: ParentNode = container) => [...scope.querySelectorAll<HTMLButtonElement>('button')];
const named = (name: string) => { const found = buttons().find(button => button.getAttribute('aria-label') === name); if (!found) throw new Error(`Missing ${name}`); return found; };

/** Two lines meeting at b, two circles, and an arc. */
const plate = () => graphOf({
  points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [10, 10] }, { id: 'o1', position: [30, 0] }, { id: 'o2', position: [40, 0] },
    { id: 'q', position: [20, 10] }, { id: 's', position: [20, 0] }],
  entities: [line('ab', 'a', 'b'), line('bc', 'b', 'c'), { id: 'c1', kind: 'circle', centerPointId: 'o1', radius: 2, construction: false },
    { id: 'c2', kind: 'circle', centerPointId: 'o2', radius: 3, construction: false }, { id: 'arc', kind: 'arc', centerPointId: 'q', startPointId: 'c', endPointId: 's', direction: 'ccw', construction: false }],
  relations: [{ id: 'level', kind: 'horizontal', pointIds: ['a', 'b'] }]
});

describe('selection icon row', () => {
  it('names two arcs or circles on one centre Concentric, a Fix by its tool name, and a name two kinds share once, the usable one first', () => {
    const graph = plate();
    const circles = cadSketchSelectionActions(graph, cadSketchRelationOffers(graph, [{ kind: 'entity', id: 'c1' }, { kind: 'entity', id: 'c2' }]));
    expect(circles.map(action => action.label)).toEqual(expect.arrayContaining(['Concentric', 'Equal radius']));
    expect(circles.find(action => action.label === 'Concentric')).toMatchObject({ key: 'concentric', state: 'available', help: 'Keeps the arcs and circles on one center, independently of their sizes.' });
    // A line alone takes Horizontal, applied here and pressed to remove, Vertical, blocked with the judge's reason, and Fix for the whole edge.
    const edge = cadSketchSelectionActions(graph, cadSketchRelationOffers(graph, [{ kind: 'entity', id: 'ab' }]));
    expect(edge.map(action => [action.label, action.state])).toEqual([['Horizontal', 'applied'], ['Vertical', 'blocked'], ['Fix', 'available']]);
    expect(edge[0].help).toBe('Applied. Press to remove horizontal.'); expect(edge[1].help).toBe('This is already horizontal.');
    // Tangent and the tangent joint share a name: the row shows one button, the available offer over a blocked one in either order.
    const blocked: CadSketchRelationOffer = { kind: 'tangent', state: 'blocked', reason: 'These do not touch.', operands: [], relations: [], relationIds: [] };
    const available: CadSketchRelationOffer = { kind: 'tangent-joint', state: 'available', operands: [], relations: [], relationIds: [] };
    for (const offers of [[blocked, available], [available, blocked]]) expect(cadSketchSelectionActions(graph, offers).map(action => [action.label, action.state])).toEqual([['Tangent', 'available']]);
  });

  it('offers Symmetric centers beside Symmetric for two circles and a line or an axis, applied once their centers mirror, and for nothing else', () => {
    // Fixed radii of 2 and 3 cannot mirror as whole curves, so Symmetric is blocked, while the centers alone can mirror about the line.
    const graph = graphOf({ ...plate(), entities: plate().entities.map(entity => entity.kind === 'circle' ? { ...entity, radius: String(entity.radius) } : entity) });
    const pick = (...ids: string[]) => ids.map(id => ({ kind: 'entity' as const, id }));
    const row = (selection: ReturnType<typeof pick>, on = graph) => cadSketchSelectionActions(on, cadSketchRelationOffers(on, selection), cadSketchCenterSymmetryOffer(on, selection));
    const free = row(pick('c1', 'c2', 'ab')), at = free.findIndex(action => action.label === 'Symmetric');
    expect(free[at]).toMatchObject({ state: 'blocked', help: 'These circles have fixed radii that differ, so they cannot mirror each other.' });
    expect(free[at + 1]).toMatchObject({ key: 'symmetric-centers', label: 'Symmetric centers', state: 'available',
      help: 'Keeps the two circles’ centers mirrored about the line or axis; each radius keeps its own driver.' });
    expect(free[at + 1].offer.relations).toEqual([expect.objectContaining({ kind: 'symmetric', pointIds: ['o1', 'o2'], lineId: 'ab' })]);
    expect(row(pick('c2', '@v', 'c1')).find(action => action.key === 'symmetric-centers')?.offer.relations).toEqual([expect.objectContaining({ pointIds: ['o2', 'o1'], lineId: '@v' })]);
    // x = 35 mirrors the centers at 30 and 40.
    const mirrored = graphOf({ points: [...graph.points, { id: 'm1', position: [35, -5] }, { id: 'm2', position: [35, 5] }], entities: [...graph.entities, line('axis', 'm1', 'm2')],
      relations: [{ id: 'mirror', kind: 'symmetric', pointIds: ['o1', 'o2'], lineId: 'axis' }] });
    expect(row(pick('c1', 'c2', 'axis'), mirrored).find(action => action.key === 'symmetric-centers')).toMatchObject({ state: 'applied', help: 'Applied. Press to remove symmetric centers.', offer: { relationIds: ['mirror'] } });
    for (const selection of [pick('c1', 'c2'), pick('c1', 'arc', 'ab'), pick('c1', 'c2', 'ab', 'bc'), [{ kind: 'point' as const, id: 'o1' }, ...pick('c2', 'ab')]])
      expect(cadSketchCenterSymmetryOffer(graph, selection), JSON.stringify(selection)).toBeNull();
  });

  it('sits above the selection, else below, beside or in a free corner, never over it, and inside the viewport margins', () => {
    const viewport = { width: 800, height: 600 }, size = { width: 160, height: 28 };
    expect(placeCadSketchSelectionActions({ left: 300, top: 300, right: 400, bottom: 360 }, size, viewport)).toEqual({ left: 270, top: 262, right: 430, bottom: 290 });
    // Under the header, the row goes below the selection.
    expect(placeCadSketchSelectionActions({ left: 300, top: 50, right: 400, bottom: 80 }, size, viewport).top).toBe(90);
    const overlaps = (a: { left: number; top: number; right: number; bottom: number }, b: typeof a) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (let left = 0; left < 800; left += 37) for (let top = 0; top < 600; top += 41) for (const [w, h] of [[4, 4], [120, 30], [300, 200], [600, 420]]) {
      const selection = { left, top, right: left + w, bottom: top + h }, box = placeCadSketchSelectionActions(selection, size, viewport);
      expect(box.left).toBeGreaterThanOrEqual(8); expect(box.right).toBeLessThanOrEqual(792); expect(box.top).toBeGreaterThanOrEqual(48); expect(box.bottom).toBeLessThanOrEqual(536);
      const clear = [placeCadSketchSelectionActions(null, size, viewport)].some(corner => !overlaps(corner, selection));
      if (clear) expect(overlaps(box, selection), JSON.stringify(selection)).toBe(false);
    }
    // A selection that fills the view leaves no clear place: the row takes the first corner.
    expect(placeCadSketchSelectionActions({ left: 0, top: 0, right: 800, bottom: 600 }, size, viewport)).toEqual({ left: 8, top: 48, right: 168, bottom: 76 });
  });

  it('keeps clear of the dimension labels, marks and panels it is given where it can, and of the selection always', () => {
    const viewport = { width: 800, height: 600 }, size = { width: 160, height: 28 }, selection = { left: 300, top: 50, right: 400, bottom: 80 };
    // A label under the selection's middle: the row leaves every place below for the one beside the selection.
    expect(placeCadSketchSelectionActions(selection, size, viewport, [{ left: 330, top: 95, right: 370, bottom: 110 }])).toEqual({ left: 410, top: 51, right: 570, bottom: 79 });
    // A label under the middle of a wide selection: the row moves to its start, still below it.
    expect(placeCadSketchSelectionActions({ left: 100, top: 50, right: 700, bottom: 80 }, size, viewport, [{ left: 380, top: 95, right: 420, bottom: 110 }]))
      .toEqual({ left: 100, top: 90, right: 260, bottom: 118 });
    // Nowhere clear of them: the selection alone decides.
    expect(placeCadSketchSelectionActions(selection, size, viewport, [{ left: 0, top: 0, right: 800, bottom: 600 }])).toEqual(placeCadSketchSelectionActions(selection, size, viewport));
  });

  it('presses offers through the model, shows applied ones pressed and blocked ones disabled, and moves focus with the arrows', async () => {
    const graph = plate(), selection = [{ kind: 'entity' as const, id: 'ab' }], offers = cadSketchRelationOffers(graph, selection);
    const onOffer = vi.fn(), onDimension = vi.fn(), onEscape = vi.fn();
    const model: CadSketchSelectionActionsModel = { graph, selection, offers, dimensionAvailable: true, disabled: false, onOffer, onDimension };
    const prepared = { points: [], geometry: { segments: [] } } as never;
    const render = (next: CadSketchSelectionActionsModel) => act(async () => root.render(<CadSketchSelectionActions model={next} prepared={prepared} center={[0, 0]} width={100} span={100}
      pixelWidth={800} pixelHeight={600} onEscape={onEscape} />));
    await render(model);
    const row = container.querySelector('[role="toolbar"]')!;
    expect(row.getAttribute('aria-label')).toBe('Relations for the selection');
    expect(buttons(row).map(button => [button.getAttribute('aria-label'), button.getAttribute('aria-pressed'), button.disabled])).toEqual([
      ['Horizontal', 'true', false], ['Vertical', 'false', true], ['Fix', 'false', false], ['Dimension the selection', null, false]]);
    expect(named('Vertical').dataset.state).toBe('blocked');
    await act(async () => named('Horizontal').click()); expect(onOffer).toHaveBeenCalledWith(offers.find(offer => offer.kind === 'horizontal'));
    await act(async () => named('Fix').click()); expect(onOffer).toHaveBeenLastCalledWith(offers.find(offer => offer.kind === 'fixed-point'));
    await act(async () => named('Dimension the selection').click()); expect(onDimension).toHaveBeenCalledOnce();
    // One stop in the tab order; the arrows, Home and End move it, and Escape hands focus back to the canvas.
    expect(buttons(row).filter(button => button.tabIndex === 0)).toHaveLength(1);
    // Blocked Vertical cannot take focus, so the arrows step over it.
    await act(async () => named('Horizontal').focus()); await key(named('Horizontal'), 'ArrowRight');
    expect(document.activeElement).toBe(named('Fix'));
    await key(named('Fix'), 'ArrowLeft'); expect(document.activeElement).toBe(named('Horizontal'));
    await key(named('Horizontal'), 'End'); expect(document.activeElement).toBe(named('Dimension the selection'));
    await key(named('Dimension the selection'), 'ArrowRight'); expect(document.activeElement).toBe(named('Horizontal'));
    await key(named('Horizontal'), 'Escape'); expect(onEscape).toHaveBeenCalledOnce();
    // With the first button blocked, the tab stop starts on the first one that can be pressed.
    const vertical = cadSketchRelationOffers(graph, [{ kind: 'entity', id: 'bc' }]).map(offer => offer.kind === 'horizontal' ? { ...offer, state: 'blocked' as const, reason: 'No.' } : offer);
    await render({ ...model, offers: vertical, selection: [{ kind: 'entity', id: 'bc' }] });
    expect(buttons(row).filter(button => button.tabIndex === 0).map(button => button.getAttribute('aria-label'))).toEqual(['Vertical']);
    // A pending edit disables the whole row, the Dimension button with it.
    await render({ ...model, disabled: true });
    expect(buttons(row).every(button => button.disabled)).toBe(true);
  });
});

describe('relations under the sketch in the feature tree', () => {
  const many = (count: number) => graphOf({
    points: Array.from({ length: count + 1 }, (_, index) => ({ id: `p${index}`, position: [index, 0] })),
    entities: Array.from({ length: count }, (_, index) => line(`l${index}`, `p${index}`, `p${index + 1}`)),
    relations: Array.from({ length: count }, (_, index) => ({ id: `h${index}`, kind: 'horizontal', pointIds: [`p${index}`, `p${index + 1}`] }))
  });
  const noIssues = (graph: CadSketchGraph) => cadSketchIssuesStandInForD1({ sketchId: 'sketch', graph });
  function props(graph: CadSketchGraph, extra: Partial<CadSketchRelationListProps> = {}): CadSketchRelationListProps {
    return { graph, parameters: {}, issues: noIssues(graph), selectedIds: [], selection: [], onlySelection: false, onOnlySelection: vi.fn(), locked: false,
      onSelect: vi.fn(), onOpen: vi.fn(), onDelete: vi.fn(), onMenu: vi.fn(), ...extra };
  }
  const rows = () => [...container.querySelectorAll<HTMLButtonElement>('[data-cad-sketch-relation-row]')];
  const row = (id: string) => { const found = container.querySelector<HTMLButtonElement>(`[data-cad-sketch-relation-row="${id}"]`); if (!found) throw new Error(`Row ${id} missing.`); return found; };
  /** jsdom lays nothing out, so the scroller reports the box the list sizes it to and keeps what it is scrolled to. */
  function scrollable() {
    const scroller = container.querySelector<HTMLElement>('.cad-sketch-relation-list-scroller')!; let top = 0;
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: value => { top = value; } });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => parseFloat(scroller.style.height) });
    return { scroller, scroll: (to: number) => act(async () => { top = to; scroller.dispatchEvent(new Event('scroll')); }) };
  }

  it('renders only the rows in view of 300 relations, and names each row once per accepted graph', async () => {
    const graph = many(300);
    await act(async () => root.render(<CadSketchRelationList {...props(graph)} />));
    expect(container.querySelector('small[aria-label="300 relations"]')).not.toBeNull();
    expect(rows().length).toBeLessThanOrEqual(20); expect(rows()[0].getAttribute('aria-label')).toBe('Horizontal relation 1 · Point 1 and Point 2');
    expect(container.querySelector('ul[aria-label="Sketch relations"]')?.getAttribute('style')).toContain(`height: ${300 * CAD_SKETCH_RELATION_ROW_HEIGHT}px`);
    expect(rows()[0].closest('li')?.getAttribute('aria-setsize')).toBe('300');
    const { scroll } = scrollable();
    await scroll(200 * CAD_SKETCH_RELATION_ROW_HEIGHT);
    expect(rows().length).toBeLessThanOrEqual(20); expect(() => row('h200')).not.toThrow(); expect(() => row('h0')).toThrow();
    expect(row('h200').closest('li')?.getAttribute('aria-posinset')).toBe('201');
    // Rows come from one index for each accepted graph: the same relation names the same row, and a new graph names it afresh.
    expect(cadSketchRelationRow(graph, graph.relations[5])).toBe(cadSketchRelationRow(graph, graph.relations[5]));
    const next = { ...graph, relations: [...graph.relations] };
    expect(cadSketchRelationRow(next, next.relations[5])).not.toBe(cadSketchRelationRow(graph, graph.relations[5]));
  });

  it('selects, opens, deletes and opens the menu of a row from the pointer and the keyboard, and does none of it while locked', async () => {
    const graph = many(30), base = props(graph);
    await act(async () => root.render(<CadSketchRelationList {...base} />));
    await act(async () => row('h2').click()); expect(base.onSelect).toHaveBeenLastCalledWith(graph.relations[2], false);
    await act(async () => row('h3').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))); expect(base.onSelect).toHaveBeenLastCalledWith(graph.relations[3], true);
    await act(async () => row('h3').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))); expect(base.onOpen).toHaveBeenLastCalledWith(graph.relations[3]);
    await key(row('h4'), 'Enter'); expect(base.onOpen).toHaveBeenLastCalledWith(graph.relations[4]);
    await key(row('h4'), 'Delete'); expect(base.onDelete).toHaveBeenLastCalledWith(graph.relations[4]);
    await key(row('h5'), 'Backspace'); expect(base.onDelete).toHaveBeenLastCalledWith(graph.relations[5]);
    await key(row('h6'), 'F10', { shiftKey: true }); expect(base.onMenu).toHaveBeenLastCalledWith(graph.relations[6], expect.objectContaining({ clientX: expect.any(Number) }));
    await act(async () => row('h7').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 6 })));
    expect(base.onMenu).toHaveBeenLastCalledWith(graph.relations[7], expect.objectContaining({ clientX: 5, clientY: 6 }));
    // The arrows move the one tab stop and focus along the list, scrolling as they go.
    scrollable();
    await act(async () => row('h0').focus()); expect(rows().filter(button => button.tabIndex === 0).map(button => button.dataset.cadSketchRelationRow)).toEqual(['h0']);
    await key(row('h0'), 'ArrowDown'); expect(document.activeElement).toBe(row('h1'));
    await key(row('h1'), 'End'); expect(document.activeElement).toBe(row('h29'));
    await key(row('h29'), 'Home'); expect(document.activeElement).toBe(row('h0'));
    const calls = [base.onSelect, base.onOpen, base.onDelete, base.onMenu].map(fn => vi.mocked(fn).mock.calls.length);
    await act(async () => root.render(<CadSketchRelationList {...base} locked />));
    expect(rows().every(button => button.disabled)).toBe(true);
    await key(row('h1'), 'Delete'); await key(row('h1'), 'Enter');
    expect([base.onSelect, base.onOpen, base.onDelete, base.onMenu].map(fn => vi.mocked(fn).mock.calls.length)).toEqual(calls);
  });

  it('shows each row pressed with its mark, its value and its issue states, lights its geometry, and lists only the selection on request', async () => {
    const graph = graphOf({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [10, 10] }], entities: [line('ab', 'a', 'b'), line('bc', 'b', 'c')],
      relations: [{ id: 'size', kind: 'distance', pointIds: ['a', 'b'], value: 'w' }, { id: 'up', kind: 'vertical', pointIds: ['b', 'c'] }, { id: 'tall', kind: 'distance', pointIds: ['b', 'c'], value: 10 }] }, { w: 10 });
    const issues = cadSketchIssuesStandInForD1({ sketchId: 'sketch', graph, analysis: { kind: 'rejected', reason: 'conflicting',
      diagnostics: { conflictingIds: ['up'], redundantIds: ['tall'], partiallyRedundantIds: [], issues: [] } } });
    const highlight = createCadSketchHighlightStore(), onOnlySelection = vi.fn();
    const base = props(graph, { parameters: { w: 10 }, issues, highlight, selectedIds: ['size'], onOnlySelection });
    await act(async () => root.render(<CadSketchRelationList {...base} />));
    expect(rows().map(button => [button.getAttribute('aria-label'), button.getAttribute('aria-pressed')])).toEqual([
      ['Distance relation 1 · Point 1 and Point 2 · 10 mm', 'true'], ['Vertical relation 2 · Point 2 and Point 3 · Conflict', 'false'],
      ['Distance relation 3 · Point 2 and Point 3 · 10 mm · Redundant', 'false']]);
    expect(row('up').classList.contains('has-issues')).toBe(true);
    await act(async () => row('up').focus());
    expect(highlight.getSnapshot()).toMatchObject({ kind: 'geometry', pointIds: ['b', 'c'], relationIds: ['up'] });
    await act(async () => row('up').blur()); expect(highlight.getSnapshot()).toBeNull();
    // With nothing selected the toggle is off and disabled; with a selection it lists the relations on its points.
    expect(named('Only the selection').disabled).toBe(true);
    await act(async () => root.render(<CadSketchRelationList {...base} selection={[{ kind: 'point', id: 'c' }]} />));
    await act(async () => named('Only the selection').click()); expect(onOnlySelection).toHaveBeenCalledWith(true);
    await act(async () => root.render(<CadSketchRelationList {...base} selection={[{ kind: 'point', id: 'c' }]} onlySelection />));
    expect(rows().map(button => button.dataset.cadSketchRelationRow)).toEqual(['up', 'tall']); expect(named('Only the selection').getAttribute('aria-pressed')).toBe('true');
    await act(async () => root.render(<CadSketchRelationList {...base} selection={[{ kind: 'point', id: 'zz' }]} onlySelection />));
    expect(container.textContent).toContain('Nothing constrains the selection.');
  });

  it('scrolls a revealed relation into view once for each request', async () => {
    const graph = many(120), base = props(graph);
    await act(async () => root.render(<CadSketchRelationList {...base} />));
    const { scroller } = scrollable();
    await act(async () => root.render(<CadSketchRelationList {...base} reveal={{ relationId: 'h100', token: '1' }} />));
    expect(scroller.scrollTop).toBe(101 * CAD_SKETCH_RELATION_ROW_HEIGHT - parseFloat(scroller.style.height)); expect(() => row('h100')).not.toThrow();
    // The same request again does nothing after the list was scrolled away; a new one scrolls back.
    scroller.scrollTop = 0;
    await act(async () => root.render(<CadSketchRelationList {...base} reveal={{ relationId: 'h100', token: '1' }} />)); expect(scroller.scrollTop).toBe(0);
    await act(async () => root.render(<CadSketchRelationList {...base} reveal={{ relationId: 'h100', token: '2' }} />)); expect(scroller.scrollTop).toBeGreaterThan(0);
  });
});

describe('sketch context header', () => {
  const graph = () => graphOf({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }], entities: [line('ab', 'a', 'b')],
    relations: [{ id: 'level', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'again', kind: 'horizontal', pointIds: ['b', 'a'] }] });
  const redundant = (source: CadSketchGraph): CadSketchIssues => cadSketchIssuesStandInForD1({ sketchId: 'sketch', graph: source, analysis: { kind: 'solved', reason: null,
    diagnostics: { conflictingIds: [], redundantIds: ['again'], partiallyRedundantIds: [], issues: [] } } });
  function mount(issues: CadSketchIssues, extra: { inspected?: string | null; locked?: boolean } = {}) {
    const handlers = { onInspectIssue: vi.fn(), onShowDimensions: vi.fn(), onShowRelations: vi.fn() }, highlight = createCadSketchHighlightStore();
    const render = (next: CadSketchIssues, more = extra) => act(async () => root.render(<CadSketchContextHeader name="Sketch 1" status={<span>Fully defined</span>} issues={next}
      inspectedIssue={more.inspected ?? null} issuesLocked={more.locked ?? false} highlight={highlight} highlightOf={issue => ({ pointIds: issue.pointIds, entityIds: issue.entityIds })}
      dimensionsShown relationsShown={false} viewModes={<span data-testid="modes" />} actions={<button type="button" aria-label="Finish sketch">Finish</button>} {...handlers} />));
    return { handlers, highlight, render };
  }

  it('counts the issues, opens them as a list that lights and inspects each, and closes on Escape with focus back on the count', async () => {
    const source = graph(), issues = redundant(source), h = mount(issues);
    await h.render(issues);
    const header = container.querySelector('[data-cad-sketch-header]')!, count = container.querySelector<HTMLButtonElement>('[data-cad-sketch-issues]')!;
    expect(header.getAttribute('role')).toBe('group'); expect(header.getAttribute('aria-label')).toBe('Sketch editing');
    expect(header.textContent).toContain('Sketch 1'); expect(header.textContent).toContain('Fully defined');
    expect([count.getAttribute('aria-label'), count.dataset.cadSketchIssues, count.getAttribute('aria-expanded')]).toEqual(['1 constraint issue', '1', 'false']);
    // The view toggles, the view-modes slot and Finish keep their places.
    expect(named('Show dimensions').getAttribute('aria-pressed')).toBe('true'); expect(named('Show relations').getAttribute('aria-pressed')).toBe('false');
    await act(async () => named('Show relations').click()); expect(h.handlers.onShowRelations).toHaveBeenCalledWith(true);
    expect(header.querySelector('[data-cad-sketch-view-modes] [data-testid="modes"]')).not.toBeNull(); expect(header.querySelector('[aria-label="Finish sketch"]')).not.toBeNull();
    await act(async () => count.click());
    const item = container.querySelector<HTMLButtonElement>('ul[aria-label="Constraint issues"] > li > button')!;
    expect(item.textContent).toBe('Horizontal relation 2 · Point 2 and Point 1Redundant'); expect(count.getAttribute('aria-expanded')).toBe('true');
    await act(async () => item.focus()); expect(h.highlight.getSnapshot()).toMatchObject({ kind: 'geometry', pointIds: ['b', 'a'] });
    await act(async () => item.click()); expect(h.handlers.onInspectIssue).toHaveBeenCalledWith(issues.list[0]);
    await key(item, 'Escape');
    expect(container.querySelector('ul[aria-label="Constraint issues"]')).toBeNull(); expect(document.activeElement).toBe(count); expect(h.highlight.getSnapshot()).toBeNull();
  });

  it('closes the list and drops a lit row when the issues go, and counts what a refusal left out', async () => {
    const source = graph(), issues = redundant(source), h = mount(issues);
    await h.render(issues);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-cad-sketch-issues]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('ul[aria-label="Constraint issues"] button')!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));
    await act(async () => container.querySelector<HTMLButtonElement>('ul[aria-label="Constraint issues"] button')!.focus());
    expect(h.highlight.getSnapshot()).not.toBeNull();
    const none = cadSketchIssuesStandInForD1({ sketchId: 'sketch', graph: source });
    await h.render(none);
    const count = container.querySelector<HTMLButtonElement>('[data-cad-sketch-issues]')!;
    expect([count.getAttribute('aria-label'), count.disabled]).toEqual(['No constraint issues', true]);
    expect(container.querySelector('ul[aria-label="Constraint issues"]')).toBeNull(); expect(h.highlight.getSnapshot()).toBeNull();
    await h.render({ ...issues, omitted: 4 });
    expect(count.getAttribute('aria-label')).toBe('5 constraint issues');
    await act(async () => count.click());
    expect(container.querySelector('.cad-sketch-header-issue-more')?.textContent).toBe('4 more affected items');
    // A pending edit of another sketch keeps each issue from opening on the canvas.
    await h.render({ ...issues, omitted: 4 }, { locked: true });
    expect(container.querySelector<HTMLButtonElement>('ul[aria-label="Constraint issues"] button')!.disabled).toBe(true);
  });
});
