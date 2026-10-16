import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '../cadSketchGraph';
import { cadSketchRelationEntityIds, cadSketchRelationPointIds, mapCadSketchRelationScalars } from '../cadSketchGraphReferences';
import { deleteCadSketchElements, setCadSketchConstruction } from '../cadSketchGraphEdits';
import type { CadSketchFeature } from '../cadDocument';
import { cadPathClosureTolerance } from '../cadAnalyticSegments';

const pair = () => ({ points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [0, 8] }],
  entities: [{ id: 'ab', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' },
    { id: 'ac', kind: 'line', construction: false, startPointId: 'c', endPointId: 'a' }],
  relations: [{ id: 'square', kind: 'perpendicular', lineIds: ['ab', 'ac'] }] });

describe('owned line pair relations', () => {
  it('retains exact construction line references and deduplicates a shared authored endpoint', () => {
    const input = pair(), original = JSON.stringify(input), graph = parseCadSketchGraph(input), relation = graph.relations[0];
    expect(checkCadSketchGraph(graph, {})).toEqual([]);
    expect(cadSketchRelationEntityIds(relation)).toEqual(['ab', 'ac']);
    expect(cadSketchRelationPointIds(graph, relation)).toEqual(['a', 'b', 'c']);
    expect(mapCadSketchRelationScalars(relation, () => { throw new Error('A line relation has no scalar.'); })).toBe(relation);
    expect(graph.points[0].position).toEqual([' 0 ', '0']);
    expect(JSON.stringify(input)).toBe(original); expect(Object.isFrozen(relation)).toBe(true);
    const unsolved = parseCadSketchGraph({ ...input, points: input.points.map(point => point.id === 'c' ? { ...point, position: [3, 8] } : point) });
    expect(checkCadSketchGraph(unsolved, {})).toMatchObject([{ source: { kind: 'relation', id: 'square' }, code: 'relation-residual' }]);
  });

  it('rejects duplicate, missing and curved entity operands without manufacturing point references', () => {
    for (const lineIds of [['ab', 'ab'], ['ab', 'missing'], ['ab', 'a'], ['ab', 'curve']]) {
      expect(() => parseCadSketchGraph({ ...pair(), entities: [...pair().entities,
        { id: 'curve', kind: 'circle', construction: true, centerPointId: 'a', radius: 3 }],
        relations: [{ id: 'bad', kind: 'parallel', lineIds }] })).toThrow();
    }
  });

  it('requires explicit entity relation deletion or cascade and preserves construction toggles', () => {
    const graph = parseCadSketchGraph(pair()), sketch: CadSketchFeature = { id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false,
      plane: 'XY', offset: 0, profiles: [], graph };
    expect(() => deleteCadSketchElements({ sketch, pointIds: [], entityIds: ['ab'], relationIds: [], cascade: false })).toThrow('depend');
    const result = deleteCadSketchElements({ sketch, pointIds: [], entityIds: ['ab'], relationIds: [], cascade: true });
    expect(result.graph?.relations).toEqual([]); expect(result.graph?.points).toEqual(graph.points);
    expect(setCadSketchConstruction({ sketch, entityIds: ['ac'], construction: true }).graph?.relations).toEqual(graph.relations);
    expect(sketch.graph).toBe(graph);
  });

  it.each(['parallel', 'perpendicular'] as const)('checks %s directions independently of endpoint and operand order at tiny and translated scales', kind => {
    for (const origin of [0, 9e8]) {
      const length = origin === 0 ? 2e-7 : 1e-6;
      const coordinates = [[origin, origin], [origin + length, origin], [origin, origin + 2],
        kind === 'parallel' ? [origin + 4 * length, origin + 2] : [origin, origin + 2 + 4 * length]];
      for (const reversed of [false, true]) {
        const graph = parseCadSketchGraph({ points: coordinates.map((position, index) => ({ id: `p${index}`, position })), entities: [
          { id: 'a', kind: 'line', construction: false, startPointId: reversed ? 'p1' : 'p0', endPointId: reversed ? 'p0' : 'p1' },
          { id: 'b', kind: 'line', construction: true, startPointId: reversed ? 'p3' : 'p2', endPointId: reversed ? 'p2' : 'p3' }
        ], relations: [{ id: 'direction', kind, lineIds: reversed ? ['b', 'a'] : ['a', 'b'] }] });
        expect(checkCadSketchGraph(graph, {})).toEqual([]);
      }
    }
  });

  it.each(['parallel', 'perpendicular'] as const)('rejects %s errors hidden by short-line scaling or large world coordinates', kind => {
    const make = (origin: number, lengthA: number, dx: number, dy: number) => parseCadSketchGraph({ points: [
      { id: 'a', position: [origin, origin] }, { id: 'b', position: [origin + lengthA, origin] },
      { id: 'c', position: [origin, origin + 3] }, { id: 'd', position: kind === 'parallel' ? [origin + dx, origin + 3 + dy] : [origin + dy, origin + 3 + dx] }
    ], entities: [{ id: 'long', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
      { id: 'short', kind: 'line', construction: true, startPointId: 'c', endPointId: 'd' }], relations: [{ id: 'direction', kind, lineIds: ['long', 'short'] }] });
    const disparate = make(0, 1e6, 1e-6, 1e-13);
    const issues = checkCadSketchGraph(disparate, {});
    expect(issues).toMatchObject([{ source: { id: 'direction' }, code: 'relation-residual' }]);
    expect(issues[0].residualMm).toBeGreaterThan(.09);
    const far = make(9e8, 1e-6, 1e-6, 1e-6), farIssues = checkCadSketchGraph(far, {});
    expect(farIssues).toMatchObject([{ source: { id: 'direction' }, code: 'relation-residual' }]);
    expect(farIssues[0].residualMm).toBeLessThan(cadPathClosureTolerance([{ x: 9e8, y: 9e8 }]));
    const long = make(0, 1e6, 1e6, 5e-7);
    expect(checkCadSketchGraph(long, {})).toMatchObject([{ source: { id: 'direction' }, code: 'relation-residual' }]);
    expect(checkCadSketchGraph(parseCadSketchGraph({ ...disparate, relations: [{ id: 'direction', kind, lineIds: ['short', 'long'] }] }), {})).toEqual(issues);
  });
});
