// Records the equation baseline fixture that src/features/cad/sketch-solver/native/__tests__/cadSketchEquationBaseline.test.ts replays:
// the equations the per-kind compiler gave, and native's answers to them, before relations compiled from their definitions. Run it only
// in a snapshot of the source commit the fixture's manifest names, never on the current code, whose output the fixture exists to check.
// The manifest next to the fixture gives the inputs, normalization and steps.
//
// Usage, from the snapshot's root:
//   node scripts/run-bundled.mjs scripts/record-sketch-equation-baseline.ts [--benchmark <fixture.json.gz>] [--out <file>]
// The benchmark inputs are captured by running the solver benchmarks once through a runtime that keeps every input it is given, unless
// --benchmark names an existing fixture, whose recorded benchmark inputs are then used. The fixture is written to --out, by default over
// the committed one, and its counts and hashes are printed for the manifest.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createCadSolverWorkloadCases } from '../src/features/cad/benchmark/cadSolverWorkloadCases';
import { measureCadSolverDrag, measureCadSolverDragSweep, measureCadSolverEdits, measureCadSolverWorkload } from '../src/features/cad/benchmark/cadSolverWorkloadBenchmark';
import { createCadBenchmarkRuntime, type CadBenchmarkSolver } from '../src/features/cad/benchmark/cadSolverBenchmarkAdapters';
import { measureCadDragPreview, measureCadSolverScaling, probeCadSolverCapacity, type CadSketchSolver } from '../src/features/cad/benchmark/cadBenchmark';
import { createCadSketchNativeRuntime } from '../src/features/cad/sketch-solver/cadSketchNativeRuntime';
import { loadCadSketchNativeSolver } from '../src/features/cad/sketch-solver/native/cadSketchNativeSolver';
// The compiler at the source commit, which the fixture records.
import { compileCadSketchEquations } from '../src/features/cad/sketch-solver/native/compileCadSketchEquations';
import { benchmarkInputCollector, encodeEquationBaseline, equationBaselinePaths, equationBaselineInputs, equationBaselineNative, EQUATION_BASELINE_FORMAT,
  readEquationBaseline, recordEquationBaselineInput, sha256, type EquationBaselineModel, type EquationBaselineRecord } from '../src/features/cad/sketch-solver/native/__tests__/cadSketchEquationBaseline';
import type { CadSketchSolveInput } from '../src/features/cad/sketch-solver/cadSketchSolverTypes';

const args = process.argv.slice(2), option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const paths = equationBaselinePaths(new URL('..', import.meta.url));
const out = option('--out') ?? fileURLToPath(paths.fixture), from = option('--benchmark');
const native = await equationBaselineNative(paths);

async function captureBenchmarkInputs() {
  const collector = benchmarkInputCollector();
  let section = '';
  // Each input is kept as it reaches the runtime, which parses and compiles exactly it.
  const keeping = <T extends CadSketchSolver>(solver: T): T => ({ ...solver, solve: (input: CadSketchSolveInput, signal?: AbortSignal) => {
    collector.add(section, input);
    return solver.solve(input, signal);
  } });
  const load = () => loadCadSketchNativeSolver(native.module);
  const runtime = (): CadBenchmarkSolver => keeping(createCadBenchmarkRuntime(load));
  const solvers = [runtime()];
  for (const testCase of createCadSolverWorkloadCases()) { section = `benchmark:workloads/${testCase.id}`; await measureCadSolverWorkload(testCase, solvers, 1); }
  section = 'benchmark:edits'; await measureCadSolverEdits(solvers, 1);
  section = 'benchmark:drag'; await measureCadSolverDrag(solvers, 1);
  section = 'benchmark:sweep'; await measureCadSolverDragSweep(solvers);
  // The legacy group's solver steps, at their full sizes.
  const plain = () => keeping(createCadSketchNativeRuntime({ loadNative: load }));
  section = 'benchmark:scaling'; await measureCadSolverScaling(plain(), { sizes: [1, 10, 40, 60], dragSize: 40, runs: 1 });
  section = 'benchmark:drag-preview'; await measureCadDragPreview(plain(), { sketchCounts: [1, 4, 8, 32], rectanglesPerSketch: 10, runs: 1 });
  section = 'benchmark:capacity-independent'; await probeCadSolverCapacity(plain, [80, 100, 200, 400], { connected: false });
  section = 'benchmark:capacity-connected'; await probeCadSolverCapacity(plain, [60, 80, 88, 89, 100, 125], { connected: true });
  return collector.result();
}

const started = performance.now();
const benchmark = from ? readEquationBaseline(from).benchmark : await captureBenchmarkInputs();
const captured = performance.now();
const models: Record<string, EquationBaselineModel> = {}, records: EquationBaselineRecord[] = [];
const counts = { inputs: 0, compiled: 0, refused: 0, equations: 0, temporary: 0, nativeErrors: 0, relations: 0, bySource: {} as Record<string, number> };
for (const item of equationBaselineInputs(benchmark, paths)) {
  const { compiled: { model, stored, hash }, record } = await recordEquationBaselineInput(compileCadSketchEquations, native, item);
  const group = item.source.startsWith('benchmark:') ? item.source.split('/')[0] : item.source.split(':')[0];
  counts.inputs++; counts.bySource[group] = (counts.bySource[group] ?? 0) + 1; counts.relations += item.input.graph.relations.length;
  models[hash] ??= stored;
  records.push(record);
  if (!model) { counts.refused++; continue; }
  counts.compiled++; counts.equations += model.equations.length; counts.temporary += model.equations.filter(equation => equation.temporary).length;
  if (record[3] && 'throws' in record[3]) counts.nativeErrors++;
}
const recorded = performance.now();

const text = encodeEquationBaseline({ format: EQUATION_BASELINE_FORMAT, benchmark, models, records }), bytes = gzipSync(text, { level: 9 });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
const stored = Object.values(models);
console.log(JSON.stringify({
  ...counts, models: stored.length, storedEquations: stored.reduce((sum, model) => sum + ('equations' in model ? model.equations.length : 0), 0),
  refusals: [...new Set(stored.flatMap(model => 'throws' in model ? [model.throws] : []))].sort(),
  benchmarkGraphs: Object.keys(benchmark.graphs).length, benchmarkInputs: benchmark.inputs.length,
  captureSeconds: Math.round((captured - started) / 100) / 10, recordSeconds: Math.round((recorded - captured) / 100) / 10,
  jsonBytes: Buffer.byteLength(text), gzipBytes: bytes.length, jsonSha256: sha256(text), gzipSha256: sha256(bytes)
}, null, 2));
