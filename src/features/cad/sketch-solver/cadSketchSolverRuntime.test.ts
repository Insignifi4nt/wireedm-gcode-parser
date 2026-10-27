// @vitest-environment node
// PlaneGCS's own runtime: what only it does, until it is removed. What a solve promises its callers
// is tested natively in `cadSketchSolveContracts.test.ts`.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { parseCadSketchGraph } from '../../../domain/cad/cadSketchGraph';
import { createCadSketchSolverRuntime, MAX_CAD_SKETCH_SOLVER_GROUP_SIZE } from './cadSketchSolverRuntime';
import { initializeCadSketchSolverModule, type CadSketchSolverModule } from './cadSketchSolverModule';
import { createCadBenchmarkRectangleGraph } from '../benchmark/cadBenchmarkCases';

const require = createRequire(import.meta.url);
const initialize = () => initializeCadSketchSolverModule(pathToFileURL(require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href);

describe('real PlaneGCS sketch solving', () => {
  it('reassembles a four-bar dragged out of reach in one jump, but not when the drag is chained', async () => {
    // c–b must stay between 6 and 16 mm, so the linkage has two separate assemblies, c above a as it
    // starts or below. One long jump lands PlaneGCS on the lower one, closer to the target; the same
    // drag in steps stays on the upper one, stretched with c, d and b in line, as native does in one jump.
    const fourBar = parseCadSketchGraph({ points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: ['10', '0'] }, { id: 'c', position: [6, 8] }, { id: 'd', position: [10, 11] }],
      entities: [], relations: [{ id: 'ac-length', kind: 'distance', pointIds: ['a', 'c'], value: 10 }, { id: 'cd-length', kind: 'distance', pointIds: ['c', 'd'], value: 5 },
        { id: 'db-length', kind: 'distance', pointIds: ['d', 'b'], value: 11 }] });
    const runtime = createCadSketchSolverRuntime(initialize), target = [-20, -18] as const;
    const jumped = await runtime.solve({ graph: fourBar, parameters: {}, drag: { pointId: 'c', position: target } });
    if (jumped.kind !== 'solved') throw new Error(jumped.message);
    const c = jumped.graph.points[2].position as [number, number];
    [-2.8, -9.6].forEach((expected, axis) => expect(c[axis]).toBeCloseTo(expected, 8));
    let current = fourBar;
    for (let frame = 1; frame <= 10; frame++) {
      const dragged = await runtime.solve({ graph: current, parameters: {}, drag: { pointId: 'c', position: [6 + (target[0] - 6) * frame / 10, 8 + (target[1] - 8) * frame / 10] } });
      if (dragged.kind !== 'solved') throw new Error(dragged.message);
      current = dragged.graph;
    }
    [-2.8, 9.6].forEach((expected, axis) => expect(current.points[2].position[axis]).toBeCloseTo(expected, 8));
  });
});

describe('independent solver groups', () => {
  type Part = { points: unknown[]; entities: unknown[]; relations: unknown[] };
  const merge = (...parts: Part[]) => parseCadSketchGraph({ points: parts.flatMap(part => part.points), entities: parts.flatMap(part => part.entities), relations: parts.flatMap(part => part.relations) });
  const line: Part = { points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [18, 4] }], entities: [{ id: 'line', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
    relations: [{ id: 'origin', kind: 'fixed-point', pointId: 'a', position: [0, 0] }, { id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }] };
  // Each unfixed parameter is free: f contributes x, y and its radius; g only its numeric y.
  const free: Part = { points: [{ id: 'f', position: [90, 0] }, { id: 'g', position: ['w', 3] }], relations: [], entities: [
    { id: 'circle', kind: 'circle', construction: false, centerPointId: 'f', radius: 4 }, { id: 'fixed-circle', kind: 'circle', construction: false, centerPointId: 'g', radius: 'w' }] };

  it('keeps geometry without relations as authored without loading the native module', async () => {
    const load = vi.fn(initialize), graph = merge(free);
    expect(await createCadSketchSolverRuntime(load).solve({ graph, parameters: { w: 2 } })).toEqual({ kind: 'solved', graph,
      diagnostics: { status: 'success', degreesOfFreedom: 4, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] } });
    expect(load).not.toHaveBeenCalled();
  });

  it('refuses one connected group above the native memory limit and solves many small groups beyond it', async () => {
    // 89 chained rectangles: 712 parameters times 712 constraints.
    const load = vi.fn(initialize), runtime = createCadSketchSolverRuntime(load);
    expect(712 * 712).toBeGreaterThan(MAX_CAD_SKETCH_SOLVER_GROUP_SIZE);
    expect(await runtime.solve({ graph: createCadBenchmarkRectangleGraph(89, 'r', false, true), parameters: {} })).toMatchObject({ kind: 'rejected', reason: 'too-large', diagnostics: { status: null } });
    expect(load).not.toHaveBeenCalled();
    expect(await runtime.solve({ graph: createCadBenchmarkRectangleGraph(88, 'r', false, true), parameters: {} })).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 0 } });
    // As one native system, 100 independent rectangles aborted with OOM.
    expect(await runtime.solve({ graph: createCadBenchmarkRectangleGraph(150), parameters: {} })).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 0 } });
  }, 30_000);

  it('counts both equations of a coincidence when sizing a group', async () => {
    // 800 parameters times 798 equations aborted natively; the same 399 relations count only 319,200 objects.
    const load = vi.fn(initialize), graph = parseCadSketchGraph({ points: Array.from({ length: 400 }, (_, index) => ({ id: `c${index}`, position: [index, 0] })),
      entities: [], relations: Array.from({ length: 399 }, (_, index) => ({ id: `co${index}`, kind: 'coincident', pointIds: [`c${index}`, `c${index + 1}`] })) });
    expect(await createCadSketchSolverRuntime(load).solve({ graph, parameters: {} })).toMatchObject({ kind: 'rejected', reason: 'too-large' });
    expect(load).not.toHaveBeenCalled();
  });

  it('discards an aborted native module before the next solve', async () => {
    const real = await initialize();
    let aborting = true;
    const aborted = { ...real, GcsSystem: class { constructor() { throw new WebAssembly.RuntimeError('Aborted(OOM)'); } } } as unknown as CadSketchSolverModule;
    const load = vi.fn(async () => aborting ? aborted : real), discard = vi.fn(() => { aborting = false; });
    const runtime = createCadSketchSolverRuntime(load, { discard }), input = { graph: merge(line), parameters: {} };
    await expect(runtime.solve(input)).rejects.toThrow('ran out of native memory');
    expect(discard).not.toHaveBeenCalled();
    expect(await runtime.solve(input)).toMatchObject({ kind: 'solved' });
    expect(discard).toHaveBeenCalledTimes(1); expect(discard.mock.invocationCallOrder[0]).toBeLessThan(load.mock.invocationCallOrder[1]);
    // Without a way to discard the module, later solves fail clearly instead of calling into it.
    aborting = true;
    const stuck = createCadSketchSolverRuntime(load);
    await expect(stuck.solve(input)).rejects.toThrow('ran out of native memory');
    await expect(stuck.solve(input)).rejects.toThrow('cannot restart');
  });

  it('runs overlapping solves one at a time so the second sees the first abort', async () => {
    const real = await initialize();
    let aborting = true;
    const aborted = { ...real, GcsSystem: class { constructor() { throw new WebAssembly.RuntimeError('Aborted(OOM)'); } } } as unknown as CadSketchSolverModule;
    const discard = vi.fn(() => { aborting = false; }), runtime = createCadSketchSolverRuntime(async () => aborting ? aborted : real, { discard });
    const input = { graph: merge(line), parameters: {} }, [first, second] = await Promise.allSettled([runtime.solve(input), runtime.solve(input)]);
    expect(first).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('ran out of native memory') }) });
    expect(second).toMatchObject({ status: 'fulfilled', value: { kind: 'solved' } }); expect(discard).toHaveBeenCalledTimes(1);
  });
});
