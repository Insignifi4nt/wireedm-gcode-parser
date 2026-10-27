// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { createCadSketchNativeRuntime } from '../sketch-solver/cadSketchNativeRuntime';
import type { CadSketchSolveDiagnostics, CadSketchSolveInput, CadSketchSolveResult } from '../sketch-solver/cadSketchSolverTypes';
import { loadCadSketchTestNativeSolver } from '../sketch-solver/__tests__/cadSketchTestSolver';
import { corpusDragDistance, corpusInput, corpusSolvedGraph, readPlaneGcsCorpus } from '../sketch-solver/__tests__/planeGcsCorpus';
import { createCadBenchmarkRectangleGraph } from './cadBenchmarkCases';
import { createCadBenchmarkRuntime, type CadBenchmarkSolver } from './cadSolverBenchmarkAdapters';
import { createCadSolverDragTrajectories } from './cadSolverDragCases';
import { createCadSolverDieInput, createCadSolverWorkloadCases } from './cadSolverWorkloadCases';
import { cadSolverBoundaryThrottled, cadSolverCalibrationDrifted, cadSolverFrameStats, cadSolverOutcome, checkCadSolverBenchmarkResult, measureCadSolverDrag, measureCadSolverDragSweep, measureCadSolverEdits, measureCadSolverOperations, measureCadSolverWorkload } from './cadSolverWorkloadBenchmark';

const native = () => createCadBenchmarkRuntime(loadCadSketchTestNativeSolver);
const corpus = new Map(readPlaneGcsCorpus().records.map(({ record }) => [record.hash, record.outcome]));
/** PlaneGCS's frozen answer to an input these tests solved while it was bundled, before 0.0.757. */
function planeGcs(input: CadSketchSolveInput) {
  const hash = corpusInput(input).hash, outcome = corpus.get(hash);
  if (!outcome || outcome.kind === 'threw') throw new Error(`The frozen PlaneGCS corpus has no answer to input ${hash}.`);
  return { outcome: outcome.kind === 'solved' ? 'solved' : `rejected:${outcome.reason}`, diagnostics: outcome.diagnostics, graph: corpusSolvedGraph(input, outcome) };
}
/** PlaneGCS's frozen frames of a trajectory, chained from its own answers as the benchmark chained it. */
function planeGcsFrames(id: string, mode: 'from-start' | 'chained') {
  const trajectory = createCadSolverDragTrajectories().find(item => item.id === id)!;
  let previous = trajectory.input;
  return trajectory.frames.map(drag => {
    const input = { ...(mode === 'chained' ? previous : trajectory.input), drag }, { outcome, graph } = planeGcs(input);
    if (graph) previous = { graph, parameters: input.parameters };
    return { outcome, targetErrorMm: graph ? corpusDragDistance(input, graph) : null };
  });
}

describe('public-boundary solver benchmarks', () => {
  it('observes the production runtime\'s stages and records without changing its answers, and consumes each call\'s once', async () => {
    const solver = native(), input = { graph: createCadBenchmarkRectangleGraph(2), parameters: {} };
    expect(await solver.solve(input)).toEqual(await createCadSketchNativeRuntime({ loadNative: loadCadSketchTestNativeSolver }).solve(input));
    for (const stage of Object.values(solver.takeStages())) expect(stage).toBeGreaterThan(0);
    expect(solver.takeStages()).toEqual({ parseCompile: 0, nativeCall: 0, mapping: 0, validation: 0 });
    expect(solver.takeRecord()).toMatchObject({ native: 'answer' });
    expect(solver.takeRecord()).toBeUndefined();
    expect(await solver.solve(createCadSolverWorkloadCases().find(testCase => testCase.id === 'conflicting-distances')!.input))
      .toMatchObject({ kind: 'rejected', reason: 'conflicting' });
    expect(solver.takeStages().nativeCall).toBeGreaterThan(0);
    expect(solver.takeStages().nativeCall).toBe(0);
    // Native blames these conflicts as their start shows, and records why.
    const overlapping = createCadSolverWorkloadCases().find(testCase => testCase.id === 'overlapping-conflicts')!.input;
    expect(await solver.solve(overlapping)).toMatchObject({ kind: 'rejected', reason: 'conflicting' });
    expect(solver.takeRecord()).toMatchObject({ native: 'start-diagnosis' });
  });

  it('answers every workload through the production runtime as PlaneGCS did, except reviewed differences', async () => {
    const solver = native(), summary = (outcome: string, diagnostics: CadSketchSolveDiagnostics) => ({ outcome, degreesOfFreedom: diagnostics.degreesOfFreedom,
      conflictingIds: diagnostics.conflictingIds, redundantIds: diagnostics.redundantIds, partiallyRedundantIds: diagnostics.partiallyRedundantIds });
    // Reviewed differences from PlaneGCS's frozen answers. PlaneGCS stopped short of tangency and
    // failed the graph check. Native suspects the impossible triangle at the nearest point it
    // reached, without naming relations or freedom; PlaneGCS diagnosed at the start, counting freedom
    // for the triangle. Native names the overlapping conflicts as their start shows, as PlaneGCS did,
    // and a repeated 10 there as redundant: it agrees with the first, and the conflict stands without
    // it. PlaneGCS named it conflicting too, as the sketch still failed without the relations it set
    // aside. With nothing free, PlaneGCS accepted a relation that is not met and failed the graph
    // check; native names it.
    const suspected = { outcome: 'rejected:failed', degreesOfFreedom: null, conflictingIds: [] };
    const reviewed: Record<string, object> = { 'tangency-near': { outcome: 'solved' }, 'impossible-triangle': suspected,
      'overlapping-conflicts-repeated': { conflictingIds: ['length', 'other', 'third'], redundantIds: ['repeat'] },
      'fully-fixed-conflict': { outcome: 'rejected:conflicting', degreesOfFreedom: null, conflictingIds: ['fixedSize'] } };
    for (const testCase of createCadSolverWorkloadCases()) {
      const expected = planeGcs(testCase.input), result = await solver.solve(testCase.input);
      expect(summary(cadSolverOutcome(result), result.diagnostics), testCase.id).toEqual({ ...summary(expected.outcome, expected.diagnostics), ...reviewed[testCase.id] });
      expect(['failed', 'load-failed', 'incompatible'], testCase.id).not.toContain(solver.takeRecord()?.native);
      if (result.kind === 'solved') expect(checkCadSolverBenchmarkResult(testCase.input, result), testCase.id).toEqual([]);
    }
  }, 30_000);

  it('warms up once and feeds accepted geometry into the next edit, outside timing', async () => {
    const input = { graph: createCadBenchmarkRectangleGraph(1), parameters: {} }, previousWidths: number[] = [], solver = native();
    let calls = 0;
    const counted: CadBenchmarkSolver = { ...solver, solve: async next => { calls++; return solver.solve(next); } };
    const measured = await measureCadSolverOperations({ id: 'edit', input, solvers: [counted], runs: 2, operations: [
      { id: 'first', prepare: () => input },
      { id: 'wider', prepare: previous => {
        previousWidths.push(Number(previous.graph.points[1].position[0]) - Number(previous.graph.points[0].position[0]));
        return { ...previous, graph: parseCadSketchGraph({ ...previous.graph, relations: previous.graph.relations.map(relation => relation.id === 'r0_width' && relation.kind === 'distance' ? { ...relation, value: 20.5 } : relation) }) };
      } }
    ] });
    expect(calls).toBe(6);
    expect(previousWidths).toHaveLength(3);
    for (const width of previousWidths) expect(width).toBeCloseTo(20, 8);
    expect(measured.failures).toEqual([]);
    for (const row of measured.measurements) { expect(row.kind).toBe('measured'); if (row.kind === 'measured') expect(row.outcomes).toEqual({ solved: 2 }); }
  });

  it('solves both dimension changes and both constraint edits through the public runtime', async () => {
    const groups = await measureCadSolverEdits([native()], 1);
    for (const group of groups) for (const row of group.measurements) {
      expect(group.failures).toEqual([]); expect(row.kind).toBe('measured');
      if (row.kind === 'measured') expect(row.outcomes).toEqual({ solved: 1 });
      if (row.kind === 'measured') expect(row.diagnostics.degreesOfFreedom).toBe(row.operation === 'constraint-addition' ? 20 : row.operation === 'constraint-removal' ? 21 : 0);
    }
  });

  it('times a genuine rejection and skips the already-solved operation after rejection', async () => {
    const fixture = createCadSolverWorkloadCases().find(testCase => testCase.id === 'conflicting-distances')!;
    const result = await measureCadSolverWorkload(fixture, [native()], 1);
    expect(result.failures).toEqual([]);
    expect(result.measurements.filter(row => row.operation === 're-solve').map(row => row.kind)).toEqual(['skipped']);
    for (const row of result.measurements.filter(row => row.operation === 'first-solve')) {
      expect(row.kind).toBe('measured');
      if (row.kind === 'measured') expect(row.outcomes).toEqual({ 'rejected:conflicting': 1 });
    }
  });

  it('plays every drag trajectory from its start and chained, with native outcomes from production records', async () => {
    const groups = await measureCadSolverDrag([native()], 1);
    const row = (trajectory: string, mode: string) => groups.find(group => group.trajectory === trajectory && group.mode === mode)!.solvers[0];
    expect(groups.map(group => `${group.trajectory}/${group.mode}`)).toEqual(createCadSolverDragTrajectories().flatMap(trajectory => [`${trajectory.id}/from-start`, `${trajectory.id}/chained`]));
    for (const group of groups) expect(group.failures, `${group.trajectory}/${group.mode}`).toEqual([]);
    for (const mode of ['from-start', 'chained'] as const) {
      const die = row('die-slot', mode), plane = planeGcsFrames('die-slot', mode);
      expect(die.outcomes).toEqual({ solved: 60 }); expect(die.dragOutcomes).toEqual({ reached: 59, projected: 1 });
      expect(die.frames[45].targetErrorMm).toBeGreaterThan(100);
      expect(die.frames[0].target[1]).toBe(die.frames[59].target[1]); expect(die.frames[29].target[1]).toBeGreaterThan(die.frames[59].target[1]);
      // PlaneGCS solved every frame too, and reached all but the unreachable one.
      expect(plane.map(frame => frame.outcome)).toEqual(plane.map(() => 'solved'));
      expect(plane.flatMap((frame, index) => frame.targetErrorMm! > 1e-6 ? [index] : [])).toEqual([45]);
    }
    expect(row('die-slot', 'from-start').answers).toEqual({ 'native:answer': 60 });
    // Chained or in one jump, native stays on the four-bar's start assembly, as chained PlaneGCS did.
    for (const mode of ['from-start', 'chained']) expect(row('four-bar', mode).largestTargetErrorMm).toBeCloseTo(Math.hypot(17.2, 27.6), 6);
    expect(Math.max(...planeGcsFrames('four-bar', 'chained').map(frame => frame.targetErrorMm!))).toBeCloseTo(Math.hypot(17.2, 27.6), 6);
    // Stretched arm frames whose rank is too close to call still solve natively, with freedom unknown.
    expect(row('arm', 'from-start').answers).toEqual({ 'native:answer': 47 });
    // With nothing free, native stalls at its start on the way to the tangency, where its relations
    // are met, and keeps those frames there. Its landing is answered, stopped short of the singular point.
    expect(row('tangency', 'from-start').answers).toEqual({ 'native:stalled': 3, 'native:answer': 1 });
    expect(row('tangency', 'from-start').frames.slice(0, 3).map(frame => frame.targetErrorMm)).toEqual([2.5e-6, 5e-6, 7.5e-6].map(error => expect.closeTo(error, 18)));
    for (const trajectory of ['arm', 'tangency']) {
      const frames = createCadSolverDragTrajectories().find(item => item.id === trajectory)!.frames.length;
      expect(row(trajectory, 'from-start').outcomes).toEqual({ solved: frames });
      expect(planeGcsFrames(trajectory, 'from-start').filter(frame => frame.outcome === 'solved')).toHaveLength(frames);
    }
  }, 60_000);

  it('sweeps every free die point from one settled start, all answered natively and never further than PlaneGCS', async () => {
    const solver = native(), solved: { input: CadSketchSolveInput; result: CadSketchSolveResult }[] = [];
    const recorded: CadBenchmarkSolver = { ...solver, solve: async input => { const result = await solver.solve(input); solved.push({ input, result }); return result; } };
    const sweeps = await measureCadSolverDragSweep([recorded]);
    expect(sweeps.map(sweep => [sweep.id, sweep.drags])).toEqual([['die', 120], ['free-die', 126]]);
    for (const sweep of sweeps) {
      const [row] = sweep.solvers;
      expect(sweep.failures).toEqual([]); expect(row.outcomes).toEqual({ solved: sweep.drags }); expect(row.answers).toEqual({ 'native:answer': sweep.drags });
    }
    // Native settles both starts exactly where PlaneGCS did, so PlaneGCS answered every one of these drags.
    const drags = solved.filter(({ input }) => input.drag);
    expect(drags).toHaveLength(246);
    expect(drags.map(({ input }) => planeGcs(input).outcome)).toEqual(drags.map(() => 'solved'));
    expect(drags.filter(({ input, result }) => result.kind !== 'solved'
      || corpusDragDistance(input, result.graph) > corpusDragDistance(input, planeGcs(input).graph!) + 1e-6).map(({ input }) => input.drag)).toEqual([]);
  }, 60_000);

  it('checks geometry independently and computes frame tail statistics from raw samples', () => {
    const input = createCadSolverDieInput();
    const invalid = { kind: 'solved', graph: { ...input.graph, points: input.graph.points.map(point => point.id === 'v1' ? { ...point, position: [0, 0] as const } : point) },
      diagnostics: { status: 'success', degreesOfFreedom: 0, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] } } as const;
    expect(checkCadSolverBenchmarkResult(input, invalid).length).toBeGreaterThan(0);
    expect(cadSolverFrameStats(Array.from({ length: 100 }, (_, index) => index + 1))).toEqual({ runs: 100, p50: 50, p95: 95, p99: 99, min: 1, max: 100, framesOver8Ms: 92 });
    expect(cadSolverCalibrationDrifted([60, 91])).toBe(true); expect(cadSolverCalibrationDrifted([60, 80])).toBe(false);
    // Each probe of the recorded 0.0.741 native boundary was steady, but they ran at different host speeds.
    expect(cadSolverBoundaryThrottled([{ cpuCalibrationMs: [141.64, 183.1] }, { cpuCalibrationMs: [237.56, 236.26] }])).toBe(true);
    expect(cadSolverBoundaryThrottled([{ cpuCalibrationMs: [60, 70] }, { cpuCalibrationMs: [75, 80] }, undefined])).toBe(false);
  });
});
