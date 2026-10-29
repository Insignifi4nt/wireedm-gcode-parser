import { describe, expect, it } from 'vitest';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { cadSketchConstraintChoices, cadSketchConstraintStep, type CadSketchConstraintPick } from './cadSketchConstraintTool';
import { CAD_SKETCH_DATUMS, pickCadSketchDatum, type CadSketchDatum } from './cadSketchGraphSelection';

const graph: CadSketchGraph = {
  points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [40, 2] }, { id: 'c', position: [40, 20] }, { id: 'd', position: [0, 20] },
    { id: 'o1', position: [10, 10] }, { id: 'o2', position: [30, 10] }, { id: 'e', position: [60, 2] }, { id: 'free', position: ['w', 5] }],
  entities: [
    { id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
    { id: 'cd', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
    { id: 'bc', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' },
    { id: 'arc', kind: 'arc', construction: false, centerPointId: 'o2', startPointId: 'b', endPointId: 'e', direction: 'ccw' },
    { id: 'c1', kind: 'circle', construction: false, centerPointId: 'o1', radius: 3 },
    { id: 'c2', kind: 'circle', construction: false, centerPointId: 'o2', radius: 4 }
  ],
  relations: [{ id: 'v', kind: 'vertical', pointIds: ['b', 'c'] }]
};
let counter = 0;
const operand = (id: string, source: CadSketchGraph): CadSketchConstraintPick => CAD_SKETCH_DATUMS.includes(id as CadSketchDatum) ? { kind: 'datum', id: id as CadSketchDatum }
  : { kind: source.points.some(point => point.id === id) ? 'point' : 'entity', id };
const stepIn = (source: CadSketchGraph, tool: Parameters<typeof cadSketchConstraintStep>[1], ...ids: string[]) =>
  cadSketchConstraintStep(source, tool, ids.map(id => operand(id, source)), () => `r${++counter}`);
const step = (tool: Parameters<typeof cadSketchConstraintStep>[1], ...ids: string[]) => stepIn(graph, tool, ...ids);

describe('cadSketchConstraintStep', () => {
  it('guides each tool from its first pick and narrows what can be picked next', () => {
    expect(step('parallel')).toMatchObject({ status: 'more', prompt: 'Choose a line, or an axis', entityIds: ['ab', 'cd', 'bc'], pointIds: [], datums: ['x-axis', 'y-axis'] });
    expect(step('parallel', 'ab')).toMatchObject({ status: 'more', entityIds: ['cd', 'bc'] });
    expect(step('equal', 'c1')).toMatchObject({ status: 'more', prompt: 'Choose the second arc or circle', entityIds: ['arc', 'c2'] });
    expect(step('coincident', 'a')).toMatchObject({ status: 'more', entityIds: ['ab', 'cd', 'bc', 'arc', 'c1', 'c2'], pointIds: expect.not.arrayContaining(['a']) });
    expect(step('coincident', 'arc')).toMatchObject({ status: 'more', prompt: 'Choose a point to keep on this arc, or an axis to center it on', entityIds: [], datums: ['x-axis', 'y-axis'] });
    expect(step('symmetric', 'o1', 'a')).toMatchObject({ status: 'more', prompt: 'Choose the line to mirror about' });
  });

  it('creates the relation once the picks are complete', () => {
    expect(step('parallel', 'ab', 'cd')).toMatchObject({ status: 'ready', relations: [{ kind: 'parallel', lineIds: ['ab', 'cd'] }] });
    expect(step('horizontal', 'ab')).toMatchObject({ status: 'ready', relations: [{ kind: 'horizontal', pointIds: ['a', 'b'] }] });
    expect(step('coincident', 'd', 'ab')).toMatchObject({ status: 'ready', relations: [{ kind: 'point-on-line', pointId: 'd', lineId: 'ab' }] });
    expect(step('coincident', 'c1', 'd')).toMatchObject({ status: 'ready', relations: [{ kind: 'point-on-curve', pointId: 'd', curveId: 'c1' }] });
    expect(step('coincident', 'a', 'arc')).toMatchObject({ status: 'ready', relations: [{ kind: 'point-on-curve', pointId: 'a', curveId: 'arc' }] });
    expect(step('equal', 'c1', 'c2')).toMatchObject({ status: 'ready', relations: [{ kind: 'equal-radius', curveIds: ['c1', 'c2'] }] });
    expect(step('concentric', 'c1', 'c2')).toMatchObject({ status: 'ready', relations: [{ kind: 'coincident', pointIds: ['o1', 'o2'] }] });
    expect(step('tangent', 'ab', 'arc')).toMatchObject({ status: 'ready', relations: [{ kind: 'tangent-joint', endpoints: [{ entityId: 'ab', pointId: 'b' }, { entityId: 'arc', pointId: 'b' }] }] });
    expect(step('fix', 'a')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', axis: 'x', value: 0 }, { kind: 'fixed-axis', axis: 'y', value: 0 }] });
    expect(step('fix', 'free')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', axis: 'y', value: 5 }] });
  });

  it('explains picks that cannot take the constraint instead of adding a duplicate or conflict', () => {
    expect(step('vertical', 'bc')).toEqual({ status: 'invalid', reason: 'Vertical is already applied here.', applied: ['v'] });
    expect(step('horizontal', 'b', 'c')).toEqual({ status: 'invalid', reason: 'This is already vertical.' });
    expect(step('equal', 'ab', 'c1')).toEqual({ status: 'invalid', reason: 'Choose two lines, or two arcs or circles.' });
    expect(step('tangent', 'cd', 'arc')).toMatchObject({ status: 'invalid', reason: 'Join these endpoints with Coincident before adding Tangent.' });
    expect(step('concentric', 'arc', 'c2')).toEqual({ status: 'invalid', reason: 'These already share a center.' });
    // A curve's own center and arc ends already sit on it.
    for (const [point, curve] of [['e', 'arc'], ['o2', 'arc'], ['o1', 'c1']]) expect(step('coincident', point, curve)).toEqual({ status: 'invalid',
      reason: 'The point must be distinct from the curve center, its arc endpoints and their declared coincident aliases.' });
    const held: CadSketchGraph = { ...graph, relations: [...graph.relations, { id: 'on', kind: 'point-on-curve', pointId: 'd', curveId: 'c1' }] };
    expect(stepIn(held, 'coincident', 'c1', 'd')).toEqual({ status: 'invalid', reason: 'Coincident is already applied here.', applied: ['on'] });
    expect(stepIn(held, 'coincident', 'd', 'c2')).toMatchObject({ status: 'ready', relations: [{ kind: 'point-on-curve', pointId: 'd', curveId: 'c2' }] });
  });

  it('constrains geometry to the plane origin and axes in either pick order', () => {
    expect(step('coincident', 'e', 'origin')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'e', axis: 'x', value: 0 }, { kind: 'fixed-axis', pointId: 'e', axis: 'y', value: 0 }] });
    expect(step('coincident', 'x-axis', 'e')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'e', axis: 'y', value: 0 }] });
    expect(step('coincident', 'e', 'y-axis')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'e', axis: 'x', value: 0 }] });
    expect(step('horizontal', 'origin', 'e')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'e', axis: 'y', value: 0 }] });
    expect(step('vertical', 'e', 'origin')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'e', axis: 'x', value: 0 }] });
    expect(step('parallel', 'cd', 'x-axis')).toMatchObject({ status: 'ready', relations: [{ kind: 'horizontal', pointIds: ['c', 'd'] }] });
    expect(step('perpendicular', 'y-axis', 'ab')).toMatchObject({ status: 'ready', relations: [{ kind: 'horizontal', pointIds: ['a', 'b'] }] });
    expect(step('perpendicular', 'ab', 'x-axis')).toMatchObject({ status: 'ready', relations: [{ kind: 'vertical', pointIds: ['a', 'b'] }] });
    // After a plane reference the next pick is geometry only; references never pair with each other.
    expect(step('coincident', 'origin')).toMatchObject({ status: 'more', prompt: 'Choose a point to place at the origin', entityIds: [], datums: [] });
    expect(step('parallel', 'x-axis')).toMatchObject({ status: 'more', entityIds: ['ab', 'cd', 'bc'], datums: [] });
    expect(step('horizontal', 'e')).toMatchObject({ status: 'more', datums: ['origin'] });
  });

  it('keeps an existing fixed coordinate instead of overwriting it from a plane reference', () => {
    const fixed: CadSketchGraph = { ...graph, relations: [...graph.relations, { id: 'fx', kind: 'fixed-axis', pointId: 'e', axis: 'x', value: 60 }, { id: 'fy', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 }] };
    expect(stepIn(fixed, 'coincident', 'e', 'origin')).toEqual({ status: 'invalid', reason: 'This point already has a fixed X. Remove that dimension first.' });
    expect(stepIn(fixed, 'coincident', 'e', 'x-axis')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'e', axis: 'y', value: 0 }] });
    expect(stepIn(fixed, 'coincident', 'a', 'x-axis')).toEqual({ status: 'invalid', reason: 'This point is already on the X axis.', applied: ['fy'] });
    expect(stepIn(fixed, 'coincident', 'a', 'origin')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'a', axis: 'x', value: 0 }] });
    expect(step('parallel', 'bc', 'y-axis')).toEqual({ status: 'invalid', reason: 'This line is already vertical.', applied: ['v'] });
  });

  it('lays a line on an axis by keeping both endpoints on it, in either pick order', () => {
    expect(step('coincident', 'ab')).toMatchObject({ status: 'more', prompt: 'Choose a point to keep on this line, or an axis to lay it on', datums: ['x-axis', 'y-axis'] });
    expect(step('coincident', 'ab', 'x-axis')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 }, { kind: 'fixed-axis', pointId: 'b', axis: 'y', value: 0 }] });
    expect(step('coincident', 'y-axis', 'cd')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'c', axis: 'x', value: 0 }, { kind: 'fixed-axis', pointId: 'd', axis: 'x', value: 0 }] });
    // An upright line cannot lie on the X axis, and a line already on the Y axis reports the relations that hold it.
    expect(step('coincident', 'bc', 'x-axis')).toEqual({ status: 'invalid', reason: 'This line is vertical, so it cannot lie on the X axis. Remove that relation first.' });
    const onAxis: CadSketchGraph = { ...graph, relations: [...graph.relations, { id: 'cx', kind: 'fixed-axis', pointId: 'c', axis: 'x', value: 0 }, { id: 'dx', kind: 'fixed-axis', pointId: 'd', axis: 'x', value: 0 }] };
    expect(stepIn(onAxis, 'coincident', 'cd', 'y-axis')).toEqual({ status: 'invalid', reason: 'This line is already on the Y axis.', applied: ['cx', 'dx'] });
  });

  it('adds one endpoint for a level line so the solver never receives a repeated relation', () => {
    const level: CadSketchGraph = { ...graph, relations: [...graph.relations, { id: 'h', kind: 'horizontal', pointIds: ['c', 'd'] }] };
    expect(stepIn(level, 'coincident', 'cd', 'x-axis')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'c', axis: 'y', value: 0 }] });
    expect(stepIn(level, 'coincident', 'cd', 'x-axis')).toMatchObject({ relations: { length: 1 } });
    const held: CadSketchGraph = { ...level, relations: [...level.relations, { id: 'dy', kind: 'fixed-axis', pointId: 'd', axis: 'y', value: 0 }] };
    expect(stepIn(held, 'coincident', 'x-axis', 'cd')).toEqual({ status: 'invalid', reason: 'This line is already on the X axis.', applied: ['dy'] });
    const dimensioned: CadSketchGraph = { ...graph, relations: [...graph.relations, { id: 'ay', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 4 }] };
    expect(stepIn(dimensioned, 'coincident', 'ab', 'x-axis')).toEqual({ status: 'invalid', reason: 'An endpoint of this line already has a fixed Y. Remove that dimension first.' });
    const pinned: CadSketchGraph = { ...graph, relations: [...graph.relations, { id: 'pin', kind: 'fixed-point', pointId: 'b', position: [40, 2] }] };
    expect(stepIn(pinned, 'coincident', 'ab', 'x-axis')).toEqual({ status: 'invalid', reason: 'An endpoint of this line is fixed away from the X axis. Remove that relation first.' });
  });

  it('reads coordinate expressions and joined endpoints when laying a line on an axis', () => {
    const at = (id: string, position: CadSketchGraph['points'][number]['position']) => graph.points.map(point => point.id === id ? { ...point, position } : point);
    // A Y written as an expression that is always zero holds that endpoint on the X axis; any other expression holds it elsewhere.
    expect(stepIn({ ...graph, points: at('a', [0, '0']) }, 'coincident', 'ab', 'x-axis')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'b', axis: 'y', value: 0 }] });
    expect(stepIn({ ...graph, points: at('a', [0, '1 - 1']) }, 'coincident', 'x-axis', 'ab')).toMatchObject({ relations: { length: 1 } });
    expect(stepIn({ ...graph, points: at('a', [0, 'h']) }, 'coincident', 'ab', 'x-axis'))
      .toEqual({ status: 'invalid', reason: 'An endpoint of this line has its Y set by an expression away from the X axis. Edit that coordinate first.' });
    expect(stepIn({ ...graph, points: at('e', [60, '0']) }, 'coincident', 'e', 'x-axis')).toEqual({ status: 'invalid', reason: 'This point is already on the X axis.' });
    // Orientation through a joined endpoint: a joins q, so q–b level means a–b is level, and q–b upright means a–b is upright.
    const joined = (kind: 'horizontal' | 'vertical'): CadSketchGraph => ({ ...graph, points: [...graph.points, { id: 'q', position: [0, 0] }],
      relations: [{ id: 'j', kind: 'coincident', pointIds: ['a', 'q'] }, { id: 'o', kind, pointIds: ['q', 'b'] }] });
    expect(stepIn(joined('horizontal'), 'coincident', 'ab', 'x-axis')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 }] });
    expect(stepIn(joined('horizontal'), 'coincident', 'ab', 'x-axis')).toMatchObject({ relations: { length: 1 } });
    expect(stepIn(joined('vertical'), 'coincident', 'ab', 'x-axis')).toEqual({ status: 'invalid', reason: 'This line is vertical, so it cannot lie on the X axis. Remove that relation first.' });
    expect(stepIn(joined('horizontal'), 'parallel', 'ab', 'x-axis')).toEqual({ status: 'invalid', reason: 'This line is already horizontal.', applied: ['o'] });
    expect(stepIn(joined('vertical'), 'horizontal', 'ab')).toEqual({ status: 'invalid', reason: 'This is already vertical.' });
  });

  it('counts an endpoint that any relation already holds on the axis, and constrains only the other one', () => {
    const line = (relations: CadSketchGraph['relations'], points: CadSketchGraph['points'] = graph.points): CadSketchGraph => ({ ...graph, points, relations: [...graph.relations, ...relations] });
    // An endpoint fixed at the origin, or fixed anywhere on the axis, already lies on it.
    for (const position of [[0, 0], [7, 0], ['0', '2 - 2']] as const) {
      expect(stepIn(line([{ id: 'pin', kind: 'fixed-point', pointId: 'a', position: [...position] }]), 'coincident', 'ab', 'x-axis'))
        .toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'b', axis: 'y', value: 0 }] });
    }
    expect(stepIn(line([{ id: 'pin', kind: 'fixed-point', pointId: 'a', position: [0, 0] }]), 'coincident', 'ab', 'x-axis')).toMatchObject({ relations: { length: 1 } });
    // A point joined to the endpoint holds it there too through a fixed coordinate, but a linked reference only follows its source.
    const joined = line([{ id: 'j', kind: 'coincident', pointIds: ['a', 'free'] }, { id: 'fy', kind: 'fixed-axis', pointId: 'free', axis: 'y', value: ' 0 ' }]);
    expect(stepIn(joined, 'coincident', 'x-axis', 'ab')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'b', axis: 'y', value: 0 }] });
    const linkedPoints = [...graph.points, { id: 'r0', position: [-5, 0] as [number, number] }, { id: 'r1', position: [-5, 9] as [number, number] }];
    const linked: CadSketchGraph = { ...line([{ id: 'j', kind: 'coincident', pointIds: ['a', 'r0'] },
      { id: 'ref', kind: 'external-reference', entityId: 'refLine', sourceSketchId: 'layout', source: { kind: 'line', entityId: 'line', startPointId: 's', endPointId: 'e' } }], linkedPoints),
      entities: [...graph.entities, { id: 'refLine', kind: 'line', construction: true, startPointId: 'r0', endPointId: 'r1' }] };
    expect(stepIn(linked, 'coincident', 'ab', 'x-axis')).toEqual({ status: 'invalid', reason: 'An endpoint of this line follows a linked reference that its source sketch can move off the X axis. Detach it first.' });
    expect(stepIn(linked, 'coincident', 'ab', 'y-axis')).toEqual({ status: 'invalid', reason: 'An endpoint of this line follows a linked reference away from the Y axis. Detach it first.' });
    // Both ends held: fixed coordinates can be removed together, a fixed point is never removed for the axis alone.
    const both = line([{ id: 'ay', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 }, { id: 'by', kind: 'fixed-axis', pointId: 'b', axis: 'y', value: '0' }]);
    expect(stepIn(both, 'coincident', 'ab', 'x-axis')).toEqual({ status: 'invalid', reason: 'This line is already on the X axis.', applied: ['ay', 'by'] });
    const fixedEnds = line([{ id: 'ay', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 }, { id: 'pin', kind: 'fixed-point', pointId: 'b', position: [40, 0] }]);
    expect(stepIn(fixedEnds, 'coincident', 'ab', 'x-axis')).toEqual({ status: 'invalid', reason: 'This line is already on the X axis.' });
    // A coordinate that follows a parameter is a dimension, even while the parameter is zero.
    expect(stepIn(line([{ id: 'ay', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 'lift' }]), 'coincident', 'ab', 'x-axis'))
      .toEqual({ status: 'invalid', reason: 'An endpoint of this line already has a fixed Y. Remove that dimension first.' });
  });

  it('counts what value-free relations keep on an axis or level, and never what a dimension happens to hold', () => {
    const add = (...relations: CadSketchGraph['relations']): CadSketchGraph => ({ ...graph, relations: [...graph.relations, ...relations] });
    // a–b is level through Parallel with a horizontal line, or Perpendicular to the upright b–c, so one end lays it on the axis.
    for (const source of [add({ id: 'h', kind: 'horizontal', pointIds: ['c', 'd'] }, { id: 'p', kind: 'parallel', lineIds: ['ab', 'cd'] }), add({ id: 'p', kind: 'perpendicular', lineIds: ['ab', 'bc'] })]) {
      expect(stepIn(source, 'coincident', 'ab', 'x-axis')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 }] });
      expect(stepIn(source, 'coincident', 'ab', 'x-axis')).toMatchObject({ relations: { length: 1 } });
      expect(stepIn(source, 'coincident', 'ab', 'y-axis')).toEqual({ status: 'invalid', reason: 'Other relations keep this line horizontal, so it cannot lie on the Y axis.' });
      expect(stepIn(source, 'horizontal', 'ab')).toEqual({ status: 'invalid', reason: 'This is already horizontal through other relations.' });
      expect(stepIn(source, 'vertical', 'ab')).toEqual({ status: 'invalid', reason: 'This is already horizontal through other relations.' });
      expect(stepIn(source, 'parallel', 'ab', 'x-axis')).toEqual({ status: 'invalid', reason: 'This is already horizontal through other relations.' });
    }
    // A point on, or at the middle of, a line lying on the X axis is on it, and so is a line collinear with that line.
    const axisLine = [{ id: 'cy', kind: 'fixed-axis', pointId: 'c', axis: 'y', value: 0 }, { id: 'dy', kind: 'fixed-axis', pointId: 'd', axis: 'y', value: 0 }] as const;
    for (const kind of ['point-on-line', 'midpoint'] as const) {
      expect(stepIn(add(...axisLine, { id: 'on', kind, pointId: 'e', lineId: 'cd' }), 'coincident', 'e', 'x-axis')).toEqual({ status: 'invalid', reason: 'This point is already on the X axis.' });
      expect(stepIn(add(...axisLine, { id: 'on', kind, pointId: 'a', lineId: 'cd' }), 'coincident', 'ab', 'x-axis')).toMatchObject({ status: 'ready', relations: [{ pointId: 'b' }] });
      expect(stepIn(add(...axisLine, { id: 'on', kind, pointId: 'e', lineId: 'cd' }), 'coincident', 'e', 'origin')).toMatchObject({ status: 'ready', relations: [{ pointId: 'e', axis: 'x' }] });
    }
    expect(stepIn(add(...axisLine, { id: 'cl', kind: 'collinear', lineIds: ['cd', 'ab'] }), 'coincident', 'x-axis', 'ab')).toEqual({ status: 'invalid', reason: 'This line is already on the X axis.' });
    // A chain of Horizontal relations shares one Y, and a mirror keeps the coordinate along it, and the other one when it lies on that axis.
    const chain = add({ id: 'h1', kind: 'horizontal', pointIds: ['a', 'o1'] }, { id: 'h2', kind: 'horizontal', pointIds: ['o1', 'e'] });
    expect(stepIn(chain, 'horizontal', 'a', 'e')).toEqual({ status: 'invalid', reason: 'This is already horizontal through other relations.' });
    expect(stepIn(add(...chain.relations.slice(1), { id: 'ay', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 }), 'coincident', 'e', 'x-axis'))
      .toEqual({ status: 'invalid', reason: 'This point is already on the X axis.' });
    const mirror = (...relations: CadSketchGraph['relations']) => add({ id: 'mirror', kind: 'symmetric', pointIds: ['a', 'e'], lineId: 'cd' }, ...relations);
    expect(stepIn(mirror({ id: 'h', kind: 'horizontal', pointIds: ['c', 'd'] }, { id: 'ax', kind: 'fixed-axis', pointId: 'a', axis: 'x', value: 0 }), 'coincident', 'e', 'y-axis'))
      .toEqual({ status: 'invalid', reason: 'This point is already on the Y axis.' });
    expect(stepIn(mirror(...axisLine, { id: 'ay', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 }), 'coincident', 'e', 'x-axis')).toEqual({ status: 'invalid', reason: 'This point is already on the X axis.' });
    expect(stepIn(mirror({ id: 'h', kind: 'horizontal', pointIds: ['c', 'd'] }, { id: 'ay', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 }), 'coincident', 'e', 'x-axis'))
      .toMatchObject({ status: 'ready', relations: [{ pointId: 'e', axis: 'y' }] });
    // A zero dimension only happens to hold e level with a, so a later edit could move it: the fix is still added.
    expect(stepIn(add({ id: 'ay', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 }, { id: 'gap', kind: 'axis-distance', pointIds: ['a', 'e'], axis: 'y', value: 0 }), 'coincident', 'e', 'x-axis'))
      .toMatchObject({ status: 'ready', relations: [{ pointId: 'e', axis: 'y' }] });
  });
  it('never counts a linked reference at 0 as holding a coordinate or keeping a line level, since its source can move it', () => {
    // r0–r1 is a linked reference lying on the X axis for now.
    const reference = (...relations: CadSketchGraph['relations']): CadSketchGraph => ({ ...graph,
      points: [...graph.points, { id: 'r0', position: [-10, 0] }, { id: 'r1', position: [10, 0] }],
      entities: [...graph.entities, { id: 'refLine', kind: 'line', construction: true, startPointId: 'r0', endPointId: 'r1' }],
      relations: [...graph.relations, { id: 'ref', kind: 'external-reference', entityId: 'refLine', sourceSketchId: 'layout', source: { kind: 'line', entityId: 'line', startPointId: 's', endPointId: 'e' } }, ...relations] });
    const moved = (subject: string, target: string) => ({ status: 'invalid', reason: `${subject} follows a linked reference that its source sketch can move off ${target}. Detach it first.` });
    // An end on the reference line, joined to one of its points, or level with one follows the snapshot, and the step asks to detach it.
    for (const holding of [reference({ id: 'on', kind: 'point-on-line', pointId: 'a', lineId: 'refLine' }), reference({ id: 'j', kind: 'coincident', pointIds: ['a', 'r0'] }),
      reference({ id: 'h', kind: 'horizontal', pointIds: ['a', 'r1'] })]) {
      expect(stepIn(holding, 'coincident', 'ab', 'x-axis')).toEqual(moved('An endpoint of this line', 'the X axis'));
      expect(stepIn(holding, 'coincident', 'a', 'x-axis')).toEqual(moved('This point', 'the X axis'));
      expect(stepIn(holding, 'coincident', 'a', 'origin')).toMatchObject({ status: 'invalid' });
    }
    // A line parallel to the reference is not kept level by it, so both ends take a fix, and Horizontal is still offered.
    const parallel = reference({ id: 'p', kind: 'parallel', lineIds: ['ab', 'refLine'] });
    expect(stepIn(parallel, 'coincident', 'ab', 'x-axis')).toMatchObject({ status: 'ready', relations: [{ pointId: 'a', axis: 'y' }, { pointId: 'b', axis: 'y' }] });
    expect(stepIn(parallel, 'horizontal', 'ab')).toMatchObject({ status: 'ready', relations: [{ kind: 'horizontal' }] });
    // Value-free relations that hold the end at 0 still count, whatever the reference does.
    const fixed = reference({ id: 'j', kind: 'coincident', pointIds: ['a', 'r0'] }, { id: 'ay', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 });
    expect(stepIn(fixed, 'coincident', 'ab', 'x-axis')).toMatchObject({ status: 'ready', relations: [{ pointId: 'b', axis: 'y' }] });
    expect(stepIn(fixed, 'coincident', 'ab', 'x-axis')).toMatchObject({ relations: { length: 1 } });
  });

  it('places a fixed point on the reference it already sits on, and explains one fixed elsewhere', () => {
    const pinned = (position: [number, number]): CadSketchGraph => ({ ...graph, relations: [...graph.relations, { id: 'pin', kind: 'fixed-point', pointId: 'e', position }] });
    expect(stepIn(pinned([60, 0]), 'coincident', 'e', 'x-axis')).toEqual({ status: 'invalid', reason: 'This point is already on the X axis.' });
    expect(stepIn(pinned([0, 0]), 'coincident', 'origin', 'e')).toEqual({ status: 'invalid', reason: 'This point is already at the origin.' });
    expect(stepIn(pinned([60, 0]), 'coincident', 'e', 'origin')).toEqual({ status: 'invalid', reason: 'This point is fixed away from the origin. Remove that relation first.' });
    expect(stepIn(pinned([60, 0]), 'vertical', 'e', 'origin')).toEqual({ status: 'invalid', reason: 'This point is fixed away from the Y axis. Remove that relation first.' });
    expect(stepIn(pinned([60, 0]), 'horizontal', 'e', 'origin')).toEqual({ status: 'invalid', reason: 'This point is already level with the origin.' });
  });

  it('keeps the center of an arc or circle on an axis, in either pick order', () => {
    expect(step('coincident', 'x-axis')).toMatchObject({ status: 'more', prompt: 'Choose a point, line, arc or circle to keep on this axis', entityIds: ['ab', 'cd', 'bc', 'arc', 'c1', 'c2'] });
    expect(step('coincident', 'c1', 'x-axis')).toEqual({ status: 'ready', relations: [{ id: expect.any(String), kind: 'fixed-axis', pointId: 'o1', axis: 'y', value: 0 }] });
    expect(step('coincident', 'y-axis', 'arc')).toEqual({ status: 'ready', relations: [{ id: expect.any(String), kind: 'fixed-axis', pointId: 'o2', axis: 'x', value: 0 }] });
    const centered: CadSketchGraph = { ...graph, relations: [...graph.relations, { id: 'oy', kind: 'fixed-axis', pointId: 'o1', axis: 'y', value: 0 }, { id: 'ox', kind: 'fixed-axis', pointId: 'o2', axis: 'x', value: 30 }] };
    expect(stepIn(centered, 'coincident', 'c1', 'x-axis')).toEqual({ status: 'invalid', reason: 'This circle is already centered on the X axis.', applied: ['oy'] });
    expect(stepIn(centered, 'coincident', 'arc', 'y-axis')).toEqual({ status: 'invalid', reason: 'The center of this arc already has a fixed X. Remove that dimension first.' });
    // Two curves sharing a center: one already on the axis holds the other.
    const shared: CadSketchGraph = { ...graph, relations: [...graph.relations, { id: 'j', kind: 'coincident', pointIds: ['o1', 'o2'] }, { id: 'oy', kind: 'fixed-axis', pointId: 'o1', axis: 'y', value: 0 }] };
    expect(stepIn(shared, 'coincident', 'c2', 'x-axis')).toEqual({ status: 'invalid', reason: 'This circle is already centered on the X axis.', applied: ['oy'] });
  });

  it('centers an arc or circle at the origin through its center point', () => {
    expect(step('concentric')).toMatchObject({ status: 'more', prompt: 'Choose an arc or circle, or the origin', datums: ['origin'] });
    expect(step('concentric', 'origin')).toMatchObject({ status: 'more', prompt: 'Choose an arc or circle to center at the origin', entityIds: ['arc', 'c1', 'c2'], pointIds: [], datums: [] });
    expect(step('concentric', 'c1', 'origin')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'o1', axis: 'x', value: 0 }, { kind: 'fixed-axis', pointId: 'o1', axis: 'y', value: 0 }] });
    expect(step('concentric', 'origin', 'arc')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'o2', axis: 'x' }, { kind: 'fixed-axis', pointId: 'o2', axis: 'y' }] });
    const centered: CadSketchGraph = { ...graph, relations: [...graph.relations, { id: 'ox', kind: 'fixed-axis', pointId: 'o1', axis: 'x', value: 0 }, { id: 'oy', kind: 'fixed-axis', pointId: 'o1', axis: 'y', value: 0 }] };
    expect(stepIn(centered, 'concentric', 'c1', 'origin')).toEqual({ status: 'invalid', reason: 'This circle is already centered at the origin.', applied: ['ox', 'oy'] });
  });
});

describe('cadSketchConstraintChoices', () => {
  const choices = (source: CadSketchGraph, ...ids: string[]) => cadSketchConstraintChoices(source, ids.map(id => operand(id, source)), () => `r${++counter}`)
    .map(choice => choice.state === 'available' ? { tool: choice.tool, state: choice.state, kinds: choice.relations.map(relation => relation.kind) }
      : choice.state === 'applied' ? { tool: choice.tool, state: choice.state, ids: choice.relationIds } : { tool: choice.tool, state: choice.state, reason: choice.reason });

  it('offers only the constraints that take exactly the selection, whatever order it was picked in', () => {
    const atOrigin = [{ tool: 'coincident', state: 'available', kinds: ['fixed-axis', 'fixed-axis'] },
      { tool: 'horizontal', state: 'available', kinds: ['fixed-axis'] }, { tool: 'vertical', state: 'available', kinds: ['fixed-axis'] }];
    expect(choices(graph, 'e', 'origin')).toEqual(atOrigin);
    expect(choices(graph, 'origin', 'e')).toEqual(atOrigin);
    expect(choices(graph, 'ab', 'cd')).toEqual([{ tool: 'parallel', state: 'available', kinds: ['parallel'] },
      { tool: 'perpendicular', state: 'available', kinds: ['perpendicular'] }, { tool: 'equal', state: 'available', kinds: ['equal-length'] }]);
    expect(choices(graph, 'o1', 'cd', 'a').map(choice => choice.tool)).toEqual(['symmetric']);
    expect(choices(graph, 'c1', 'd')).toEqual([{ tool: 'coincident', state: 'available', kinds: ['point-on-curve'] }]);
    expect(choices(graph, 'a', 'arc')).toEqual([{ tool: 'coincident', state: 'available', kinds: ['point-on-curve'] }]);
    // A selection no constraint takes in full offers nothing rather than a constraint on part of it.
    expect(choices(graph, 'a', 'b', 'e')).toEqual([]);
    expect(choices(graph, 'origin')).toEqual([]);
  });

  it('offers what a line or circle takes with a selected axis or the origin', () => {
    expect(choices(graph, 'x-axis', 'ab')).toEqual([{ tool: 'coincident', state: 'available', kinds: ['fixed-axis', 'fixed-axis'] },
      { tool: 'parallel', state: 'available', kinds: ['horizontal'] }, { tool: 'perpendicular', state: 'available', kinds: ['vertical'] }]);
    expect(choices(graph, 'bc', 'x-axis')).toEqual([{ tool: 'coincident', state: 'blocked', reason: 'This line is vertical, so it cannot lie on the X axis. Remove that relation first.' },
      { tool: 'parallel', state: 'blocked', reason: 'This is already vertical.' }, { tool: 'perpendicular', state: 'applied', ids: ['v'] }]);
    expect(choices(graph, 'c2', 'origin')).toEqual([{ tool: 'concentric', state: 'available', kinds: ['fixed-axis', 'fixed-axis'] }]);
    // An axis has no length, middle or mirror, and plane references never pair with each other.
    expect(choices(graph, 'x-axis', 'y-axis')).toEqual([]);
    expect(choices(graph, 'arc', 'x-axis')).toEqual([{ tool: 'coincident', state: 'available', kinds: ['fixed-axis'] }]);
    expect(choices(graph, 'y-axis', 'c1')).toEqual([{ tool: 'coincident', state: 'available', kinds: ['fixed-axis'] }]);
    // Concentric takes only the origin; the origin on a curve's circumference has no relation of its own.
    expect(choices(graph, 'c1', 'x-axis').map(choice => choice.tool)).toEqual(['coincident']);
    expect(choices(graph, 'origin', 'c1').map(choice => choice.tool)).toEqual(['concentric']);
  });

  it('marks constraints already in place with the relations that hold them, and explains conflicts', () => {
    expect(choices(graph, 'bc')).toEqual([{ tool: 'horizontal', state: 'blocked', reason: 'This is already vertical.' }, { tool: 'vertical', state: 'applied', ids: ['v'] }]);
    const placed: CadSketchGraph = { ...graph, relations: [...graph.relations, { id: 'ex', kind: 'fixed-axis', pointId: 'e', axis: 'x', value: 0 }, { id: 'ey', kind: 'fixed-axis', pointId: 'e', axis: 'y', value: 0 }] };
    expect(choices(placed, 'origin', 'e')).toEqual([{ tool: 'coincident', state: 'applied', ids: ['ex', 'ey'] },
      { tool: 'horizontal', state: 'applied', ids: ['ey'] }, { tool: 'vertical', state: 'applied', ids: ['ex'] }]);
    const held: CadSketchGraph = { ...graph, relations: [...graph.relations, { id: 'on', kind: 'point-on-curve', pointId: 'd', curveId: 'c1' }] };
    expect(choices(held, 'd', 'c1')).toEqual([{ tool: 'coincident', state: 'applied', ids: ['on'] }]);
    expect(choices(graph, 'e', 'arc')).toEqual([{ tool: 'coincident', state: 'blocked',
      reason: 'The point must be distinct from the curve center, its arc endpoints and their declared coincident aliases.' }]);
  });
});

describe('pickCadSketchDatum', () => {
  it('prefers the origin where the axes cross and otherwise the nearest eligible axis', () => {
    const all = CAD_SKETCH_DATUMS;
    expect(pickCadSketchDatum([0.5, 0.5], 0.1, all)).toBe('origin');
    expect(pickCadSketchDatum([0.5, 0.5], 0.1, ['x-axis', 'y-axis'])).toBe('x-axis');
    expect(pickCadSketchDatum([0.3, 0.5], 0.1, ['x-axis', 'y-axis'])).toBe('y-axis');
    expect(pickCadSketchDatum([6, 0.4], 0.1, all)).toBe('x-axis');
    expect(pickCadSketchDatum([-0.2, 7], 0.1, all)).toBe('y-axis');
    expect(pickCadSketchDatum([6, 0.7], 0.1, all)).toBeNull();
    expect(pickCadSketchDatum([30, 0.4], 0.1, ['origin'])).toBeNull();
    expect(pickCadSketchDatum([0, 0], 0, all)).toBeNull();
    expect(pickCadSketchDatum([0, 0], Number.NaN, all)).toBeNull();
  });

  it('picks an axis anywhere along it, on either side of the origin, within the same screen reach at every zoom', () => {
    const all = CAD_SKETCH_DATUMS;
    for (const millimetersPerPixel of [0.001, 0.1, 25]) {
      const reach = 6 * millimetersPerPixel, far = 5000 * millimetersPerPixel;
      expect(pickCadSketchDatum([far, reach * 0.9], millimetersPerPixel, all)).toBe('x-axis');
      expect(pickCadSketchDatum([-far, -reach * 0.9], millimetersPerPixel, all)).toBe('x-axis');
      expect(pickCadSketchDatum([reach * 0.9, -far], millimetersPerPixel, all)).toBe('y-axis');
      expect(pickCadSketchDatum([-reach * 0.5, far], millimetersPerPixel, all)).toBe('y-axis');
      expect(pickCadSketchDatum([far, reach * 1.1], millimetersPerPixel, all)).toBeNull();
      expect(pickCadSketchDatum([reach, reach], millimetersPerPixel, all)).toBe('origin');
      expect(pickCadSketchDatum([far, 0], millimetersPerPixel, ['y-axis', 'origin'])).toBeNull();
    }
  });
});
