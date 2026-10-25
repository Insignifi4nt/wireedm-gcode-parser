// Setup for the `native-differential` project: every PlaneGCS solve in the selected suites is
// repeated by the native solver, which must match its diagnosis and, for solved sketches, its
// geometry. Mismatches are collected and fail the suite after its tests, so suites that expect
// rejections cannot swallow them.
import { readFileSync } from 'node:fs';
import { afterAll, expect, vi } from 'vitest';
import { checkCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import type { CadSketchSolveInput, CadSketchSolveResult } from '../../cadSketchSolverTypes';
import { cadSketchSolutionMatchesInput, parseCadSketchSolveInput } from '../../cadSketchSolverProtocol';
import { compileCadSketchEquations } from '../compileCadSketchEquations';
import { applyCadSketchEquationSolution, cadSketchEquationDiagnostics, type CadSketchEquationModel } from '../cadSketchEquationModel';
import { loadCadSketchNativeSolver, type CadSketchNativeSolution, type CadSketchNativeSolver } from '../cadSketchNativeSolver';
import { planeGcsEquations, planeGcsValues } from './planeGcsEquations';

const wasm = readFileSync(new URL('../../../../../../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url));
const tally = { compared: 0, diagnosed: 0, reviewedDifferences: 0, diagnosisUnavailable: 0, diagnosisSuspected: 0, unmetWithoutUnknowns: 0, wellConstrained: 0, skippedDrag: 0 }, mismatches: string[] = [];

/**
 * Reviewed diagnosis differences: the native result each test must keep. PlaneGCS writes
 * perpendicular and parallel relations as unnormalized dot and cross products. With an opposite
 * direction relation, their gradients run along the line, so PlaneGCS also blames the line's length
 * dimension; the native normalized forms blame only the direction relations. PlaneGCS also sets
 * aside the equation shared by most dependencies, which for a repeated collinear relation is the
 * earlier one; native sets aside the relation that repeats. With nothing free, PlaneGCS reports success
 * with no freedom for relations that are not met, and the graph checks reject them; native names
 * them as conflicting.
 */
const directionConflict = (...conflictingIds: string[]) => JSON.stringify({ degreesOfFreedom: null, conflictingIds, redundantIds: [], partiallyRedundantIds: [] });
const reviewedDiagnoses = new Map([
  ['real PlaneGCS explicit line angles > updates an exact degree expression through preparation and rejects an incompatible complete session batch atomically', directionConflict('angle', 'opposite')],
  ['real PlaneGCS line pair relations > rejects opposite or duplicate parallel relations with source IDs and no accepted document mutation', directionConflict('opposite')],
  ['real PlaneGCS line pair relations > rejects opposite or duplicate perpendicular relations with source IDs and no accepted document mutation', directionConflict('opposite')],
  ['real PlaneGCS collinear support > keeps native redundancy IDs source-owned and rejects a fixed parallel offset atomically even when native says Success',
    JSON.stringify({ degreesOfFreedom: 6, conflictingIds: [], redundantIds: ['duplicate'], partiallyRedundantIds: [] })]
]);
let solver: Promise<CadSketchNativeSolver> | undefined;

/** Exact native diagnosis in the runtime's terms; a sketch without unknowns has no freedom. */
function nativeDiagnostics(model: CadSketchEquationModel, native: CadSketchNativeSolution) {
  if (native.diagnosis.kind === 'unavailable' || native.diagnosis.kind === 'suspected') return undefined;
  const ids = cadSketchEquationDiagnostics(model, native.diagnosis.labels);
  return { degreesOfFreedom: native.diagnosis.kind === 'diagnosed' ? native.diagnosis.degreesOfFreedom : ids.conflictingIds.length ? null : 0, ...ids };
}

async function compare(input: CadSketchSolveInput, result: CadSketchSolveResult | undefined, runtime: typeof import('../../cadSketchSolverRuntime')) {
  if (input.drag) { tally.skippedDrag += 1; return; }
  const label = (message: string) => `${expect.getState().currentTestName ?? 'unknown test'}: ${message}`;
  let planeGcs: ReturnType<typeof runtime.compileCadSketchPlaneGcs> | undefined, parsed: CadSketchSolveInput | undefined;
  try { parsed = parseCadSketchSolveInput(input); planeGcs = runtime.compileCadSketchPlaneGcs(parsed); } catch { /* compared below */ }
  let model: CadSketchEquationModel | undefined;
  try { if (parsed) model = compileCadSketchEquations(parsed); } catch (error) { if (planeGcs) mismatches.push(label(`native compilation failed: ${String(error)}`)); }
  if (!planeGcs || !parsed || !model) {
    if (model) mismatches.push(label('native compilation accepted input that PlaneGCS rejects'));
    return;
  }
  tally.compared += 1;
  const restated = planeGcsEquations(planeGcs, model);
  if (JSON.stringify(restated) !== JSON.stringify(model.equations)) mismatches.push(label(`equations differ:\n${JSON.stringify(restated)}\n${JSON.stringify(model.equations)}`));
  if (JSON.stringify(planeGcsValues(planeGcs, model)) !== JSON.stringify(model.values)) mismatches.push(label('parameter values differ'));
  if (!result || result.kind === 'rejected' && (result.reason === 'invalid-input' || result.reason === 'too-large')) return;
  const native = (await (solver ??= loadCadSketchNativeSolver(wasm))).solve(model);
  const diagnosed = nativeDiagnostics(model, native);
  if (diagnosed) {
    tally.diagnosed += 1;
    const { degreesOfFreedom, conflictingIds, redundantIds, partiallyRedundantIds } = result.diagnostics, expected = { degreesOfFreedom, conflictingIds, redundantIds, partiallyRedundantIds };
    if (JSON.stringify(diagnosed) === reviewedDiagnoses.get(expect.getState().currentTestName ?? '')) tally.reviewedDifferences += 1;
    else if (native.diagnosis.kind === 'no-unknowns' && diagnosed.conflictingIds.length && result.kind === 'rejected' && result.reason === 'invalid-solution'
      && JSON.stringify(expected) === JSON.stringify({ degreesOfFreedom: 0, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] })) tally.unmetWithoutUnknowns += 1;
    else if (JSON.stringify(diagnosed) !== JSON.stringify(expected)) mismatches.push(label(`diagnosis differs: native ${JSON.stringify(diagnosed)}, PlaneGCS ${JSON.stringify(expected)}`));
  } else if (native.diagnosis.kind === 'suspected') tally.diagnosisSuspected += 1;
  else tally.diagnosisUnavailable += 1;
  if (result.kind !== 'solved') return;
  if (native.status !== 'converged') { mismatches.push(label(`native solve did not converge (residual ${native.residual})`)); return; }
  const graph = applyCadSketchEquationSolution(parsed.graph, model, native.values);
  if (!cadSketchSolutionMatchesInput(parsed, graph)) mismatches.push(label('native solution changed fixed source geometry'));
  const issues = checkCadSketchGraph(graph, parsed.parameters);
  if (issues.length) mismatches.push(label(`native solution fails graph checks: ${JSON.stringify(issues)}`));
  if (result.diagnostics.degreesOfFreedom !== 0) return;
  tally.wellConstrained += 1;
  graph.points.forEach((point, index) => point.position.forEach((value, axis) => {
    const expected = result.graph.points[index].position[axis];
    if (typeof value === 'number' && typeof expected === 'number' && Math.abs(value - expected) > 1e-8 * Math.max(1, Math.abs(expected)))
      mismatches.push(label(`point ${point.id} axis ${axis}: native ${value}, PlaneGCS ${expected}`));
  }));
  graph.entities.forEach((entity, index) => {
    const expected = result.graph.entities[index];
    if (entity.kind === 'circle' && expected.kind === 'circle' && typeof entity.radius === 'number' && typeof expected.radius === 'number'
      && Math.abs(entity.radius - expected.radius) > 1e-8 * Math.max(1, Math.abs(expected.radius)))
      mismatches.push(label(`circle ${entity.id} radius: native ${entity.radius}, PlaneGCS ${expected.radius}`));
  });
}

vi.mock('../../cadSketchSolverRuntime', async importOriginal => {
  const runtime = await importOriginal<typeof import('../../cadSketchSolverRuntime')>();
  return { ...runtime, createCadSketchSolverRuntime: (...args: Parameters<typeof runtime.createCadSketchSolverRuntime>) => {
    const inner = runtime.createCadSketchSolverRuntime(...args);
    return { async solve(input: CadSketchSolveInput) {
      // Suites may mutate their input after the call to prove it was captured.
      const captured = structuredClone(input), result = await inner.solve(input);
      await compare(captured, result, runtime);
      return result;
    } };
  } };
});

afterAll(() => {
  if (process.env.NATIVE_DIFFERENTIAL_TALLY) console.log(`native differential: ${JSON.stringify(tally)}`);
  expect(mismatches).toEqual([]);
});
