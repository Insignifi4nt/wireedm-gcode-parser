import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { gzipSync } from 'node:zlib';
import initOpenCascade from 'replicad-opencascadejs';
import { getOC, setOC } from 'replicad';
import initPlaneGcs from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.js';
import { createCadKernelBenchmarkCases } from '../src/features/cad/benchmark/cadBenchmarkCases.ts';
import { cadBenchmarkCpuCalibrationMs, measureCadDragPreview, measureCadKernelCase, measureCadSolverScaling, probeCadSolverCapacity } from '../src/features/cad/benchmark/cadBenchmark.ts';
import { createCadSketchSolverRuntime } from '../src/features/cad/sketch-solver/cadSketchSolverRuntime.ts';

// Node-only CAD baseline. Compare runs from the same idle machine; never compare across hosts.
// Usage: npm run cad:benchmark [-- --runs 7 --quick]
const args = process.argv.slice(2);
const quick = args.includes('--quick');
const runs = args.includes('--runs') ? Number(args[args.indexOf('--runs') + 1]) : quick ? 3 : 7;
if (!Number.isSafeInteger(runs) || runs < 1) {
  console.error('--runs needs a positive whole number of samples.');
  process.exit(1);
}
// Package export maps hide the WASM files, so resolve them as plain installed files.
const installed = (path: string) => new URL(`../node_modules/${path}`, import.meta.url);

async function asset(name: string, path: string) {
  const bytes = await readFile(installed(path));
  return { name, bytes: bytes.byteLength, gzipBytes: gzipSync(bytes).byteLength };
}
const assets = await Promise.all([
  asset('replicad-opencascadejs', 'replicad-opencascadejs/dist/replicad_single.wasm'),
  asset('planegcs', '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm'),
  asset('occt-import-js (machine STEP import only)', 'occt-import-js/dist/occt-import-js.wasm')
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

// Calibration that moves by more than 1.5 times means the host changed clock speed mid-measurement.
const drifted = (calibrations: readonly number[]) => Math.max(...calibrations) > 1.5 * Math.min(...calibrations);
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

const planeGcsWasm = installed('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm').href;
started = performance.now();
const module = await initPlaneGcs({ locateFile: () => planeGcsWasm, print: () => undefined, printErr: () => undefined });
const solverInitMs = performance.now() - started;
const solverCpuCalibrationMs = cadBenchmarkCpuCalibrationMs();
const solver = createCadSketchSolverRuntime(async () => module);
const solverScaling = await measureCadSolverScaling(solver, { sizes: quick ? [1, 10, 40] : [1, 10, 40, 60], dragSize: 40, runs });
const dragPreview = await measureCadDragPreview(solver, { sketchCounts: [1, 4, 8], rectanglesPerSketch: 10, runs });
// Each attempt instantiates its own module: an OOM abort leaves a module unusable.
const capacity = await probeCadSolverCapacity(() => createCadSketchSolverRuntime(() => initPlaneGcs({ locateFile: () => planeGcsWasm, print: () => undefined, printErr: () => undefined })),
  quick ? [60, 100] : [60, 80, 100, 125, 150, 200]);
for (const size of solverScaling.sizes) console.log(`solver ${size.rectangles} rectangles (${size.entities} lines) [cpu ${size.cpuCalibrationMs.join('/')} ms]: ${size.outcome}, p50 ${size.solveMs.p50} ms${drifted(size.cpuCalibrationMs) ? ' THROTTLED' : ''}`);
console.log(`solver drag on ${solverScaling.drag.rectangles} rectangles: ${solverScaling.drag.outcome}, p50 ${solverScaling.drag.solveMs.p50} ms`);
for (const preview of dragPreview) console.log(`drag preview with ${preview.sketchCount} sketches [cpu ${preview.cpuCalibrationMs.join('/')} ms]: ${preview.solvesPerPreview} solves, p50 ${preview.prepareMs.p50} ms${drifted(preview.cpuCalibrationMs) ? ' THROTTLED' : ''}`);
console.log(`solver capacity in a fresh module: largest solved ${capacity.largestSolved ?? 'none'}, first failed ${capacity.firstFailed ?? 'none'} rectangles`);

const report = {
  createdAt: new Date().toISOString(), quick, runs,
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, totalMemoryBytes: totalmem() },
  assets, kernel: { initMs: Math.round(kernelInitMs), cases: kernel },
  cpuCalibrationMs: { idle: idleCpuCalibrationMs, solver: solverCpuCalibrationMs },
  solver: { initMs: Math.round(solverInitMs), scaling: solverScaling, dragPreview, capacity }
};
const calibrations = [idleCpuCalibrationMs, solverCpuCalibrationMs, ...kernel.flatMap(testCase => testCase.steps.flatMap(step => Object.values(step.cpuCalibrationMs))), ...solverScaling.sizes.flatMap(size => size.cpuCalibrationMs), ...solverScaling.drag.cpuCalibrationMs, ...dragPreview.flatMap(preview => preview.cpuCalibrationMs)];
if (drifted(calibrations)) {
  console.warn(`CPU calibration varied from ${Math.min(...calibrations)} to ${Math.max(...calibrations)} ms: the host throttled, so compare only steps with similar calibration.`);
}
await mkdir('tmp/cad-benchmark', { recursive: true });
const file = `tmp/cad-benchmark/${report.createdAt.replace(/[:.]/g, '-')}.json`;
await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Report: ${file}`);
if (kernel.some(testCase => testCase.steps.some(step => step.failures.length))) {
  console.error('A benchmark case produced incorrect geometry; its timings are not comparable.');
  process.exitCode = 1;
}
