import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { gzipSync } from 'node:zlib';
import initOpenCascade from 'replicad-opencascadejs';
import { getOC, setOC } from 'replicad';
import { createCadKernelBenchmarkCases } from '../src/features/cad/benchmark/cadBenchmarkCases.ts';
import { cadBenchmarkCpuCalibrationMs, measureCadDragPreview, measureCadKernelCase, measureCadSolverScaling, probeCadSolverCapacity } from '../src/features/cad/benchmark/cadBenchmark.ts';
import { createCadSketchNativeRuntime } from '../src/features/cad/sketch-solver/cadSketchNativeRuntime.ts';
import { loadCadSketchNativeSolver } from '../src/features/cad/sketch-solver/native/cadSketchNativeSolver.ts';

// Node-only CAD baseline. Compare runs from the same idle machine; never compare across hosts.
// Usage: npm run cad:benchmark [-- --group solver-workloads|legacy|preview|all --runs 7 --quick]
// The npm script bundles this file as the application is built (scripts/run-bundled.mjs); through
// tsx every TypeScript stage is timed slower. The preview group runs only the legacy drag previews.
// Solver workloads also take --sections workloads,edits,drag,sweep,cold,memory,capacity, --cases <ids>
// and --out <directory>; parts already in the directory are kept, so a stopped run resumes.
// --aggregate <directory> joins its parts into one report.
const args = process.argv.slice(2);
const quick = args.includes('--quick');
const runs = args.includes('--runs') ? Number(args[args.indexOf('--runs') + 1]) : quick ? 3 : 7;
const group = args.includes('--group') ? args[args.indexOf('--group') + 1] : 'all';
if (!['all', 'legacy', 'preview', 'solver-workloads'].includes(group)) throw new Error('--group needs all, legacy, preview or solver-workloads.');
if (!Number.isSafeInteger(runs) || runs < 1) {
  console.error('--runs needs a positive whole number of samples.');
  process.exit(1);
}
// The bundle runs from a file beside this one; tsx runs the source.
const runner = import.meta.url.endsWith('.bundled.mjs') ? 'bundled' : 'source';
const nativeWasm = new URL('../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url);
const environment = () => ({ node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, totalMemoryBytes: totalmem() });
// Calibration that moves by more than 1.5 times means the host changed clock speed mid-measurement.
const drifted = (calibrations: readonly number[]) => Math.max(...calibrations) > 1.5 * Math.min(...calibrations);
const DRAG_PREVIEW_SKETCH_COUNTS = [1, 4, 8, 32];
type DragPreview = Awaited<ReturnType<typeof measureCadDragPreview>>;
const previewLine = (preview: DragPreview['dependent']['referenced']) =>
  `[cpu ${preview.cpuCalibrationMs.join('/')} ms]: ${preview.solvesPerPreview} solves, p50 ${preview.prepareMs.p50} ms of which solver calls ${preview.solverCallMs.p50} ms; `
  + `one full parse of the ${Math.round(preview.documentJsonBytes / 1024)} KiB document p50 ${preview.documentParseMs.p50} ms; `
  + `viewport references p50 ${preview.viewportReferencesMs.p50} ms${drifted(preview.cpuCalibrationMs) ? ' THROTTLED' : ''}`;
function logDragPreview(dragPreview: DragPreview) {
  for (const item of dragPreview.independent) console.log(`drag preview with ${item.sketchCount} sketches ${previewLine(item)}`);
  for (const item of dragPreview.padded) console.log(`drag preview with ${item.sketchCount} extruded sketches ${previewLine(item)}`);
  console.log(`dependent drag preview, referenced edge ${previewLine(dragPreview.dependent.referenced)}`);
  console.log(`dependent drag preview, unreferenced point ${previewLine(dragPreview.dependent.unreferenced)}`);
}
const dragPreviewCalibrations = (dragPreview: DragPreview) =>
  [...dragPreview.independent, ...dragPreview.padded, dragPreview.dependent.referenced, dragPreview.dependent.unreferenced].flatMap(preview => preview.cpuCalibrationMs);
async function writeReport<Report extends { createdAt: string }>(prefix: string, report: Report) {
  await mkdir('tmp/cad-benchmark', { recursive: true });
  const file = `tmp/cad-benchmark/${prefix}${report.createdAt.replace(/[:.]/g, '-')}.json`;
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${file}`);
}

if (group === 'preview') {
  const nativeModule = await WebAssembly.compile(await readFile(nativeWasm));
  const solver = createCadSketchNativeRuntime({ loadNative: () => loadCadSketchNativeSolver(nativeModule) });
  const dragPreview = await measureCadDragPreview(solver, { sketchCounts: DRAG_PREVIEW_SKETCH_COUNTS, rectanglesPerSketch: 10, runs });
  logDragPreview(dragPreview);
  const calibrations = dragPreviewCalibrations(dragPreview);
  if (drifted(calibrations)) console.warn(`CPU calibration varied from ${Math.min(...calibrations)} to ${Math.max(...calibrations)} ms: the host throttled, so compare only previews with similar calibration.`);
  await writeReport('preview-', { createdAt: new Date().toISOString(), quick, runs, runner, environment: environment(), dragPreview });
}
if (group === 'all' || group === 'legacy') {
// Package export maps hide the WASM files, so resolve them as plain installed files.
const installed = (path: string) => new URL(`../node_modules/${path}`, import.meta.url);

async function asset(name: string, file: URL) {
  const bytes = await readFile(file);
  return { name, bytes: bytes.byteLength, gzipBytes: gzipSync(bytes).byteLength };
}
const assets = await Promise.all([
  asset('replicad-opencascadejs', installed('replicad-opencascadejs/dist/replicad_single.wasm')),
  asset('sketch-solver (native)', nativeWasm),
  asset('occt-import-js (machine STEP import only)', installed('occt-import-js/dist/occt-import-js.wasm'))
]);

const idleCpuCalibrationMs = cadBenchmarkCpuCalibrationMs();
const wasmBinary = await readFile(installed('replicad-opencascadejs/dist/replicad_single.wasm'));
// Each case gets a fresh module: WASM memory never shrinks, so a shared module would carry one
// case's high-water mark into the next and make memory and cold builds depend on case order.
const initKernel = async () => setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
let started = performance.now();
await initKernel();
const kernelInitMs = performance.now() - started;
const memoryBytes = () => getOC().wasmMemory.buffer.byteLength;

const kernel = [];
for (const [index, testCase] of createCadKernelBenchmarkCases().entries()) {
  if (index) await initKernel();
  const measured = await measureCadKernelCase(testCase, { runs, memoryMarks: quick ? [1, 10] : [1, 10, 50], memoryBytes });
  kernel.push(measured);
  for (const step of measured.steps) {
    console.log(`${testCase.id} / ${step.label} [cpu ${Object.values(step.cpuCalibrationMs).join('/')} ms]: build p50 ${step.buildMs.p50} ms`
      + (step.shippedEditMs ? `, shipped edit p50 ${step.shippedEditMs.p50} ms` : '')
      + (step.affectedBodiesMs ? `, affected bodies alone p50 ${step.affectedBodiesMs.p50} ms` : '')
      + `, ${step.payload.triangles} triangles, ${Math.round(step.payload.jsonBytes / 1024)} KiB, main thread clone/validate/display p50 `
      + `${step.mainThread.cloneMs.p50}/${step.mainThread.validateMs.p50}/${step.mainThread.displayMs.p50} ms`
      + (drifted(Object.values(step.cpuCalibrationMs)) ? ' THROTTLED: calibration drifted within this step' : '')
      + (step.failures.length ? ` INCORRECT: ${step.failures.join('; ')}` : ''));
  }
}

// The app's sketch solver, compiled once as the worker does; its init time covers compiling and one instance.
started = performance.now();
const nativeModule = await WebAssembly.compile(await readFile(nativeWasm));
await loadCadSketchNativeSolver(nativeModule);
const solverInitMs = performance.now() - started;
const solverCpuCalibrationMs = cadBenchmarkCpuCalibrationMs();
const freshSolver = () => createCadSketchNativeRuntime({ loadNative: () => loadCadSketchNativeSolver(nativeModule) });
const solver = freshSolver();
const solverScaling = await measureCadSolverScaling(solver, { sizes: quick ? [1, 10, 40] : [1, 10, 40, 60], dragSize: 40, runs });
const dragPreview = await measureCadDragPreview(solver, { sketchCounts: DRAG_PREVIEW_SKETCH_COUNTS, rectanglesPerSketch: 10, runs });
const capacity = {
  independent: await probeCadSolverCapacity(freshSolver, quick ? [100] : [80, 100, 200, 400], { connected: false }),
  connected: await probeCadSolverCapacity(freshSolver, quick ? [80, 100] : [60, 80, 88, 89, 100, 125], { connected: true })
};
for (const size of solverScaling.sizes) console.log(`solver ${size.rectangles} rectangles (${size.entities} lines) [cpu ${size.cpuCalibrationMs.join('/')} ms]: ${size.outcome}, p50 ${size.solveMs.p50} ms${drifted(size.cpuCalibrationMs) ? ' THROTTLED' : ''}`);
console.log(`solver drag on ${solverScaling.drag.rectangles} rectangles [cpu ${solverScaling.drag.cpuCalibrationMs.join('/')} ms]: ${solverScaling.drag.outcome}, p50 ${solverScaling.drag.solveMs.p50} ms${drifted(solverScaling.drag.cpuCalibrationMs) ? ' THROTTLED' : ''}`);
logDragPreview(dragPreview);
for (const probe of [capacity.independent, capacity.connected]) {
  const failed = probe.outcomes.find(outcome => outcome.rectangles === probe.firstFailed);
  console.log(`solver capacity, ${probe.connected ? 'one connected group' : 'independent rectangles'}, fresh instance: largest solved ${probe.largestSolved ?? 'none'}, first failed ${probe.firstFailed ?? 'none'} rectangles`
    + (failed ? ` (${failed.parameters} parameters x ${failed.constraints} constraints: ${failed.reason ?? failed.outcome})` : ''));
}

const report = {
  createdAt: new Date().toISOString(), quick, runs, runner, environment: environment(),
  assets, kernel: { initMs: Math.round(kernelInitMs), cases: kernel },
  cpuCalibrationMs: { idle: idleCpuCalibrationMs, solver: solverCpuCalibrationMs },
  solver: { initMs: Math.round(solverInitMs), scaling: solverScaling, dragPreview, capacity }
};
const calibrations = [idleCpuCalibrationMs, solverCpuCalibrationMs, ...kernel.flatMap(testCase => testCase.steps.flatMap(step => Object.values(step.cpuCalibrationMs))), ...solverScaling.sizes.flatMap(size => size.cpuCalibrationMs), ...solverScaling.drag.cpuCalibrationMs, ...dragPreviewCalibrations(dragPreview)];
if (drifted(calibrations)) {
  console.warn(`CPU calibration varied from ${Math.min(...calibrations)} to ${Math.max(...calibrations)} ms: the host throttled, so compare only steps with similar calibration.`);
}
await writeReport('', report);
if (kernel.some(testCase => testCase.steps.some(step => step.failures.length))) {
  console.error('A benchmark case produced incorrect geometry; its timings are not comparable.');
  process.exitCode = 1;
}
}
if (group === 'all' || group === 'solver-workloads') {
  const { aggregateCadSolverWorkloads, CAD_SOLVER_SECTIONS, runCadSolverWorkloads } = await import('./benchmark-cad-solver-workloads');
  const list = <T extends string>(flag: string, allowed: readonly T[] | undefined, fallback: readonly T[]) => {
    if (!args.includes(flag)) return fallback;
    const values = args[args.indexOf(flag) + 1]?.split(',').filter(Boolean) ?? [];
    const unknown = allowed ? values.filter(value => !allowed.includes(value as T)) : [];
    if (!values.length || unknown.length) throw new Error(`${flag} needs a comma-separated list${allowed ? ` of ${allowed.join(', ')}` : ''}.`);
    return values as T[];
  };
  if (args.includes('--aggregate')) await aggregateCadSolverWorkloads(args[args.indexOf('--aggregate') + 1]);
  else {
    const { execFileSync } = await import('node:child_process');
    const commit = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })();
    const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    await runCadSolverWorkloads({ runs, quick, runner, sections: list('--sections', CAD_SOLVER_SECTIONS, CAD_SOLVER_SECTIONS), cases: list('--cases', undefined, []),
      out: args.includes('--out') ? args[args.indexOf('--out') + 1] : `tmp/cad-benchmark/solver-workloads-${packageInfo.version}-${commit}${quick ? '-quick' : ''}` });
  }
}
