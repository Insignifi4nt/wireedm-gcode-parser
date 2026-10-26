// Setup for the `native-differential` project. Every PlaneGCS solve in the selected suites is
// repeated by the native solver, which must match its diagnosis and, for solved sketches, its
// geometry. Suites that solve through the application's native-first runtime also get a PlaneGCS
// answer for the same input, so every native answer, fallback and rescue is compared and tallied.
// Mismatches are collected and fail the suite after its tests, so suites that expect rejections
// cannot swallow them.
import { readFileSync } from 'node:fs';
import { afterAll, expect, vi } from 'vitest';
import { cadSketchSolvedValues, checkCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import type { CadSketchSolveInput, CadSketchSolveResult } from '../../cadSketchSolverTypes';
import { cadSketchSolutionMatchesInput, parseCadSketchSolveInput } from '../../cadSketchSolverProtocol';
import { compileCadSketchEquations } from '../compileCadSketchEquations';
import { applyCadSketchEquationSolution, cadSketchEquationDiagnostics, type CadSketchEquationModel } from '../cadSketchEquationModel';
import { loadCadSketchNativeSolver, type CadSketchNativeSolution, type CadSketchNativeSolver } from '../cadSketchNativeSolver';
import { planeGcsEquations, planeGcsValues } from './planeGcsEquations';
import type { CadSketchSolveRecord } from '../../cadSketchNativeFirstRuntime';

const wasm = readFileSync(new URL('../../../../../../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url));
const tally = { compared: 0, diagnosed: 0, reviewedDifferences: 0, unmetWithoutUnknowns: 0, wellConstrained: 0, skippedDrag: 0 }, mismatches: string[] = [];
/** The application runtime's answers: which backend answered, why native fell back, and how far free solutions differ. */
const answers = { native: 0, planeGcs: 0, fallbacks: {} as Record<string, number>, keptGroups: 0, nativeOnlyImprovements: 0, freeSolutions: 0, largestFreeDifference: 0,
  /** Free solutions where native moved further from the start than PlaneGCS, and the largest such excess in mm. */
  movedFurther: 0, movedLess: 0, largestExtraMovement: 0, movements: [] as string[] };

/**
 * Reviewed cases where PlaneGCS solves after the native solver fell back, by test name and reason.
 * Each one is native-only behaviour that PlaneGCS removal still has to cover; drag is counted apart.
 */
const reviewedRescues = new Map<string, string>();

/**
 * Reviewed diagnosis differences: the native result each test must keep. PlaneGCS writes
 * perpendicular and parallel relations as unnormalized dot and cross products. With an opposite
 * direction relation, their gradients run along the line, so PlaneGCS also blames the line's length
 * dimension; the native normalized forms blame only the direction relations. PlaneGCS also sets
 * aside the equation shared by most dependencies, which for a repeated collinear relation is the
 * earlier one; native sets aside the relation that repeats. With nothing free, PlaneGCS reports success
 * with no freedom for relations that are not met, and the graph checks reject them; native names
 * them as conflicting. A suspected or unavailable native diagnosis is a mismatch unless reviewed
 * here, as `{"suspected":[ids]}` or `"unavailable"`.
 */
const directionConflict = (...conflictingIds: string[]) => JSON.stringify({ degreesOfFreedom: null, conflictingIds, redundantIds: [], partiallyRedundantIds: [] });
const reviewedDiagnoses = new Map([
  ['real PlaneGCS explicit line angles > updates an exact degree expression through preparation and rejects an incompatible complete session batch atomically', directionConflict('angle', 'opposite')],
  ['real PlaneGCS line pair relations > rejects opposite or duplicate parallel relations with source IDs and no accepted document mutation', directionConflict('opposite')],
  ['real PlaneGCS line pair relations > rejects opposite or duplicate perpendicular relations with source IDs and no accepted document mutation', directionConflict('opposite')],
  ['real PlaneGCS collinear support > keeps redundancy IDs source-owned and rejects a fixed parallel offset atomically',
    JSON.stringify({ degreesOfFreedom: 6, conflictingIds: [], redundantIds: ['duplicate'], partiallyRedundantIds: [] })]
]);
let solver: Promise<CadSketchNativeSolver> | undefined;

/** Native diagnosis in the runtime's terms; a sketch without unknowns has no freedom. */
function nativeDiagnostics(model: CadSketchEquationModel, native: CadSketchNativeSolution) {
  if (native.diagnosis.kind === 'unavailable') return 'unavailable';
  const ids = cadSketchEquationDiagnostics(model, native.diagnosis.labels);
  if (native.diagnosis.kind === 'suspected') return { suspected: ids.conflictingIds };
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
  const { degreesOfFreedom, conflictingIds, redundantIds, partiallyRedundantIds } = result.diagnostics, expected = { degreesOfFreedom, conflictingIds, redundantIds, partiallyRedundantIds };
  tally.diagnosed += 1;
  if (JSON.stringify(diagnosed) === reviewedDiagnoses.get(expect.getState().currentTestName ?? '')) tally.reviewedDifferences += 1;
  else if (native.diagnosis.kind === 'no-unknowns' && typeof diagnosed === 'object' && 'conflictingIds' in diagnosed && diagnosed.conflictingIds.length
    && result.kind === 'rejected' && result.reason === 'invalid-solution'
    && JSON.stringify(expected) === JSON.stringify({ degreesOfFreedom: 0, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] })) tally.unmetWithoutUnknowns += 1;
  else if (JSON.stringify(diagnosed) !== JSON.stringify(expected)) mismatches.push(label(`diagnosis differs: native ${JSON.stringify(diagnosed)}, PlaneGCS ${JSON.stringify(expected)}`));
  if (result.kind !== 'solved') return;
  if (native.status !== 'converged') { mismatches.push(label(`native solve did not converge (residual ${native.residual})`)); return; }
  const graph = applyCadSketchEquationSolution(parsed.graph, model, native.values);
  if (!graph || !cadSketchSolutionMatchesInput(parsed, graph)) { mismatches.push(label('native solution changed fixed source geometry')); return; }
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

/**
 * Compares the application's native-first answer with PlaneGCS alone on the same captured input.
 * Native may answer differently only where the diagnosis comparison above reviews it, or by solving
 * what PlaneGCS rejects; PlaneGCS may rescue a native fallback only where reviewed.
 */
function compareAnswer(input: CadSketchSolveInput, result: CadSketchSolveResult, oracle: CadSketchSolveResult | undefined, record: CadSketchSolveRecord | undefined) {
  const label = (message: string) => `${expect.getState().currentTestName ?? 'unknown test'}: ${message}`;
  // Input rejected before either solver runs leaves no record; anything solved went through one.
  if (!record || record.native === undefined) { if (result.kind === 'solved') mismatches.push(label('a solved answer has no native attempt record')); return; }
  if (record.answeredBy === 'native') answers.native += 1; else answers.planeGcs += 1;
  if (record.native !== 'answer') answers.fallbacks[record.native] = (answers.fallbacks[record.native] ?? 0) + 1;
  answers.keptGroups += record.keptGroups ?? 0;
  if (input.drag) return;
  // A rescue needs review whatever its cause, including a native instance that failed to load or trapped.
  if (record.answeredBy === 'planegcs' && result.kind === 'solved') {
    if (reviewedRescues.get(expect.getState().currentTestName ?? '') !== record.native) mismatches.push(label(`PlaneGCS solved after native fell back (${record.native})`));
    return;
  }
  if (record.answeredBy !== 'native') return;
  if (!oracle) { mismatches.push(label('PlaneGCS alone failed on input native answered')); return; }
  if (result.kind === 'solved' && oracle.kind !== 'solved') { answers.nativeOnlyImprovements += 1; return; }
  if (result.kind === 'solved' && oracle.kind === 'solved' && result.diagnostics.degreesOfFreedom !== 0) {
    answers.freeSolutions += 1;
    const solved = cadSketchSolvedValues(result.graph), expected = cadSketchSolvedValues(oracle.graph);
    solved.forEach((value, index) => { answers.largestFreeDifference = Math.max(answers.largestFreeDifference, Math.abs(value - expected[index])); });
    const start = cadSketchSolvedValues(parseCadSketchSolveInput(input).graph), movement = (values: readonly number[]) => Math.hypot(...values.map((value, index) => value - start[index]));
    const extra = movement(solved) - movement(expected);
    if (extra > 1e-6) { answers.movedFurther += 1; answers.largestExtraMovement = Math.max(answers.largestExtraMovement, extra);
      answers.movements.push(`${expect.getState().currentTestName}: +${extra.toPrecision(3)}`); }
    else if (extra < -1e-6) answers.movedLess += 1;
  }
  // Rejections that differ from PlaneGCS are diagnosis differences, which the comparison above reviews.
  if (result.kind !== 'solved' && oracle.kind === 'solved') mismatches.push(label(`native rejected (${result.reason}) what PlaneGCS solves`));
}

vi.mock('../../__tests__/cadSketchTestSolver', async importOriginal => {
  const factory = await importOriginal<typeof import('../../__tests__/cadSketchTestSolver')>();
  return { ...factory, createCadSketchTestSolver: (options: Parameters<typeof factory.createCadSketchTestSolver>[0] = {}) => {
    if (options.mode && options.mode !== 'native-first') return factory.createCadSketchTestSolver(options);
    let record: CadSketchSolveRecord | undefined;
    const inner = factory.createCadSketchTestSolver({ ...options, onSolve: solved => { record = solved; options.onSolve?.(solved); } });
    const oracle = factory.createCadSketchTestSolver({ mode: 'planegcs' });
    return { async solve(input: CadSketchSolveInput) {
      // Suites may mutate their input after the call to prove it was captured.
      const captured = structuredClone(input);
      record = undefined;
      const result = await inner.solve(input), solvedRecord = record, expected = await oracle.solve(captured).catch((error: unknown) => {
        mismatches.push(`${expect.getState().currentTestName ?? 'unknown test'}: PlaneGCS alone threw: ${String(error)}`);
        return undefined;
      });
      compareAnswer(captured, result, expected, solvedRecord);
      return result;
    } };
  } };
});

afterAll(() => {
  if (process.env.NATIVE_DIFFERENTIAL_TALLY) console.log(`native-first answers: ${JSON.stringify(answers)}`);
  if (process.env.NATIVE_DIFFERENTIAL_TALLY) console.log(`native differential: ${JSON.stringify(tally)}`);
  expect(mismatches).toEqual([]);
});
