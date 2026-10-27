// @vitest-environment node
// Every native call the app makes on the frozen corpus, on seeded sketches and in the solver
// benchmarks, asked again of the module the baseline names. Until a change to the solver is meant to
// answer differently, every answer must be the baseline's, bit for bit.
import { describe, expect, it, vi } from 'vitest';
import { createCadSolverWorkloadCases } from '../../../benchmark/cadSolverWorkloadCases';
import { createCadBenchmarkRuntime } from '../../../benchmark/cadSolverBenchmarkAdapters';
import { measureCadSolverDrag, measureCadSolverDragSweep, measureCadSolverEdits, measureCadSolverWorkload } from '../../../benchmark/cadSolverWorkloadBenchmark';
import { createCadSketchNativeRuntime } from '../../cadSketchNativeRuntime';
import type { CadSketchSolveInput } from '../../cadSketchSolverTypes';
import { createCadSketchFuzzCase } from '../../__tests__/cadSketchFuzz';
import { loadCadSketchTestNativeSolver } from '../../__tests__/cadSketchTestSolver';
import { corpusInput, corpusModelHash, readPlaneGcsCorpus } from '../../__tests__/planeGcsCorpus';
import { CadSketchNativeProtocolError, type CadSketchNativeSolution } from '../cadSketchNativeSolver';
import { loadPairedWithBaseline, nativeAnswerDifferences, nativeBaselineBytes, nativeBaselineManifest, recordNativeCalls, type NativeAnswer } from './nativeBaseline';

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

/** A loader whose instances are compared with the baseline's, call by call, under the current label. */
function comparison() {
  const parts = new Map<string, number>(), examples: string[] = [];
  const state = { label: '', calls: 0 };
  const loadNative = loadPairedWithBaseline(loadCadSketchTestNativeSolver, (model, baseline, current) => {
    state.calls += 1;
    const found = nativeAnswerDifferences(baseline, current);
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

  it('records a failure and rethrows it as it was, so the runtime recovers as it would', () => {
    const thrown = new CadSketchNativeProtocolError('another version'), recorded: NativeAnswer[] = [];
    const solver = recordNativeCalls({ memoryBytes: () => 0, solve: () => { throw thrown; } }, (_, answer) => recorded.push(answer));
    expect(() => solver.solve({ values: [], fixed: [], pointParameters: new Map(), radiusParameters: new Map(), equations: [] })).toThrow(thrown);
    expect(recorded).toEqual([{ error: 'protocol: another version' }]);
    expect(nativeAnswerDifferences(recorded[0], { error: 'another version' })).toEqual(['error']);
  });

  it('answers every call for the corpus and the seeded sketches as the baseline module does', async () => {
    const compared = comparison(), runtime = createCadSketchNativeRuntime({ loadNative: compared.loadNative }), inputs: { label: string; input: CadSketchSolveInput }[] = comparedInputs();
    for (const { label, input } of inputs) { compared.state.label = label; await runtime.solve(input); }
    expect(compared.differences()).toEqual({ parts: {}, examples: [] });
    // The corpus and both generators were answered, not skipped.
    expect(inputs.length).toBeGreaterThan(3000);
    expect(compared.state.calls).toBeGreaterThan(3000);
  }, 300_000);

  it('answers every call the solver benchmarks make as the baseline module does', async () => {
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
  }, 300_000);
});
