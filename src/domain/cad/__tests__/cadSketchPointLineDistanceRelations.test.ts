import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph, type CadSketchGraph, type CadSketchGraphRelation } from '../cadSketchGraph';
import { cadSketchRelationEntityIds, cadSketchRelationPointIds, mapCadSketchRelationScalars } from '../cadSketchGraphReferences';
import { deleteCadSketchElements } from '../cadSketchGraphEdits';
import { createCadSketchParallelLineDistance, createCadSketchPointLineDistance } from '../cadSketchPointLineDistanceRelations';
import { cadSketchReferenceDimensionToDriving, measureCadSketchReferenceDimension } from '../cadSketchReferenceDimensions';
import { extendCadSketchEntity, prepareCadSketchExtend, prepareCadSketchTrim, trimCadSketchEntity } from '../cadSketchTrimExtend';
import { splitCadSketchEntity } from '../cadSketchSplit';

const gap = { id: 'gap', kind: 'point-line-distance', pointId: 'p', lineId: 'base', value: 4 } as const;
const measured = { id: 'measured', kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: 'p', lineId: 'base' } } as const;
type Position = readonly [number | string, number | string];
/** A base line from (0, 0) to (20, 0) offset by `at`, a line 10 above it, a free point and a ring. */
function lines(relations: readonly CadSketchGraphRelation[] = [], p: Position = [5, 4], at: readonly [number, number] = [0, 0]): CadSketchGraph {
  const shift = (x: number, y: number) => [at[0] + x, at[1] + y] as const;
  return parseCadSketchGraph({ points: [{ id: 'a', position: shift(0, 0) }, { id: 'b', position: shift(20, 0) }, { id: 'c', position: shift(0, 10) },
    { id: 'd', position: shift(20, 10) }, { id: 'p', position: typeof p[0] === 'number' && typeof p[1] === 'number' ? shift(p[0], p[1]) : p }, { id: 'o', position: shift(40, 0) }],
  entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
    { id: 'top', kind: 'line', construction: true, startPointId: 'c', endPointId: 'd' },
    { id: 'ring', kind: 'circle', construction: false, centerPointId: 'o', radius: 3 }], relations });
}

describe('point to line distance', () => {
  it('stores a positive length or expression and rejects zero, a non-line and a point that ends the line', () => {
    expect(lines([gap]).relations).toEqual([gap]);
    expect(lines([{ ...gap, value: ' depth ' }]).relations).toEqual([{ ...gap, value: ' depth ' }]);
    for (const relation of [{ ...gap, value: 0 }, { ...gap, value: -4 }, { ...gap, pointId: 'missing' }, { ...gap, lineId: 'missing' }, { ...gap, lineId: 'ring' },
      { ...gap, pointId: 'a' }, { ...gap, pointId: 'b' }, { ...gap, extra: true }])
      expect(() => lines([relation as CadSketchGraphRelation])).toThrow();
    expect(() => lines([{ id: 'joint', kind: 'coincident', pointIds: ['p', 'b'] }, gap])).toThrow(/distinct/);
  });

  it('measures to the infinite support on either side, far from the origin, and reports a target that is not positive', () => {
    for (const p of [[5, 4], [5, -4], [-30, 4], [70, -4]] as const) expect(checkCadSketchGraph(lines([gap], p), {})).toEqual([]);
    expect(checkCadSketchGraph(lines([gap], [5, 4], [1e6, 2e6]), {})).toEqual([]);
    expect(checkCadSketchGraph(lines([gap], [5, 6]), {})).toEqual([expect.objectContaining({ source: { kind: 'relation', id: 'gap' },
      code: 'relation-residual', residualMm: expect.closeTo(2, 12) })]);
    expect(checkCadSketchGraph(lines([{ ...gap, value: ' depth ' }]), { depth: 4 })).toEqual([]);
    expect(checkCadSketchGraph(lines([{ ...gap, value: ' depth ' }]), { depth: 0 })).toEqual([expect.objectContaining({ code: 'invalid-distance' })]);
    expect(checkCadSketchGraph(lines([{ ...gap, value: ' depth ' }]), {})).toEqual([expect.objectContaining({ code: 'invalid-expression' })]);
  });

  it('reports its operands through the shared visitors and protects its point and line on delete', () => {
    const graph = lines([gap]);
    expect(cadSketchRelationEntityIds(gap)).toEqual(['base']);
    expect(cadSketchRelationPointIds(graph, gap)).toEqual(['p', 'a', 'b']);
    expect(mapCadSketchRelationScalars(gap, () => ' depth ')).toEqual({ ...gap, value: ' depth ' });
    const sketch = { id: 'sketch', kind: 'sketch', name: 'Lines', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph } as const;
    expect(() => deleteCadSketchElements({ sketch, pointIds: [], entityIds: ['base'], relationIds: [], cascade: false })).toThrow();
    expect(() => deleteCadSketchElements({ sketch, pointIds: ['p'], entityIds: [], relationIds: [], cascade: false })).toThrow();
    expect(deleteCadSketchElements({ sketch, pointIds: [], entityIds: ['base'], relationIds: [], cascade: true }).graph?.relations).toEqual([]);
    expect(deleteCadSketchElements({ sketch, pointIds: ['p'], entityIds: [], relationIds: [], cascade: true }).graph?.relations).toEqual([]);
    expect(deleteCadSketchElements({ sketch, pointIds: [], entityIds: ['top'], relationIds: [], cascade: false }).graph?.relations).toEqual([gap]);
  });

  it('creates a distance at the current gap, and refuses a point on the support', () => {
    const graph = lines();
    expect(createCadSketchPointLineDistance({ graph, parameters: {}, relationId: 'new', pointId: 'p', lineId: 'base' }))
      .toEqual({ id: 'new', kind: 'point-line-distance', pointId: 'p', lineId: 'base', value: 4 });
    expect(createCadSketchPointLineDistance({ graph: lines([], [-12, -3]), parameters: {}, relationId: 'new', pointId: 'p', lineId: 'base' }).value).toBe(3);
    expect(() => createCadSketchPointLineDistance({ graph: lines([], [30, 0]), parameters: {}, relationId: 'new', pointId: 'p', lineId: 'base' })).toThrow(/Point on line/);
    expect(() => createCadSketchPointLineDistance({ graph, parameters: {}, relationId: 'new', pointId: 'a', lineId: 'base' })).toThrow(/distinct/);
  });

  it('measures parallel lines from an unshared endpoint of the second line, and leaves crossing lines to an angle', () => {
    const graph = lines();
    expect(createCadSketchParallelLineDistance({ graph, parameters: {}, relationId: 'new', lineIds: ['base', 'top'] }))
      .toEqual({ id: 'new', kind: 'point-line-distance', pointId: 'c', lineId: 'base', value: 10 });
    expect(createCadSketchParallelLineDistance({ graph, parameters: {}, relationId: 'new', lineIds: ['top', 'base'] }))
      .toEqual({ id: 'new', kind: 'point-line-distance', pointId: 'a', lineId: 'top', value: 10 });
    // A hair off parallel, within the accuracy Parallel accepts, still takes a distance; a visible tilt takes an angle.
    const tilt = (dy: number) => parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'd' ? { ...point, position: [20, 10 + dy] as const } : point) });
    expect(createCadSketchParallelLineDistance({ graph: tilt(1e-12), parameters: {}, relationId: 'new', lineIds: ['base', 'top'] })?.pointId).toBe('c');
    expect(createCadSketchParallelLineDistance({ graph: tilt(1e-6), parameters: {}, relationId: 'new', lineIds: ['base', 'top'] })).toBeNull();
    const crossing = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'd' ? { ...point, position: [20, 12] as const } : point) });
    expect(createCadSketchParallelLineDistance({ graph: crossing, parameters: {}, relationId: 'new', lineIds: ['base', 'top'] })).toBeNull();
    const collinear = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'c' ? { ...point, position: [30, 0] as const }
      : point.id === 'd' ? { ...point, position: [50, 0] as const } : point) });
    expect(() => createCadSketchParallelLineDistance({ graph: collinear, parameters: {}, relationId: 'new', lineIds: ['base', 'top'] })).toThrow(/Collinear/);
  });

  it('measures as a reference without driving and converts to a driving distance with the same identity', () => {
    const graph = lines([measured], [5, -7]), exact = JSON.stringify(graph);
    expect(measureCadSketchReferenceDimension(graph, {}, measured)).toBe(7);
    expect(cadSketchRelationEntityIds(measured)).toEqual(['base']);
    expect(cadSketchRelationPointIds(graph, measured)).toEqual(['p', 'a', 'b']);
    expect(cadSketchReferenceDimensionToDriving(graph, {}, measured)).toEqual({ id: 'measured', kind: 'point-line-distance', pointId: 'p', lineId: 'base', value: 7 });
    expect(cadSketchReferenceDimensionToDriving(graph, {}, measured, ' depth ')).toEqual({ id: 'measured', kind: 'point-line-distance', pointId: 'p', lineId: 'base', value: ' depth ' });
    expect(JSON.stringify(graph)).toBe(exact);
    expect(() => lines([{ ...measured, measurement: { ...measured.measurement, pointId: 'a' } }])).toThrow(/distinct/);
    expect(() => lines([{ ...measured, measurement: { ...measured.measurement, lineId: 'ring' } }])).toThrow();
  });
});

describe('Trim, Extend and Split with a point to line distance', () => {
  /** The base line crossed by fences at X 8 and 12, a wall at X 30 beyond it, and a stub that ends at the measured point. */
  function fenced(relations: readonly CadSketchGraphRelation[] = [gap, measured]): CadSketchGraph {
    const graph = lines(relations);
    return parseCadSketchGraph({ ...graph, points: [...graph.points, { id: 'f0', position: [8, -5] }, { id: 'f1', position: [8, 5] }, { id: 'g0', position: [12, -5] },
      { id: 'g1', position: [12, 5] }, { id: 'w0', position: [30, -5] }, { id: 'w1', position: [30, 5] }, { id: 's', position: [5, 8] }],
    entities: [...graph.entities, { id: 'fence', kind: 'line', construction: true, startPointId: 'f0', endPointId: 'f1' },
      { id: 'gate', kind: 'line', construction: true, startPointId: 'g0', endPointId: 'g1' },
      { id: 'wall', kind: 'line', construction: true, startPointId: 'w0', endPointId: 'w1' },
      { id: 'stub', kind: 'line', construction: true, startPointId: 'p', endPointId: 's' }] });
  }

  it('keeps the distance on the piece that retains the line, since every piece stays on its support', () => {
    const graph = fenced();
    const end = prepareCadSketchTrim({ graph, parameters: {}, entityId: 'base', parameter: .9 });
    if (end.target.kind !== 'end') throw new Error('Expected end trim.');
    expect(end.target.removedRelationIds ?? []).not.toContain('gap');
    const trimmed = trimCadSketchEntity({ graph, parameters: {}, trim: { ...end.target, cutPointId: 'cut' } }).graph;
    expect(trimmed.relations).toEqual(expect.arrayContaining([gap, measured]));
    expect(checkCadSketchGraph(trimmed, {})).toEqual([]);
    const middle = prepareCadSketchTrim({ graph, parameters: {}, entityId: 'base', parameter: .5 });
    if (middle.target.kind !== 'middle') throw new Error('Expected middle trim.');
    const opened = trimCadSketchEntity({ graph, parameters: {}, trim: { ...middle.target, cutPointIds: ['m0', 'm1'], newEntityId: 'after', supportRelationId: 'support' } }).graph;
    expect(opened.relations).toEqual(expect.arrayContaining([gap, measured]));
    expect(checkCadSketchGraph(opened, {})).toEqual([]);
    const split = splitCadSketchEntity({ graph, parameters: {}, split: { kind: 'line', entityId: 'base', parameter: .9, splitPointId: 'cut', newEntityId: 'piece', supportRelationId: 'support' } });
    expect(split.graph.relations).toEqual([...graph.relations, { id: 'support', kind: 'parallel', lineIds: ['base', 'piece'] }]);
    expect(checkCadSketchGraph(split.graph, {})).toEqual([]);
  });

  it('extends the line along its support with the distance kept', () => {
    const graph = fenced(), preview = prepareCadSketchExtend({ graph, parameters: {}, entityId: 'base', end: 'end' });
    const extended = extendCadSketchEntity({ graph, parameters: {}, extend: { ...preview.target, endPointId: 'm' } }).graph;
    expect(extended.relations).toEqual(graph.relations);
    expect(extended.points.find(point => point.id === 'm')?.position).toEqual([30, 0]);
    expect(checkCadSketchGraph(extended, {})).toEqual([]);
  });

  it('removes the distance with its line or with its point', () => {
    const graph = fenced();
    const line = prepareCadSketchTrim({ graph: parseCadSketchGraph({ ...graph, entities: graph.entities.filter(entity => entity.id !== 'fence' && entity.id !== 'gate' && entity.id !== 'wall') }),
      parameters: {}, entityId: 'base', parameter: .5 });
    expect(line.target).toMatchObject({ kind: 'delete', removedRelationIds: ['gap', 'measured'] });
    const stub = prepareCadSketchTrim({ graph, parameters: {}, entityId: 'stub', parameter: .5 });
    expect(stub.target).toMatchObject({ kind: 'delete', removedRelationIds: ['gap', 'measured'] });
    if (stub.target.kind !== 'delete') throw new Error('Expected deletion.');
    const trimmed = trimCadSketchEntity({ graph, parameters: {}, trim: stub.target }).graph;
    expect(trimmed.points.some(point => point.id === 'p')).toBe(false);
    expect(trimmed.relations).toEqual([]);
  });
});
