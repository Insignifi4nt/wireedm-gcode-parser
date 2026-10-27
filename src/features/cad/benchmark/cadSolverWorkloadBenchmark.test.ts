// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { createCadSketchSolverRuntime } from '../sketch-solver/cadSketchSolverRuntime';
import type { CadSketchSolveResult } from '../sketch-solver/cadSketchSolverTypes';
import { initializeCadSketchSolverModule } from '../sketch-solver/cadSketchSolverModule';
import { loadCadSketchNativeSolver } from '../sketch-solver/native/cadSketchNativeSolver';
import { createCadBenchmarkRectangleGraph } from './cadBenchmarkCases';
import { createCadBenchmarkPlaneGcs, createCadBenchmarkRuntime, type CadBenchmarkSolver } from './cadSolverBenchmarkAdapters';
import { createCadSolverDragTrajectories } from './cadSolverDragCases';
import { createCadSolverDieInput, createCadSolverWorkloadCases } from './cadSolverWorkloadCases';
import { cadSolverBoundaryThrottled, cadSolverCalibrationDrifted, cadSolverFrameStats, cadSolverOutcome, checkCadSolverBenchmarkResult, measureCadSolverDrag, measureCadSolverDragSweep, measureCadSolverEdits, measureCadSolverOperations, measureCadSolverWorkload } from './cadSolverWorkloadBenchmark';

const require = createRequire(import.meta.url);
const initialize = () => initializeCadSketchSolverModule(pathToFileURL(require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href);
const native = loadCadSketchNativeSolver(await readFile(new URL('../../../../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url)));
const pair = () => [createCadBenchmarkPlaneGcs(initialize), createCadBenchmarkRuntime('native-only', () => native)];

describe('public-boundary solver benchmarks', () => {
  it('keeps PlaneGCS results identical with stage observation and consumes each call once', async () => {
    const input = { graph: createCadBenchmarkRectangleGraph(2), parameters: {} }, solver = createCadBenchmarkPlaneGcs(initialize);
    expect(await solver.solve(input)).toEqual(await createCadSketchSolverRuntime(initialize).solve(input));
    const stages = solver.takeStages();
    for (const stage of Object.values(stages)) expect(stage).toBeGreaterThan(0);
    expect(solver.takeStages()).toEqual({ parseCompile: 0, nativeCall: 0, mapping: 0, validation: 0 });
    expect(await solver.solve(createCadSolverWorkloadCases().find(testCase => testCase.id === 'conflicting-distances')!.input))
      .toMatchObject({ kind: 'rejected', reason: 'conflicting' });
    expect(solver.takeStages().nativeCall).toBeGreaterThan(0);
    expect(solver.takeStages().nativeCall).toBe(0);
    expect(solver.takeRecord()).toBeUndefined();
  });

  it('observes the production runtime\'s stages and records, and adds PlaneGCS\'s on a fallback', async () => {
    const solver = createCadBenchmarkRuntime('native-first', () => native, initialize), input = { graph: createCadBenchmarkRectangleGraph(2), parameters: {} };
    expect(await solver.solve(input)).toEqual(await createCadBenchmarkRuntime('native-only', () => native).solve(input));
    for (const stage of Object.values(solver.takeStages())) expect(stage).toBeGreaterThan(0);
    expect(solver.takeRecord()).toMatchObject({ answeredBy: 'native', native: 'answer' });
    expect(solver.takeRecord()).toBeUndefined();
    const nativeOnly = solver.takeStages();
    expect(nativeOnly).toEqual({ parseCompile: 0, nativeCall: 0, mapping: 0, validation: 0 });
    // Native suspects these conflicts without naming them, so PlaneGCS is asked and names them.
    const overlapping = createCadSolverWorkloadCases().find(testCase => testCase.id === 'overlapping-conflicts')!.input;
    expect(await solver.solve(overlapping)).toMatchObject({ kind: 'rejected', reason: 'conflicting' });
    expect(solver.takeRecord()).toMatchObject({ answeredBy: 'planegcs', native: 'suspected', planeGcs: 'conflicting' });
    expect(solver.takeStages().nativeCall).toBeGreaterThan(0);
  });

  it('answers every workload through the production runtime as PlaneGCS does, except reviewed differences', async () => {
    const [plane, solver] = pair(), summary = (result: CadSketchSolveResult) => ({ outcome: cadSolverOutcome(result), degreesOfFreedom: result.diagnostics.degreesOfFreedom,
      conflictingIds: result.diagnostics.conflictingIds, redundantIds: result.diagnostics.redundantIds, partiallyRedundantIds: result.diagnostics.partiallyRedundantIds });
    // Reviewed differences. PlaneGCS stops short of tangency and fails the graph check. Native suspects the overlapping conflicts and the impossible triangle at
    // the nearest point it reached, without naming relations or freedom; PlaneGCS diagnoses at the
    // start, naming the overlapping conflicts but counting freedom for the triangle. With nothing
    // free, PlaneGCS accepts a relation that is not met and fails the graph check; native names it.
    const suspected = { outcome: 'rejected:failed', degreesOfFreedom: null, conflictingIds: [] };
    const reviewed: Record<string, object> = { 'tangency-near': { outcome: 'solved' }, 'overlapping-conflicts': suspected, 'impossible-triangle': suspected,
      'fully-fixed-conflict': { outcome: 'rejected:conflicting', degreesOfFreedom: null, conflictingIds: ['fixedSize'] } };
    for (const testCase of createCadSolverWorkloadCases()) {
      const expected = summary(await plane.solve(testCase.input)), result = await solver.solve(testCase.input);
      expect(summary(result), testCase.id).toEqual({ ...expected, ...reviewed[testCase.id] });
      expect(solver.takeRecord()?.answeredBy, testCase.id).toBe('native');
      if (result.kind === 'solved') expect(checkCadSolverBenchmarkResult(testCase.input, result), testCase.id).toEqual([]);
    }
  }, 30_000);

  it('alternates solver order and feeds accepted geometry into the next edit, outside timing', async () => {
    const input = { graph: createCadBenchmarkRectangleGraph(1), parameters: {} }, order: string[] = [], previousWidths: number[] = [];
    const solvers = pair().map((solver): CadBenchmarkSolver => ({ ...solver, solve: async next => { order.push(solver.id); return solver.solve(next); } }));
    const measured = await measureCadSolverOperations({ id: 'edit', input, solvers, runs: 2, operations: [
      { id: 'first', prepare: () => input },
      { id: 'wider', prepare: previous => {
        previousWidths.push(Number(previous.graph.points[1].position[0]) - Number(previous.graph.points[0].position[0]));
        return { ...previous, graph: parseCadSketchGraph({ ...previous.graph, relations: previous.graph.relations.map(relation => relation.id === 'r0_width' && relation.kind === 'distance' ? { ...relation, value: 20.5 } : relation) }) };
      } }
    ] });
    expect(measured.sampleOrder).toEqual([['planegcs', 'native-only'], ['native-only', 'planegcs']]);
    expect(order).toEqual(['planegcs', 'planegcs', 'native-only', 'native-only', 'planegcs', 'planegcs', 'native-only', 'native-only', 'native-only', 'native-only', 'planegcs', 'planegcs']);
    for (const width of previousWidths) expect(width).toBeCloseTo(20, 8);
    expect(measured.failures).toEqual([]);
    for (const row of measured.measurements) { expect(row.kind).toBe('measured'); if (row.kind === 'measured') expect(row.outcomes).toEqual({ solved: 2 }); }
  });

  it('solves both dimension changes and both constraint edits through each public adapter', async () => {
    const groups = await measureCadSolverEdits(pair(), 1);
    for (const group of groups) for (const row of group.measurements) {
      expect(group.failures).toEqual([]); expect(row.kind).toBe('measured');
      if (row.kind === 'measured') expect(row.outcomes).toEqual({ solved: 1 });
      if (row.kind === 'measured') expect(row.diagnostics.degreesOfFreedom).toBe(row.operation === 'constraint-addition' ? 20 : row.operation === 'constraint-removal' ? 21 : 0);
    }
  });

  it('times a genuine rejection and skips the already-solved operation after rejection', async () => {
    const fixture = createCadSolverWorkloadCases().find(testCase => testCase.id === 'conflicting-distances')!;
    const result = await measureCadSolverWorkload(fixture, pair(), 1, 0);
    expect(result.failures).toEqual([]);
    expect(result.measurements.filter(row => row.operation === 're-solve').map(row => row.kind)).toEqual(['skipped', 'skipped']);
    for (const row of result.measurements.filter(row => row.operation === 'first-solve')) {
      expect(row.kind).toBe('measured');
      if (row.kind === 'measured') expect(row.outcomes).toEqual({ 'rejected:conflicting': 1 });
    }
  });

  it('plays every drag trajectory from its start and chained, with native outcomes from production records', async () => {
    const groups = await measureCadSolverDrag(pair(), 1);
    const row = (trajectory: string, mode: string, solver: string) => groups.find(group => group.trajectory === trajectory && group.mode === mode)!.solvers.find(item => item.solver === solver)!;
    expect(groups.map(group => `${group.trajectory}/${group.mode}`)).toEqual(createCadSolverDragTrajectories().flatMap(trajectory => [`${trajectory.id}/from-start`, `${trajectory.id}/chained`]));
    for (const group of groups) expect(group.failures, `${group.trajectory}/${group.mode}`).toEqual([]);
    for (const mode of ['from-start', 'chained']) for (const solver of ['planegcs', 'native-only']) {
      const die = row('die-slot', mode, solver);
      expect(die.outcomes).toEqual({ solved: 60 }); expect(die.dragOutcomes).toEqual({ reached: 59, projected: 1 });
      expect(die.frames[45].targetErrorMm).toBeGreaterThan(100);
      expect(die.frames[0].target[1]).toBe(die.frames[59].target[1]); expect(die.frames[29].target[1]).toBeGreaterThan(die.frames[59].target[1]);
    }
    expect(row('die-slot', 'from-start', 'native-only').answers).toEqual({ 'native:answer': 60 });
    // Chained or in one jump, native stays on the four-bar's start assembly, as chained PlaneGCS does.
    for (const [mode, solver] of [['from-start', 'native-only'], ['chained', 'native-only'], ['chained', 'planegcs']]) expect(row('four-bar', mode, solver).largestTargetErrorMm).toBeCloseTo(Math.hypot(17.2, 27.6), 6);
    // Stretched arm frames whose rank is too close to call still solve natively, with freedom unknown.
    expect(row('arm', 'from-start', 'native-only').answers).toEqual({ 'native:answer': 47 });
    // With nothing free, native stalls at its start on the way to the tangency, where its relations
    // are met: native-only keeps those frames there, and native-first asks PlaneGCS first. Its
    // landing is answered, stopped short of the singular point.
    expect(row('tangency', 'from-start', 'native-only').answers).toEqual({ 'native:stalled': 3, 'native:answer': 1 });
    expect(row('tangency', 'from-start', 'native-only').frames.slice(0, 3).map(frame => frame.targetErrorMm)).toEqual([2.5e-6, 5e-6, 7.5e-6].map(error => expect.closeTo(error, 18)));
    for (const trajectory of ['arm', 'tangency']) for (const solver of ['planegcs', 'native-only']) expect(row(trajectory, 'from-start', solver).outcomes).toEqual({ solved: createCadSolverDragTrajectories().find(item => item.id === trajectory)!.frames.length });
  }, 60_000);

  it('sweeps every free die point from one settled start, all answered natively and never further than PlaneGCS', async () => {
    const sweeps = await measureCadSolverDragSweep(pair());
    expect(sweeps.map(sweep => [sweep.id, sweep.drags])).toEqual([['die', 120], ['free-die', 126]]);
    for (const sweep of sweeps) {
      const [plane, nativeRow] = sweep.solvers;
      expect(sweep.failures).toEqual([]); expect(plane.outcomes).toEqual({ solved: sweep.drags }); expect(nativeRow.outcomes).toEqual({ solved: sweep.drags });
      expect(nativeRow.answers).toEqual({ 'native:answer': sweep.drags }); expect(nativeRow.worseThanFirst).toEqual([]);
    }
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
