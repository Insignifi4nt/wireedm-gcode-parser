// @vitest-environment node
// Replays the frozen PlaneGCS corpus through the production runtime with the native solver alone, and
// compares each answer with PlaneGCS's on the same input. Needs no PlaneGCS, so it outlives it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cadSketchGraphWithSolvedValues, cadSketchSolvedValues } from '@/domain/cad/cadSketchGraph';
import { createCadSketchNativeFirstRuntime, type CadSketchSolveRecord } from '../cadSketchNativeFirstRuntime';
import type { CadSketchSolveDiagnostics, CadSketchSolveInput, CadSketchSolveResult } from '../cadSketchSolverTypes';
import { compileCadSketchEquations } from '../native/compileCadSketchEquations';
import { loadCadSketchNativeSolver } from '../native/cadSketchNativeSolver';
import {
  corpusDragAllowance, corpusDragDistance, corpusModelHash, corpusSolvedGraph, readPlaneGcsCorpus, type PlaneGcsCorpusOutcome
} from './planeGcsCorpus';

/** Ways native's answer can differ from PlaneGCS's that need review. */
type Difference = 'native-rejects-solved' | 'native-solves-invalid' | 'reason-differs' | 'status-differs' | 'freedom-unknown' | 'freedom-differs'
  | 'ids-differ' | 'issues-differ' | 'geometry-differs' | 'drag-further';

/** Why each reviewed difference is right for native. */
const why = {
  nearTangency: 'Close to a tangency the rank is too close to call: native solves with freedom unknown, where PlaneGCS counts it.',
  releasedOnTangency: 'Released on a tangency, rank is too close to call, so native solves with freedom unknown; the solution is a double root, and native keeps the point where the drag left it, meeting both relations, where PlaneGCS moves it along the tangent by up to 3e-6 of the radius.',
  unmetWithNothingFree: 'With nothing free, native names the unmet relation conflicting; PlaneGCS accepts it and fails the graph check.',
  conflictStatus: 'Relations that conflict cannot all be met, so native reports the solve failed; PlaneGCS reports success for these conflicts, though failed for most others.',
  oppositeDirections: 'Opposite direction relations conflict alone: native names them, PlaneGCS adds a length the conflict stands without.',
  farTinyDirection: 'A tiny line far from the origin cannot meet its direction relation: both reject, native as an invalid solution naming it, PlaneGCS as failed.',
  duplicateCollinear: 'Of two equivalent collinear relations either is redundant: native names the duplicate, PlaneGCS the one it repeats.',
  repeatedDimension: 'A repeated 10 agrees with the first and the conflict stands without it: native names it redundant, PlaneGCS conflicting.',
  impossibleTriangle: 'Native suspects the impossible triangle where it stopped, without naming relations or freedom; PlaneGCS diagnoses it at its start.',
  oversizedFillet: 'An oversized fillet cannot fit and both reject the solution, native for the trim leaving its segment alone, PlaneGCS also for collapsed lines and a tangency missed by 13 mm.',
  fourBarReassembly: 'PlaneGCS reassembles a four-bar dragged out of reach in one jump; native keeps its start assembly, as chained drags do.',
  tangencyStall: 'With nothing free, native stalls at its start on the way to a tangency, where its relations are met; PlaneGCS creeps on.',
  mirroredSmallScale: 'PlaneGCS mirrors the 0.02 mm rectangle beside a 20 mm one across its fixed corner; native keeps the side it started on.'
};

/**
 * A reviewed record: every way native differs, native's answer exactly, and why it stands. A
 * reviewed geometry difference also bounds how far native's solution may be from PlaneGCS's, and a
 * reviewed further drag how far native may end from its target, both in mm.
 */
interface Reviewed { readonly differs: readonly Difference[]; readonly native: string; readonly why: string; readonly geometryMm?: number; readonly dragMm?: number }

/**
 * Reviewed differences, by the start of the input hash. Each must still occur, on exactly one record,
 * with exactly these differences and this native answer, so a reviewed record cannot change unseen.
 */
const reviewed = new Map<string, Reviewed>([
  ['0c97e98a1743e0e9', { differs: ['freedom-unknown'], native: 'solved success dof=?', why: why.nearTangency }],
  ['26342bb96afe7d0c', { differs: ['freedom-unknown'], native: 'solved success dof=?', why: why.nearTangency }],
  ['587cbe30951bc356', { differs: ['freedom-unknown'], native: 'solved success dof=?', why: why.nearTangency }],
  ['6202b39e0c7d9573', { differs: ['freedom-unknown'], native: 'solved success dof=?', why: why.nearTangency }],
  ['63a75ba513550626', { differs: ['freedom-unknown'], native: 'solved success dof=?', why: why.nearTangency }],
  ['644433001546348a', { differs: ['freedom-unknown'], native: 'solved success dof=?', why: why.nearTangency }],
  ['6cd41bb3304392ff', { differs: ['freedom-unknown'], native: 'solved success dof=?', why: why.nearTangency }],
  ['783f9ffd86b1815c', { differs: ['freedom-unknown'], native: 'solved success dof=?', why: why.nearTangency }],
  ['8066ca6e37caafa4', { differs: ['freedom-unknown'], native: 'solved success dof=?', why: why.nearTangency }],
  ['aa27d4e3c83374c4', { differs: ['freedom-unknown'], native: 'solved success dof=?', why: why.nearTangency }],
  ['ba0f14ece316e2d7', { differs: ['freedom-unknown'], native: 'solved success dof=?', why: why.nearTangency }],
  ['d12813a33eec2967', { differs: ['freedom-unknown'], native: 'solved success dof=?', why: why.nearTangency }],
  ['d60b8def0375bf20', { differs: ['freedom-unknown'], native: 'solved success dof=?', why: why.nearTangency }],
  ['df979527d2e0b1a3', { differs: ['freedom-unknown'], native: 'solved success dof=?', why: why.nearTangency }],
  ['e5ab88b68e198369', { differs: ['freedom-unknown'], native: 'solved success dof=?', why: why.nearTangency }],
  ['e6a41fd884982b98', { differs: ['freedom-unknown'], native: 'solved success dof=?', why: why.nearTangency }],
  ['060e6d055d6ee020', { differs: ['freedom-unknown', 'geometry-differs'], native: 'solved success dof=?', why: why.releasedOnTangency, geometryMm: 0.0002822 }],
  ['1df3aae67436520a', { differs: ['freedom-unknown', 'geometry-differs'], native: 'solved success dof=?', why: why.releasedOnTangency, geometryMm: 0.0001220 }],
  ['a9a79893a74fc708', { differs: ['freedom-unknown', 'geometry-differs'], native: 'solved success dof=?', why: why.releasedOnTangency, geometryMm: 0.00002472 }],
  ['1ac1c9c8d31404da', { differs: ['reason-differs', 'status-differs', 'freedom-unknown', 'ids-differ', 'issues-differ'], native: 'conflicting failed dof=? conflicting=mid', why: why.unmetWithNothingFree }],
  ['26d0b45a0b375c2b', { differs: ['reason-differs', 'status-differs', 'freedom-unknown', 'ids-differ', 'issues-differ'], native: 'conflicting failed dof=? conflicting=incompatible-radius', why: why.unmetWithNothingFree }],
  ['308f5e3824425661', { differs: ['reason-differs', 'status-differs', 'freedom-unknown', 'ids-differ', 'issues-differ'], native: 'conflicting failed dof=? conflicting=mid', why: why.unmetWithNothingFree }],
  ['31eef1eb12fb62ef', { differs: ['reason-differs', 'status-differs', 'freedom-unknown', 'ids-differ', 'issues-differ'], native: 'conflicting failed dof=? conflicting=dx', why: why.unmetWithNothingFree }],
  ['5950d008b3f3b54a', { differs: ['reason-differs', 'status-differs', 'freedom-unknown', 'ids-differ', 'issues-differ'], native: 'conflicting failed dof=? conflicting=same', why: why.unmetWithNothingFree }],
  ['b867115762c8f4bd', { differs: ['reason-differs', 'status-differs', 'freedom-unknown', 'ids-differ', 'issues-differ'], native: 'conflicting failed dof=? conflicting=fixedSize', why: why.unmetWithNothingFree }],
  ['c2256ccdb160247c', { differs: ['reason-differs', 'status-differs', 'freedom-unknown', 'ids-differ', 'issues-differ'], native: 'conflicting failed dof=? conflicting=symmetry', why: why.unmetWithNothingFree }],
  ['d631c7f34ab5b335', { differs: ['reason-differs', 'status-differs', 'freedom-unknown', 'ids-differ', 'issues-differ'], native: 'conflicting failed dof=? conflicting=angle', why: why.unmetWithNothingFree }],
  ['e0d0cf56b466f895', { differs: ['reason-differs', 'status-differs', 'freedom-unknown', 'ids-differ', 'issues-differ'], native: 'conflicting failed dof=? conflicting=support', why: why.unmetWithNothingFree }],
  ['eb57f765e6e081df', { differs: ['reason-differs', 'status-differs', 'freedom-unknown', 'ids-differ', 'issues-differ'], native: 'conflicting failed dof=? conflicting=on-guide', why: why.unmetWithNothingFree }],
  ['ee8f14b0caad64e9', { differs: ['reason-differs', 'status-differs', 'freedom-unknown', 'ids-differ', 'issues-differ'], native: 'conflicting failed dof=? conflicting=attempt', why: why.unmetWithNothingFree }],
  ['fbd4fee2894da630', { differs: ['reason-differs', 'status-differs', 'freedom-unknown', 'ids-differ', 'issues-differ'], native: 'conflicting failed dof=? conflicting=tangent', why: why.unmetWithNothingFree }],
  ['04ba32010b405dba', { differs: ['status-differs'], native: 'conflicting failed dof=? conflicting=p-x', why: why.conflictStatus }],
  ['6756a275e4ba3074', { differs: ['status-differs'], native: 'conflicting failed dof=? conflicting=fixedSize', why: why.conflictStatus }],
  ['924ce85760b2ab6e', { differs: ['status-differs'], native: 'conflicting failed dof=? conflicting=conflict', why: why.conflictStatus }],
  ['9a2038e67b790ba2', { differs: ['status-differs'], native: 'conflicting failed dof=? conflicting=p-x', why: why.conflictStatus }],
  ['ce6addd09868be6d', { differs: ['status-differs'], native: 'conflicting failed dof=? conflicting=p-x', why: why.conflictStatus }],
  ['0f3499736aeb3ca3', { differs: ['ids-differ'], native: 'conflicting failed dof=? conflicting=opposite', why: why.oppositeDirections }],
  ['115ee63ef32a83d7', { differs: ['ids-differ'], native: 'conflicting failed dof=? conflicting=opposite', why: why.oppositeDirections }],
  ['bb896bbbe18ba2f5', { differs: ['ids-differ'], native: 'conflicting failed dof=? conflicting=angle,opposite', why: why.oppositeDirections }],
  ['06230b624bf0b537', { differs: ['reason-differs', 'status-differs', 'issues-differ'], native: 'invalid-solution success dof=0 issues=relation:direction:relation-residual', why: why.farTinyDirection }],
  ['bc8f9a5d1e244c27', { differs: ['reason-differs', 'status-differs', 'issues-differ'], native: 'invalid-solution success dof=0 issues=relation:direction:relation-residual', why: why.farTinyDirection }],
  ['4cb7c2cd572f442d', { differs: ['ids-differ'], native: 'redundant success dof=6 redundant=duplicate', why: why.duplicateCollinear }],
  ['e5f86571162fb20a', { differs: ['ids-differ'], native: 'conflicting failed dof=? conflicting=length,other,third redundant=repeat', why: why.repeatedDimension }],
  ['f672e07f6eabed9e', { differs: ['freedom-unknown'], native: 'failed failed dof=?', why: why.impossibleTriangle }],
  ['a39314be63da34a8', { differs: ['issues-differ'], native: 'invalid-solution success dof=0 issues=relation:corner_5:relation-residual,relation:corner_5:relation-residual', why: why.oversizedFillet }],
  ['89463f19e2ca8ac7', { differs: ['drag-further'], native: 'solved success dof=1', why: why.fourBarReassembly, dragMm: 32.53 }],
  ['f815c7400240750c', { differs: ['drag-further'], native: 'solved success dof=1', why: why.fourBarReassembly, dragMm: 32.53 }],
  ['3f672252a867403a', { differs: ['drag-further'], native: 'solved success dof=0', why: why.tangencyStall, dragMm: 7.501e-6 }],
  ['f573371195c8132a', { differs: ['geometry-differs'], native: 'solved success dof=0', why: why.mirroredSmallScale, geometryMm: 0.02001 }]
]);

/** Outcomes that are not differences to review: counted for the record. */
const newTally = () => ({ replayed: 0, solvedAlike: 0, rejectedAlike: 0, wellConstrained: 0, drags: 0, freeSolutions: 0, nativeSolvesRejected: 0,
  nativeSolvesTooLarge: 0, planeGcsThrew: 0, reviewed: 0, largestFreeDifference: 0 });
type Tally = ReturnType<typeof newTally>;

const native = loadCadSketchNativeSolver(readFileSync(new URL('../../../../../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url)));
let record: CadSketchSolveRecord | undefined;
const runtime = createCadSketchNativeFirstRuntime({ mode: 'native-only', loadNative: () => native, onSolve: solved => { record = solved; },
  loadPlaneGcs: () => Promise.reject(new Error('The corpus replays native alone.')) });

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
      if (solved?.native === 'failed' || solved?.native === 'load-failed' || solved?.nativeReset === 'failure') problems.push(`${label}: native failed (${JSON.stringify(solved)})`);
      const found = problem(frozen.hash, input, frozen.outcome, result, tally, seen);
      if (found) problems.push(`${label}: ${found}`);
    }
    for (const key of reviewed.keys()) if (seen.get(key) !== 1) problems.push(`${key}: the reviewed difference occurs on ${seen.get(key) ?? 0} records, not one`);
    if (process.env.PLANEGCS_CORPUS_TALLY) console.log(`PlaneGCS corpus: ${JSON.stringify(tally)}`);
    expect(problems).toEqual([]);
    expect(tally.replayed).toBe(records.length);
  });

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
