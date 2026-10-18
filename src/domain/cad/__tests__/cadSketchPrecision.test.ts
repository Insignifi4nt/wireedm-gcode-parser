import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph, type CadSketchGraphRelation } from '../cadSketchGraph';
import { compileCadSketchGraph } from '../cadSketchGraphGeometry';
import { createCadSketchCornerTreatment } from '../cadSketchCornerTreatment';

describe('physical sketch driver precision', () => {
  it('accepts the physical driver boundary while rejecting larger errors without changing source scalars', () => {
    const relations: readonly CadSketchGraphRelation[] = [
      { id: 'x', kind: 'fixed-axis', pointId: 'b', axis: 'x', value: ' zero ' },
      { id: 'fixed', kind: 'fixed-point', pointId: 'b', position: [' zero ', '0'] },
      { id: 'span', kind: 'distance', pointIds: ['a', 'b'], value: ' zero ' },
      { id: 'vertical', kind: 'vertical', pointIds: ['a', 'b'] }
    ];
    for (const residual of [1e-10, 1.000001e-10]) {
      const graph = parseCadSketchGraph({ points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [residual, 0] }], entities: [], relations });
      const before = JSON.stringify(graph), issues = checkCadSketchGraph(graph, { zero: 0 });
      expect(issues.map(issue => issue.source.id)).toEqual(residual === 1e-10 ? [] : ['x', 'fixed', 'span', 'vertical']);
      expect(JSON.stringify(graph)).toBe(before);
      const horizontal = parseCadSketchGraph({ ...graph, points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [1, residual] }],
        relations: [{ id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }] });
      expect(checkCadSketchGraph(horizontal, {}).map(issue => issue.source.id)).toEqual(residual === 1e-10 ? [] : ['horizontal']);
    }
  });

  it('accepts the recorded ordinary 120-degree solve length without repairing its numeric endpoint', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'v', position: [' 0 ', '0'] }, { id: 'b', position: [-5.000000000003924, 8.66025403784448] }],
      entities: [{ id: 'line', kind: 'line', startPointId: 'v', endPointId: 'b', construction: false }],
      relations: [{ id: 'length', kind: 'distance', pointIds: ['v', 'b'], value: ' length ' }] });
    const before = JSON.stringify(graph);
    expect(checkCadSketchGraph(graph, { length: 10 })).toEqual([]);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('applies one physical size budget to equal lengths and independent radii without inheriting distant circle centers', () => {
    for (const residual of [5e-11, 2e-10]) {
      const lines = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] },
        { id: 'c', position: [0, 5] }, { id: 'd', position: [10 + residual, 5] }], entities: [
        { id: 'first', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' },
        { id: 'second', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' }
      ], relations: [{ id: 'equal', kind: 'equal-length', lineIds: ['first', 'second'] }] });
      expect(checkCadSketchGraph(lines, {}).map(issue => issue.source.id)).toEqual(residual === 5e-11 ? [] : ['equal']);
      const circles = parseCadSketchGraph({ points: [{ id: 'o', position: [9e8, 9e8] }], entities: [
        { id: 'reference', kind: 'circle', construction: true, centerPointId: 'o', radius: ' radius ' },
        { id: 'driven', kind: 'circle', construction: false, centerPointId: 'o', radius: 10 + residual }
      ], relations: [{ id: 'equal', kind: 'equal-radius', curveIds: ['reference', 'driven'] },
        { id: 'radius', kind: 'radial-size', entityId: 'driven', quantity: 'diameter', value: ' radius * 2 ' }] });
      expect(checkCadSketchGraph(circles, { radius: 10 }).map(issue => issue.source.id)).toEqual(residual === 5e-11 ? [] : ['equal', 'radius']);
    }
  });

  it('keeps independent direction and longer-line deflection bounds after adding the physical driver floor', () => {
    const pair = (length: number, slope: number) => parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] },
      { id: 'b', position: [length, 0] }, { id: 'c', position: [0, 0] }, { id: 'd', position: [length, length * slope] }],
      entities: [{ id: 'reference', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' },
        { id: 'moving', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' }],
      relations: [{ id: 'parallel', kind: 'parallel', lineIds: ['reference', 'moving'] }] });
    expect(checkCadSketchGraph(pair(10, 5e-13), {})).toEqual([]);
    expect(checkCadSketchGraph(pair(1e6, 5e-13), {})).toMatchObject([{ source: { id: 'parallel' }, code: 'relation-residual' }]);
    expect(checkCadSketchGraph(pair(1e-6, 5e-11), {})).toMatchObject([{ source: { id: 'parallel' }, code: 'relation-residual' }]);
    const translated = (delta: number) => parseCadSketchGraph({ points: [{ id: 'p', position: [9e8 + delta, 9e8] }], entities: [],
      relations: [{ id: 'x', kind: 'fixed-axis', pointId: 'p', axis: 'x', value: ' origin ' }] });
    expect(checkCadSketchGraph(translated(5e-7), { origin: 9e8 })).toEqual([]);
    expect(checkCadSketchGraph(translated(3e-6), { origin: 9e8 })).toMatchObject([{ source: { id: 'x' }, code: 'relation-residual' }]);
  });

  it('keeps coincidence, complete joint classes and endpoint-arc structure at arithmetic roundoff precision', () => {
    const join = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [5e-11, 0] }], entities: [],
      relations: [{ id: 'join', kind: 'coincident', pointIds: ['a', 'b'] }] });
    expect(checkCadSketchGraph(join, {})).toMatchObject([{ source: { id: 'join' }, code: 'relation-residual' }]);
    const chain = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [7e-13, 0] }, { id: 'c', position: [1.4e-12, 0] }], entities: [],
      relations: [{ id: 'ab', kind: 'coincident', pointIds: ['a', 'b'] }, { id: 'bc', kind: 'coincident', pointIds: ['b', 'c'] }] });
    expect(checkCadSketchGraph(chain, {})).toEqual([]);
    expect(() => compileCadSketchGraph(chain, {})).toThrowError(expect.objectContaining({ code: 'sketch-graph-precision' }));
    const arc = parseCadSketchGraph({ points: [{ id: 'o', position: [0, 0] }, { id: 'a', position: [10, 0] }, { id: 'b', position: [0, 10 + 5e-11] }],
      entities: [{ id: 'arc', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 'a', endPointId: 'b', direction: 'ccw' }], relations: [] });
    expect(checkCadSketchGraph(arc, {})).toMatchObject([{ source: { id: 'arc' }, code: 'arc-radius-mismatch' }]);
  });

  it('leaves hybrid corner setbacks at their existing stricter construction precision', () => {
    let id = 0;
    const corner = createCadSketchCornerTreatment({ graph: parseCadSketchGraph({ points: [{ id: 'v', position: [0, 0] },
      { id: 'a', position: [20, 0] }, { id: 'b', position: [0, 20] }], entities: [
      { id: 'first', kind: 'line', construction: false, startPointId: 'v', endPointId: 'a' },
      { id: 'second', kind: 'line', construction: false, startPointId: 'v', endPointId: 'b' }
    ], relations: [] }), parameters: {}, pointId: 'v', treatment: { kind: 'chamfer', setbacks: [2, 2] }, createId: () => `corner-${++id}` });
    const changed = parseCadSketchGraph({ ...corner.graph, relations: corner.graph.relations.map(relation => relation.kind === 'chamfer-corner'
      ? { ...relation, values: [2 + 5e-11, 2] } : relation) });
    expect(checkCadSketchGraph(changed, {})).toMatchObject([{ source: { id: corner.relationId }, code: 'relation-residual' }]);
  });
});
