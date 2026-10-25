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
import { createCadBenchmarkNative, createCadBenchmarkPlaneGcs, type CadBenchmarkSolver } from './cadSolverBenchmarkAdapters';
import { createCadSolverDieInput, createCadSolverWorkloadCases } from './cadSolverWorkloadCases';
import { cadSolverBoundaryThrottled, cadSolverCalibrationDrifted, cadSolverFrameStats, cadSolverOutcome, checkCadSolverBenchmarkResult, measureCadSolverDrag, measureCadSolverEdits, measureCadSolverOperations, measureCadSolverWorkload } from './cadSolverWorkloadBenchmark';

const require = createRequire(import.meta.url);
const initialize = () => initializeCadSketchSolverModule(pathToFileURL(require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href);
const native = loadCadSketchNativeSolver(await readFile(new URL('../../../../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url)));
const pair = () => [createCadBenchmarkPlaneGcs(initialize), createCadBenchmarkNative(() => native)];

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
  });

  it('diagnoses every workload natively as PlaneGCS does and refuses drag', async () => {
    const [plane, solver] = pair(), summary = (result: CadSketchSolveResult) => ({ outcome: cadSolverOutcome(result), degreesOfFreedom: result.diagnostics.degreesOfFreedom,
      conflictingIds: result.diagnostics.conflictingIds, redundantIds: result.diagnostics.redundantIds, partiallyRedundantIds: result.diagnostics.partiallyRedundantIds });
    // Reviewed differences, where the native result is the better one. PlaneGCS stops short of
    // tangency and fails the graph check. It diagnoses at the start, where the vertical offset is
    // independent of the three distances and the impossible triangle is not yet flat; native finds
    // the conflict at the nearest point and reports it as suspected. With nothing free, PlaneGCS
    // reports success for a relation that is not met.
    const conflicting = (...conflictingIds: string[]) => ({ outcome: 'rejected:conflicting', degreesOfFreedom: null, conflictingIds });
    const reviewed: Record<string, object> = { 'tangency-near': { outcome: 'solved' }, 'overlapping-conflicts': conflicting('length', 'other', 'third', 'vertical'),
      'impossible-triangle': conflicting('ab', 'bc', 'ac'), 'fully-fixed-conflict': conflicting('fixedSize') };
    expect(solver.diagnosis).toBe('available'); expect(solver.drag).toBe('unsupported');
    for (const testCase of createCadSolverWorkloadCases()) {
      const expected = summary(await plane.solve(testCase.input)), result = await solver.solve(testCase.input);
      expect(summary(result), testCase.id).toEqual({ ...expected, ...reviewed[testCase.id] });
      if (result.kind === 'solved') expect(checkCadSolverBenchmarkResult(testCase.input, result), testCase.id).toEqual([]);
    }
    const input = createCadSolverDieInput();
    expect(await solver.solve({ ...input, drag: { pointId: 'slotA', position: [-12, 4] } })).toMatchObject({ kind: 'rejected', reason: 'invalid-input', message: expect.stringContaining('does not support drag') });
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
    expect(measured.sampleOrder).toEqual([['planegcs', 'native'], ['native', 'planegcs']]);
    expect(order).toEqual(['planegcs', 'planegcs', 'native', 'native', 'planegcs', 'planegcs', 'native', 'native', 'native', 'native', 'planegcs', 'planegcs']);
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

  it('runs all 60 connected-die frames with reversal and projects the unreachable target', async () => {
    const [plane, nativeReport] = await measureCadSolverDrag(pair(), 1);
    expect(nativeReport).toMatchObject({ solver: 'native', kind: 'unsupported' });
    expect(plane).toMatchObject({ kind: 'measured', framesPerTrajectory: 60, accepted: 60, projected: 1, failures: [] });
    if (plane.kind !== 'measured') throw new Error('Missing PlaneGCS trajectory.');
    expect(plane.frames[45].targetErrorMm).toBeGreaterThan(100);
    expect(plane.frames[0].target[1]).toBe(plane.frames[59].target[1]);
    expect(plane.frames[29].target[1]).toBeGreaterThan(plane.frames[59].target[1]);
  }, 30_000);

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
