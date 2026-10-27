import { checkCadSketchGraph, type CadSketchGraph, type CadSketchGraphIssue } from '../../../../domain/cad/cadSketchGraph';
import { cadSketchSolverStageClock, type CadSketchSolverStageObserver } from '../cadSketchSolverStages';
import type { CadSketchSolveDiagnostics, CadSketchSolveInput, CadSketchSolveResult } from '../cadSketchSolverTypes';
import { compileCadSketchEquations } from './compileCadSketchEquations';
import { applyCadSketchEquationSolution, cadSketchEquationDiagnostics, cadSketchEquationResidual, type CadSketchEquationModel } from './cadSketchEquationModel';
import type { CadSketchNativeDiagnosis, CadSketchNativeSolution, CadSketchNativeSolver } from './cadSketchNativeSolver';

/** Why the native solver did not answer a solve; PlaneGCS answers it instead while both exist. */
export type CadSketchNativeFallbackReason = 'compile' | 'too-large' | 'unavailable' | 'suspected' | 'start-diagnosis' | 'incomplete'
  | 'unknown-freedom' | 'not-converged' | 'stalled' | 'drag-diagnosis' | 'moved-fixed-value' | 'graph-check';

/**
 * `answer`: a solution, or a definite conflicting or redundant diagnosis of a solve that is not a
 * drag. `fallback`: native cannot answer for it; `own` is native's own result, returned when
 * PlaneGCS does no better: a rejection, the conflicts a stalled sketch's start shows, a solution
 * some group of which was not diagnosed, or for a drag that stalled where its relations are met the
 * solved frame where it stopped. Group counts say how
 * many connected groups native moved and how many of those kept their accepted start values. `drag`
 * is native's drag outcome whenever the input has a drag target.
 */
export type CadSketchNativeAttempt = (
  | { readonly kind: 'answer'; readonly result: CadSketchSolveResult; readonly movedGroups: number; readonly keptGroups: number }
  | { readonly kind: 'fallback'; readonly reason: CadSketchNativeFallbackReason; readonly own?: CadSketchSolveResult }
) & { readonly drag?: CadSketchNativeSolution['drag'] };

const noDiagnostics = (status: CadSketchSolveDiagnostics['status']): CadSketchSolveDiagnostics =>
  ({ status, degreesOfFreedom: null, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] });
const failed = (message: string): CadSketchSolveResult => ({ kind: 'rejected', reason: 'failed', message, diagnostics: noDiagnostics('failed') });
const STALLED_DRAG = 'The point could not be moved toward the target from this start.';

/**
 * Solves already parsed input with the native solver and accepts only what it can answer for:
 * a converged solution, diagnosed with known freedom or with a rank too close to call and nothing
 * found dependent, that keeps fixed values and passes the graph checks, or definite conflicts and
 * redundancies, rejected in the PlaneGCS runtime's order. A drag answers only with a solution whose
 * target was reached, projected or limited. A drag that stalled where its relations are met stopped
 * at feasible values no more singular than its start, but nothing shows it got as close as it
 * could, so that frame, checked as any solution, and a drag's conflicts and redundancies stand
 * only when PlaneGCS does no better; one that stalled elsewhere is not converged. While PlaneGCS is
 * bundled, it is also asked first when native blames a stalled sketch as its start shows, as
 * PlaneGCS does, and when some converged group was not diagnosed, judged as a rank too close to call:
 * native's answer then stands only when PlaneGCS does no better.
 * Projected means native's first- and second-order necessary conditions for a local minimum of the
 * target distance held up to its resolution. That proves neither a local minimum nor the nearest
 * configuration: another solver can end closer, for example on another assembly of a linkage.
 * Errors from `solver` propagate; the caller treats them as a failed native instance.
 * `observe` receives stage timings for benchmarks.
 */
export function attemptCadSketchNativeSolve(input: CadSketchSolveInput, solver: CadSketchNativeSolver, observe?: CadSketchSolverStageObserver): CadSketchNativeAttempt {
  const clock = cadSketchSolverStageClock(observe, 'parseCompile');
  const check: Check = observe ? (graph, parameters) => clock.during('validation', () => checkCadSketchGraph(graph, parameters)) : checkCadSketchGraph;
  try {
    let model: CadSketchEquationModel;
    try { model = compileCadSketchEquations(input); }
    catch (error) { return { kind: 'fallback', reason: 'compile', own: { kind: 'rejected', reason: 'invalid-input', message: error instanceof Error ? error.message : 'Invalid sketch input.', diagnostics: noDiagnostics(null) } }; }
    clock.next('nativeCall');
    const solution = solver.solve(model);
    clock.next('mapping');
    const judged = judge(input, model, solution, check), withheld = WITHHELD[solution.diagnosis.kind];
    const attempt: CadSketchNativeAttempt = withheld && judged.kind === 'answer' ? { kind: 'fallback', reason: withheld, own: judged.result } : judged;
    return solution.drag ? { ...attempt, drag: solution.drag } : attempt;
  } finally { clock.stop(); }
}

type Check = (graph: CadSketchGraph, parameters: CadSketchSolveInput['parameters']) => readonly CadSketchGraphIssue[];

/** Diagnoses whose answers stand only when PlaneGCS does no better, while it is bundled. */
const WITHHELD: Partial<Record<CadSketchNativeDiagnosis['kind'], CadSketchNativeFallbackReason>> = { 'from-start': 'start-diagnosis', incomplete: 'incomplete' };

function judge(input: CadSketchSolveInput, model: CadSketchEquationModel, solution: CadSketchNativeSolution, check: Check): CadSketchNativeAttempt {
  const { diagnosis } = solution, stalled = solution.drag?.outcome === 'stalled';
  if (solution.status === 'too-large') return { kind: 'fallback', reason: 'too-large', own: { kind: 'rejected', reason: 'too-large',
    message: 'A connected group of sketch relations is too large to solve. Split it into separate groups or remove relations.', diagnostics: noDiagnostics(null) } };
  if (diagnosis.kind === 'unavailable') return { kind: 'fallback', reason: 'unavailable', own: failed('The sketch solver could not diagnose these relations.') };
  // A suspected diagnosis is a stall short of a collapsed point, not a proof: it never blames relations.
  if (diagnosis.kind === 'suspected') return { kind: 'fallback', reason: 'suspected', own: failed('Sketch relations could not be met together from this start.') };
  const status = solution.status === 'converged' ? 'success' : 'failed', ids = cadSketchEquationDiagnostics(model, diagnosis.labels);
  // With nothing free, only unmet relations are labelled, each as conflicting, and nothing is free.
  // An uncertain rank, or a group not diagnosed, leaves freedom unknown.
  const uncertain = diagnosis.kind === 'uncertain' || diagnosis.kind === 'incomplete';
  const degreesOfFreedom = diagnosis.kind === 'diagnosed' ? diagnosis.degreesOfFreedom : diagnosis.kind === 'no-unknowns' && !ids.conflictingIds.length ? 0 : null;
  const diagnostics: CadSketchSolveDiagnostics = { ...noDiagnostics(status), degreesOfFreedom, ...ids };
  const unsolved = (reason: CadSketchNativeFallbackReason): CadSketchNativeAttempt => ({ kind: 'fallback', reason,
    own: { kind: 'rejected', reason: 'failed', message: stalled ? STALLED_DRAG : 'The sketch solver did not produce a valid solution.', diagnostics } });
  // Native judges each equation at its own scale and the graph checks at the sketch's, which can be
  // looser far from the origin. With nothing free there is nothing to solve, so the checks decide for
  // each relation: one they accept is not blamed, and issues elsewhere are reported as the checks'.
  if (diagnosis.kind === 'no-unknowns' && ids.conflictingIds.length) {
    const flagged = new Set(check(input.graph, input.parameters).filter(issue => issue.source.kind === 'relation').map(issue => issue.source.id));
    const conflictingIds = ids.conflictingIds.filter(id => flagged.has(id));
    if (!conflictingIds.length) return stalled ? unsolved('not-converged') : solvedAttempt(input, model, solution, { ...noDiagnostics('success'), degreesOfFreedom: 0 }, check);
    return answer({ kind: 'rejected', reason: 'conflicting', message: 'Sketch constraints conflict.', diagnostics: { ...diagnostics, conflictingIds } });
  }
  // A drag is diagnosed where it ends, and its target can land it on a singular configuration (a
  // tangency met exactly) whose rank reads redundant or conflicting where the sketch is not, so for a
  // drag such a rejection stands only when PlaneGCS does no better.
  const definite = (result: CadSketchSolveResult): CadSketchNativeAttempt => solution.drag ? { kind: 'fallback', reason: 'drag-diagnosis', own: result } : answer(result);
  if (ids.conflictingIds.length) return definite({ kind: 'rejected', reason: 'conflicting', message: 'Sketch constraints conflict.', diagnostics });
  if (ids.redundantIds.length || ids.partiallyRedundantIds.length) return definite({ kind: 'rejected', reason: 'redundant', message: 'Sketch constraints are redundant.', diagnostics });
  if (solution.status !== 'converged') return unsolved('not-converged');
  // A converged sketch whose rank was too close to call, as near a tangency, or some group of which
  // was not diagnosed, is solved with its freedom unknown.
  if (degreesOfFreedom === null && !uncertain) return unsolved('unknown-freedom');
  const solved = solvedAttempt(input, model, solution, diagnostics, check, !uncertain);
  return stalled && solved.kind === 'answer' ? { kind: 'fallback', reason: 'stalled', own: solved.result } : solved;
}

function answer(result: CadSketchSolveResult): CadSketchNativeAttempt { return { kind: 'answer', result, movedGroups: 0, keptGroups: 0 }; }

/** The native solver's absolute tolerance for a driver, in each equation's mm or radians. */
const DRIVER_TOLERANCE = 1e-10;

/**
 * A value that moved by at most the driver tolerance, or about one ulp of its start where that is
 * larger, may have moved only by polishing: PlaneGCS leaves residuals of about 1e-12 mm that native
 * polishes away.
 */
const polished = (start: number, value: number) => Math.abs(value - start) <= Math.max(DRIVER_TOLERANCE, 2 * Number.EPSILON * Math.abs(start));

/**
 * The solved graph. Native polishing moves values by ulps even where the start already met every
 * check, and each solver moves the other's solutions, so connected groups that moved only by
 * polishing keep their exact start values when the graph checks accept them: an edit then moves
 * only the geometry it affects, and exact comparisons of untouched geometry (linear pattern
 * ownership, placements) still hold. A group was edited, and takes the solved values, when any of
 * its values moved further, or when its start leaves any of its equations further from met than
 * the solution by more than the driver tolerance: far from the origin a driver edit can move each
 * value by only a few ulps, and the checks' sketch-wide tolerance would accept the old values.
 * A drag moves its point's groups on purpose, however little, so they are never kept.
 * Groups are judged on the native values themselves. Roundoff also leaves exact intent a few ulps
 * off (55 as 54.99999999999999), so short decimals within roundoff are tried first, never in a kept
 * group; the graph checks decide, as for any solution. Rounding can close a near tangency exactly,
 * so it is not tried at all when `snap` is off, for a rank too close to call.
 */
function solvedAttempt(input: CadSketchSolveInput, model: CadSketchEquationModel, solution: CadSketchNativeSolution, diagnostics: CadSketchSolveDiagnostics, check: Check, snap = true): CadSketchNativeAttempt {
  if (!applyCadSketchEquationSolution(input.graph, model, solution.values)) return { kind: 'fallback', reason: 'moved-fixed-value',
    own: { kind: 'rejected', reason: 'invalid-solution', message: 'The sketch solution changed fixed source geometry.', diagnostics } };
  const group = parameterGroups(model), moved = new Set<number>(), edited = new Set<number>();
  solution.values.forEach((value, index) => {
    const start = model.values[index];
    if (Object.is(value, start)) return;
    moved.add(group[index]);
    if (!polished(start, value)) edited.add(group[index]);
  });
  for (const equation of model.equations) if (equation.temporary) for (const operand of equation.operands) if (!model.fixed[operand]) edited.add(group[operand]);
  for (const equation of model.equations) {
    const groups = equation.operands.filter(operand => !model.fixed[operand]).map(operand => group[operand]);
    if (groups.every(id => !moved.has(id) || edited.has(id))) continue;
    const start = Math.abs(cadSketchEquationResidual(equation, model.values)), solved = Math.abs(cadSketchEquationResidual(equation, solution.values));
    if (!(start <= solved + DRIVER_TOLERANCE)) for (const id of groups) edited.add(id);
  }
  const keep = new Set([...moved].filter(id => !edited.has(id)));
  const kept = (values: readonly number[]) => values.map((value, index) => keep.has(group[index]) ? model.values[index] : value);
  const snapped = snap ? shortDecimals(model, solution.values, index => keep.has(group[index])) : undefined;
  const candidates = [snapped && keep.size ? kept(snapped) : undefined, snapped, keep.size ? kept(solution.values) : undefined, solution.values];
  let issues: readonly CadSketchGraphIssue[] = [];
  for (const values of candidates) {
    if (!values) continue;
    const graph = applyCadSketchEquationSolution(input.graph, model, values)!;
    issues = check(graph, input.parameters);
    if (!issues.length) return { kind: 'answer', result: { kind: 'solved', graph, diagnostics }, movedGroups: moved.size, keptGroups: values === solution.values || values === snapped ? 0 : keep.size };
  }
  return { kind: 'fallback', reason: 'graph-check',
    own: { kind: 'rejected', reason: 'invalid-solution', message: 'The sketch solution does not satisfy its geometry and relations.', diagnostics: { ...diagnostics, issues } } };
}

/**
 * Values the solver moved outside kept groups, moved again to the nearest 12-significant-digit
 * decimal when that is within 8 ulps of the value, and to zero when within 8 ulps of the tightest
 * scale among the equations using it (the largest operand magnitude, at least 1 mm); undefined when
 * nothing changes.
 * Values the solver left alone are the caller's intent, even a few ulps from a short decimal far from
 * the origin, and a snap that leaves any equation further from met is undone with the others of that
 * equation, so an exact driver target stays exact. Values that need more digits keep them. No value
 * moves by more than the driver tolerance, so far from the origin, where 8 ulps are larger,
 * rounding cannot close a near tangency of a diagnosed sketch, whose rank holds over about 1e-7 of
 * its size.
 */
function shortDecimals(model: CadSketchEquationModel, values: readonly number[], kept: (index: number) => boolean): number[] | undefined {
  const scale = values.map(() => Infinity);
  for (const equation of model.equations) {
    const size = equation.operands.reduce((largest, operand) => Math.max(largest, Math.abs(values[operand])), 1);
    for (const operand of equation.operands) scale[operand] = Math.min(scale[operand], size);
  }
  const snapped = values.map((value, index) => {
    if (model.fixed[index] || kept(index) || Object.is(value, model.values[index])) return value;
    const short = Math.abs(value) <= 8 * Number.EPSILON * (Number.isFinite(scale[index]) ? scale[index] : 1) ? 0 : Number(value.toPrecision(12));
    return short === value || short !== 0 && Math.abs(short - value) > 8 * Number.EPSILON * Math.abs(value) || Math.abs(short - value) > DRIVER_TOLERANCE ? value : short;
  });
  // Each pass undoes at least one snap, so this ends.
  for (let worse = true; worse;) {
    worse = false;
    for (const equation of model.equations) {
      if (equation.operands.every(operand => Object.is(snapped[operand], values[operand]))) continue;
      const before = Math.abs(cadSketchEquationResidual(equation, values)), after = Math.abs(cadSketchEquationResidual(equation, snapped));
      if (after <= before || Number.isNaN(after) && Number.isNaN(before)) continue;
      for (const operand of equation.operands) snapped[operand] = values[operand];
      worse = true;
    }
  }
  return snapped.some((value, index) => !Object.is(value, values[index])) ? snapped : undefined;
}

/** Connected group of each parameter through the lasting equations' free operands; fixed values never move. */
function parameterGroups(model: CadSketchEquationModel): number[] {
  const parent = model.values.map((_, index) => index);
  const root = (index: number): number => { while (parent[index] !== index) index = parent[index] = parent[parent[index]]; return index; };
  for (const equation of model.equations) {
    if (equation.temporary) continue;
    const free = equation.operands.filter(operand => !model.fixed[operand]);
    for (const operand of free.slice(1)) parent[root(operand)] = root(free[0]);
  }
  return parent.map((_, index) => root(index));
}
