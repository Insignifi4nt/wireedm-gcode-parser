// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph, checkCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { createCadSketchTestSolver } from './__tests__/cadSketchTestSolver';

const runtime = createCadSketchTestSolver();
function driven(fixed?: readonly [string, string]) {
  return parseCadSketchGraph({ points: [{ id: 'a', position: ['0', ' 0 '] }, { id: 'b', position: [' width ', '0'] },
    { id: 'm', position: fixed ?? [14, 3] }], entities: [
      { id: 'line', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' },
      { id: 'bore', kind: 'circle', construction: false, centerPointId: 'm', radius: fixed ? '2' : 2 }
    ], relations: [{ id: 'mid', kind: 'midpoint', pointId: 'm', lineId: 'line' }] });
}
describe('real PlaneGCS line midpoint', () => {
  it('propagates a source parameter to a free bore center while preserving endpoint strings and radius', async () => {
    const graph = driven(), before = JSON.stringify(graph), first = await runtime.solve({ graph, parameters: { width: 40 } });
    expect(first.kind).toBe('solved'); if (first.kind !== 'solved') throw Error(first.message);
    expect(first.graph.points[2].position).toEqual([20, 0]);
    expect(first.diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 1, conflictingIds: [], redundantIds: [], issues: [] });
    const changed = await runtime.solve({ graph: first.graph, parameters: { width: 60 } });
    expect(changed.kind).toBe('solved'); if (changed.kind !== 'solved') throw Error(changed.message);
    expect(changed.graph.points[2].position).toEqual([30, 0]);
    expect(changed.graph.points.slice(0, 2)).toEqual(graph.points.slice(0, 2));
    expect(changed.graph.entities).toEqual(graph.entities);
    expect(changed.graph.relations).toEqual(graph.relations);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('removes exactly two freedoms for a reversed free oblique line and retains the midpoint during movement', async () => {
    const source = { points: [{ id: 'a', position: [7, -3] }, { id: 'b', position: [-5, 9] }, { id: 'm', position: [0, 8] }],
      entities: [{ id: 'line', kind: 'line', construction: false, startPointId: 'b', endPointId: 'a' }] };
    const free = await runtime.solve({ graph: parseCadSketchGraph({ ...source, relations: [] }), parameters: {} });
    const constrained = await runtime.solve({ graph: parseCadSketchGraph({ ...source, relations: [{ id: 'mid', kind: 'midpoint', pointId: 'm', lineId: 'line' }] }), parameters: {} });
    expect(free.kind).toBe('solved'); expect(constrained.kind).toBe('solved');
    if (free.kind !== 'solved' || constrained.kind !== 'solved') throw Error('Expected native solve');
    expect(free.diagnostics.degreesOfFreedom).toBe(6); expect(constrained.diagnostics.degreesOfFreedom).toBe(4);
    const moved = await runtime.solve({ graph: constrained.graph, parameters: {}, drag: { pointId: 'm', position: [10, 12] } });
    expect(moved.kind).toBe('solved'); if (moved.kind !== 'solved') throw Error(moved.message);
    expect(moved.graph.points[2].position[0]).toBeCloseTo(10, 10); expect(moved.graph.points[2].position[1]).toBeCloseTo(12, 10);
    expect(checkCadSketchGraph(moved.graph, {})).toEqual([]);
    expect(moved.diagnostics.degreesOfFreedom).toBe(4);
  });

  it('reports actual duplicate diagnostics and names an incompatible all-fixed midpoint as conflicting', async () => {
    const matching = await runtime.solve({ graph: driven(['20', '0']), parameters: { width: 40 } });
    expect(matching.kind).toBe('solved'); expect(matching.diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 0, redundantIds: [] });
    const wrong = driven(['0', '4']), before = JSON.stringify(wrong), rejected = await runtime.solve({ graph: wrong, parameters: { width: 40 } });
    // With nothing free, the native solver names the unmet relation itself.
    expect(rejected).toMatchObject({ kind: 'rejected', reason: 'conflicting', diagnostics: { status: 'failed', degreesOfFreedom: null, conflictingIds: ['mid'], issues: [] } });
    expect(JSON.stringify(wrong)).toBe(before);
    const graph = driven(), duplicate = await runtime.solve({ graph: parseCadSketchGraph({ ...graph,
      relations: [...graph.relations, { id: 'duplicate-midpoint', kind: 'midpoint', pointId: 'm', lineId: 'line' }] }), parameters: { width: 40 } });
    expect(duplicate).toMatchObject({ kind: 'rejected', reason: 'redundant', diagnostics: { redundantIds: ['duplicate-midpoint'] } });
  });
});
