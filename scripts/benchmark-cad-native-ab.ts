import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import packageInfo from '../package.json' with { type: 'json' };
import { cadBenchmarkCpuCalibrationMs, cadBenchmarkStats } from '../src/features/cad/benchmark/cadBenchmark';
import { createCadBenchmarkRuntime } from '../src/features/cad/benchmark/cadSolverBenchmarkAdapters';
import { createCadSolverDragTrajectories } from '../src/features/cad/benchmark/cadSolverDragCases';
import { cadSolverCalibrationDrifted, measureCadSolverDrag, measureCadSolverDragSweep, measureCadSolverEdits } from '../src/features/cad/benchmark/cadSolverWorkloadBenchmark';
import { createCadSolverWorkloadCases } from '../src/features/cad/benchmark/cadSolverWorkloadCases';
import { encodeCadSketchEquationModel, type CadSketchEquationModel } from '../src/features/cad/sketch-solver/native/cadSketchEquationModel';
import { loadCadSketchNativeSolver, type CadSketchNativeSolver } from '../src/features/cad/sketch-solver/native/cadSketchNativeSolver';
import { answerNatively, nativeAnswerDifferences, nativeBaselineBytes, nativeBaselineManifest, recordNativeCalls } from '../src/features/cad/sketch-solver/native/__tests__/nativeBaseline';

// The baseline module the manifest in packages/sketch-solver/baseline names, against the committed
// module, on the models the app's runtime sends them in the solver benchmarks: workload first solves
// and re-solves, die edits, every drag trajectory and the drag sweep. The models are recorded once
// through the current module; each round then times every group's calls on both modules, taking turns
// to go first, on instances that have answered them all once untimed. A ratio below 1 means the
// current module is faster. With both modules the same, the ratios measure this host's noise.
// Usage: tsx --tsconfig tsconfig.app.json scripts/benchmark-cad-native-ab.ts [--rounds 15] [--only text] [--out file.json]
const args = process.argv.slice(2), option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const rounds = Number(option('--rounds') ?? 15), only = option('--only'), out = option('--out');
if (!Number.isInteger(rounds) || rounds < 2) throw new Error('--rounds must be an integer of at least 2.');

const current = await WebAssembly.compile(await readFile(new URL('../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url)));
const baseline = await WebAssembly.compile(nativeBaselineBytes());
const modules = { baseline, current } as const;
type ModuleId = keyof typeof modules;

/** Each group's distinct models, in the order the runtime first sent them. */
const groups = new Map<string, Map<string, CadSketchEquationModel>>();
let label = '';
const solver = createCadBenchmarkRuntime(async () => recordNativeCalls(await loadCadSketchNativeSolver(current), model => {
  const encoded = encodeCadSketchEquationModel(model), key = createHash('sha256').update(new Uint8Array(encoded.buffer)).digest('hex');
  if (!groups.has(label)) groups.set(label, new Map());
  if (!groups.get(label)!.has(key)) groups.get(label)!.set(key, model);
}));
for (const testCase of createCadSolverWorkloadCases()) {
  label = `workload ${testCase.id} first solve`;
  const result = await solver.solve(testCase.input);
  label = `workload ${testCase.id} re-solve`;
  if (result.kind === 'solved') await solver.solve({ graph: result.graph, parameters: testCase.input.parameters });
}
label = 'die edits';
await measureCadSolverEdits([solver], 1);
for (const trajectory of createCadSolverDragTrajectories()) for (const mode of ['from-start', 'chained'] as const) {
  label = `drag ${trajectory.id} ${mode}`;
  await measureCadSolverDrag([solver], 1, [trajectory], [mode]);
}
label = 'drag sweep';
await measureCadSolverDragSweep([solver]);

const selected = [...groups].filter(([name]) => !only || name.includes(only));
if (!selected.length) throw new Error(`No group matches --only ${only}.`);
const ratio = (value: number, reference: number) => Math.round(value / reference * 1000) / 1000;
const median = (values: readonly number[]) => { const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1; return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };

const results = [];
for (const [name, recorded] of selected) {
  const models = [...recorded.values()];
  const fresh = async () => Object.fromEntries(await Promise.all((Object.keys(modules) as ModuleId[]).map(async id => [id, await loadCadSketchNativeSolver(modules[id])] as const))) as Record<ModuleId, CadSketchNativeSolver>;
  let instances = await fresh(), differingCalls = 0;
  // The untimed pass warms both instances and compares their answers. A call either fails is not
  // timed, and as a failed instance never runs again, both are replaced after it, as the runtime does.
  const timed: CadSketchEquationModel[] = [];
  for (const model of models) {
    const answers = { baseline: answerNatively(instances.baseline, model), current: answerNatively(instances.current, model) };
    if (nativeAnswerDifferences(answers.baseline, answers.current).length) differingCalls += 1;
    if ('error' in answers.baseline || 'error' in answers.current) instances = await fresh();
    else timed.push(model);
  }
  if (!timed.length) { results.push({ group: name, calls: models.length, timedCalls: 0, differingCalls }); continue; }
  const pass = (instance: CadSketchNativeSolver) => { const started = performance.now(); for (const model of timed) instance.solve(model); return performance.now() - started; };
  // Short groups repeat within a round so each module's turn lasts about 25 ms; totals are per pass.
  const passes = Math.max(1, Math.ceil(25 / Math.max(pass(instances.baseline), pass(instances.current))));
  const totals: Record<ModuleId, number[]> = { baseline: [], current: [] };
  const before = cadBenchmarkCpuCalibrationMs();
  for (let round = 0; round < rounds; round++) for (const id of round % 2 ? ['current', 'baseline'] as const : ['baseline', 'current'] as const) {
    let elapsed = 0;
    for (let index = 0; index < passes; index++) elapsed += pass(instances[id]);
    totals[id].push(elapsed / passes);
  }
  const cpuCalibrationMs = [before, cadBenchmarkCpuCalibrationMs()];
  const row = { group: name, calls: models.length, timedCalls: timed.length, differingCalls, passes, cpuCalibrationMs, throttled: cadSolverCalibrationDrifted(cpuCalibrationMs),
    baselineMs: cadBenchmarkStats(totals.baseline), currentMs: cadBenchmarkStats(totals.current),
    ratioOfMedians: ratio(median(totals.current), median(totals.baseline)), medianRoundRatio: ratio(median(totals.current.map((value, round) => value / totals.baseline[round])), 1),
    memoryBytes: { baseline: instances.baseline.memoryBytes(), current: instances.current.memoryBytes() } };
  results.push(row);
  console.log(`${name}: ${timed.length}/${models.length} calls, baseline ${row.baselineMs.p50} ms, current ${row.currentMs.p50} ms, ratio ${row.ratioOfMedians} (rounds ${row.medianRoundRatio}),`
    + ` CPU ${cpuCalibrationMs.join('/')} ms${differingCalls ? `, ${differingCalls} calls answered differently` : ''}${row.throttled ? ', THROTTLED' : ''}`);
}

const report = { createdAt: new Date().toISOString(), appVersion: packageInfo.version, rounds, only: only ?? null,
  modules: { baseline: nativeBaselineManifest, current: { sha256: createHash('sha256').update(await readFile(new URL('../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url))).digest('hex') } },
  environment: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? 'unknown' },
  timing: 'Each round runs every timed call of a group `passes` times per module, in turn order alternating by round; totals are per pass, per module per round.', results };
if (out) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
