import { checkCadSketchGraph, type CadSketchGraph, type CadSketchGraphIssue } from '../../../../domain/cad/cadSketchGraph';
import { cadSketchEntityPointIds, cadSketchRelationEntityIds, cadSketchRelationPointIds } from '../../../../domain/cad/cadSketchGraphReferences';
import type { CadSketchSolveDiagnostics, CadSketchSolveInput, CadSketchSolveResult } from '../cadSketchSolverTypes';
import { compileCadSketchEquations } from './compileCadSketchEquations';
import { applyCadSketchEquationSolution, cadSketchEquationDiagnostics, type CadSketchEquationModel } from './cadSketchEquationModel';
import type { CadSketchNativeSolution, CadSketchNativeSolver } from './cadSketchNativeSolver';

/** Why the native solver did not answer a solve; PlaneGCS answers it instead while both exist. */
export type CadSketchNativeFallbackReason = 'drag' | 'compile' | 'too-large' | 'unavailable' | 'suspected' | 'unknown-freedom'
  | 'not-converged' | 'moved-fixed-value' | 'graph-check';

/**
 * `answer`: a solution, or a definite conflicting or redundant diagnosis. `fallback`: native cannot
 * answer; `rejection` is its own result, returned when PlaneGCS does no better. Group counts say how
 * many connected groups native moved and how many of those kept their accepted start values.
 */
export type CadSketchNativeAttempt =
  | { readonly kind: 'answer'; readonly result: CadSketchSolveResult; readonly movedGroups: number; readonly keptGroups: number }
  | { readonly kind: 'fallback'; readonly reason: CadSketchNativeFallbackReason; readonly rejection?: CadSketchSolveResult };

const noDiagnostics = (status: CadSketchSolveDiagnostics['status']): CadSketchSolveDiagnostics =>
  ({ status, degreesOfFreedom: null, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] });
const failed = (message: string): CadSketchSolveResult => ({ kind: 'rejected', reason: 'failed', message, diagnostics: noDiagnostics('failed') });

/**
 * Solves already parsed input with the native solver and accepts only what it can answer for:
 * a converged, fully diagnosed solution with known freedom that keeps fixed values and passes the
 * graph checks, or definite conflicts and redundancies, rejected in the PlaneGCS runtime's order.
 * Errors from `solver` propagate; the caller treats them as a failed native instance.
 */
export function attemptCadSketchNativeSolve(input: CadSketchSolveInput, solver: CadSketchNativeSolver): CadSketchNativeAttempt {
  if (input.drag) return { kind: 'fallback', reason: 'drag' };
  let model: CadSketchEquationModel;
  try { model = compileCadSketchEquations(input); }
  catch (error) { return { kind: 'fallback', reason: 'compile', rejection: { kind: 'rejected', reason: 'invalid-input', message: error instanceof Error ? error.message : 'Invalid sketch input.', diagnostics: noDiagnostics(null) } }; }
  const solution = solver.solve(model), { diagnosis } = solution;
  if (solution.status === 'too-large') return { kind: 'fallback', reason: 'too-large', rejection: { kind: 'rejected', reason: 'too-large',
    message: 'A connected group of sketch relations is too large to solve. Split it into separate groups or remove relations.', diagnostics: noDiagnostics(null) } };
  if (diagnosis.kind === 'unavailable') return { kind: 'fallback', reason: 'unavailable', rejection: failed('The sketch solver could not diagnose these relations.') };
  // A suspected diagnosis is a stall short of a collapsed point, not a proof: it never blames relations.
  if (diagnosis.kind === 'suspected') return { kind: 'fallback', reason: 'suspected', rejection: failed('Sketch relations could not be met together from this start.') };
  const status = solution.status === 'converged' ? 'success' : 'failed', ids = cadSketchEquationDiagnostics(model, diagnosis.labels);
  // With nothing free, only unmet relations are labelled, each as conflicting, and nothing is free.
  const degreesOfFreedom = diagnosis.kind === 'diagnosed' ? diagnosis.degreesOfFreedom : ids.conflictingIds.length ? null : 0;
  const diagnostics: CadSketchSolveDiagnostics = { ...noDiagnostics(status), degreesOfFreedom, ...ids };
  if (ids.conflictingIds.length) return answer({ kind: 'rejected', reason: 'conflicting', message: 'Sketch constraints conflict.', diagnostics });
  if (ids.redundantIds.length || ids.partiallyRedundantIds.length) return answer({ kind: 'rejected', reason: 'redundant', message: 'Sketch constraints are redundant.', diagnostics });
  const unsolved = (reason: CadSketchNativeFallbackReason): CadSketchNativeAttempt => ({ kind: 'fallback', reason,
    rejection: { kind: 'rejected', reason: 'failed', message: 'The sketch solver did not produce a valid solution.', diagnostics } });
  if (solution.status !== 'converged') return unsolved('not-converged');
  if (degreesOfFreedom === null) return unsolved('unknown-freedom');
  return solvedAttempt(input, model, solution, diagnostics);
}

function answer(result: CadSketchSolveResult): CadSketchNativeAttempt { return { kind: 'answer', result, movedGroups: 0, keptGroups: 0 }; }

/**
 * The solved graph. Native polishing moves values by ulps even where the start already met every
 * check, and each solver moves the other's solutions, so connected groups whose start was already
 * accepted keep their exact start values: an edit then moves only the geometry it affects, and
 * exact comparisons of untouched geometry (linear pattern ownership, placements) still hold.
 * Roundoff also leaves exact intent a few ulps off (55 as 54.99999999999999), so short decimals
 * within roundoff are tried first; the graph checks decide, as for any solution.
 */
function solvedAttempt(input: CadSketchSolveInput, model: CadSketchEquationModel, solution: CadSketchNativeSolution, diagnostics: CadSketchSolveDiagnostics): CadSketchNativeAttempt {
  if (!applyCadSketchEquationSolution(input.graph, model, solution.values)) return { kind: 'fallback', reason: 'moved-fixed-value',
    rejection: { kind: 'rejected', reason: 'invalid-solution', message: 'The sketch solution changed fixed source geometry.', diagnostics } };
  const group = parameterGroups(model), check = (graph: CadSketchGraph) => checkCadSketchGraph(graph, input.parameters);
  let startIssues: readonly CadSketchGraphIssue[] | undefined;
  const solvedWith = (values: readonly number[]): CadSketchNativeAttempt | readonly CadSketchGraphIssue[] => {
    const moved = new Set<number>();
    values.forEach((value, index) => { if (!Object.is(value, model.values[index])) moved.add(group[index]); });
    const solved = (graph: CadSketchGraph, keptGroups: number): CadSketchNativeAttempt => ({ kind: 'answer', result: { kind: 'solved', graph, diagnostics }, movedGroups: moved.size, keptGroups });
    if (moved.size) {
      const dirty = issueGroups(input.graph, model, group, startIssues ??= check(input.graph)), kept = [...moved].filter(id => !dirty.has(id));
      if (kept.length) {
        const keep = new Set(kept), graph = applyCadSketchEquationSolution(input.graph, model, values.map((value, index) => keep.has(group[index]) ? model.values[index] : value))!;
        if (!check(graph).length) return solved(graph, kept.length);
      }
    }
    const graph = applyCadSketchEquationSolution(input.graph, model, values)!, issues = check(graph);
    return issues.length ? issues : solved(graph, 0);
  };
  const snapped = shortDecimals(model, solution.values), first = snapped && solvedWith(snapped);
  if (first && 'kind' in first) return first;
  const result = solvedWith(solution.values);
  return 'kind' in result ? result : { kind: 'fallback', reason: 'graph-check',
    rejection: { kind: 'rejected', reason: 'invalid-solution', message: 'The sketch solution does not satisfy its geometry and relations.', diagnostics: { ...diagnostics, issues: result } } };
}

/**
 * Free values moved to the nearest 12-significant-digit decimal when that is within 8 ulps, and to
 * zero within 8 ulps of the sketch's largest value; undefined when nothing changes. Values that need
 * more digits keep them.
 */
function shortDecimals(model: CadSketchEquationModel, values: readonly number[]): number[] | undefined {
  const zero = 8 * Number.EPSILON * values.reduce((largest, value) => Math.max(largest, Math.abs(value)), 1);
  let changed = false;
  const snapped = values.map((value, index) => {
    if (model.fixed[index]) return value;
    const short = Math.abs(value) <= zero ? 0 : Number(value.toPrecision(12));
    if (short === value || short !== 0 && Math.abs(short - value) > 8 * Number.EPSILON * Math.abs(value)) return value;
    changed = true;
    return short;
  });
  return changed ? snapped : undefined;
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

/** Groups holding any value that an input issue's point, entity or relation reaches. */
function issueGroups(graph: CadSketchGraph, model: CadSketchEquationModel, group: readonly number[], issues: readonly CadSketchGraphIssue[]): Set<number> {
  const dirty = new Set<number>();
  if (!issues.length) return dirty;
  const entities = new Map(graph.entities.map(entity => [entity.id, entity])), relations = new Map(graph.relations.map(relation => [relation.id, relation]));
  const point = (id: string) => { const index = model.pointParameters.get(id); if (index !== undefined) dirty.add(group[index]).add(group[index + 1]); };
  const entity = (id: string) => {
    const item = entities.get(id); if (!item) return;
    cadSketchEntityPointIds(item).forEach(point);
    const radius = model.radiusParameters.get(id); if (radius !== undefined) dirty.add(group[radius]);
  };
  for (const { source } of issues) {
    if (source.kind === 'point') point(source.id);
    else if (source.kind === 'entity') entity(source.id);
    else {
      const relation = relations.get(source.id);
      if (relation) { cadSketchRelationPointIds(graph, relation).forEach(point); cadSketchRelationEntityIds(relation).forEach(entity); }
    }
    for (const equation of model.equations) if (equation.sourceId === source.id) equation.operands.forEach(operand => dirty.add(group[operand]));
  }
  return dirty;
}
