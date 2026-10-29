// @vitest-environment node
// Every native call the app makes on the frozen corpus, on seeded sketches and in the solver
// benchmarks, asked again of the module the baseline names. Every answer must be the baseline's, bit
// for bit, except where a change since meant it to differ: from 0.0.760, a group solved through the
// classes its simple equalities hold may move its values to roundoff and take other iterations (see
// `nativeEliminationDifferences`).
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createCadSolverWorkloadCases } from '../../../benchmark/cadSolverWorkloadCases';
import { createCadBenchmarkRuntime } from '../../../benchmark/cadSolverBenchmarkAdapters';
import { measureCadSolverDrag, measureCadSolverDragSweep, measureCadSolverEdits, measureCadSolverWorkload } from '../../../benchmark/cadSolverWorkloadBenchmark';
import { createCadSketchNativeRuntime } from '../../cadSketchNativeRuntime';
import type { CadSketchSolveInput } from '../../cadSketchSolverTypes';
import { createCadSketchFuzzCase } from '../../__tests__/cadSketchFuzz';
import { loadCadSketchTestNativeSolver } from '../../__tests__/cadSketchTestSolver';
import { corpusInput, corpusModelHash, readPlaneGcsCorpus } from '../../__tests__/planeGcsCorpus';
import type { CadSketchEquationModel } from '../cadSketchEquationModel';
import { CadSketchNativeProtocolError, loadCadSketchNativeSolver, type CadSketchNativeSolution } from '../cadSketchNativeSolver';
import { answerNatively, loadNativeBaselineSolver, loadPairedWithBaseline, nativeAnswerDifferences, nativeBaselineBytes, nativeBaselineManifest, nativeEliminationDifferences, nativeValueMove, recordNativeCalls, type NativeAnswer } from './nativeBaseline';

// The benchmarks' calls are compared here, not timed, so their CPU calibration is skipped.
vi.mock('../../../benchmark/cadBenchmark', async original => ({ ...await original<typeof import('../../../benchmark/cadBenchmark')>(), cadBenchmarkCpuCalibrationMs: () => 1 }));

const MIXED_SEEDS = 150, EQUALITY_SEEDS = 300;

/** The corpus, then each seeded generator's roles, every distinct input once. */
function comparedInputs() {
  const list = readPlaneGcsCorpus().records.map(({ record, input }) => ({ label: `corpus ${record.hash.slice(0, 16)}`, input }));
  for (const [mode, seeds] of [['mixed', MIXED_SEEDS], ['equalities', EQUALITY_SEEDS]] as const) for (let seed = 1; seed <= seeds; seed++) {
    const fuzz = createCadSketchFuzzCase(seed, mode);
    for (const role of ['witness', 'perturbed', 'drag', 'reachable'] as const) list.push({ label: `${mode} ${seed} ${role}`, input: fuzz[role] });
    list.push({ label: `${mode} ${seed} contradiction`, input: fuzz.contradiction.input });
  }
  const seen = new Set<string>();
  return list.filter(({ input }) => { const hash = corpusInput(input).hash; return !seen.has(hash) && seen.add(hash); });
}

/**
 * A loader whose instances are compared with the baseline's, call by call, under the current label,
 * counting the calls answered differently as elimination allows and the largest value move.
 */
function comparison() {
  const parts = new Map<string, number>(), examples: string[] = [];
  const state = { label: '', calls: 0, eliminated: 0, largestMove: 0 };
  const loadNative = loadPairedWithBaseline(loadCadSketchTestNativeSolver, (model, baseline, current) => {
    state.calls += 1;
    const found = nativeEliminationDifferences(model, baseline, current);
    if (!found.length && nativeAnswerDifferences(baseline, current).length && 'solution' in baseline && 'solution' in current) {
      state.eliminated += 1;
      state.largestMove = Math.max(state.largestMove, nativeValueMove(baseline.solution.values, current.solution.values));
    }
    for (const part of found) parts.set(part, (parts.get(part) ?? 0) + 1);
    if (found.length && examples.length < 20) examples.push(`${state.label}, model ${corpusModelHash(model).slice(0, 16)}: ${found.join(', ')}`);
  });
  return { loadNative, state, differences: () => ({ parts: Object.fromEntries(parts), examples }) };
}

describe(`native answers against the ${nativeBaselineManifest.appVersion} baseline module`, () => {
  it('keeps the baseline module its manifest names', () => {
    expect(nativeBaselineBytes().length).toBe(nativeBaselineManifest.bytes);
    expect(() => nativeBaselineBytes({ ...nativeBaselineManifest, sha256: '0'.repeat(64) })).toThrow('is not the module its manifest names');
  });

  it('asks the baseline in its own protocol, which has no point to line distance', async () => {
    const model = (equations: CadSketchEquationModel['equations']): CadSketchEquationModel =>
      ({ values: [0, 0, 10, 0, 3, 4], fixed: [true, true, true, true, false, false], pointParameters: new Map(), radiusParameters: new Map(), equations });
    const held = model([{ kind: 'distance', operands: [0, 1, 4, 5], value: 6, sourceId: 'span', tag: 0 }]);
    const answer = answerNatively(await loadNativeBaselineSolver(), held);
    expect(answer).toMatchObject({ solution: { status: 'converged' } });
    expect(answerNatively(await loadNativeBaselineSolver(), model([{ kind: 'point-line-distance', operands: [4, 5, 0, 1, 2, 3], value: 6, sourceId: 'gap', tag: 0 }])))
      .toEqual({ error: 'The native sketch solver rejected its input.' });
    const current = await loadCadSketchTestNativeSolver();
    expect(answerNatively(current, held)).toEqual(answer);
    const replied = await loadCadSketchNativeSolver(readFileSync(new URL('../../../../../../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url)), undefined, nativeBaselineManifest.protocol);
    expect(() => replied.solve(held)).toThrow(CadSketchNativeProtocolError);
  });

  it('tells answers apart by any bit of any part', () => {
    const solution: CadSketchNativeSolution = { status: 'converged', iterations: 3, residual: 1e-14, values: [0, 1.5, Number.NaN],
      diagnosis: { kind: 'diagnosed', degreesOfFreedom: 2, labels: [0, 1] }, drag: { outcome: 'reached', targetDistance: 0 } };
    const answer = (change: Partial<CadSketchNativeSolution> = {}): NativeAnswer => ({ solution: { ...solution, ...change } });
    expect(nativeAnswerDifferences(answer(), answer({ values: [0, 1.5, Number.NaN] }))).toEqual([]);
    expect(nativeAnswerDifferences(answer(), answer({ values: [-0, 1.5, Number.NaN] }))).toEqual(['values']);
    expect(nativeAnswerDifferences(answer(), answer({ values: [0, 1.5 + 2 ** -52, Number.NaN] }))).toEqual(['values']);
    expect(nativeAnswerDifferences(answer(), answer({ diagnosis: { kind: 'diagnosed', degreesOfFreedom: 2, labels: [0, 2] } }))).toEqual(['labels']);
    expect(nativeAnswerDifferences(answer(), answer({ diagnosis: { kind: 'diagnosed', degreesOfFreedom: null, labels: [0, 1] } }))).toEqual(['freedom']);
    expect(nativeAnswerDifferences(answer(), answer({ diagnosis: { kind: 'uncertain', labels: [0, 1] } }))).toEqual(['diagnosis', 'freedom']);
    expect(nativeAnswerDifferences(answer(), answer({ drag: { outcome: 'projected', targetDistance: 1e-300 } }))).toEqual(['drag', 'target-distance']);
    expect(nativeAnswerDifferences(answer(), answer({ status: 'not-converged', iterations: 4, residual: 2e-14 }))).toEqual(['status', 'iterations', 'residual']);
    expect(nativeAnswerDifferences({ error: 'trap' }, answer())).toEqual(['error']);
    expect(nativeAnswerDifferences({ error: 'trap' }, { error: 'trap' })).toEqual([]);
  });

  it('lets elimination move values to roundoff and change iterations, and nothing else', () => {
    const level = { kind: 'difference', operands: [0, 1], value: 0, sourceId: 'level', tag: 0 } as const;
    const model = (equations: CadSketchEquationModel['equations'], fixed = [false, false]): CadSketchEquationModel =>
      ({ values: [0, 100], fixed, pointParameters: new Map(), radiusParameters: new Map(), equations });
    const levelled = model([level]);
    const answer = (values: number[], change: Partial<CadSketchNativeSolution> = {}): NativeAnswer => ({ solution: { status: 'converged', iterations: 3, residual: 1e-14,
      values, diagnosis: { kind: 'diagnosed', degreesOfFreedom: 1, labels: [0] }, ...change } });
    const baseline = answer([5, 100]);
    expect(nativeEliminationDifferences(levelled, baseline, answer([5 + 4e-9, 100 + 9e-8], { iterations: 1, residual: 0 }))).toEqual([]);
    expect(nativeEliminationDifferences(levelled, baseline, answer([5 + 6e-9, 100]))).toEqual(['values']);
    expect(nativeEliminationDifferences(levelled, baseline, answer([5, 100.000001]))).toEqual(['values']);
    expect(nativeEliminationDifferences(levelled, baseline, answer([5, Number.NaN]))).toEqual(['values']);
    expect(nativeEliminationDifferences(levelled, baseline, answer([5, 100], { status: 'not-converged' }))).toEqual(['status']);
    expect(nativeEliminationDifferences(levelled, baseline, answer([5, 100], { diagnosis: { kind: 'diagnosed', degreesOfFreedom: 1, labels: [1] } }))).toEqual(['labels']);
    // A drag, a start the baseline took no step from and a model without a simple equality over an
    // unknown are answered bit for bit.
    const moved = answer([5 + 1e-12, 100]);
    expect(nativeEliminationDifferences(model([level, { kind: 'value', operands: [0], value: 5, sourceId: 'target', tag: 1, temporary: true }]), baseline, moved)).toEqual(['values']);
    expect(nativeEliminationDifferences(levelled, answer([5, 100], { iterations: 0 }), moved)).toEqual(['values', 'iterations']);
    expect(nativeEliminationDifferences(model([level], [true, true]), baseline, moved)).toEqual(['values']);
    expect(nativeEliminationDifferences(model([{ ...level, kind: 'midpoint', operands: [0, 1, 0] }]), baseline, moved)).toEqual(['values']);
    // Only a group the solver may solve through its classes may move: one that also holds a
    // distance is solved whole, so its values stay the baseline's.
    const spread = (equations: CadSketchEquationModel['equations']): CadSketchEquationModel =>
      ({ values: [0, 100, 0, 0, 3, 4], fixed: Array<boolean>(6).fill(false), pointParameters: new Map(), radiusParameters: new Map(), equations });
    const span = { kind: 'distance', operands: [2, 3, 4, 5], value: 5, sourceId: 'span', tag: 1 } as const;
    const wide = answer([5, 100, 0, 0, 3, 4]);
    expect(nativeEliminationDifferences(spread([level, span]), wide, answer([5 + 1e-12, 100, 0, 0, 3, 4], { iterations: 1 }))).toEqual([]);
    expect(nativeEliminationDifferences(spread([level, span]), wide, answer([5, 100, 0, 0, 3, 4 + 1e-12]))).toEqual(['values']);
    const pinnedSpan = spread([{ kind: 'value', operands: [0], value: 5, sourceId: 'pin', tag: 0 }, { ...span, operands: [0, 1, 4, 5] }]);
    expect(nativeEliminationDifferences(pinnedSpan, wide, answer([5 + 1e-12, 100, 0, 0, 3, 4], { iterations: 1 }))).toEqual(['values', 'iterations']);
  });

  it('records a failure and rethrows it as it was, so the runtime recovers as it would', () => {
    const thrown = new CadSketchNativeProtocolError('another version'), recorded: NativeAnswer[] = [];
    const solver = recordNativeCalls({ memoryBytes: () => 0, solve: () => { throw thrown; } }, (_, answer) => recorded.push(answer));
    expect(() => solver.solve({ values: [], fixed: [], pointParameters: new Map(), radiusParameters: new Map(), equations: [] })).toThrow(thrown);
    expect(recorded).toEqual([{ error: 'protocol: another version' }]);
    expect(nativeAnswerDifferences(recorded[0], { error: 'another version' })).toEqual(['error']);
  });

  it('answers every call for the corpus and the seeded sketches as the baseline module does, but for elimination', async () => {
    const compared = comparison(), runtime = createCadSketchNativeRuntime({ loadNative: compared.loadNative }), inputs: { label: string; input: CadSketchSolveInput }[] = comparedInputs();
    for (const { label, input } of inputs) { compared.state.label = label; await runtime.solve(input); }
    expect(compared.differences()).toEqual({ parts: {}, examples: [] });
    // The corpus and both generators were answered, not skipped, and elimination ran.
    expect(inputs.length).toBeGreaterThan(3000);
    expect(compared.state.calls).toBeGreaterThan(3000);
    expect(compared.state.eliminated).toBeGreaterThan(100);
    expect(compared.state.largestMove).toBeLessThanOrEqual(1);
  }, 300_000);

  it('answers every call the solver benchmarks make as the baseline module does, but for elimination', async () => {
    const compared = comparison(), solver = createCadBenchmarkRuntime(compared.loadNative), solvers = [solver];
    for (const testCase of createCadSolverWorkloadCases()) { compared.state.label = `workload ${testCase.id}`; await measureCadSolverWorkload(testCase, solvers, 1); }
    compared.state.label = 'edits';
    await measureCadSolverEdits(solvers, 1);
    compared.state.label = 'drag trajectories';
    await measureCadSolverDrag(solvers, 1);
    compared.state.label = 'drag sweep';
    await measureCadSolverDragSweep(solvers);
    expect(compared.differences()).toEqual({ parts: {}, examples: [] });
    expect(compared.state.calls).toBeGreaterThan(500);
    expect(compared.state.eliminated).toBeGreaterThan(5);
  }, 300_000);
});
