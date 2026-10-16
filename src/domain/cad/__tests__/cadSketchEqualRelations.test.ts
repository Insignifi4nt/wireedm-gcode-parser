import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '../cadSketchGraph';
import { cadSketchRelationEntityIds, cadSketchRelationPointIds, mapCadSketchRelationScalars } from '../cadSketchGraphReferences';
import { deleteCadSketchElements } from '../cadSketchGraphEdits';
import type { CadSketchFeature } from '../cadDocument';

const lines = () => ({ points: [{ id: 'v', position: [' 0 ', '0'] }, { id: 'a', position: [10, 0] }, { id: 'b', position: [0, 6] }],
  entities: [{ id: 'reference', kind: 'line', construction: true, startPointId: 'a', endPointId: 'v' },
    { id: 'moving', kind: 'line', construction: false, startPointId: 'v', endPointId: 'b' }],
  relations: [{ id: 'same', kind: 'equal-length', lineIds: ['moving', 'reference'] }] });

describe('owned scalar-free sketch size equality', () => {
  it('retains reversed line entity references, construction and exact strings with one shared authored point', () => {
    const input = lines(), before = JSON.stringify(input), graph = parseCadSketchGraph(input), relation = graph.relations[0];
    expect(cadSketchRelationEntityIds(relation)).toEqual(['moving', 'reference']);
    expect(cadSketchRelationPointIds(graph, relation)).toEqual(['v', 'b', 'a']);
    expect(mapCadSketchRelationScalars(relation, () => { throw new Error('Equal size has no scalar.'); })).toBe(relation);
    expect(checkCadSketchGraph(graph, {})).toMatchObject([{ source: { kind: 'relation', id: 'same' }, code: 'relation-residual', residualMm: 4 }]);
    expect(graph.points[0].position).toEqual([' 0 ', '0']); expect(Object.isFrozen(relation)).toBe(true); expect(JSON.stringify(input)).toBe(before);
    const reordered = parseCadSketchGraph({ ...input, entities: [...input.entities].reverse() });
    expect(reordered.relations).toEqual(graph.relations); expect(checkCadSketchGraph(reordered, {})).toEqual(checkCadSketchGraph(graph, {}));
  });

  it('resolves shared arc endpoints and construction by curve identity without adding scalar ownership', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'shared', position: [10, 0] },
      { id: 'end-a', position: [0, 10] }, { id: 'end-b', position: [20, 10] }], entities: [
      { id: 'arc-a', kind: 'arc', construction: true, centerPointId: 'a', startPointId: 'shared', endPointId: 'end-a', direction: 'cw' },
      { id: 'arc-b', kind: 'arc', construction: false, centerPointId: 'b', startPointId: 'end-b', endPointId: 'shared', direction: 'ccw' }
    ], relations: [{ id: 'same', kind: 'equal-radius', curveIds: ['arc-b', 'arc-a'] }] });
    expect(checkCadSketchGraph(graph, {})).toEqual([]);
    expect(cadSketchRelationEntityIds(graph.relations[0])).toEqual(['arc-b', 'arc-a']);
    expect(cadSketchRelationPointIds(graph, graph.relations[0])).toEqual(['b', 'end-b', 'shared', 'a', 'end-a']);
    expect(mapCadSketchRelationScalars(graph.relations[0], () => { throw new Error('Equal radius has no scalar.'); })).toBe(graph.relations[0]);
    const sketch: CadSketchFeature = { id: 'sketch', kind: 'sketch', name: 'Arcs', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph };
    expect(() => deleteCadSketchElements({ sketch, pointIds: [], entityIds: ['arc-a'], relationIds: [], cascade: false })).toThrow('depend');
    const removed = deleteCadSketchElements({ sketch, pointIds: [], entityIds: ['arc-a'], relationIds: [], cascade: true });
    expect(removed.graph?.relations).toEqual([]); expect(removed.graph?.points).toEqual(graph.points);
  });

  it('compares both arc endpoint radii and keeps independent circle scalars precise at distant origins', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'center', position: [0, 0] }, { id: 'start', position: [10, 0] }, { id: 'end', position: [0, 11] }], entities: [
      { id: 'circle', kind: 'circle', construction: true, centerPointId: 'center', radius: 10 },
      { id: 'arc', kind: 'arc', construction: false, centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'cw' }
    ], relations: [{ id: 'same', kind: 'equal-radius', curveIds: ['arc', 'circle'] }] });
    expect(checkCadSketchGraph(graph, {})).toMatchObject([{ source: { id: 'arc' }, code: 'arc-radius-mismatch', residualMm: 1 },
      { source: { id: 'same' }, code: 'relation-residual', residualMm: 1 }]);
    const circles = parseCadSketchGraph({ points: [{ id: 'a', position: [9e8, 9e8] }, { id: 'b', position: [9e8 + 30, 9e8] }], entities: [
      { id: 'c1', kind: 'circle', construction: true, centerPointId: 'a', radius: 10 }, { id: 'c2', kind: 'circle', construction: false, centerPointId: 'b', radius: 10 + 1e-8 }
    ], relations: [{ id: 'same', kind: 'equal-radius', curveIds: ['c1', 'c2'] }] });
    expect(checkCadSketchGraph(circles, {})).toMatchObject([{ source: { id: 'same' }, code: 'relation-residual' }]);
  });

  it('rejects duplicate, missing, mixed-kind or scalar-bearing operands without guessing replacement entities', () => {
    const input = { ...lines(), entities: [...lines().entities, { id: 'circle', kind: 'circle', construction: true, centerPointId: 'v', radius: 10 }] };
    for (const lineIds of [['moving', 'moving'], ['moving', 'missing'], ['moving', 'circle'], ['v', 'reference']])
      expect(() => parseCadSketchGraph({ ...input, relations: [{ id: 'same', kind: 'equal-length', lineIds }] })).toThrow();
    for (const curveIds of [['circle', 'circle'], ['circle', 'missing'], ['circle', 'reference'], ['circle', 'v']])
      expect(() => parseCadSketchGraph({ ...input, relations: [{ id: 'same', kind: 'equal-radius', curveIds }] })).toThrow();
    expect(() => parseCadSketchGraph({ ...input, relations: [{ ...input.relations[0], value: 10 }] })).toThrow();
  });
});
