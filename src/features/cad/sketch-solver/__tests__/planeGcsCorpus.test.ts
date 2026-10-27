// @vitest-environment node
// Replays the frozen PlaneGCS corpus through the production runtime with the native solver alone, and
// compares each answer with PlaneGCS's on the same input. Needs no PlaneGCS, so it outlives it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cadSketchSolvedValues } from '@/domain/cad/cadSketchGraph';
import { createCadSketchNativeFirstRuntime, type CadSketchSolveRecord } from '../cadSketchNativeFirstRuntime';
import type { CadSketchSolveInput, CadSketchSolveResult } from '../cadSketchSolverTypes';
import { compileCadSketchEquations } from '../native/compileCadSketchEquations';
import { loadCadSketchNativeSolver } from '../native/cadSketchNativeSolver';
import {
  corpusDragAllowance, corpusDragDistance, corpusModelHash, corpusSolvedGraph, readPlaneGcsCorpus, type PlaneGcsCorpusOutcome
} from './planeGcsCorpus';

/** Differences from PlaneGCS that need review, by kind. */
type Difference = 'native-rejects-solved' | 'diagnosis-differs' | 'freedom-unknown' | 'freedom-differs' | 'geometry-differs' | 'drag-further';

/** Why each reviewed difference is right for native. */
const why = {
  nearTangency: 'Close to a tangency the rank is too close to call: native solves with freedom unknown, where PlaneGCS counts it.',
  unmetWithNothingFree: 'With nothing free, native names the unmet relation conflicting; PlaneGCS accepts it and fails the graph check.',
  oppositeDirections: 'Opposite direction relations conflict alone: native names them, PlaneGCS adds a length the conflict stands without.',
  farTinyDirection: 'A tiny line far from the origin cannot meet its direction relation: both reject, native as an invalid solution naming it, PlaneGCS as failed.',
  duplicateCollinear: 'Of two equivalent collinear relations either is redundant: native names the duplicate, PlaneGCS the one it repeats.',
  repeatedDimension: 'A repeated 10 agrees with the first and the conflict stands without it: native names it redundant, PlaneGCS conflicting.',
  impossibleTriangle: 'Native suspects the impossible triangle where it stopped, without naming relations or freedom; PlaneGCS diagnoses it at its start.',
  fourBarReassembly: 'PlaneGCS reassembles a four-bar dragged out of reach in one jump; native keeps its start assembly, as chained drags do.',
  tangencyStall: 'With nothing free, native stalls at its start on the way to a tangency, where its relations are met; PlaneGCS creeps on.',
  mirroredSmallScale: 'PlaneGCS mirrors the 0.02 mm rectangle beside a 20 mm one across its fixed corner; native keeps the side it started on.'
};

/**
 * Reviewed differences, by the start of the input hash, with what differs and why native's answer is
 * right. Each one must still occur, so the list cannot go stale.
 */
const reviewed = new Map<string, readonly [Difference, string]>([
  ['060e6d055d6ee020', ['freedom-unknown', why.nearTangency]],
  ['0c97e98a1743e0e9', ['freedom-unknown', why.nearTangency]],
  ['1df3aae67436520a', ['freedom-unknown', why.nearTangency]],
  ['26342bb96afe7d0c', ['freedom-unknown', why.nearTangency]],
  ['587cbe30951bc356', ['freedom-unknown', why.nearTangency]],
  ['6202b39e0c7d9573', ['freedom-unknown', why.nearTangency]],
  ['63a75ba513550626', ['freedom-unknown', why.nearTangency]],
  ['644433001546348a', ['freedom-unknown', why.nearTangency]],
  ['6cd41bb3304392ff', ['freedom-unknown', why.nearTangency]],
  ['783f9ffd86b1815c', ['freedom-unknown', why.nearTangency]],
  ['8066ca6e37caafa4', ['freedom-unknown', why.nearTangency]],
  ['a9a79893a74fc708', ['freedom-unknown', why.nearTangency]],
  ['aa27d4e3c83374c4', ['freedom-unknown', why.nearTangency]],
  ['ba0f14ece316e2d7', ['freedom-unknown', why.nearTangency]],
  ['d12813a33eec2967', ['freedom-unknown', why.nearTangency]],
  ['d60b8def0375bf20', ['freedom-unknown', why.nearTangency]],
  ['df979527d2e0b1a3', ['freedom-unknown', why.nearTangency]],
  ['e5ab88b68e198369', ['freedom-unknown', why.nearTangency]],
  ['e6a41fd884982b98', ['freedom-unknown', why.nearTangency]],
  ['1ac1c9c8d31404da', ['diagnosis-differs', why.unmetWithNothingFree]],
  ['26d0b45a0b375c2b', ['diagnosis-differs', why.unmetWithNothingFree]],
  ['308f5e3824425661', ['diagnosis-differs', why.unmetWithNothingFree]],
  ['31eef1eb12fb62ef', ['diagnosis-differs', why.unmetWithNothingFree]],
  ['5950d008b3f3b54a', ['diagnosis-differs', why.unmetWithNothingFree]],
  ['b867115762c8f4bd', ['diagnosis-differs', why.unmetWithNothingFree]],
  ['c2256ccdb160247c', ['diagnosis-differs', why.unmetWithNothingFree]],
  ['d631c7f34ab5b335', ['diagnosis-differs', why.unmetWithNothingFree]],
  ['e0d0cf56b466f895', ['diagnosis-differs', why.unmetWithNothingFree]],
  ['eb57f765e6e081df', ['diagnosis-differs', why.unmetWithNothingFree]],
  ['ee8f14b0caad64e9', ['diagnosis-differs', why.unmetWithNothingFree]],
  ['fbd4fee2894da630', ['diagnosis-differs', why.unmetWithNothingFree]],
  ['0f3499736aeb3ca3', ['diagnosis-differs', why.oppositeDirections]],
  ['115ee63ef32a83d7', ['diagnosis-differs', why.oppositeDirections]],
  ['bb896bbbe18ba2f5', ['diagnosis-differs', why.oppositeDirections]],
  ['06230b624bf0b537', ['diagnosis-differs', why.farTinyDirection]],
  ['bc8f9a5d1e244c27', ['diagnosis-differs', why.farTinyDirection]],
  ['4cb7c2cd572f442d', ['diagnosis-differs', why.duplicateCollinear]],
  ['e5f86571162fb20a', ['diagnosis-differs', why.repeatedDimension]],
  ['f672e07f6eabed9e', ['diagnosis-differs', why.impossibleTriangle]],
  ['89463f19e2ca8ac7', ['drag-further', why.fourBarReassembly]],
  ['f815c7400240750c', ['drag-further', why.fourBarReassembly]],
  ['3f672252a867403a', ['drag-further', why.tangencyStall]],
  ['f573371195c8132a', ['geometry-differs', why.mirroredSmallScale]]
]);

/** Outcomes that are not differences to review: counted for the record. */
const tally = { replayed: 0, solvedAlike: 0, rejectedAlike: 0, wellConstrained: 0, drags: 0, freeSolutions: 0, nativeSolvesRejected: 0,
  planeGcsRefused: 0, planeGcsThrew: 0, largestFreeDifference: 0 };

const native = loadCadSketchNativeSolver(readFileSync(new URL('../../../../../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url)));
let record: CadSketchSolveRecord | undefined;
const runtime = createCadSketchNativeFirstRuntime({ mode: 'native-only', loadNative: () => native, onSolve: solved => { record = solved; },
  loadPlaneGcs: () => Promise.reject(new Error('The corpus replays native alone.')) });

const diagnosis = (diagnostics: CadSketchSolveResult['diagnostics']) =>
  JSON.stringify([diagnostics.degreesOfFreedom, diagnostics.conflictingIds, diagnostics.redundantIds, diagnostics.partiallyRedundantIds]);

/** How native's answer differs from PlaneGCS's, if it does in a way that needs review. */
function difference(input: CadSketchSolveInput, outcome: PlaneGcsCorpusOutcome, result: CadSketchSolveResult): Difference | undefined {
  if (outcome.kind === 'threw') { tally.planeGcsThrew += 1; return; }
  if (outcome.kind === 'rejected' && (outcome.reason === 'invalid-input' || outcome.reason === 'too-large')) { tally.planeGcsRefused += 1; return; }
  if (outcome.kind === 'rejected') {
    if (result.kind === 'solved') { tally.nativeSolvesRejected += 1; return; }
    if (result.reason === outcome.reason && diagnosis(result.diagnostics) === diagnosis(outcome.diagnostics)) { tally.rejectedAlike += 1; return; }
    return 'diagnosis-differs';
  }
  if (result.kind !== 'solved') return 'native-rejects-solved';
  const expected = outcome.diagnostics.degreesOfFreedom, actual = result.diagnostics.degreesOfFreedom;
  if (actual !== expected) return actual === null ? 'freedom-unknown' : 'freedom-differs';
  const planeGcs = corpusSolvedGraph(input, outcome)!;
  if (input.drag) {
    tally.drags += 1;
    if (corpusDragDistance(input, result.graph) > corpusDragDistance(input, planeGcs) + corpusDragAllowance(input, planeGcs)) return 'drag-further';
  } else if (expected === 0) {
    tally.wellConstrained += 1;
    const values = cadSketchSolvedValues(result.graph);
    if (values.some((value, index) => Math.abs(value - outcome.values![index]) > 1e-8 * Math.max(1, Math.abs(outcome.values![index])))) return 'geometry-differs';
  } else {
    tally.freeSolutions += 1;
    cadSketchSolvedValues(result.graph).forEach((value, index) => { tally.largestFreeDifference = Math.max(tally.largestFreeDifference, Math.abs(value - outcome.values![index])); });
  }
  tally.solvedAlike += 1;
}

describe('the frozen PlaneGCS corpus', () => {
  it('compiles every input to the model PlaneGCS restated, and answers it natively as PlaneGCS did, except reviewed differences', async () => {
    const { records } = readPlaneGcsCorpus(), problems: string[] = [], seen = new Set<string>();
    for (const { record: frozen, input } of records) {
      const label = `${frozen.hash.slice(0, 16)} (${frozen.provenance[0]})`;
      let model: string | null = null;
      try { model = corpusModelHash(compileCadSketchEquations(input)); } catch { /* compared below */ }
      if (model !== frozen.model) problems.push(`${label}: native compiles to ${model}, PlaneGCS's restated model was ${frozen.model}`);
      record = undefined;
      const result = await runtime.solve(input), solved = record as CadSketchSolveRecord | undefined;
      tally.replayed += 1;
      if (solved?.native === 'failed' || solved?.native === 'load-failed' || solved?.nativeReset === 'failure') problems.push(`${label}: native failed (${JSON.stringify(solved)})`);
      const found = difference(input, frozen.outcome, result);
      if (!found) continue;
      const key = [...reviewed.keys()].find(prefix => frozen.hash.startsWith(prefix));
      if (key && reviewed.get(key)![0] === found) { seen.add(key); continue; }
      problems.push(`${label}: ${found}: native ${JSON.stringify(result.kind === 'solved' ? { solved: result.diagnostics } : { [result.reason]: result.diagnostics })}, PlaneGCS ${JSON.stringify({ ...frozen.outcome, values: undefined })}`);
    }
    for (const key of reviewed.keys()) if (!seen.has(key)) problems.push(`${key}: the reviewed difference no longer occurs`);
    if (process.env.PLANEGCS_CORPUS_TALLY) console.log(`PlaneGCS corpus: ${JSON.stringify(tally)}`);
    expect(problems).toEqual([]);
    expect(tally.replayed).toBe(records.length);
  });
});
