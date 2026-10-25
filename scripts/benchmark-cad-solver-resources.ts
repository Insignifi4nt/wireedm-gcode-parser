import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import initPlaneGcs from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.js';
import { loadCadSketchNativeSolver } from '../src/features/cad/sketch-solver/native/cadSketchNativeSolver';
import { createCadBenchmarkNative, createCadBenchmarkPlaneGcs, type CadBenchmarkSolver } from '../src/features/cad/benchmark/cadSolverBenchmarkAdapters';
import { createCadBenchmarkRectangleGraph } from '../src/features/cad/benchmark/cadBenchmarkCases';
import { cadBenchmarkCpuCalibrationMs, cadBenchmarkStats } from '../src/features/cad/benchmark/cadBenchmark';
import { cadSolverCalibrationDrifted, cadSolverOutcome, checkCadSolverBenchmarkResult } from '../src/features/cad/benchmark/cadSolverWorkloadBenchmark';
import { createCadSolverDieInput, type CadSolverWorkloadCase } from '../src/features/cad/benchmark/cadSolverWorkloadCases';

export type SolverId = CadBenchmarkSolver['id'];
const wasmFile = (id: SolverId) => new URL(id === 'native' ? '../packages/sketch-solver/wasm/sketch_solver.wasm'
  : '../node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm', import.meta.url);

/** Explicit compilation separates compile from instantiation/glue. Capture actual exported
 * Memory objects rather than assuming a module's heap size. Each factory owns a fresh instance. */
export async function createNodeCadBenchmarkSolver(id: SolverId) {
  const before = performance.now(), bytes = await readFile(wasmFile(id)), readMs = performance.now() - before;
  const compileStarted = performance.now(), compiled = await WebAssembly.compile(bytes), compileMs = performance.now() - compileStarted;
  let memory: WebAssembly.Memory | undefined;
  const initializeStarted = performance.now();
  let solver: CadBenchmarkSolver;
  if (id === 'native') {
    const module = await loadCadSketchNativeSolver(compiled, value => { memory = value; });
    solver = createCadBenchmarkNative(async () => module);
  } else {
    const config = { locateFile: () => wasmFile(id).href, print: () => undefined, printErr: () => undefined,
      instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) {
        const instance = new WebAssembly.Instance(compiled, imports);
        memory = Object.values(instance.exports).find(value => value instanceof WebAssembly.Memory);
        receive(instance); return instance.exports;
      } };
    const module = await initPlaneGcs(config);
    solver = createCadBenchmarkPlaneGcs(async () => module);
  }
  const instantiateMs = performance.now() - initializeStarted;
  if (!memory) throw new Error(`Cannot observe ${id} WebAssembly.Memory.`);
  const observedMemory = memory;
  return { solver, memoryBytes: () => observedMemory.buffer.byteLength,
    cold: { localFileReadMs: readMs, compileMs, instantiateAndGlueMs: instantiateMs, totalMs: readMs + compileMs + instantiateMs },
    asset: { bytes: bytes.byteLength, gzipBytes: gzipSync(bytes).byteLength } };
}

export function measureColdCadBenchmarkSolvers() {
  return (['planegcs', 'native'] as const).map(id => {
    // A separate process per solver prevents V8's WASM compilation cache from warming the
    // other probe. OS disk caches are not flushed; this is not a browser/network fetch metric.
    const child = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--cold-probe', id], { encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, TSX_TSCONFIG_PATH: fileURLToPath(new URL('../tsconfig.app.json', import.meta.url)) } });
    if (child.status !== 0) throw new Error(`Cold ${id} probe failed: ${child.stderr || child.error}`);
    const result: unknown = JSON.parse(child.stdout);
    return result;
  });
}

function memoryDelta(before: NodeJS.MemoryUsage, after: NodeJS.MemoryUsage) {
  return { rss: after.rss - before.rss, heapUsed: after.heapUsed - before.heapUsed, external: after.external - before.external, arrayBuffers: after.arrayBuffers - before.arrayBuffers };
}

export async function measureCadSolverMemory(cases: readonly CadSolverWorkloadCase[], repeatedSolves: number) {
  const workloads = [];
  for (const testCase of cases) for (const id of ['planegcs', 'native'] as const) {
    const instance = await createNodeCadBenchmarkSolver(id), before = process.memoryUsage(), initialWasmBytes = instance.memoryBytes();
    const result = await instance.solver.solve(testCase.input);
    const after = process.memoryUsage();
    workloads.push({ workload: testCase.id, solver: id, outcome: cadSolverOutcome(result), initialWasmBytes,
      peakWasmCapacityBytes: instance.memoryBytes(), processMemoryDeltaBytes: memoryDelta(before, after), failures: checkCadSolverBenchmarkResult(testCase.input, result) });
  }
  const repeated = [];
  for (const id of ['planegcs', 'native'] as const) {
    const instance = await createNodeCadBenchmarkSolver(id), input = createCadSolverDieInput(), initial = await instance.solver.solve(input);
    if (initial.kind !== 'solved') throw new Error(`Cannot seed ${id} repeated solves.`);
    const solvedInput = { graph: initial.graph, parameters: input.parameters }, before = process.memoryUsage(), initialWasmBytes = instance.memoryBytes();
    const marks = [];
    for (let index = 1; index <= repeatedSolves; index++) {
      const result = await instance.solver.solve(solvedInput);
      const failures = checkCadSolverBenchmarkResult(solvedInput, result);
      if (result.kind !== 'solved' || failures.length) throw new Error(`${id} repeated solve ${index} failed: ${failures.join('; ')}`);
      if ([1, 10, 100, repeatedSolves].includes(index)) marks.push({ solves: index, wasmCapacityBytes: instance.memoryBytes(), processMemoryDeltaBytes: memoryDelta(before, process.memoryUsage()) });
    }
    repeated.push({ solver: id, workload: 'die-constrained already solved', initialWasmBytes, marks });
  }
  return { method: 'Fresh instance per workload; WASM capacity is a retained high-water allocation, not live bytes. Process deltas are boundary observations with uncontrolled GC, not attributable peaks. Temporary process allocation peaks and browser/network memory are unavailable.', workloads, repeated };
}

export async function probeCadSolverWorkloadCapacity() {
  const outcomes = new Map<number, Awaited<ReturnType<typeof measureSize>>>();
  async function measureSize(rectangles: number, orderOffset: number) {
    const input = { graph: createCadBenchmarkRectangleGraph(rectangles, 'r', false, true), parameters: {} };
    const measurements: { solver: SolverId; elapsedMs: number; outcome: string; failures: string[] }[] = [];
    const cpuCalibrationMs = [cadBenchmarkCpuCalibrationMs()];
    for (let run = 0; run < 3; run++) for (const id of (run + orderOffset) % 2 ? ['native', 'planegcs'] as const : ['planegcs', 'native'] as const) {
      const instance = await createNodeCadBenchmarkSolver(id);
      const started = performance.now(), result = await instance.solver.solve(input), elapsedMs = performance.now() - started;
      const failures = checkCadSolverBenchmarkResult(input, result);
      measurements.push({ solver: id, elapsedMs, outcome: cadSolverOutcome(result), failures });
    }
    cpuCalibrationMs.push(cadBenchmarkCpuCalibrationMs());
    return { rectangles, entities: rectangles * 4, parameters: rectangles * 8, scalarEquations: rectangles * 8,
      cpuCalibrationMs, throttled: cadSolverCalibrationDrifted(cpuCalibrationMs), measurements,
      solvers: (['planegcs', 'native'] as const).map(id => {
        const samples = measurements.filter(row => row.solver === id);
        return { solver: id, totalMs: cadBenchmarkStats(samples.map(row => row.elapsedMs)),
          under1s: samples.every(row => row.outcome === 'solved' && !row.failures.length) && cadBenchmarkStats(samples.map(row => row.elapsedMs)).p50 < 1000 };
      }) };
  }
  const probe = async (size: number) => { if (!outcomes.has(size)) outcomes.set(size, await measureSize(size, outcomes.size)); return outcomes.get(size)!; };
  const limits = [];
  for (const id of ['planegcs', 'native'] as const) {
    let low = 0, high: number | null = null;
    for (const size of [60, 88, 89, 128, 192, 256]) {
      const result = (await probe(size)).solvers.find(row => row.solver === id)!;
      if (!result.under1s) { high = size; break; } low = size;
    }
    if (high !== null) while (high - low > 1) {
      const mid = Math.floor((low + high) / 2), result = (await probe(mid)).solvers.find(row => row.solver === id)!;
      if (result.under1s) low = mid; else high = mid;
    }
    limits.push({ solver: id, largestConnectedRectanglesUnder1s: low || null, firstRejectedOrAtLeast1s: high,
      bound: high === null ? 'at least largest probed; search capped at 256 rectangles' : 'integer boundary, median of 3 fresh-instance public solves' });
  }
  const probes = [...outcomes.values()].sort((a, b) => a.rectangles - b.rectangles);
  return { limits: limits.map(limit => ({ ...limit,
    boundaryThrottled: probes.some(probe => (probe.rectangles === limit.largestConnectedRectanglesUnder1s || probe.rectangles === limit.firstRejectedOrAtLeast1s) && probe.throttled),
    largestUnthrottledSolvedUnder1s: Math.max(0, ...probes.filter(probe => !probe.throttled && probe.solvers.some(row => row.solver === limit.solver && row.under1s)).map(probe => probe.rectangles)) || null
  })), probes };
}

if (process.argv.includes('--cold-probe')) {
  const id = process.argv[process.argv.indexOf('--cold-probe') + 1];
  if (id !== 'native' && id !== 'planegcs') throw new Error('Unknown cold probe solver.');
  const instance = await createNodeCadBenchmarkSolver(id);
  console.log(JSON.stringify({ solver: id, ...instance.cold, ...instance.asset, wasmMemoryBytes: instance.memoryBytes(), fetch: 'local file read; browser/network fetch unavailable; OS cache not flushed' }));
}
