import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { loadCadSketchNativeSolver } from '../src/features/cad/sketch-solver/native/cadSketchNativeSolver';
import { createCadBenchmarkRuntime, type CadBenchmarkSolverId } from '../src/features/cad/benchmark/cadSolverBenchmarkAdapters';
import { createCadBenchmarkRectangleGraph } from '../src/features/cad/benchmark/cadBenchmarkCases';
import { cadBenchmarkCpuCalibrationMs, cadBenchmarkStats } from '../src/features/cad/benchmark/cadBenchmark';
import { createCadSolverDragTrajectories } from '../src/features/cad/benchmark/cadSolverDragCases';
import { cadSolverBoundaryThrottled, cadSolverCalibrationDrifted, cadSolverOutcome, cadSolverRecordKey, checkCadSolverBenchmarkResult } from '../src/features/cad/benchmark/cadSolverWorkloadBenchmark';
import { createCadSolverDieInput, type CadSolverWorkloadCase } from '../src/features/cad/benchmark/cadSolverWorkloadCases';

export const CAD_BENCHMARK_SOLVER_IDS = ['native'] as const satisfies readonly CadBenchmarkSolverId[];
const nativeWasm = new URL('../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url);
// The tsx package itself (`tsx`, `tsx/esm`) or a file inside its installed package, as a path or URL; any other preload is kept.
const TSX_LOADER = /^(tsx(\/[\w./-]*)?|.*[\\/]node_modules[\\/]tsx[\\/].*)$/;
/** Node and V8 flags of this process without the tsx loader, so cold probes run as the parent does and runs record them. */
export function cadBenchmarkExecArgv() {
  const loader = (flag: string, value = '') => /^(--require|-r|--import|--loader)(=|$)/.test(flag)
    && TSX_LOADER.test(flag.includes('=') ? flag.slice(flag.indexOf('=') + 1) : value);
  return process.execArgv.filter((flag, index, all) => !loader(flag, all[index + 1]) && !(index > 0 && !all[index - 1].includes('=') && loader(all[index - 1], flag)));
}

/** Explicit compilation separates compile from instantiation. Captures the exported Memory of each
 * instance rather than assuming its size. Each call owns a fresh runtime, which may replace its instance. */
export async function createNodeCadBenchmarkSolver() {
  const before = performance.now(), bytes = await readFile(nativeWasm), readMs = performance.now() - before;
  const compileStarted = performance.now(), compiled = await WebAssembly.compile(bytes), compileMs = performance.now() - compileStarted;
  let memory: WebAssembly.Memory | undefined, instances = 0;
  const loadNative = () => { instances++; return loadCadSketchNativeSolver(compiled, value => { memory = value; }); };
  // The runtime loads lazily, so the first instance is created here to time it apart from solving.
  const instantiateStarted = performance.now(), first = await loadNative(), instantiateMs = performance.now() - instantiateStarted;
  let fresh: typeof first | undefined = first;
  const solver = createCadBenchmarkRuntime(async () => { const instance = fresh ?? await loadNative(); fresh = undefined; return instance; });
  const memoryBytes = () => memory?.buffer.byteLength ?? 0;
  if (!memoryBytes()) throw new Error('Cannot observe the native WebAssembly.Memory.');
  return { solver, memoryBytes, nativeInstances: () => instances,
    cold: { localFileReadMs: readMs, compileMs, instantiateAndGlueMs: instantiateMs, totalMs: readMs + compileMs + instantiateMs },
    asset: { bytes: bytes.byteLength, gzipBytes: gzipSync(bytes).byteLength } };
}

/** First public answers from a fresh process, loading the module on demand as the worker does. */
export const CAD_SOLVER_COLD_SCENARIOS = { native: 'Load native and solve the die.' } as const;
type ColdScenario = keyof typeof CAD_SOLVER_COLD_SCENARIOS;

async function coldFirstAnswer(scenario: ColdScenario) {
  const input = createCadSolverDieInput(), started = performance.now();
  const solver = createCadBenchmarkRuntime(async () => loadCadSketchNativeSolver(await readFile(nativeWasm)));
  const result = await solver.solve(input), firstAnswerMs = performance.now() - started, record = solver.takeRecord();
  return { scenario, firstAnswerMs, outcome: cadSolverOutcome(result), answer: record && cadSolverRecordKey(record), nativeMs: record?.nativeMs,
    failures: checkCadSolverBenchmarkResult(input, result).map(failure => `cold/${scenario}: ${failure}`) };
}

function child(args: readonly string[]) {
  // A separate process per probe prevents V8's WASM compilation cache from warming another probe.
  // OS disk caches are not flushed; this is not a browser/network fetch metric. The source is named,
  // so a run bundled beside it (scripts/run-bundled.mjs) starts the same probe.
  const probe = fileURLToPath(new URL('./benchmark-cad-solver-resources.ts', import.meta.url));
  const run = spawnSync(process.execPath, [...cadBenchmarkExecArgv(), '--import', 'tsx', probe, ...args], { encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, TSX_TSCONFIG_PATH: fileURLToPath(new URL('../tsconfig.app.json', import.meta.url)) } });
  if (run.status !== 0) throw new Error(`Cold probe ${args.join(' ')} failed: ${run.stderr || run.error}`);
  // The probe's report is its last line.
  return JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1)!) as unknown;
}

/** The module breakdown once, then `runs` fresh processes per first-answer scenario, in one calibration bracket. */
export function measureColdCadBenchmarkSolvers(runs: number) {
  const before = cadBenchmarkCpuCalibrationMs();
  const modules = [child(['--cold-probe'])];
  const scenarios = Object.keys(CAD_SOLVER_COLD_SCENARIOS) as ColdScenario[];
  const samples = new Map(scenarios.map(scenario => [scenario, [] as Awaited<ReturnType<typeof coldFirstAnswer>>[]]));
  for (let run = 0; run < runs; run++) for (const scenario of scenarios) samples.get(scenario)!.push(child(['--cold-answer', scenario]) as Awaited<ReturnType<typeof coldFirstAnswer>>);
  const cpuCalibrationMs = [before, cadBenchmarkCpuCalibrationMs()];
  return { cpuCalibrationMs, throttled: cadSolverCalibrationDrifted(cpuCalibrationMs), modules, firstAnswer: scenarios.map(scenario => {
    const rows = samples.get(scenario)!;
    return { scenario, description: CAD_SOLVER_COLD_SCENARIOS[scenario], firstAnswerMs: cadBenchmarkStats(rows.map(row => row.firstAnswerMs)),
      outcomes: [...new Set(rows.map(row => `${row.outcome} ${row.answer ?? ''}`.trim()))], samples: rows };
  }) };
}

function memoryDelta(before: NodeJS.MemoryUsage, after: NodeJS.MemoryUsage) {
  return { rss: after.rss - before.rss, heapUsed: after.heapUsed - before.heapUsed, external: after.external - before.external, arrayBuffers: after.arrayBuffers - before.arrayBuffers };
}

export async function measureCadSolverMemory(cases: readonly CadSolverWorkloadCase[], repeatedSolves: number) {
  const workloads = [];
  for (const testCase of cases) {
    const instance = await createNodeCadBenchmarkSolver(), before = process.memoryUsage(), initialWasmBytes = instance.memoryBytes();
    const result = await instance.solver.solve(testCase.input), record = instance.solver.takeRecord();
    const after = process.memoryUsage();
    workloads.push({ workload: testCase.id, solver: instance.solver.id, outcome: cadSolverOutcome(result), answer: record && cadSolverRecordKey(record),
      initialWasmBytes, peakWasmCapacityBytes: instance.memoryBytes(), processMemoryDeltaBytes: memoryDelta(before, after), failures: checkCadSolverBenchmarkResult(testCase.input, result) });
  }
  // Repeated solves of the solved die, then the die-slot trajectory from its start, frame after frame.
  const trajectory = createCadSolverDragTrajectories().find(item => item.id === 'die-slot')!;
  const repeated = [];
  for (const kind of ['solves', 'drags'] as const) {
    const instance = await createNodeCadBenchmarkSolver(), id = instance.solver.id, input = kind === 'solves' ? createCadSolverDieInput() : trajectory.input, initial = await instance.solver.solve(input);
    if (initial.kind !== 'solved') throw new Error(`Cannot seed ${id} repeated ${kind}.`);
    const solvedInput = { graph: initial.graph, parameters: input.parameters }, before = process.memoryUsage(), initialWasmBytes = instance.memoryBytes();
    const marks = [], resets: Record<string, number> = {};
    for (let index = 1; index <= repeatedSolves; index++) {
      const next = kind === 'solves' ? solvedInput : { ...solvedInput, drag: trajectory.frames[(index - 1) % trajectory.frames.length] };
      const result = await instance.solver.solve(next), record = instance.solver.takeRecord();
      const failures = checkCadSolverBenchmarkResult(next, result);
      if (record?.nativeReset) resets[record.nativeReset] = (resets[record.nativeReset] ?? 0) + 1;
      if ((kind === 'solves' && result.kind !== 'solved') || failures.length) throw new Error(`${id} repeated ${kind} ${index} failed: ${failures.join('; ') || cadSolverOutcome(result)}`);
      if ([1, 10, 100, repeatedSolves].includes(index)) marks.push({ calls: index, wasmCapacityBytes: instance.memoryBytes(), processMemoryDeltaBytes: memoryDelta(before, process.memoryUsage()) });
    }
    repeated.push({ solver: id, workload: kind === 'solves' ? 'die-constrained already solved' : 'die-slot frames from the start, repeated', initialWasmBytes, marks,
      nativeInstances: instance.nativeInstances(), nativeResets: resets });
  }
  return { method: 'Fresh instances per workload; WASM capacity is the current native instance\'s retained high-water allocation, not live bytes. Process deltas are boundary observations with uncontrolled GC, not attributable peaks. Temporary process allocation peaks and browser/network memory are unavailable.', workloads, repeated };
}

/** The largest connected rectangle group each solver answers in under 1 s from a fresh instance: a ladder of sizes, then bisection to the integer boundary. */
export async function probeCadSolverWorkloadCapacity() {
  const outcomes = new Map<number, Awaited<ReturnType<typeof measureSize>>>();
  async function measureSize(rectangles: number) {
    const input = { graph: createCadBenchmarkRectangleGraph(rectangles, 'r', false, true), parameters: {} };
    const measurements: { solver: string; elapsedMs: number; outcome: string; failures: string[] }[] = [];
    const cpuCalibrationMs = [cadBenchmarkCpuCalibrationMs()];
    for (let run = 0; run < 3; run++) {
      const instance = await createNodeCadBenchmarkSolver();
      const started = performance.now(), result = await instance.solver.solve(input), elapsedMs = performance.now() - started;
      const failures = checkCadSolverBenchmarkResult(input, result);
      measurements.push({ solver: instance.solver.id, elapsedMs, outcome: cadSolverOutcome(result), failures });
    }
    cpuCalibrationMs.push(cadBenchmarkCpuCalibrationMs());
    return { rectangles, entities: rectangles * 4, parameters: rectangles * 8, scalarEquations: rectangles * 8,
      cpuCalibrationMs, throttled: cadSolverCalibrationDrifted(cpuCalibrationMs), measurements,
      solvers: CAD_BENCHMARK_SOLVER_IDS.map(id => {
        const samples = measurements.filter(row => row.solver === id);
        return { solver: id, totalMs: cadBenchmarkStats(samples.map(row => row.elapsedMs)),
          under1s: samples.every(row => row.outcome === 'solved' && !row.failures.length) && cadBenchmarkStats(samples.map(row => row.elapsedMs)).p50 < 1000 };
      }) };
  }
  const probe = async (size: number) => { if (!outcomes.has(size)) outcomes.set(size, await measureSize(size)); return outcomes.get(size)!; };
  const limits = [];
  for (const id of CAD_BENCHMARK_SOLVER_IDS) {
    let low = 0, high: number | null = null;
    for (const size of [60, 88, 89, 128, 256, 512, 1024, 2048, 4096]) {
      const result = (await probe(size)).solvers.find(row => row.solver === id)!;
      if (!result.under1s) { high = size; break; } low = size;
    }
    if (high !== null) while (high - low > 1) {
      const mid = Math.floor((low + high) / 2), result = (await probe(mid)).solvers.find(row => row.solver === id)!;
      if (result.under1s) low = mid; else high = mid;
    }
    limits.push({ solver: id, largestConnectedRectanglesUnder1s: low || null, firstRejectedOrAtLeast1s: high,
      bound: high === null ? 'at least largest probed; search capped at 4096 rectangles' : 'integer boundary, median of 3 fresh-instance public solves' });
  }
  const probes = [...outcomes.values()].sort((a, b) => a.rectangles - b.rectangles);
  return { limits: limits.map(limit => ({ ...limit,
    boundaryThrottled: cadSolverBoundaryThrottled([limit.largestConnectedRectanglesUnder1s, limit.firstRejectedOrAtLeast1s].map(size => probes.find(probe => probe.rectangles === size))),
    largestUnthrottledSolvedUnder1s: Math.max(0, ...probes.filter(probe => !probe.throttled && probe.solvers.some(row => row.solver === limit.solver && row.under1s)).map(probe => probe.rectangles)) || null
  })), probes };
}

if (process.argv.includes('--cold-probe')) {
  const instance = await createNodeCadBenchmarkSolver();
  console.log(JSON.stringify({ module: 'native', ...instance.cold, ...instance.asset, wasmMemoryBytes: instance.memoryBytes(), fetch: 'local file read; browser/network fetch unavailable; OS cache not flushed' }));
}
if (process.argv.includes('--cold-answer')) {
  const scenario = process.argv[process.argv.indexOf('--cold-answer') + 1];
  if (!(scenario in CAD_SOLVER_COLD_SCENARIOS)) throw new Error('Unknown cold answer scenario.');
  console.log(JSON.stringify(await coldFirstAnswer(scenario as ColdScenario)));
}
