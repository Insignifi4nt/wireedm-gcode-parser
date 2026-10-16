// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '../../../domain/cad/cadSketchGraph';
import { createCadSketchSolverRuntime } from './cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from './cadSketchSolverModule';

const require = createRequire(import.meta.url);
const initialize = () => initializeCadSketchSolverModule(pathToFileURL(require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href);

describe('real PlaneGCS sketch solving', () => {
  it('solves numeric copies and reports the fixed horizontal line degrees of freedom', async () => {
    const graph = parseCadSketchGraph({
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [18, 4] }],
      entities: [{ id: 'line', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
      relations: [
        { id: 'origin', kind: 'fixed-point', pointId: 'a', position: [0, 0] },
        { id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] },
        { id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 20 }
      ]
    });
    const before = JSON.stringify(graph), runtime = createCadSketchSolverRuntime(initialize);
    const result = await runtime.solve({ graph, parameters: {} });
    expect(result.kind).toBe('solved');
    if (result.kind !== 'solved') throw new Error(result.message);
    expect(result.graph.points[1].position[0]).toBeCloseTo(20, 8);
    expect(result.graph.points[1].position[1]).toBeCloseTo(0, 8);
    expect(result.diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 0, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] });
    expect(Object.isFrozen(result.graph)).toBe(true);
    expect(JSON.stringify(graph)).toBe(before);
  });
  it('solves the implicit arc radius while preserving clockwise major-arc intent and exact driver strings', async () => {
    const graph = parseCadSketchGraph({ points: [
      { id: 'center', position: ['0', '0'] }, { id: 'start', position: [' r / 2 ', 0] }, { id: 'end', position: [0, 12] }
    ], entities: [{ id: 'arc', kind: 'arc', construction: false, centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'cw' }],
    relations: [
      { id: 'start-axis', kind: 'fixed-axis', pointId: 'start', axis: 'y', value: 0 },
      { id: 'end-axis', kind: 'fixed-axis', pointId: 'end', axis: 'x', value: 0 }
    ] });
    const result = await createCadSketchSolverRuntime(initialize).solve({ graph, parameters: { r: 20 } });
    expect(result.kind).toBe('solved');
    if (result.kind !== 'solved') throw new Error(result.message);
    expect(result.graph.points[1].position).toEqual([' r / 2 ', 0]);
    expect(result.graph.points[2].position[1]).toBeCloseTo(10, 7);
    expect(result.graph.entities[0]).toEqual(graph.entities[0]);
    expect(result.diagnostics.degreesOfFreedom).toBe(0);
  });
  it('captures parameter inputs before asynchronous native initialization', async () => {
    const module = await initialize();
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const runtime = createCadSketchSolverRuntime(async () => { await gate; return module; });
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [15, 0] }], entities: [], relations: [
      { id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 'length' }
    ] });
    const parameters = { length: 20 }, pending = runtime.solve({ graph, parameters });
    parameters.length = 30; release();
    const result = await pending;
    expect(result.kind).toBe('solved');
    if (result.kind !== 'solved') throw new Error(result.message);
    expect(result.graph.points[1].position[0]).toBeCloseTo(20, 8);
    expect(parameters.length).toBe(30);
  });
  it('drags free and dimensioned endpoints with temporary targets without saving those targets', async () => {
    const runtime = createCadSketchSolverRuntime(initialize);
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [10, 5] }], entities: [], relations: [] });
    const free = await runtime.solve({ graph, parameters: {}, drag: { pointId: 'b', position: [35, 12] } });
    expect(free.kind).toBe('solved');
    if (free.kind !== 'solved') throw new Error(free.message);
    expect(free.graph.points[1].position).toEqual([35, 12]);
    expect(free.graph.relations).toEqual([]); expect(free.diagnostics.degreesOfFreedom).toBe(2);
    const dimensioned = parseCadSketchGraph({ ...graph, relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 20 }] });
    const limited = await runtime.solve({ graph: dimensioned, parameters: {}, drag: { pointId: 'b', position: [35, 12] } });
    expect(limited.kind).toBe('solved');
    if (limited.kind !== 'solved') throw new Error(limited.message);
    expect(Math.hypot(Number(limited.graph.points[1].position[0]), Number(limited.graph.points[1].position[1]))).toBeCloseTo(20, 10);
    expect(limited.graph.relations).toEqual(dimensioned.relations); expect(limited.diagnostics.degreesOfFreedom).toBe(1);
  });
  it('keeps circle radius expressions fixed while allowing its numeric center to move', async () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'center', position: [0, 0] }], entities: [
      { id: 'circle', kind: 'circle', construction: true, centerPointId: 'center', radius: ' diameter / 2 ' }
    ], relations: [] });
    const result = await createCadSketchSolverRuntime(initialize).solve({ graph, parameters: { diameter: 14 }, drag: { pointId: 'center', position: [5, 6] } });
    expect(result.kind).toBe('solved');
    if (result.kind !== 'solved') throw new Error(result.message);
    expect(result.graph.points[0].position).toEqual([5, 6]); expect(result.graph.entities[0]).toEqual(graph.entities[0]);
    expect(result.diagnostics.degreesOfFreedom).toBe(2);
  });
  it('reports redundant convergence and conflicting relation identities without publishing a candidate, then recovers', async () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [18, 4] }], entities: [], relations: [
      { id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 20 }
    ] });
    const runtime = createCadSketchSolverRuntime(initialize), before = JSON.stringify(graph);
    const redundant = await runtime.solve({ graph: parseCadSketchGraph({ ...graph, relations: [...graph.relations,
      { id: 'duplicate', kind: 'distance', pointIds: ['a', 'b'], value: 20 }] }), parameters: {} });
    expect(redundant).toMatchObject({ kind: 'rejected', reason: 'redundant', diagnostics: { status: 'converged', redundantIds: ['duplicate'] } });
    const conflict = await runtime.solve({ graph: parseCadSketchGraph({ ...graph, relations: [...graph.relations,
      { id: 'contradiction', kind: 'distance', pointIds: ['a', 'b'], value: 30 }] }), parameters: {} });
    expect(conflict).toMatchObject({ kind: 'rejected', reason: 'conflicting', diagnostics: { status: 'failed', conflictingIds: ['length', 'contradiction'] } });
    expect('graph' in conflict).toBe(false); expect(JSON.stringify(graph)).toBe(before);
    for (let index = 0; index < 50; index++) expect((await runtime.solve({ graph, parameters: {} })).kind).toBe('solved');
  });
  it('rejects a native success whose geometry fails independent graph validation', async () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [0, 0] }], entities: [
      { id: 'zero-line', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }
    ], relations: [] });
    const result = await createCadSketchSolverRuntime(initialize).solve({ graph, parameters: {} });
    expect(result).toMatchObject({ kind: 'rejected', reason: 'invalid-solution', diagnostics: { status: 'success', issues: [{ source: { kind: 'entity', id: 'zero-line' }, code: 'degenerate-entity' }] } });
  });
  it('solves distinct rectangle endpoints through coincident, horizontal and vertical relations', async () => {
    const graph = parseCadSketchGraph({
      points: [[0, 0], [18, 1], [19, 0], [20, 11], [19, 12], [-1, 10], [0, 11], [-1, -1]].map((position, index) => ({ id: `p${index}`, position })),
      entities: [0, 1, 2, 3].map(index => ({ id: `line${index}`, kind: 'line', construction: false, startPointId: `p${index * 2}`, endPointId: `p${index * 2 + 1}` })),
      relations: [
        ...[0, 1, 2, 3].map(index => ({ id: `join${index}`, kind: 'coincident', pointIds: [`p${index * 2 + 1}`, `p${(index * 2 + 2) % 8}`] })),
        ...[0, 1, 2, 3].map(index => ({ id: `axis${index}`, kind: index % 2 ? 'vertical' : 'horizontal', pointIds: [`p${index * 2}`, `p${index * 2 + 1}`] })),
        { id: 'origin', kind: 'fixed-point', pointId: 'p0', position: [0, 0] },
        { id: 'width', kind: 'distance', pointIds: ['p0', 'p1'], value: 20 },
        { id: 'height', kind: 'distance', pointIds: ['p2', 'p3'], value: 10 }
      ]
    });
    const result = await createCadSketchSolverRuntime(initialize).solve({ graph, parameters: {} });
    expect(result.kind).toBe('solved'); if (result.kind !== 'solved') throw new Error(result.message);
    expect(result.diagnostics.degreesOfFreedom).toBe(0);
    expect(result.graph.points.map(point => point.position)).toEqual([[0, 0], [20, 0], [20, 0], [20, 10], [20, 10], [0, 10], [0, 10], [0, 0]]);
  });
  it('solves an oblique endpoint arc directly through its equal-radius structural relation', async () => {
    const graph = parseCadSketchGraph({ points: [
      { id: 'center', position: ['0', '0'] }, { id: 'start', position: ['86.16952767655165', '49.74999999999999'] },
      { id: 'end', position: ['-81.50562840675468', 68.48502650031552] }
    ], entities: [{ id: 'arc', kind: 'arc', construction: false, centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'ccw' }], relations: [] });
    const result = await createCadSketchSolverRuntime(initialize).solve({ graph, parameters: {} });
    expect(result.kind).toBe('solved'); if (result.kind !== 'solved') throw new Error(result.message);
    expect(result.graph.points[2].position[1]).toBeCloseTo(57.07085541692911, 9);
    expect(result.diagnostics.degreesOfFreedom).toBe(0);
  });
  it('explicitly rejects native success when an oblique arc still misses strict source closure', async () => {
    const graph = parseCadSketchGraph({ points: [
      { id: 'center', position: ['0', '0'] }, { id: 'start', position: [String(.25 * Math.cos(Math.PI / 6)), String(.25 * Math.sin(Math.PI / 6))] },
      { id: 'end', position: [String(.25 * Math.cos(145 * Math.PI / 180)), .3 * Math.sin(145 * Math.PI / 180)] }
    ], entities: [{ id: 'arc', kind: 'arc', construction: false, centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'ccw' }], relations: [] });
    const result = await createCadSketchSolverRuntime(initialize).solve({ graph, parameters: {} });
    expect(result).toMatchObject({ kind: 'rejected', reason: 'invalid-solution', diagnostics: { status: 'success', issues: [{
      source: { kind: 'entity', id: 'arc' }, code: 'arc-radius-mismatch', residualMm: expect.any(Number)
    }] } });
    expect('graph' in result).toBe(false);
  });
});
