import { describe, expect, it } from 'vitest';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { cadSketchConstraintStep, type CadSketchConstraintPick } from './cadSketchConstraintTool';
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
    expect(step('coincident', 'a')).toMatchObject({ status: 'more', entityIds: ['ab', 'cd', 'bc'], pointIds: expect.not.arrayContaining(['a']) });
    expect(step('symmetric', 'o1', 'a')).toMatchObject({ status: 'more', prompt: 'Choose the line to mirror about' });
  });

  it('creates the relation once the picks are complete', () => {
    expect(step('parallel', 'ab', 'cd')).toMatchObject({ status: 'ready', relations: [{ kind: 'parallel', lineIds: ['ab', 'cd'] }] });
    expect(step('horizontal', 'ab')).toMatchObject({ status: 'ready', relations: [{ kind: 'horizontal', pointIds: ['a', 'b'] }] });
    expect(step('coincident', 'd', 'ab')).toMatchObject({ status: 'ready', relations: [{ kind: 'point-on-line', pointId: 'd', lineId: 'ab' }] });
    expect(step('equal', 'c1', 'c2')).toMatchObject({ status: 'ready', relations: [{ kind: 'equal-radius', curveIds: ['c1', 'c2'] }] });
    expect(step('concentric', 'c1', 'c2')).toMatchObject({ status: 'ready', relations: [{ kind: 'coincident', pointIds: ['o1', 'o2'] }] });
    expect(step('tangent', 'ab', 'arc')).toMatchObject({ status: 'ready', relations: [{ kind: 'tangent-joint', endpoints: [{ entityId: 'ab', pointId: 'b' }, { entityId: 'arc', pointId: 'b' }] }] });
    expect(step('fix', 'a')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', axis: 'x', value: 0 }, { kind: 'fixed-axis', axis: 'y', value: 0 }] });
    expect(step('fix', 'free')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', axis: 'y', value: 5 }] });
  });

  it('explains picks that cannot take the constraint instead of adding a duplicate or conflict', () => {
    expect(step('vertical', 'bc')).toEqual({ status: 'invalid', reason: 'Vertical is already applied here.' });
    expect(step('horizontal', 'b', 'c')).toEqual({ status: 'invalid', reason: 'This is already vertical.' });
    expect(step('equal', 'ab', 'c1')).toEqual({ status: 'invalid', reason: 'Choose two lines, or two arcs or circles.' });
    expect(step('tangent', 'cd', 'arc')).toMatchObject({ status: 'invalid', reason: 'Join these endpoints with Coincident before adding Tangent.' });
    expect(step('concentric', 'arc', 'c2')).toEqual({ status: 'invalid', reason: 'These already share a center.' });
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
    expect(stepIn(fixed, 'coincident', 'a', 'x-axis')).toEqual({ status: 'invalid', reason: 'This point is already on the X axis.' });
    expect(stepIn(fixed, 'coincident', 'a', 'origin')).toMatchObject({ status: 'ready', relations: [{ kind: 'fixed-axis', pointId: 'a', axis: 'x', value: 0 }] });
    expect(step('parallel', 'bc', 'y-axis')).toEqual({ status: 'invalid', reason: 'This line is already vertical.' });
  });
});

describe('pickCadSketchDatum', () => {
  it('prefers the origin where the axes cross and otherwise the nearest eligible axis within reach', () => {
    const all = CAD_SKETCH_DATUMS;
    expect(pickCadSketchDatum([0.5, 0.5], 0.1, all)).toBe('origin');
    expect(pickCadSketchDatum([0.5, 0.5], 0.1, ['x-axis', 'y-axis'])).toBe('x-axis');
    expect(pickCadSketchDatum([30, 0.4], 0.1, all)).toBe('x-axis');
    expect(pickCadSketchDatum([-0.2, -30], 0.1, all)).toBe('y-axis');
    expect(pickCadSketchDatum([30, 0.7], 0.1, all)).toBeNull();
    expect(pickCadSketchDatum([30, 0.4], 0.1, ['origin'])).toBeNull();
    expect(pickCadSketchDatum([0, 0], 0, all)).toBeNull();
  });
});
