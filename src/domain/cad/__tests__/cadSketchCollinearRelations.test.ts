import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '../cadSketchGraph';
import { cadSketchRelationEntityIds, cadSketchRelationPointIds, mapCadSketchRelationScalars } from '../cadSketchGraphReferences';
import { deleteCadSketchElements } from '../cadSketchGraphEdits';
import type { CadSketchFeature } from '../cadDocument';

function source() {
  return { points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: [10, 0] },
    { id: 'c', position: [30, 0] }, { id: 'd', position: [20, 0] }], entities: [
    { id: 'left', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' },
    { id: 'right', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' }
  ], relations: [{ id: 'support', kind: 'collinear', lineIds: ['right', 'left'] }] };
}

describe('owned collinear line support', () => {
  it('retains a scalar-free ordered pair and exact drivers across disjoint reversed supports', () => {
    const input = source(), before = JSON.stringify(input), graph = parseCadSketchGraph(input), relation = graph.relations[0];
    expect(checkCadSketchGraph(graph, {})).toEqual([]);
    expect(cadSketchRelationEntityIds(relation)).toEqual(['right', 'left']);
    expect(cadSketchRelationPointIds(graph, relation)).toEqual(['c', 'd', 'a', 'b']);
    expect(mapCadSketchRelationScalars(relation, () => { throw new Error('Collinear has no driving scalar.'); })).toBe(relation);
    expect(graph.points[0].position).toEqual([' 0 ', '0']);
    expect(Object.isFrozen(relation)).toBe(true); expect(JSON.stringify(input)).toBe(before);
  });

  it('checks infinite support across gaps independently of direction, source order and disparate line lengths', () => {
    const input = source();
    const offset = parseCadSketchGraph({ ...input, points: input.points.map(point => ['c', 'd'].includes(point.id) ? { ...point, position: [point.position[0], 2] } : point) });
    expect(checkCadSketchGraph(offset, {})).toMatchObject([{ source: { kind: 'relation', id: 'support' }, code: 'relation-residual', residualMm: 2 }]);
    const longGap = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] },
      { id: 'c', position: [1e8, 0] }, { id: 'd', position: [1e8 + 10, 1e-12] }], entities: input.entities, relations: input.relations });
    // Each local deflection is tiny, but extending the second support back over
    // the actual gap misses the first line by ten micrometres.
    expect(checkCadSketchGraph(longGap, {})).toMatchObject([{ source: { id: 'support' }, residualMm: expect.any(Number) }]);
    expect(checkCadSketchGraph(longGap, {})[0].residualMm).toBeGreaterThan(9e-6);
    const skew = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [1e6, 0] },
      { id: 'c', position: [2, 0] }, { id: 'd', position: [2.000001, 1e-13] }], entities: input.entities, relations: input.relations });
    expect(checkCadSketchGraph(skew, {})[0].residualMm).toBeGreaterThan(.09);
    expect(checkCadSketchGraph(parseCadSketchGraph({ ...skew, relations: [{ id: 'support', kind: 'collinear', lineIds: ['left', 'right'] }] }), {})).toEqual(checkCadSketchGraph(skew, {}));
    const translated = parseCadSketchGraph({ ...input, points: [{ id: 'a', position: [9e8, 9e8] }, { id: 'b', position: [9e8 + 1e-6, 9e8] },
      { id: 'c', position: [9e8 + 4, 9e8] }, { id: 'd', position: [9e8 + 3, 9e8] }] });
    expect(checkCadSketchGraph(translated, {})).toEqual([]);
  });

  it('rejects invalid entity owners and retains explicit deletion dependencies', () => {
    const input = source();
    for (const lineIds of [['left', 'left'], ['left', 'missing'], ['left', 'curve']]) expect(() => parseCadSketchGraph({ ...input,
      entities: [...input.entities, { id: 'curve', kind: 'circle', construction: false, centerPointId: 'a', radius: 2 }],
      relations: [{ id: 'support', kind: 'collinear', lineIds }] })).toThrow();
    const graph = parseCadSketchGraph(input), sketch: CadSketchFeature = { id: 'sketch', name: 'Supports', kind: 'sketch', suppressed: false,
      plane: 'XY', offset: 0, profiles: [], graph };
    expect(() => deleteCadSketchElements({ sketch, pointIds: [], entityIds: ['right'], relationIds: [], cascade: false })).toThrow('depend');
    expect(deleteCadSketchElements({ sketch, pointIds: [], entityIds: ['right'], relationIds: [], cascade: true }).graph).toEqual(parseCadSketchGraph({
      ...graph, entities: [graph.entities[0]], relations: []
    }));
    expect(sketch.graph).toBe(graph);
  });
});
