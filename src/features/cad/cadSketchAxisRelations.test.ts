// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { CadError } from '@/domain/cad/cadError';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { parseCadSketchGraph, type CadSketchGraph, type CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { cadSketchGraphSelectionSet, type CadSketchGraphSelection } from '@/domain/cad/cadSketchGraphSelection';
import { cadSketchRelationOffers } from '@/domain/cad/sketch-relations/cadSketchRelationOffers';
import { CadSketchPositions } from '@/domain/cad/sketch-relations/cadSketchVirtualElements';
import { CadSketchLowering, CadSketchLoweringRefusal } from '@/domain/cad/sketch-solver/cadSketchLoweringContext';
import { compileCadSketchEquations } from '@/domain/cad/sketch-solver/compileCadSketchEquations';
import { prepareCadEdits } from './cadEditPreparation';
import { cadSketchConstraintStep, type CadSketchConstraintTool } from './cadSketchConstraintTool';
import { cadSketchDimensionRelationsAt, planCadSketchDimension, type CadSketchAvailableDimension, type CadSketchDimensionForm } from './cadSketchDimensionPlacement';
import { createCadSketchTestSolver } from './sketch-solver/__tests__/cadSketchTestSolver';

// Every relation that can name the origin or an axis, end to end: what the selection offers, what the tool or the Dimension tool
// stores, what the lowering emits for it and where the native solver puts the geometry.

const runtime = createCadSketchTestSolver();
let counter = 0;
const nextId = () => `r${++counter}`;

/** A sloped line a–b, a level line c–d, a circle of radius 3 around k, an arc around m and free points p and q. */
const POINTS = { a: [3, 4], b: [13, 9], c: [-20, 7], d: [-8, 7], k: [5, -12], m: [30, 20], s: [36, 20], e: [30, 26], p: [-6, 11], q: [7, 2] } as const;
const ENTITIES = [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'cd', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
  { id: 'ring', kind: 'circle', construction: false, centerPointId: 'k', radius: 3 },
  { id: 'arc', kind: 'arc', construction: false, centerPointId: 'm', startPointId: 's', endPointId: 'e', direction: 'ccw' }] as const;
type Moved = Readonly<Record<string, readonly [number, number]>>;
const rawGraph = (relations: readonly unknown[] = [], moved: Moved = {}) => ({ points: Object.entries(POINTS).map(([id, position]) => ({ id, position: moved[id] ?? position })), entities: ENTITIES, relations });
function part(relations: readonly unknown[] = [], moved: Moved = {}): CadDocument {
  return parseCadDocument({ ...createCadDocument('Axis relations', 'axis-relations'), schemaVersion: 2, features: [{
    id: 'sketch', name: 'Axes', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: rawGraph(relations, moved) }] });
}
const graphOf = (document: CadDocument) => { const sketch = document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing sketch.'); return sketch.graph; };
const at = (document: CadDocument, id: string) => { const [x, y] = graphOf(document).points.find(point => point.id === id)!.position.map(Number); return { x, y }; };
/** The solved size of an arc or circle: its radius, or the span from its centre to its start. */
const sizeOf = (document: CadDocument, id: string) => {
  const curve = graphOf(document).entities.find(entity => entity.id === id);
  if (curve?.kind === 'circle') return Number(curve.radius);
  if (curve?.kind !== 'arc') throw new Error('Missing curve.');
  const [c, s] = [at(document, curve.centerPointId), at(document, curve.startPointId)]; return Math.hypot(s.x - c.x, s.y - c.y);
};
const pick = (id: string): CadSketchGraphSelection => ({ kind: ['ab', 'cd', 'ring', 'arc', '@h', '@v'].includes(id) ? 'entity' : 'point', id });
const offer = (graph: CadSketchGraph, ids: readonly string[], kind: string) => cadSketchRelationOffers(graph, ids.map(pick)).find(item => item.kind === kind);
/** The ready relations a tool-first constraint stores for these picks. */
function step(graph: CadSketchGraph, tool: CadSketchConstraintTool, ...ids: string[]) {
  const result = cadSketchConstraintStep(graph, tool, ids.map(pick), nextId);
  if (result.status !== 'ready') throw new Error(`Expected relations, got ${JSON.stringify(result)}.`);
  return result.relations;
}
/** Apply the relations through the native solver, as the workbench does, and return the solved document and its diagnostics. */
async function solve(source: CadDocument, relations: readonly CadSketchGraphRelation[]) {
  const prepared = await prepareCadEdits(source, relations.map(relation => ({ kind: 'set-sketch-relation', sketchId: 'sketch', relation } as const)), runtime);
  expect(prepared.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', conflictingIds: [], redundantIds: [], issues: [] });
  return prepared.document;
}
/** The equations the stored relations lower to, by relation, with the parameters the compiler made for the origin's and axes' values. */
function lowered(document: CadDocument, ids: readonly string[]) {
  const graph = graphOf(document), model = compileCadSketchEquations({ graph, parameters: {} });
  const own = graph.points.length * 2 + graph.entities.filter(entity => entity.kind === 'circle').length;
  const param = (id: string, axis: 0 | 1) => model.pointParameters.get(id)! + axis;
  return { equations: model.equations.filter(equation => ids.includes(equation.sourceId)), param, fixed: (index: number) => index >= own ? model.values[index] : undefined, own,
    made: model.values.length - own };
}
/** A relation lowered by itself, without the parse that would store it in another form. */
function lowerAlone(relation: CadSketchGraphRelation) {
  const graph = parseCadSketchGraph(rawGraph()), model = compileCadSketchEquations({ graph, parameters: {} });
  const points = new CadSketchPositions(graph.points.map(point => [point.id, { x: Number(point.position[0]), y: Number(point.position[1]) }]));
  const context = new CadSketchLowering(graph, {}, model.pointParameters, model.radiusParameters, points, model.values.length);
  context.lower(relation);
  const param = (id: string, axis: 0 | 1) => model.pointParameters.get(id)! + axis;
  return { equations: context.equations.map(({ kind, operands, value }) => ({ kind, operands, value })), fixedValues: context.fixedValues, param, own: model.values.length };
}
const failure = (run: () => unknown) => { try { run(); } catch (error) { return error; } throw new Error('Expected a failure.'); };
const dimension = (graph: CadSketchGraph, ids: readonly string[], form: CadSketchDimensionForm) => {
  const found = planCadSketchDimension(graph, {}, ids.map(pick), nextId).candidates.find(candidate => candidate.form === form);
  if (found?.state !== 'available') throw new Error(`${form} is ${found?.state ?? 'missing'}.`);
  return found as CadSketchAvailableDimension;
};

describe('relations with the origin and the H and V axes, end to end', () => {
  it('places a point at the origin as two coordinates held at 0, and then reports it applied', async () => {
    const graph = graphOf(part()), relations = step(graph, 'coincident', 'q', '@origin');
    const zero = [{ kind: 'fixed-axis', pointId: 'q', axis: 'x', value: 0 }, { kind: 'fixed-axis', pointId: 'q', axis: 'y', value: 0 }];
    expect(offer(graph, ['q', '@origin'], 'coincident')).toMatchObject({ state: 'available', relations: zero });
    expect(relations).toMatchObject(zero);
    const solved = await solve(part(), relations), low = lowered(solved, relations.map(relation => relation.id));
    expect(low.equations.map(({ kind, operands, value }) => [kind, operands, value])).toEqual([['value', [low.param('q', 0)], 0], ['value', [low.param('q', 1)], 0]]);
    expect(low.made).toBe(0);
    expect(at(solved, 'q')).toEqual({ x: expect.closeTo(0, 9), y: expect.closeTo(0, 9) });
    expect(offer(graphOf(solved), ['@origin', 'q'], 'coincident')).toMatchObject({ state: 'applied', relationIds: relations.map(relation => relation.id) });
  });

  it('keeps a point on the H or V axis as the one coordinate across it held at 0', async () => {
    for (const [axis, across] of [['@h', 'y'], ['@v', 'x']] as const) {
      const graph = graphOf(part()), relations = step(graph, 'coincident', axis, 'p');
      expect(offer(graph, ['p', axis], 'point-on-line')).toMatchObject({ state: 'available', relations: [{ kind: 'fixed-axis', pointId: 'p', axis: across, value: 0 }] });
      expect(relations).toMatchObject([{ kind: 'fixed-axis', pointId: 'p', axis: across, value: 0 }]);
      const solved = await solve(part(), relations);
      expect(at(solved, 'p')[across]).toBeCloseTo(0, 9);
      expect(offer(graphOf(solved), ['p', axis], 'point-on-line')).toMatchObject({ state: 'applied', relationIds: [relations[0].id] });
      expect(cadSketchConstraintStep(graphOf(solved), 'coincident', [pick('p'), pick(axis)], nextId)).toMatchObject({ status: 'invalid', applied: [relations[0].id] });
    }
  });

  it('keeps the origin at the middle of a line through its fixed coordinates', async () => {
    const graph = graphOf(part()), relations = step(graph, 'midpoint', '@origin', 'ab');
    expect(offer(graph, ['@origin', 'ab'], 'midpoint')).toMatchObject({ state: 'available', relations: [{ kind: 'midpoint', pointId: '@origin', lineId: 'ab' }] });
    expect(relations).toMatchObject([{ kind: 'midpoint', pointId: '@origin', lineId: 'ab' }]);
    const solved = await solve(part(), relations), low = lowered(solved, [relations[0].id]);
    // Each midpoint equation keeps one origin coordinate, made once as a fixed parameter at 0.
    expect(low.equations.map(equation => equation.kind)).toEqual(['midpoint', 'midpoint']);
    expect(low.equations.map(equation => [equation.operands.slice(0, 2), low.fixed(equation.operands[2])])).toEqual([[[low.param('a', 0), low.param('b', 0)], 0], [[low.param('a', 1), low.param('b', 1)], 0]]);
    expect(low.made).toBe(2);
    const [a, b] = [at(solved, 'a'), at(solved, 'b')];
    expect((a.x + b.x) / 2).toBeCloseTo(0, 9); expect((a.y + b.y) / 2).toBeCloseTo(0, 9);
  });

  it('stores a line parallel or square to an axis as horizontal or vertical, and collinear with one as both ends held on it', async () => {
    const graph = graphOf(part());
    for (const [axis, parallel, square] of [['@h', 'horizontal', 'vertical'], ['@v', 'vertical', 'horizontal']] as const) {
      expect(offer(graph, ['ab', axis], 'parallel')).toMatchObject({ state: 'available', relations: [{ kind: parallel, pointIds: ['a', 'b'] }] });
      expect(offer(graph, ['ab', axis], 'perpendicular')).toMatchObject({ state: 'available', relations: [{ kind: square, pointIds: ['a', 'b'] }] });
      expect(step(graph, 'parallel', axis, 'ab')).toMatchObject([{ kind: parallel, pointIds: ['a', 'b'] }]);
      expect(step(graph, 'perpendicular', 'ab', axis)).toMatchObject([{ kind: square, pointIds: ['a', 'b'] }]);
    }
    const level = await solve(part(), step(graph, 'parallel', 'ab', '@h'));
    expect(at(level, 'a').y).toBeCloseTo(at(level, 'b').y, 9);
    const upright = await solve(part(), step(graph, 'perpendicular', 'ab', '@h'));
    expect(at(upright, 'a').x).toBeCloseTo(at(upright, 'b').x, 9);
    // Collinear with an axis is the line on it: both ends' coordinate across it held at 0.
    const collinear = offer(graph, ['ab', '@v'], 'collinear');
    expect(collinear).toMatchObject({ state: 'available', relations: [{ kind: 'fixed-axis', pointId: 'a', axis: 'x', value: 0 }, { kind: 'fixed-axis', pointId: 'b', axis: 'x', value: 0 }] });
    const on = await solve(part(), collinear!.relations.map(relation => ({ id: nextId(), ...relation }) as CadSketchGraphRelation));
    for (const id of ['a', 'b']) expect(at(on, id).x).toBeCloseTo(0, 9);
  });

  it('mirrors two points about an axis through its fixed coordinates and one shared tag', async () => {
    for (const [axis, mirrored, kept] of [['@v', 'x', 'y'], ['@h', 'y', 'x']] as const) {
      const graph = graphOf(part()), relations = step(graph, 'symmetric', 'p', 'q', axis);
      expect(offer(graph, ['p', 'q', axis], 'symmetric')).toMatchObject({ state: 'available', relations: [{ kind: 'symmetric', pointIds: ['p', 'q'], lineId: axis }] });
      expect(relations).toMatchObject([{ kind: 'symmetric', pointIds: ['p', 'q'], lineId: axis }]);
      const solved = await solve(part(), relations), low = lowered(solved, [relations[0].id]);
      // About the V axis the X coordinates sum to 0 and the Y coordinates match; about the H axis the other way round.
      const across = mirrored === 'x' ? 0 : 1, along = 1 - across as 0 | 1;
      expect(low.equations.map(({ kind, operands }) => [kind, operands.slice(0, 2)])).toEqual([['midpoint', [low.param('p', across), low.param('q', across)]], ['difference', [low.param('p', along), low.param('q', along)]]]);
      expect(low.fixed(low.equations[0].operands[2])).toBe(0);
      expect(new Set(low.equations.map(equation => equation.tag)).size).toBe(1);
      const [p, q] = [at(solved, 'p'), at(solved, 'q')];
      expect(p[mirrored] + q[mirrored]).toBeCloseTo(0, 9); expect(p[kept]).toBeCloseTo(q[kept], 9);
    }
  });

  it('measures a point from the origin as a distance, and from an axis as a held coordinate', async () => {
    const graph = graphOf(part());
    const aligned = cadSketchDimensionRelationsAt(dimension(graph, ['q', '@origin'], 'aligned'), null).relations!;
    expect(aligned).toMatchObject([{ kind: 'distance', pointIds: ['q', '@origin'], value: Math.hypot(7, 2) }]);
    const far = await solve(part(), [{ ...aligned[0], value: 20 } as CadSketchGraphRelation]), low = lowered(far, [aligned[0].id]);
    // The origin's coordinates are made once, as fixed parameters at 0, for the span to it.
    expect(low.equations.map(({ kind, operands, value }) => [kind, operands.slice(0, 2), operands.slice(2).map(low.fixed), value])).toEqual([['distance', [low.param('q', 0), low.param('q', 1)], [0, 0], 20]]);
    expect(Math.hypot(at(far, 'q').x, at(far, 'q').y)).toBeCloseTo(20, 9);
    // From the H axis the distance is the point's Y, signed by its side; from the V axis its X.
    for (const [axis, across, value] of [['@h', 'y', 2], ['@v', 'x', 7]] as const) {
      const held = cadSketchDimensionRelationsAt(dimension(graph, ['q', axis], 'point-line'), null).relations!;
      expect(held).toMatchObject([{ kind: 'fixed-axis', pointId: 'q', axis: across, value }]);
      const moved = await solve(part(), [{ ...held[0], value: -6 } as CadSketchGraphRelation]);
      expect(at(moved, 'q')[across]).toBeCloseTo(-6, 9);
    }
    // Along an axis from the origin the distance is the coordinate too.
    expect(cadSketchDimensionRelationsAt(dimension(graph, ['@origin', 'q'], 'horizontal'), null).relations).toMatchObject([{ kind: 'fixed-axis', pointId: 'q', axis: 'x', value: 7 }]);
  });

  it('measures the angle between a line and an axis through the axis direction', async () => {
    const graph = graphOf(part()), found = dimension(graph, ['ab', '@h'], 'angle');
    const relation = cadSketchDimensionRelationsAt(found, { x: 20, y: 6 }).relations?.[0];
    // The axis ray runs from the origin along +X toward its sample end, or toward the origin against it.
    expect(relation).toMatchObject({ kind: 'line-angle', rays: [{ lineId: 'ab', towardPointId: 'b' }, { lineId: '@h', towardPointId: '@h' }], sense: 'cw', value: expect.closeTo(Math.atan2(5, 10) * 180 / Math.PI, 9) });
    expect(cadSketchDimensionRelationsAt(found, { x: -20, y: 6 }).relations).toMatchObject([{ rays: [{ lineId: 'ab', towardPointId: 'b' }, { lineId: '@h', towardPointId: '@origin' }] }]);
    const solved = await solve(part(), [{ ...relation!, value: 30 } as CadSketchGraphRelation]), low = lowered(solved, [relation!.id]);
    expect(low.equations.map(equation => equation.kind)).toEqual(['angle']);
    expect(low.equations[0].operands.filter(operand => operand >= low.own).map(low.fixed).sort()).toEqual([0, 0, 0, 1]);
    const [a, b] = [at(solved, 'a'), at(solved, 'b')];
    expect(Math.abs(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI)).toBeCloseTo(30, 6);
  });

  it('keeps an arc or circle touching an axis on the side it is on', async () => {
    for (const [curve, axis, centre] of [['ring', '@h', 'k'], ['arc', '@v', 'm']] as const) {
      const graph = graphOf(part()), relations = step(graph, 'tangent', curve, axis);
      expect(offer(graph, [curve, axis], 'tangent')).toMatchObject({ state: 'available', relations: [{ kind: 'tangent', curveIds: [curve, axis] }] });
      expect(relations).toMatchObject([{ kind: 'tangent', curveIds: [curve, axis] }]);
      const solved = await solve(part(), relations), low = lowered(solved, [relations[0].id]);
      expect(low.equations).toHaveLength(1);
      expect(low.equations[0].operands.filter(operand => operand >= low.own).map(low.fixed)).toEqual([0]);
      const c = at(solved, centre), size = sizeOf(solved, curve);
      const across = axis === '@h' ? c.y : c.x;
      expect(Math.abs(across)).toBeCloseTo(size, 9);
      // It stays on its own side: the circle below the H axis, the arc right of the V axis.
      expect(Math.sign(across)).toBe(axis === '@h' ? -1 : 1);
    }
  });

  it('centres an arc or circle on the origin, and keeps the origin on one', async () => {
    const graph = graphOf(part()), centred = step(graph, 'concentric', 'ring', '@origin');
    expect(centred).toMatchObject([{ kind: 'fixed-axis', pointId: 'k', axis: 'x', value: 0 }, { kind: 'fixed-axis', pointId: 'k', axis: 'y', value: 0 }]);
    const centredDocument = await solve(part(), centred);
    expect(at(centredDocument, 'k')).toEqual({ x: expect.closeTo(0, 9), y: expect.closeTo(0, 9) });
    expect(cadSketchConstraintStep(graphOf(centredDocument), 'concentric', [pick('ring'), pick('@origin')], nextId))
      .toEqual({ status: 'invalid', reason: 'This circle is already centered at the origin.', applied: centred.map(relation => relation.id) });
    // The origin on a curve is stored with the origin as its point.
    expect(offer(graph, ['@origin', 'arc'], 'point-on-curve')).toMatchObject({ state: 'available', relations: [{ kind: 'point-on-curve', pointId: '@origin', curveId: 'arc' }] });
    for (const curve of ['ring', 'arc']) {
      const relations = step(graph, 'coincident', '@origin', curve);
      expect(relations).toMatchObject([{ kind: 'point-on-curve', pointId: '@origin', curveId: curve }]);
      const solved = await solve(part(), relations), low = lowered(solved, [relations[0].id]);
      expect(low.equations.flatMap(equation => equation.operands.filter(operand => operand >= low.own)).map(low.fixed)).toEqual([0, 0]);
      const centre = at(solved, curve === 'ring' ? 'k' : 'm');
      expect(Math.hypot(centre.x, centre.y)).toBeCloseTo(sizeOf(solved, curve), 9);
    }
  });
});

describe('what the origin and the axes cannot take', () => {
  it('refuses what an axis or the origin lacks, with the reason', () => {
    const graph = graphOf(part());
    expect(offer(graph, ['ab', '@h'], 'equal-length')).toMatchObject({ state: 'blocked', reason: 'The H axis is infinite, so it has no length.' });
    expect(offer(graph, ['arc', '@v'], 'tangent-joint')).toMatchObject({ state: 'blocked', reason: 'The V axis is infinite, so it has no ends.' });
    expect(offer(graph, ['q', '@h'], 'midpoint')).toMatchObject({ state: 'blocked', reason: 'The H axis is infinite, so it has no middle.' });
    expect(offer(graph, ['q', '@origin'], 'fixed-point')).toMatchObject({ state: 'blocked', reason: 'The origin is fixed, so it cannot take this relation.' });
    expect(cadSketchConstraintStep(graph, 'equal', [pick('ab'), pick('@h')], nextId)).toEqual({ status: 'invalid', reason: 'The H axis is infinite, so it has no length.' });
    expect(cadSketchConstraintStep(graph, 'tangent', [pick('ab'), pick('@v')], nextId)).toEqual({ status: 'invalid', reason: 'The V axis is infinite, so it has no ends.' });
    expect(cadSketchConstraintStep(graph, 'fix', [pick('@origin')], nextId)).toEqual({ status: 'invalid', reason: 'The origin is fixed, so it cannot take this relation.' });
    // The origin and the axes relate nothing that can move, so a selection of only them offers nothing.
    expect(cadSketchRelationOffers(graph, [pick('@origin'), pick('@h'), pick('@v')])).toEqual([]);
    // A stored relation that needs what they lack is refused when it is read.
    const fixed = 'A relation needs a sketch point or edge: the origin and the H and V axes are fixed already.';
    for (const [relation, code, message] of [
      [{ id: 'eq', kind: 'equal-length', lineIds: ['ab', '@h'] }, 'unsupported-sketch-operand', 'The H axis is infinite, so it has no length.'],
      [{ id: 'mid', kind: 'midpoint', pointId: 'q', lineId: '@v' }, 'unsupported-sketch-operand', 'The V axis is infinite, so it has no middle.'],
      [{ id: 'join', kind: 'tangent-joint', endpoints: [{ entityId: '@h', pointId: '@origin' }, { entityId: 'arc', pointId: 's' }] }, 'unsupported-sketch-operand', 'The H axis is infinite, so it has no ends.'],
      [{ id: 'touch', kind: 'tangent', curveIds: ['ab', '@h'] }, 'invalid-sketch-tangent', 'Tangent to an axis needs an existing arc or circle and the H or V axis.'],
      [{ id: 'pin', kind: 'fixed-point', pointId: '@origin', position: [0, 0] }, 'fixed-sketch-relation', fixed],
      [{ id: 'both', kind: 'parallel', lineIds: ['@h', '@v'] }, 'fixed-sketch-relation', fixed]] as const) {
      expect(failure(() => parseCadSketchGraph(rawGraph([relation])))).toMatchObject({ code, message });
    }
  });

  it('refuses through the lowering what an axis cannot give', () => {
    const graph = parseCadSketchGraph(rawGraph()), model = compileCadSketchEquations({ graph, parameters: {} });
    const context = new CadSketchLowering(graph, {}, model.pointParameters, model.radiusParameters, new Map(), model.values.length);
    for (const [run, capability] of [[() => context.centre(context.edge('@h')), 'centre'], [() => context.size(context.edge('@v')), 'size']] as const) {
      expect(failure(run)).toBeInstanceOf(CadSketchLoweringRefusal);
      expect(failure(run)).toMatchObject({ code: 'unlowerable-sketch-operand', operandId: capability === 'centre' ? '@h' : '@v', capability });
    }
    expect(context.equations).toEqual([]);
  });

  it('refuses every edit that would move, cut, delete, convert or copy them, and keeps a mirror about an axis', async () => {
    const source = part();
    const mirrored = graphOf((await prepareCadEdits(source, [{ kind: 'mirror-sketch-geometry', sketchId: 'sketch', entityIds: ['ab'], axisLineId: '@v', idPrefix: 'flip' }], runtime)).document);
    const copy = mirrored.entities.find(entity => entity.id.startsWith('flip') && entity.kind === 'line');
    if (copy?.kind !== 'line') throw new Error('Missing mirrored line.');
    const position = (id: string) => mirrored.points.find(point => point.id === id)!.position.map(Number);
    expect([position(copy.startPointId), position(copy.endPointId)]).toEqual([[-3, 4], [-13, 9]]);
    for (const edit of [{ kind: 'delete-sketch-elements', sketchId: 'sketch', selections: [{ kind: 'entity', id: '@h' }] },
      { kind: 'move-sketch-point', sketchId: 'sketch', pointId: '@origin', position: [1, 1] },
      { kind: 'translate-sketch-geometry', sketchId: 'sketch', selections: [{ kind: 'point', id: '@origin' }], delta: [1, 0] },
      { kind: 'set-sketch-construction', sketchId: 'sketch', entityIds: ['@v'], construction: false }] as const) {
      await expect(prepareCadEdits(source, [edit as never], runtime)).rejects.toMatchObject({ code: 'fixed-sketch-element' });
    }
    expect(failure(() => cadSketchGraphSelectionSet(graphOf(source), [{ kind: 'entity', id: '@v' }], true))).toMatchObject({ code: 'fixed-sketch-element' });
    // Selected without an edit, they are kept with the sketch's own geometry.
    expect(cadSketchGraphSelectionSet(graphOf(source), [{ kind: 'entity', id: '@v' }, { kind: 'point', id: '@origin' }, { kind: 'point', id: 'q' }]))
      .toEqual([{ kind: 'entity', id: '@v' }, { kind: 'point', id: '@origin' }, { kind: 'point', id: 'q' }]);
  });

  it('reserves ids that start with @ for them', () => {
    for (const graph of [{ ...rawGraph(), points: [...rawGraph().points, { id: '@origin', position: [0, 0] }] },
      { ...rawGraph(), points: [...rawGraph().points, { id: '@p', position: [1, 1] }] },
      { ...rawGraph(), entities: [...ENTITIES, { id: '@h', kind: 'line', construction: false, startPointId: 'p', endPointId: 'q' }] },
      rawGraph([{ id: '@r', kind: 'horizontal', pointIds: ['p', 'q'] }])]) {
      const error = failure(() => parseCadSketchGraph(graph));
      expect(error).toBeInstanceOf(CadError);
      expect(error).toMatchObject({ code: 'reserved-sketch-id', message: expect.stringContaining('ids starting with "@" name the origin and the H and V axes') });
    }
    // A line may not end at the origin: it is no stored point.
    expect(failure(() => parseCadSketchGraph({ ...rawGraph(), entities: [...ENTITIES, { id: 'spoke', kind: 'line', construction: false, startPointId: '@origin', endPointId: 'q' }] })))
      .toMatchObject({ code: 'reserved-sketch-id' });
  });
});

describe('one stored form for each condition on the origin or an axis', () => {
  it('refuses to read a relation stored in another form than its canonical one, naming the form', () => {
    for (const [relation, stored] of [
      [{ id: 'at', kind: 'coincident', pointIds: ['q', '@origin'] }, 'fixed-axis x = 0 on "q", y = 0 on "q"'],
      [{ id: 'level', kind: 'horizontal', pointIds: ['@origin', 'q'] }, 'fixed-axis y = 0 on "q"'],
      [{ id: 'on', kind: 'point-on-line', pointId: 'q', lineId: '@v' }, 'fixed-axis x = 0 on "q"'],
      [{ id: 'along', kind: 'parallel', lineIds: ['ab', '@h'] }, 'a horizontal relation on the line\'s ends "a" and "b"'],
      [{ id: 'square', kind: 'perpendicular', lineIds: ['@h', 'ab'] }, 'a vertical relation on the line\'s ends "a" and "b"'],
      [{ id: 'lies', kind: 'collinear', lineIds: ['ab', '@v'] }, 'fixed-axis x = 0 on "a", x = 0 on "b"'],
      [{ id: 'gap', kind: 'point-line-distance', pointId: 'q', lineId: '@h', side: 'right', value: 4 }, 'fixed-axis y = -4 on "q"'],
      [{ id: 'span', kind: 'axis-distance', pointIds: ['q', '@origin'], axis: 'x', value: 5 }, 'fixed-axis x = -5 on "q"']
    ] as const) {
      expect(failure(() => parseCadSketchGraph(rawGraph([relation])))).toMatchObject({ code: 'non-canonical-sketch-relation', message: expect.stringContaining(`is stored as ${stored}.`) });
    }
  });

  it('recognises the canonical form as already applied', () => {
    const graph = graphOf(part([{ id: 'level', kind: 'horizontal', pointIds: ['b', 'a'] }, { id: 'qx', kind: 'fixed-axis', pointId: 'q', axis: 'x', value: 0 },
      { id: 'qy', kind: 'fixed-axis', pointId: 'q', axis: 'y', value: 0 }, { id: 'onv', kind: 'fixed-axis', pointId: 'p', axis: 'x', value: 0 }], { b: [13, 4], q: [0, 0], p: [0, 11] }));
    expect(offer(graph, ['ab', '@h'], 'parallel')).toMatchObject({ state: 'applied', relationIds: ['level'] });
    expect(offer(graph, ['@v', 'ab'], 'perpendicular')).toMatchObject({ state: 'applied', relationIds: ['level'] });
    expect(cadSketchConstraintStep(graph, 'parallel', [pick('ab'), pick('@h')], nextId)).toEqual({ status: 'invalid', reason: 'This line is already horizontal.', applied: ['level'] });
    expect(offer(graph, ['q', '@origin'], 'coincident')).toMatchObject({ state: 'applied', relationIds: ['qx', 'qy'] });
    expect(offer(graph, ['q', '@h'], 'point-on-line')).toMatchObject({ state: 'applied', relationIds: ['qy'] });
    expect(offer(graph, ['p', '@v'], 'point-on-line')).toMatchObject({ state: 'applied', relationIds: ['onv'] });
    // A point at the origin is level with it and above it already.
    expect(cadSketchConstraintStep(graph, 'horizontal', [pick('q'), pick('@origin')], nextId)).toMatchObject({ status: 'invalid', reason: 'This point is already level with the origin.', applied: ['qy'] });
  });

  it('lowers an equation on an axis in the simpler form it takes there', () => {
    const { param, equations, fixedValues } = lowerAlone({ id: 'on', kind: 'point-on-line', pointId: 'q', lineId: '@h' });
    expect(equations).toEqual([{ kind: 'value', operands: [param('q', 1)], value: 0 }]);
    expect(fixedValues).toEqual([]);
    expect(lowerAlone({ id: 'along', kind: 'parallel', lineIds: ['@v', 'ab'] }).equations).toEqual([{ kind: 'difference', operands: [param('a', 0), param('b', 0)], value: 0 }]);
    expect(lowerAlone({ id: 'square', kind: 'perpendicular', lineIds: ['ab', '@v'] }).equations).toEqual([{ kind: 'difference', operands: [param('a', 1), param('b', 1)], value: 0 }]);
    // Positive to the left of the axis as it runs from the origin: above the H axis, and left of the V axis.
    expect(lowerAlone({ id: 'gap', kind: 'point-line-distance', pointId: 'q', lineId: '@h', side: 'left', value: 4 }).equations).toEqual([{ kind: 'value', operands: [param('q', 1)], value: 4 }]);
    expect(lowerAlone({ id: 'gap', kind: 'point-line-distance', pointId: 'q', lineId: '@v', side: 'left', value: 4 }).equations).toEqual([{ kind: 'value', operands: [param('q', 0)], value: -4 }]);
    // A line from the origin keeps its general form, with the origin's values made once as fixed parameters.
    const through = lowerAlone({ id: 'gap', kind: 'point-line-distance', pointId: '@origin', lineId: 'ab', side: 'left', value: 4 });
    expect(through.equations).toEqual([{ kind: 'point-line-distance', operands: [through.own, through.own + 1, param('a', 0), param('a', 1), param('b', 0), param('b', 1)], value: expect.any(Number) }]);
    expect(through.fixedValues).toEqual([0, 0]);
  });
});
