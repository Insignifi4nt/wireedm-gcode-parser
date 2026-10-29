// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { checkCadSketchGraph, type CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { measureCadSketchReferenceDimension } from '@/domain/cad/cadSketchReferenceDimensions';
import { prepareCadEdits } from './cadEditPreparation';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { CadSession } from './cadSession';
import { CadSketchEditDraft } from './cadSketchEditDraft';
import { createCadSketchTestSolver } from './sketch-solver/__tests__/cadSketchTestSolver';

const runtime = createCadSketchTestSolver();
const set = (relation: CadSketchGraphRelation) => ({ kind: 'set-sketch-relation', sketchId: 'sketch', relation } as const);
const gap = (value: number | string, side: 'left' | 'right') => ({ id: 'gap', kind: 'point-line-distance', pointId: 'p', lineId: 'base', side, value } as const);

function part(graph: object): CadDocument {
  return parseCadDocument({ ...createCadDocument('Line distances', 'line-distances'), schemaVersion: 2, parameters: { depth: 6, height: 0, lift: 4 }, features: [{
    id: 'sketch', name: 'Distances', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph }] });
}
/** A driven 20 mm base line at `origin`, optionally reversed, and a free point 4 mm to the given side of it. */
function based(origin: readonly [number, number], reversed: boolean, side: 1 | -1): CadDocument {
  const [x, y] = origin;
  return part({ points: [{ id: 'a', position: [String(x), String(y)] }, { id: 'b', position: [String(x + 20), String(y)] }, { id: 'p', position: [x + 5, y + side * 4] }],
    entities: [{ id: 'base', kind: 'line', construction: false, startPointId: reversed ? 'b' : 'a', endPointId: reversed ? 'a' : 'b' }], relations: [] });
}
function graphOf(document: CadDocument) {
  const sketch = document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing sketch fixture.'); return sketch.graph;
}
const position = (document: CadDocument, id: string) => graphOf(document).points.find(point => point.id === id)!.position.map(Number);

describe('prepared point to line distance', () => {
  it.each([
    { origin: [0, 0], reversed: false, side: 1 }, { origin: [0, 0], reversed: true, side: 1 }, { origin: [0, 0], reversed: false, side: -1 },
    { origin: [0, 0], reversed: true, side: -1 }, { origin: [1e6, -2e6], reversed: true, side: -1 }, { origin: [-3e6, 1e6], reversed: false, side: 1 }
  ] as const)('holds the point on its stored side through value edits and drags across: %o', async ({ origin, reversed, side }) => {
    const source = based(origin, reversed, side), digits = origin[0] ? 6 : 9;
    // Left is seen from the line's start looking toward its end.
    const held = (side === 1) !== reversed ? 'left' : 'right', opposite = held === 'left' ? 'right' : 'left';
    const added = await prepareCadEdits(source, [set(gap(4, held))], runtime);
    expect(added.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 1, conflictingIds: [], redundantIds: [], issues: [] });
    const offset = (document: CadDocument) => position(document, 'p')[1] - origin[1];
    // A value edit and an expression move the point away from the line on the side it is on.
    const edited = await prepareCadEdits(added.document, [set(gap(9, held))], runtime);
    expect(offset(edited.document)).toBeCloseTo(side * 9, digits);
    const driven = await prepareCadEdits(edited.document, [set(gap(' depth ', held))], runtime);
    expect(offset(driven.document)).toBeCloseTo(side * 6, digits);
    // A drag across the line slides the point along its side instead of flipping it over.
    const p = position(driven.document, 'p');
    const dragged = await prepareCadEdits(driven.document, [{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'p', translation: [3, -side * 30] }], runtime);
    expect(offset(dragged.document)).toBeCloseTo(side * 6, digits);
    expect(position(dragged.document, 'p')[0]).toBeCloseTo(p[0] + 3, digits);
    expect(checkCadSketchGraph(graphOf(dragged.document), dragged.document.parameters)).toEqual([]);
    expect(graphOf(dragged.document).relations).toEqual([gap(' depth ', held)]);
    // The stored side decides, not where the point happens to be: the other side carries the point across.
    const crossed = await prepareCadEdits(source, [set(gap(4, opposite))], runtime);
    expect(offset(crossed.document)).toBeCloseTo(-side * 4, digits);
  });

  it('measures as a reference without driving the point', async () => {
    const measured = { id: 'measured', kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: 'p', lineId: 'base' } } as const;
    const added = await prepareCadEdits(based([0, 0], false, 1), [set(measured)], runtime);
    expect(added.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 2, issues: [] });
    const dragged = await prepareCadEdits(added.document, [{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'p', translation: [1, -11] }], runtime);
    expect(position(dragged.document, 'p')).toEqual([6, -7]);
    expect(measureCadSketchReferenceDimension(graphOf(dragged.document), {}, measured)).toBe(7);
  });

  it('judges a parallel between two vertical lines redundant, and holds their distance without it', async () => {
    const source = part({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [0, 10] }, { id: 'c', position: [10, 0] }, { id: 'd', position: [10, 10] }],
      entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'other', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' }],
      relations: [{ id: 'up', kind: 'vertical', pointIds: ['a', 'b'] }, { id: 'up-too', kind: 'vertical', pointIds: ['c', 'd'] }] });
    // C is right of the upward base line.
    const distance = { id: 'gap', kind: 'point-line-distance', pointId: 'c', lineId: 'base', side: 'right', value: 10 } as const;
    const failure = await prepareCadEdits(source, [set(distance), set({ id: 'parallel', kind: 'parallel', lineIds: ['base', 'other'] })], runtime).catch(error => error);
    expect(failure).toBeInstanceOf(CadSketchPreparationError);
    if (!(failure instanceof CadSketchPreparationError)) throw failure;
    const subjects = failure.feedback.subjects.filter(subject => subject.source.kind === 'relation' && subject.source.id === 'parallel');
    expect(subjects.map(subject => subject.category)).toContainEqual(expect.stringMatching(/redundant/));
    expect(subjects.some(subject => subject.category === 'conflicting')).toBe(false);
    const held = await prepareCadEdits(source, [set(distance)], runtime);
    expect(held.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', conflictingIds: [], redundantIds: [], issues: [] });
    const wider = await prepareCadEdits(held.document, [set({ ...distance, value: 15 })], runtime);
    expect(position(wider.document, 'c')[0] - position(wider.document, 'a')[0]).toBeCloseTo(15, 9);
    expect(position(wider.document, 'd')[0] - position(wider.document, 'a')[0]).toBeCloseTo(15, 9);
  });
});

describe('a distance between parallel lines', () => {
  it('moves the whole line with an existing distance once Parallel joins it', async () => {
    const rise = { id: 'rise', kind: 'point-line-distance', pointId: 'c', lineId: 'base', side: 'left', value: 10 } as const;
    const source = part({ points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: ['20', '0'] }, { id: 'c', position: [0, 10] }, { id: 'd', position: [20, 10] }],
      entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'top', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' }],
      relations: [rise] });
    const wider = await prepareCadEdits(source, [set({ ...rise, value: 15 }), set({ id: 'level', kind: 'parallel', lineIds: ['base', 'top'] })], runtime);
    expect(position(wider.document, 'c')[1]).toBeCloseTo(15, 9);
    expect(position(wider.document, 'd')[1]).toBeCloseTo(15, 9);
  });
});

describe('the stored side of a point to line distance', () => {
  // The side is stored with the relation, so it holds however the geometry moved before the solve: a parameter that moves the
  // line or the point, a parameter in the value, or an undone and redone edit.
  /** A line at Y `height` and a free point 10 above it, or a free horizontal line and a point at Y `lift`. */
  const raised = () => part({ points: [{ id: 'a', position: ['0', 'height'] }, { id: 'b', position: ['20', 'height'] }, { id: 'p', position: [5, 10] }],
    entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: [gap(10, 'left')] });
  const lifted = () => part({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'p', position: ['5', 'lift'] }],
    entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
    relations: [{ id: 'level', kind: 'horizontal', pointIds: ['a', 'b'] }, gap(4, 'left')] });
  const parameter = (name: string, value: number) => ({ kind: 'set-parameter', name, value } as const);

  it('moves the point with a line that a parameter carries past it', async () => {
    for (const [height, y] of [[20, 30], [-20, -10]] as const) {
      const moved = await prepareCadEdits(raised(), [parameter('height', height)], runtime);
      expect(position(moved.document, 'p')).toEqual([expect.closeTo(5, 9), expect.closeTo(y, 9)]);
      expect(checkCadSketchGraph(graphOf(moved.document), moved.document.parameters)).toEqual([]);
    }
    // A parameter in the value moves it on the same side.
    const driven = await prepareCadEdits(raised(), [set(gap(' depth ', 'left')), parameter('height', 20), parameter('depth', 12)], runtime);
    expect(position(driven.document, 'p')[1]).toBeCloseTo(32, 9);
  });

  it('moves the line with a point that a parameter carries past it', async () => {
    const moved = await prepareCadEdits(lifted(), [parameter('lift', -20)], runtime);
    expect(position(moved.document, 'a')[1]).toBeCloseTo(-24, 9);
    expect(position(moved.document, 'b')[1]).toBeCloseTo(-24, 9);
    expect(position(moved.document, 'b')[0] - position(moved.document, 'a')[0]).toBeCloseTo(20, 9);
    expect(checkCadSketchGraph(graphOf(moved.document), moved.document.parameters)).toEqual([]);
  });

  it('moves a free point with a line that another relation carries past it, and rejects the move when the point is fixed', async () => {
    const floor = { id: 'floor', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 } as const;
    const held = (relations: readonly CadSketchGraphRelation[]) => part({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'p', position: [5, 10] }],
      entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
      relations: [{ id: 'level', kind: 'horizontal', pointIds: ['a', 'b'] }, floor, gap(10, 'left'), ...relations] });
    const raisedFloor = await prepareCadEdits(held([]), [set({ ...floor, value: 20 })], runtime);
    expect(position(raisedFloor.document, 'p')[1]).toBeCloseTo(30, 9);
    const pinned = await prepareCadEdits(held([{ id: 'pin', kind: 'fixed-point', pointId: 'p', position: [5, 10] }]), [set({ ...floor, value: 20 })], runtime).catch(error => error);
    expect(pinned).toBeInstanceOf(CadSketchPreparationError);
  });

  it('keeps the side through undo and redo, and on the next edit', async () => {
    const session = new CadSession(raised()), y = () => position(session.getSnapshot().document, 'p')[1];
    const edit = (edits: Parameters<typeof prepareCadEdits>[1]) => session.editPrepared(session.getSnapshot().version,
      async document => (await prepareCadEdits(document, edits, runtime)).document);
    await edit([parameter('height', 20)]); expect(y()).toBeCloseTo(30, 9);
    session.undo(); expect(y()).toBe(10);
    session.redo(); expect(y()).toBeCloseTo(30, 9);
    session.undo(); await edit([parameter('height', -20)]); expect(y()).toBeCloseTo(-10, 9);
    expect(graphOf(session.getSnapshot().document).relations).toEqual([gap(10, 'left')]);
  });
});

describe('a line whose endpoints an edit swaps', () => {
  // The base runs (0,0) to (20,0) with the point held 4 to its left, above it.
  const source = () => part({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'p', position: [5, 4] }],
    entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
    relations: [{ id: 'floor', kind: 'fixed-point', pointId: 'a', position: [0, 0] }, { id: 'level', kind: 'horizontal', pointIds: ['a', 'b'] }, gap(4, 'left')] });
  const swapped = (document: CadDocument, changes: { readonly side?: 'left' | 'right'; readonly p?: readonly [number, number] } = {}) => {
    const graph = graphOf(document), sketch = document.features[0];
    return { kind: 'update-feature', feature: { ...sketch, graph: { ...graph,
      points: graph.points.map(point => point.id === 'p' && changes.p ? { ...point, position: changes.p } : point),
      entities: graph.entities.map(entity => entity.kind === 'line' ? { ...entity, startPointId: entity.endPointId, endPointId: entity.startPointId } : entity),
      relations: graph.relations.map(relation => relation.kind === 'point-line-distance' && changes.side ? { ...relation, side: changes.side } : relation) } } } as const;
  };
  const sideOf = (document: CadDocument) => graphOf(document).relations.find(relation => relation.kind === 'point-line-distance')?.side;

  it('keeps the point where it is when only the endpoint order changes', async () => {
    const reversed = await prepareCadEdits(source(), [swapped(source())], runtime);
    expect(position(reversed.document, 'p')).toEqual([expect.closeTo(5, 9), expect.closeTo(4, 9)]);
    expect(sideOf(reversed.document)).toBe('right');
    expect(checkCadSketchGraph(graphOf(reversed.document), reversed.document.parameters)).toEqual([]);
    // Turning it back restores the original side.
    const restored = await prepareCadEdits(reversed.document, [swapped(reversed.document)], runtime);
    expect(position(restored.document, 'p')).toEqual([expect.closeTo(5, 9), expect.closeTo(4, 9)]);
    expect(sideOf(restored.document)).toBe('left');
  });

  it('respects a side the same edit or batch states', async () => {
    // Right of the reversed line is above it, so the stated side carries a point that arrives below back up.
    const restated = await prepareCadEdits(source(), [swapped(source(), { side: 'right', p: [5, -4] })], runtime);
    expect(position(restated.document, 'p')[1]).toBeCloseTo(4, 9);
    expect(sideOf(restated.document)).toBe('right');
    // Left of the reversed line, set by a later edit in the batch, is below it.
    const crossed = await prepareCadEdits(source(), [swapped(source()), set(gap(4, 'left'))], runtime);
    expect(position(crossed.document, 'p')[1]).toBeCloseTo(-4, 9);
    expect(sideOf(crossed.document)).toBe('left');
  });

  it('decides from endpoint identities, so the order of edits in a batch and unsolved positions do not matter', async () => {
    // The line follows the height parameter; the point starts 10 above it at height 0.
    const lifted = part({ points: [{ id: 'a', position: [0, 'height'] }, { id: 'b', position: [20, 'height'] }, { id: 'p', position: [5, 10] }],
      entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: [gap(10, 'left')] });
    const raise = { kind: 'set-parameter', name: 'height', value: 20 } as const;
    for (const order of [[raise, swapped(lifted)], [swapped(lifted), raise]]) {
      const result = await prepareCadEdits(lifted, order, runtime);
      expect(position(result.document, 'p')).toEqual([expect.closeTo(5, 9), expect.closeTo(30, 9)]); expect(sideOf(result.document)).toBe('right');
    }
    // A point arriving on the far side does not stop the flip; the stated side alone decides.
    const moved = await prepareCadEdits(source(), [swapped(source(), { p: [5, -4] })], runtime);
    expect(position(moved.document, 'p')[1]).toBeCloseTo(4, 9); expect(sideOf(moved.document)).toBe('right');
    // A swap through a declared Coincident alias counts as the same swap.
    const aliased = part({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'b2', position: [20, 0] }, { id: 'p', position: [5, 4] }],
      entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
      relations: [{ id: 'floor', kind: 'fixed-point', pointId: 'a', position: [0, 0] }, { id: 'level', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'join', kind: 'coincident', pointIds: ['b', 'b2'] }, gap(4, 'left')] });
    const sketch = aliased.features[0];
    if (sketch?.kind !== 'sketch') throw new Error('Sketch missing.');
    const throughAlias = await prepareCadEdits(aliased, [{ kind: 'update-feature', feature: { ...sketch, graph: { ...graphOf(aliased),
      entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'b2', endPointId: 'a' }] } } }], runtime);
    expect(position(throughAlias.document, 'p')[1]).toBeCloseTo(4, 9); expect(sideOf(throughAlias.document)).toBe('right');
    // So does a swap onto the alias that also removes the old end and its Coincident.
    const withoutOldEnd = await prepareCadEdits(aliased, [{ kind: 'update-feature', feature: { ...sketch, graph: { ...graphOf(aliased),
      points: graphOf(aliased).points.filter(point => point.id !== 'b'),
      entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'b2', endPointId: 'a' }],
      relations: [{ id: 'floor', kind: 'fixed-point', pointId: 'a', position: [0, 0] }, { id: 'level', kind: 'horizontal', pointIds: ['a', 'b2'] }, gap(4, 'left')] } } }], runtime);
    expect(position(withoutOldEnd.document, 'p')[1]).toBeCloseTo(4, 9); expect(sideOf(withoutOldEnd.document)).toBe('right');
  });

  it.each([false, true])('publishes a private draft that reverses the line and then restates the old side exactly (with a new pattern: %s)', async patterned => {
    const main = new CadSession(source()), base = main.getSnapshot(), draft = new CadSketchEditDraft(base, 'sketch');
    const prepare = async (document: CadDocument, edits: readonly Parameters<typeof prepareCadEdits>[1][number][]) => (await prepareCadEdits(document, edits, runtime)).document;
    await draft.editPrepared([swapped(base.document)], prepare); expect(sideOf(draft.getSnapshot().document)).toBe('right');
    // Left of the reversed line is below it, so the restated side carries the point across.
    await draft.editPrepared([set(gap(4, 'left'))], prepare);
    // A pattern solves its exact geometry while the edit that publishes it is applied, so the side must already be right there.
    if (patterned) await draft.editPrepared([
      { kind: 'append-sketch-entities', sketchId: 'sketch', geometry: { points: [{ id: 'seed_center', position: [40, 10] }],
        entities: [{ id: 'seed', kind: 'circle', centerPointId: 'seed_center', radius: 1.5, construction: false }], relations: [] } },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'holes', kind: 'linear-pattern',
        seed: { kind: 'circle', entityId: 'seed', centerPointId: 'seed_center' }, idPrefix: 'row', direction: '+x', count: 3, spacing: 5, omittedInstances: [] } }], prepare);
    const local = draft.getSnapshot().document, finish = draft.finishEdits(base);
    expect(sideOf(local)).toBe('left'); expect(position(local, 'p')[1]).toBeCloseTo(-4, 9);
    // The distance is released first, so the final state states its side exactly.
    expect(finish.edits).toEqual([{ kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'gap' }, expect.objectContaining({ kind: 'update-feature' })]);
    await main.editPrepared(base.version, document => prepare(document, finish.edits), undefined, () => draft.assertCurrent(main.getSnapshot(), finish.localVersion));
    expect(graphOf(main.getSnapshot().document)).toEqual(graphOf(local));
    // A draft that only reverses the line publishes its kept side without a replay.
    const plain = new CadSketchEditDraft(main.getSnapshot(), 'sketch');
    await plain.editPrepared([swapped(main.getSnapshot().document)], prepare);
    expect(plain.finishEdits(main.getSnapshot()).edits).toEqual([expect.objectContaining({ kind: 'update-feature' })]);
  });
});
