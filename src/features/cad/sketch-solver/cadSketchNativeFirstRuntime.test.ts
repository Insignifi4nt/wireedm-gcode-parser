// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { cadSketchSolvedValues, parseCadSketchGraph } from '../../../domain/cad/cadSketchGraph';
import { createCadSolverDieInput } from '../benchmark/cadSolverWorkloadCases';
import { createCadSketchNativeFirstRuntime, type CadSketchSolveRecord, type CadSketchSolverBackend } from './cadSketchNativeFirstRuntime';
import type { CadSketchSolveInput, CadSketchSolveResult } from './cadSketchSolverTypes';
import { CadSketchNativeProtocolError, loadCadSketchNativeSolver, type CadSketchNativeSolution, type CadSketchNativeSolver } from './native/cadSketchNativeSolver';
import type { CadSketchEquationModel } from './native/cadSketchEquationModel';
import { createCadSketchTestSolver, loadCadSketchTestNativeSolver } from './__tests__/cadSketchTestSolver';

// A free line whose length is driven: one relation, three degrees of freedom.
const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [9, 1] }],
  entities: [{ id: 'line', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
  relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 10 }] });
const input: CadSketchSolveInput = { graph, parameters: {} };
const noDiagnostics = { status: null, degreesOfFreedom: null, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] };
const planeGcsSolved = (result: CadSketchSolveResult): CadSketchSolverBackend => ({ solve: vi.fn(async () => result) });
const failedResult: CadSketchSolveResult = { kind: 'rejected', reason: 'failed', message: 'PlaneGCS failed.', diagnostics: { ...noDiagnostics, status: 'failed' } };

/** A native solver answering every model with `answer`, and the real solver's values otherwise. */
function fakeNative(answer: (model: CadSketchEquationModel) => Partial<CadSketchNativeSolution>, memoryBytes = 0): CadSketchNativeSolver {
  return { memoryBytes: () => memoryBytes, solve: model => ({ status: 'converged', iterations: 1, residual: 0, values: model.values,
    diagnosis: { kind: 'diagnosed', degreesOfFreedom: 3, labels: model.equations.map(() => 0) }, ...answer(model) }) };
}

function runtime(native: () => Promise<CadSketchNativeSolver>, planeGcs: CadSketchSolverBackend, extra: Partial<Parameters<typeof createCadSketchNativeFirstRuntime>[0]> = {}) {
  const records: CadSketchSolveRecord[] = [], loadPlaneGcs = vi.fn(async () => planeGcs), loadNative = vi.fn(native);
  return { records, loadPlaneGcs, loadNative, solver: createCadSketchNativeFirstRuntime({ loadNative, loadPlaneGcs, onSolve: record => records.push(record), ...extra }) };
}

describe('native-first sketch solving', () => {
  it('answers natively without loading PlaneGCS, and loads PlaneGCS once for drag targets', async () => {
    const { solver, records, loadPlaneGcs } = runtime(loadCadSketchTestNativeSolver, (await createCadSketchTestSolver({ mode: 'planegcs' })));
    const solved = await solver.solve(input);
    expect(solved).toMatchObject({ kind: 'solved', diagnostics: { status: 'success', degreesOfFreedom: 3, conflictingIds: [], redundantIds: [], issues: [] } });
    expect(records[0]).toMatchObject({ answeredBy: 'native', native: 'answer' });
    expect(loadPlaneGcs).not.toHaveBeenCalled();
    for (const position of [[12, 2], [13, 3]] as const) {
      const dragged = await solver.solve({ ...input, drag: { pointId: 'b', position } });
      expect(dragged.kind).toBe('solved');
    }
    expect(records.slice(1)).toMatchObject([{ answeredBy: 'planegcs', native: 'drag', planeGcs: 'solved' }, { answeredBy: 'planegcs', native: 'drag' }]);
    expect(loadPlaneGcs).toHaveBeenCalledTimes(1);
  });

  it('captures the input before waiting, so both solvers see the caller\'s values at the call', async () => {
    const parameters = { length: 10 }, source = parseCadSketchGraph({ ...graph, relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: ' length ' }] });
    const { solver } = runtime(loadCadSketchTestNativeSolver, planeGcsSolved(failedResult));
    const pending = solver.solve({ graph: source, parameters });
    parameters.length = 20;
    const result = await pending;
    if (result.kind !== 'solved') throw new Error(result.message);
    const [a, b] = result.graph.points.map(point => point.position as readonly number[]);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(10, 12);
  });

  it('keeps each already accepted group exactly and snaps roundoff to the exact intent', async () => {
    const die = createCadSolverDieInput(), first = await createCadSketchTestSolver({ mode: 'planegcs' }).solve(die);
    if (first.kind !== 'solved') throw new Error(first.message);
    const { solver, records } = runtime(loadCadSketchTestNativeSolver, planeGcsSolved(failedResult));
    // Each solver moves the other's solutions by ulps; an accepted start keeps its exact values.
    const again = await solver.solve({ graph: first.graph, parameters: die.parameters });
    if (again.kind !== 'solved') throw new Error(again.message);
    const before = cadSketchSolvedValues(first.graph);
    expect(cadSketchSolvedValues(again.graph).every((value, index) => Object.is(value, before[index]))).toBe(true);
    expect(records[0].answeredBy).toBe('native');
    // An edit moves only the group it affects; the other line keeps its exact values.
    const lines = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [9, 1] }, { id: 'c', position: [0, 5] }, { id: 'd', position: [9, 6] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'cd', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' }],
      relations: [{ id: 'first', kind: 'distance', pointIds: ['a', 'b'], value: 'first' }, { id: 'second', kind: 'distance', pointIds: ['c', 'd'], value: 'second' }] });
    const accepted = await createCadSketchTestSolver({ mode: 'planegcs' }).solve({ graph: lines, parameters: { first: 10, second: 10 } });
    if (accepted.kind !== 'solved') throw new Error(accepted.message);
    const edited = await solver.solve({ graph: accepted.graph, parameters: { first: 11, second: 10 } });
    if (edited.kind !== 'solved') throw new Error(edited.message);
    const values = cadSketchSolvedValues(edited.graph), start = cadSketchSolvedValues(accepted.graph);
    expect(values.slice(4).every((value, index) => Object.is(value, start[index + 4]))).toBe(true);
    expect(Math.hypot(values[2] - values[0], values[3] - values[1])).toBeCloseTo(11, 12);
    // A value a few ulps from a short decimal lands on it; one that needs every digit keeps them.
    const level = { graph: parseCadSketchGraph({ ...graph, points: [{ id: 'a', position: ['0', '0'] }, graph.points[1]],
      relations: [{ id: 'level', kind: 'horizontal', pointIds: ['a', 'b'] }] }), parameters: {} };
    const solvedAt = async (x: number, y: number) => {
      const result = await runtime(async () => fakeNative(model => ({ values: model.values.map((value, index) => index === 2 ? x : index === 3 ? y : value) })), planeGcsSolved(failedResult)).solver.solve(level);
      return result.kind === 'solved' ? result.graph.points[1].position : result;
    };
    expect(await solvedAt(9.999999999999998, 1e-47)).toEqual([10, 0]);
    expect(await solvedAt(1 / 3, 0)).toEqual([1 / 3, 0]);
    // A group that moved only by polishing keeps its start, though a snap would move it further.
    const near = 100000.00000000012, polishing = runtime(async () => fakeNative(model => ({ values: model.values.map((value, index) => index === 2 ? near + 2 ** -36 : index === 3 ? 0 : value) })), planeGcsSolved(failedResult));
    const untouched = await polishing.solver.solve({ ...level, graph: parseCadSketchGraph({ ...level.graph, points: [level.graph.points[0], { id: 'b', position: [near, 1e-13] }] }) });
    expect(untouched.kind === 'solved' && untouched.graph.points[1].position).toEqual([near, 1e-13]);
  });

  it('keeps small driven values and edits next to large coordinates', async () => {
    const { solver, records } = runtime(loadCadSketchTestNativeSolver, planeGcsSolved(failedResult));
    const far = (a: readonly (string | number)[], b: readonly (string | number)[], relations: readonly object[]) => parseCadSketchGraph({ points: [{ id: 'a', position: a }, { id: 'b', position: b }],
      entities: [{ id: 'line', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations });
    const lift = { id: 'lift', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0.000001 };
    // The sketch-wide check tolerance would also pass zero here; the driven value is kept exactly.
    const driven = await solver.solve({ graph: far(['999999990', 5], ['999999990', '0'], [lift]), parameters: {} });
    expect(driven.kind === 'solved' && driven.graph.points[0].position).toEqual(['999999990', 0.000001]);
    // A placement and a driver target within 8 ulps of a short decimal keep their exact digits.
    const placed = await solver.solve({ graph: far([999999990.000001, 0], [999999990.000001, 10], [{ id: 'upright', kind: 'vertical', pointIds: ['a', 'b'] }]), parameters: {} });
    expect(placed.kind === 'solved' && placed.graph.points.map(point => point.position[0])).toEqual([999999990.000001, 999999990.000001]);
    const target = await solver.solve({ graph: far([999999990, '0'], [999999990, 10], [{ id: 'place', kind: 'fixed-axis', pointId: 'a', axis: 'x', value: 999999990.000001 }]), parameters: {} });
    expect(target.kind === 'solved' && target.graph.points[0].position[0]).toBe(999999990.000001);
    // With nothing free, a relation the graph checks accept is solved, as PlaneGCS solves it.
    const fixed = await solver.solve({ graph: far(['1000000000', '0'], ['1000000000', '10'], [lift]), parameters: {} });
    expect(fixed).toMatchObject({ kind: 'solved', diagnostics: { status: 'success', degreesOfFreedom: 0, conflictingIds: [], issues: [] } });
    expect(records.at(-1)!.answeredBy).toBe('native');
    // Only relations the checks reject are blamed; an unrelated invalid circle is reported as such.
    const ring = { id: 'ring', kind: 'circle', construction: true, centerPointId: 'b', radius: '0' };
    const invalid = await solver.solve({ graph: parseCadSketchGraph({ ...far(['1000000000', '0'], ['1000000000', '10'], [lift]), entities: [ring] }), parameters: {} });
    expect(invalid).toMatchObject({ kind: 'rejected', reason: 'invalid-solution', diagnostics: { conflictingIds: [] } });
    expect(invalid.diagnostics.issues.map(issue => issue.source.id)).toContain('ring');
    // A driver edit of a few ulps at each end, which the old values would pass, is solved.
    const span = await solver.solve({ graph: far([999999970, '0'], [999999980, '0'], [{ id: 'span', kind: 'axis-distance', pointIds: ['a', 'b'], axis: 'x', value: 10.000000476837158 }]), parameters: {} });
    expect(span.kind === 'solved' && Number(span.graph.points[1].position[0]) - Number(span.graph.points[0].position[0])).toBe(10.000000476837158);
    // An edit the sketch-wide tolerance would hide still moves its group.
    const tall = far(['999999990', '0'], [999999990, 10], [{ id: 'tall', kind: 'axis-distance', pointIds: ['a', 'b'], axis: 'y', value: 'height' }]);
    const before = await solver.solve({ graph: tall, parameters: { height: 10 } });
    if (before.kind !== 'solved') throw new Error(before.message);
    const after = await solver.solve({ graph: before.graph, parameters: { height: 10.000001 } });
    if (after.kind !== 'solved') throw new Error(after.message);
    expect(Math.abs(Number(after.graph.points[1].position[1]) - 10.000001)).toBeLessThan(1e-9);
  });

  it.each([
    ['too-large',{ status: 'too-large' }, 'too-large'],
    ['unavailable', { diagnosis: { kind: 'unavailable' } }, 'failed'],
    ['suspected', { status: 'not-converged', diagnosis: { kind: 'suspected', labels: [2] } }, 'failed'],
    ['not-converged', { status: 'not-converged' }, 'failed'],
    ['unknown-freedom', { diagnosis: { kind: 'diagnosed', degreesOfFreedom: null, labels: [0] } }, 'failed'],
    ['moved-fixed-value', { values: [1, 0, 9, 1] }, 'invalid-solution'],
    ['graph-check', { values: [0, 0, 5, 1] }, 'invalid-solution']
  ] as const)('falls back on %s, and keeps its own rejection unless PlaneGCS does better', async (reason, answer, rejection) => {
    const fixedGraph = parseCadSketchGraph({ ...graph, points: [{ id: 'a', position: ['0', '0'] }, graph.points[1]] });
    const native = async () => fakeNative(() => answer as Partial<CadSketchNativeSolution>);
    const solved = await createCadSketchTestSolver({ mode: 'planegcs' }).solve({ graph: fixedGraph, parameters: {} });
    const rescued = runtime(native, planeGcsSolved(solved));
    expect(await rescued.solver.solve({ graph: fixedGraph, parameters: {} })).toBe(solved);
    expect(rescued.records[0]).toMatchObject({ answeredBy: 'planegcs', native: reason, planeGcs: 'solved' });
    const unhelped = runtime(native, planeGcsSolved(failedResult));
    const result = await unhelped.solver.solve({ graph: fixedGraph, parameters: {} });
    expect(result).toMatchObject({ kind: 'rejected', reason: rejection });
    expect(result.diagnostics.conflictingIds).toEqual([]);
    expect(unhelped.records[0]).toMatchObject({ answeredBy: 'native', native: reason, planeGcs: 'failed' });
    const thrown = runtime(native, { solve: async () => { throw new WebAssembly.RuntimeError('Aborted(OOM)'); } });
    expect(await thrown.solver.solve({ graph: fixedGraph, parameters: {} })).toMatchObject({ kind: 'rejected', reason: rejection });
    expect(thrown.records[0]).toMatchObject({ answeredBy: 'native', planeGcs: 'threw' });
  });

  it('answers definite conflicts natively and takes PlaneGCS whole when native cannot run', async () => {
    const conflicting = runtime(async () => fakeNative(model => ({ status: 'not-converged', diagnosis: { kind: 'diagnosed', degreesOfFreedom: null, labels: model.equations.map(() => 2) } })), planeGcsSolved(failedResult));
    expect(await conflicting.solver.solve(input)).toMatchObject({ kind: 'rejected', reason: 'conflicting', diagnostics: { status: 'failed', conflictingIds: ['length'] } });
    expect(conflicting.loadPlaneGcs).not.toHaveBeenCalled();
    // A load failure is remembered; PlaneGCS answers, including its own rejections.
    const unloadable = runtime(async () => { throw new Error('No module.'); }, planeGcsSolved(failedResult));
    expect(await unloadable.solver.solve(input)).toBe(failedResult); expect(await unloadable.solver.solve(input)).toBe(failedResult);
    expect(unloadable.loadNative).toHaveBeenCalledTimes(1); expect(unloadable.records[1]).toMatchObject({ answeredBy: 'planegcs', native: 'load-failed' });
    const failing = runtime(async () => { throw new Error('No module.'); }, { solve: async () => { throw new Error('PlaneGCS stopped.'); } });
    await expect(failing.solver.solve(input)).rejects.toThrow('PlaneGCS stopped.');
    // A failed instance is replaced on the next solve; another protocol stops native for good.
    let instances = 0;
    const trapping = runtime(async () => { instances += 1; return instances === 1 ? fakeNative(() => { throw new WebAssembly.RuntimeError('unreachable'); }) : fakeNative(() => ({})); }, planeGcsSolved(failedResult));
    expect(await trapping.solver.solve(input)).toBe(failedResult);
    expect(trapping.records[0]).toMatchObject({ answeredBy: 'planegcs', native: 'failed', nativeReset: 'failure' });
    await trapping.solver.solve(input);
    expect(trapping.loadNative).toHaveBeenCalledTimes(2); expect(trapping.records[1]).toMatchObject({ native: 'graph-check' });
    expect(trapping.records[1].nativeReset).toBeUndefined();
    const versioned = runtime(async () => fakeNative(() => { throw new CadSketchNativeProtocolError('Other protocol.'); }), planeGcsSolved(failedResult));
    await versioned.solver.solve(input); await versioned.solver.solve(input);
    expect(versioned.loadNative).toHaveBeenCalledTimes(1); expect(versioned.records[1].native).toBe('load-failed');
    // An instance holding too much memory is replaced after its solve.
    const large = runtime(async () => fakeNative(() => ({}), 2 ** 27), planeGcsSolved(failedResult));
    await large.solver.solve(input); await large.solver.solve(input);
    expect(large.records[0].nativeReset).toBe('memory'); expect(large.loadNative).toHaveBeenCalledTimes(2);
  });

  it('runs only the selected solver in the comparison modes', async () => {
    const planeGcsOnly = runtime(async () => fakeNative(() => ({})), planeGcsSolved(failedResult), { mode: 'planegcs' });
    expect(await planeGcsOnly.solver.solve(input)).toBe(failedResult); expect(planeGcsOnly.loadNative).not.toHaveBeenCalled();
    const nativeOnly = runtime(async () => fakeNative(() => ({ status: 'not-converged' })), planeGcsSolved(failedResult), { mode: 'native-only' });
    expect(await nativeOnly.solver.solve(input)).toMatchObject({ kind: 'rejected', reason: 'failed', message: 'The sketch solver did not produce a valid solution.' });
    expect(await nativeOnly.solver.solve({ ...input, drag: { pointId: 'b', position: [1, 1] } })).toMatchObject({ kind: 'rejected', reason: 'failed' });
    expect(nativeOnly.loadPlaneGcs).not.toHaveBeenCalled();
  });
});

/** A module with the solver's exports: each body is code ending in `end`, and `data` is placed at 1024. */
function nativeModule({ alloc, free, solve, data }: { readonly alloc: number[]; readonly free: number[]; readonly solve: number[]; readonly data?: Float64Array }) {
  const size = (length: number) => { const bytes = []; do { bytes.push(length & 127 | (length > 127 ? 128 : 0)); length >>>= 7; } while (length); return bytes; };
  const name = (text: string) => [text.length, ...new TextEncoder().encode(text)], section = (id: number, bytes: number[]) => [id, ...size(bytes.length), ...bytes];
  const body = (code: number[]) => [...size(code.length + 1), 0, ...code];
  return new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [3, 96, 1, 127, 1, 127, 96, 2, 127, 127, 0, 96, 2, 127, 127, 1, 127]), ...section(3, [3, 0, 1, 2]), ...section(5, [1, 0, 1]),
    ...section(7, [4, ...name('memory'), 2, 0, ...name('buffer_alloc'), 0, 0, ...name('buffer_free'), 0, 1, ...name('solve'), 0, 2]),
    ...section(10, [3, ...body(alloc), ...body(free), ...body(solve)]),
    ...data ? section(11, [1, 0, 65, 128, 8, 11, ...size(data.byteLength), ...new Uint8Array(data.buffer)]) : []]);
}

describe('native solver instances', () => {
  const unreachable = [0, 11], at8 = [65, 8, 11], at1024 = [65, 128, 8, 11], none = [11];
  // An empty model's reply: length, protocol 2, converged, no iterations or residual, nothing to diagnose, no freedom count.
  const reply = new Float64Array([7, 2, 0, 0, 0, 2, NaN]);
  const empty: CadSketchEquationModel = { values: [], fixed: [], pointParameters: new Map(), radiusParameters: new Map(), equations: [] };

  it('reads a reply and frees both buffers', async () => {
    const solver = await loadCadSketchNativeSolver(nativeModule({ alloc: at8, free: none, solve: at1024, data: reply }));
    for (let run = 0; run < 2; run++) expect(solver.solve(empty)).toEqual({ status: 'converged', iterations: 0, residual: 0, values: [], diagnosis: { kind: 'no-unknowns', labels: [] } });
  });

  it.each([
    ['allocating', { alloc: unreachable, free: none, solve: at1024, data: reply }],
    ['solving', { alloc: at8, free: unreachable, solve: unreachable }],
    ['freeing', { alloc: at8, free: unreachable, solve: at1024, data: reply }]
  ] as const)('stops after a trap while %s and never runs again', async (_, parts) => {
    const solver = await loadCadSketchNativeSolver(nativeModule(parts));
    expect(() => solver.solve(empty)).toThrow('unreachable');
    expect(() => solver.solve(empty)).toThrow('The native sketch solver instance stopped after a failure.');
  });
});
