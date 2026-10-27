// @vitest-environment node
// Replays the frozen PlaneGCS corpus through the production runtime and compares each answer with
// PlaneGCS's on the same input, as PlaneGCS 1.3.0 gave it before it was removed in 0.0.757.
import { describe, expect, it } from 'vitest';
import { cadSketchGraphWithSolvedValues, cadSketchSolvedValues } from '@/domain/cad/cadSketchGraph';
import { createCadSketchNativeRuntime, type CadSketchSolveRecord } from '../cadSketchNativeRuntime';
import type { CadSketchSolveDiagnostics, CadSketchSolveInput, CadSketchSolveResult } from '../cadSketchSolverTypes';
import { compileCadSketchEquations } from '../native/compileCadSketchEquations';
import {
  corpusDragAllowance, corpusDragDistance, corpusModelHash, corpusSolvedGraph, readPlaneGcsCorpus, type PlaneGcsCorpusOutcome
} from './planeGcsCorpus';
import { reviewedCorpusDifferences as reviewed, type Difference } from './planeGcsCorpusReviewed';
import { loadCadSketchTestNativeSolver } from './cadSketchTestSolver';

/** Outcomes that are not differences to review: counted for the record. */
const newTally = () => ({ replayed: 0, solvedAlike: 0, rejectedAlike: 0, wellConstrained: 0, drags: 0, freeSolutions: 0, nativeSolvesRejected: 0,
  nativeSolvesTooLarge: 0, planeGcsThrew: 0, reviewed: 0, largestFreeDifference: 0 });
type Tally = ReturnType<typeof newTally>;

let record: CadSketchSolveRecord | undefined;
const runtime = createCadSketchNativeRuntime({ loadNative: loadCadSketchTestNativeSolver, onSolve: solved => { record = solved; } });

/** The app accepts PlaneGCS's converged as it does success, which is all native reports for a met solve. */
const status = (diagnostics: CadSketchSolveDiagnostics) => diagnostics.status === 'converged' ? 'success' : diagnostics.status;
const ids = (diagnostics: CadSketchSolveDiagnostics) => JSON.stringify([diagnostics.conflictingIds, diagnostics.redundantIds, diagnostics.partiallyRedundantIds]);
const issues = (diagnostics: CadSketchSolveDiagnostics) => diagnostics.issues.map(issue => `${issue.source.kind}:${issue.source.id}:${issue.code}`);

/** An answer in short: reason or solved, status, freedom, and the ids and issues it names. */
function answer(kind: string, diagnostics: CadSketchSolveDiagnostics) {
  const list = (name: string, values: readonly string[]) => values.length ? [`${name}=${values.join(',')}`] : [];
  return [kind, status(diagnostics), `dof=${diagnostics.degreesOfFreedom ?? '?'}`, ...list('conflicting', diagnostics.conflictingIds),
    ...list('redundant', diagnostics.redundantIds), ...list('partial', diagnostics.partiallyRedundantIds), ...list('issues', issues(diagnostics))].join(' ');
}
const nativeAnswer = (result: CadSketchSolveResult) => answer(result.kind === 'solved' ? 'solved' : result.reason, result.diagnostics);

/** Every way native's answer differs from PlaneGCS's that needs review; none for an answer only counted. */
function differences(input: CadSketchSolveInput, outcome: PlaneGcsCorpusOutcome, result: CadSketchSolveResult, tally: Tally): Difference[] {
  if (outcome.kind === 'threw') { tally.planeGcsThrew += 1; return []; }
  if (outcome.kind === 'rejected' && result.kind === 'solved') {
    if (outcome.reason === 'invalid-input') return ['native-solves-invalid'];
    tally[outcome.reason === 'too-large' ? 'nativeSolvesTooLarge' : 'nativeSolvesRejected'] += 1;
    return [];
  }
  if (outcome.kind === 'solved' && result.kind === 'rejected') return ['native-rejects-solved'];
  const expected = outcome.diagnostics, actual = result.diagnostics, found: Difference[] = [];
  if (result.kind === 'rejected' && result.reason !== outcome.reason) found.push('reason-differs');
  if (status(actual) !== status(expected)) found.push('status-differs');
  if (actual.degreesOfFreedom !== expected.degreesOfFreedom) found.push(actual.degreesOfFreedom === null ? 'freedom-unknown' : 'freedom-differs');
  if (ids(actual) !== ids(expected)) found.push('ids-differ');
  if (issues(actual).join() !== issues(expected).join()) found.push('issues-differ');
  if (result.kind === 'solved') {
    const planeGcs = corpusSolvedGraph(input, outcome)!, values = cadSketchSolvedValues(result.graph);
    if (input.drag) {
      tally.drags += 1;
      if (corpusDragDistance(input, result.graph) > corpusDragDistance(input, planeGcs) + corpusDragAllowance(input, planeGcs)) found.push('drag-further');
    } else if (expected.degreesOfFreedom === 0) {
      tally.wellConstrained += 1;
      if (values.some((value, index) => Math.abs(value - outcome.values![index]) > 1e-8 * Math.max(1, Math.abs(outcome.values![index])))) found.push('geometry-differs');
    } else {
      tally.freeSolutions += 1;
      values.forEach((value, index) => { tally.largestFreeDifference = Math.max(tally.largestFreeDifference, Math.abs(value - outcome.values![index])); });
    }
  }
  if (!found.length) tally[result.kind === 'solved' ? 'solvedAlike' : 'rejectedAlike'] += 1;
  return found;
}

/** How far a native solution is from PlaneGCS's in mm, or a native drag from its target. */
function distances(input: CadSketchSolveInput, outcome: PlaneGcsCorpusOutcome, result: CadSketchSolveResult): { geometryMm?: number; dragMm?: number } {
  if (outcome.kind !== 'solved' || result.kind !== 'solved') return {};
  if (input.drag) return { dragMm: corpusDragDistance(input, result.graph) };
  return { geometryMm: Math.max(0, ...cadSketchSolvedValues(result.graph).map((value, index) => Math.abs(value - outcome.values![index]))) };
}

/** What is wrong with native's answer to one record, if anything: a difference not reviewed, or a reviewed record that changed. */
function problem(hash: string, input: CadSketchSolveInput, outcome: PlaneGcsCorpusOutcome, result: CadSketchSolveResult, tally: Tally, seen: Map<string, number>) {
  const found = differences(input, outcome, result, tally), key = [...reviewed.keys()].find(prefix => hash.startsWith(prefix));
  const planeGcs = outcome.kind === 'threw' ? `threw ${outcome.message}` : answer(outcome.kind === 'solved' ? 'solved' : outcome.reason!, outcome.diagnostics);
  if (key) {
    seen.set(key, (seen.get(key) ?? 0) + 1);
    const entry = reviewed.get(key)!, { geometryMm, dragMm } = distances(input, outcome, result);
    // A bound only where its difference is reviewed, and then met.
    const bounded = (difference: Difference, bound: number | undefined, measured: number | undefined) =>
      entry.differs.includes(difference) ? bound !== undefined && measured !== undefined && measured <= bound : bound === undefined;
    if (entry.differs.join() === found.join() && entry.native === nativeAnswer(result) && bounded('geometry-differs', entry.geometryMm, geometryMm)
      && bounded('drag-further', entry.dragMm, dragMm)) { tally.reviewed += 1; return; }
    const measured = [...geometryMm === undefined ? [] : [`${geometryMm} mm from PlaneGCS's solution (up to ${entry.geometryMm})`],
      ...dragMm === undefined ? [] : [`${dragMm} mm from its target (up to ${entry.dragMm})`]].join(', ');
    return `reviewed as ${entry.differs.join(', ')} with native "${entry.native}", now ${found.join(', ') || 'no difference'} with native "${nativeAnswer(result)}"${measured && ` ${measured}`} (PlaneGCS "${planeGcs}")`;
  }
  if (found.length) return `${found.join(', ')}: native "${nativeAnswer(result)}", PlaneGCS "${planeGcs}"`;
}

describe('the frozen PlaneGCS corpus', () => {
  const { records } = readPlaneGcsCorpus();
  const corpusRecord = (prefix: string) => records.find(({ record: frozen }) => frozen.hash.startsWith(prefix))!;

  it('compiles every input to the model PlaneGCS restated, and answers it natively as PlaneGCS did, except reviewed differences', async () => {
    const problems: string[] = [], seen = new Map<string, number>(), tally = newTally();
    for (const { record: frozen, input } of records) {
      const label = `${frozen.hash.slice(0, 16)} (${frozen.provenance[0]})`;
      let model: string | null = null;
      try { model = corpusModelHash(compileCadSketchEquations(input)); } catch { /* compared below */ }
      if (model !== frozen.model) problems.push(`${label}: native compiles to ${model}, PlaneGCS's restated model was ${frozen.model}`);
      record = undefined;
      const result = await runtime.solve(input), solved = record as CadSketchSolveRecord | undefined;
      tally.replayed += 1;
      if (solved?.native === 'failed' || solved?.native === 'load-failed' || solved?.native === 'incompatible' || solved?.nativeReset === 'failure') problems.push(`${label}: native failed (${JSON.stringify(solved)})`);
      const found = problem(frozen.hash, input, frozen.outcome, result, tally, seen);
      if (found) problems.push(`${label}: ${found}`);
    }
    for (const key of reviewed.keys()) if (seen.get(key) !== 1) problems.push(`${key}: the reviewed difference occurs on ${seen.get(key) ?? 0} records, not one`);
    if (process.env.PLANEGCS_CORPUS_TALLY) console.log(`PlaneGCS corpus: ${JSON.stringify(tally)}`);
    expect(problems).toEqual([]);
    expect(tally.replayed).toBe(records.length);
    // Every record is solved once, about 4 to 6 seconds on a shared CI runner.
  }, 60_000);

  it('fails a reviewed record whose native answer changes, even within its reviewed kind of difference', async () => {
    const { record: frozen, input } = corpusRecord('e5f86571162fb20a'), result = await runtime.solve(input);
    expect(problem(frozen.hash, input, frozen.outcome, result, newTally(), new Map())).toBeUndefined();
    const failed: CadSketchSolveResult = { kind: 'rejected', reason: 'failed', message: 'failed',
      diagnostics: { status: 'failed', degreesOfFreedom: null, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] } };
    expect(problem(frozen.hash, input, frozen.outcome, failed, newTally(), new Map())).toMatch(/now reason-differs, ids-differ with native "failed failed dof=\?"/);
  });

  /** `result` with its dragged point moved `mm` further from the drag target. */
  function draggedFurther(input: CadSketchSolveInput, result: CadSketchSolveResult, mm: number): CadSketchSolveResult {
    if (result.kind !== 'solved' || !input.drag) throw new Error('The record is a solved drag.');
    const { pointId, position: [x, y] } = input.drag, [atX, atY] = result.graph.points.find(point => point.id === pointId)!.position as readonly [number, number];
    const away = Math.hypot(atX - x, atY - y), [alongX, alongY] = away ? [(atX - x) / away, (atY - y) / away] : [1, 0];
    return { ...result, graph: { ...result.graph, points: result.graph.points.map(point => point.id === pointId
      ? { ...point, position: [atX + alongX * mm, atY + alongY * mm] as const } : point) } };
  }

  it('fails a drag that ends further than PlaneGCS on a record reviewed for another difference', async () => {
    const { record: frozen, input } = corpusRecord('0c97e98a1743e0e9'), result = await runtime.solve(input);
    expect(problem(frozen.hash, input, frozen.outcome, result, newTally(), new Map())).toBeUndefined();
    expect(problem(frozen.hash, input, frozen.outcome, draggedFurther(input, result, 1e-5), newTally(), new Map())).toMatch(/now freedom-unknown, drag-further/);
  });

  it('fails a reviewed geometry difference or further drag that grows past its bound', async () => {
    const mirrored = corpusRecord('f573371195c8132a'), solved = await runtime.solve(mirrored.input);
    if (solved.kind !== 'solved') throw new Error('The record solves.');
    const moved = { ...solved, graph: cadSketchGraphWithSolvedValues(solved.graph, cadSketchSolvedValues(solved.graph).map(value => value + 1)) };
    expect(problem(mirrored.record.hash, mirrored.input, mirrored.record.outcome, solved, newTally(), new Map())).toBeUndefined();
    expect(problem(mirrored.record.hash, mirrored.input, mirrored.record.outcome, moved, newTally(), new Map())).toMatch(/now geometry-differs .* 1\.0\d* mm from PlaneGCS's solution \(up to 0\.02001\)/);
    const fourBar = corpusRecord('89463f19e2ca8ac7'), dragged = await runtime.solve(fourBar.input);
    expect(problem(fourBar.record.hash, fourBar.input, fourBar.record.outcome, dragged, newTally(), new Map())).toBeUndefined();
    expect(problem(fourBar.record.hash, fourBar.input, fourBar.record.outcome, draggedFurther(fourBar.input, dragged, .1), newTally(), new Map()))
      .toMatch(/now drag-further .* 32\.6\d* mm from its target \(up to 32\.53\)/);
  });

  it('fails an input PlaneGCS refused as invalid that native no longer refuses alike', async () => {
    const refused = records.find(({ record: frozen }) => frozen.outcome.kind === 'rejected' && frozen.outcome.reason === 'invalid-input')!;
    const result = await runtime.solve(refused.input);
    expect(problem(refused.record.hash, refused.input, refused.record.outcome, result, newTally(), new Map())).toBeUndefined();
    const failed = { ...result, reason: 'failed' } as CadSketchSolveResult;
    const solved: CadSketchSolveResult = { kind: 'solved', graph: refused.input.graph, diagnostics: { ...result.diagnostics, status: 'success', degreesOfFreedom: 0 } };
    expect(problem(refused.record.hash, refused.input, refused.record.outcome, failed, newTally(), new Map())).toMatch(/^reason-differs:/);
    expect(problem(refused.record.hash, refused.input, refused.record.outcome, solved, newTally(), new Map())).toMatch(/^native-solves-invalid:/);
  });
});
