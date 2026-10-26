import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import initPlaneGcs from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.js';
import { loadCadSketchNativeSolver } from '../src/features/cad/sketch-solver/native/cadSketchNativeSolver';
import { createCadBenchmarkPlaneGcs, createCadBenchmarkRuntime, type CadBenchmarkSolver, type CadBenchmarkSolverId } from '../src/features/cad/benchmark/cadSolverBenchmarkAdapters';
import { createCadBenchmarkRectangleGraph } from '../src/features/cad/benchmark/cadBenchmarkCases';
import { cadBenchmarkCpuCalibrationMs, cadBenchmarkStats } from '../src/features/cad/benchmark/cadBenchmark';
import { createCadSolverDragTrajectories } from '../src/features/cad/benchmark/cadSolverDragCases';
import { cadSolverBoundaryThrottled, cadSolverCalibrationDrifted, cadSolverOutcome, cadSolverRecordKey, checkCadSolverBenchmarkResult } from '../src/features/cad/benchmark/cadSolverWorkloadBenchmark';
import { createCadSolverDieInput, createCadSolverWorkloadCases, type CadSolverWorkloadCase } from '../src/features/cad/benchmark/cadSolverWorkloadCases';

export const CAD_BENCHMARK_SOLVER_IDS = ['planegcs', 'native-only', 'native-first'] as const satisfies readonly CadBenchmarkSolverId[];
const wasmFile = (module: 'native' | 'planegcs') => new URL(module === 'native' ? '../packages/sketch-solver/wasm/sketch_solver.wasm'
  : '../node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm', import.meta.url);
const quiet = { print: () => undefined, printErr: () => undefined };

/** Explicit compilation separates compile from instantiation/glue. Capture actual exported Memory
 * objects rather than assuming a module's heap size. Each factory owns fresh instances; a native
 * runtime may replace its instance, and native-first creates PlaneGCS only on its first fallback. */
export async function createNodeCadBenchmarkSolver(id: CadBenchmarkSolverId) {
  const module = id === 'planegcs' ? 'planegcs' : 'native';
  const before = performance.now(), bytes = await readFile(wasmFile(module)), readMs = performance.now() - before;
  const compileStarted = performance.now(), compiled = await WebAssembly.compile(bytes), compileMs = performance.now() - compileStarted;
  let nativeMemory: WebAssembly.Memory | undefined, planeGcsMemory: WebAssembly.Memory | undefined, nativeInstances = 0;
  const planeGcs = async (compiledPlaneGcs: WebAssembly.Module) => initPlaneGcs({ ...quiet, locateFile: () => wasmFile('planegcs').href,
    instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) {
      const instance = new WebAssembly.Instance(compiledPlaneGcs, imports);
      planeGcsMemory = Object.values(instance.exports).find(value => value instanceof WebAssembly.Memory);
      receive(instance); return instance.exports;
    } });
  const loadNative = () => { nativeInstances++; return loadCadSketchNativeSolver(compiled, value => { nativeMemory = value; }); };
  const initializeStarted = performance.now();
  let solver: CadBenchmarkSolver;
  if (id === 'planegcs') { const instance = await planeGcs(compiled); solver = createCadBenchmarkPlaneGcs(async () => instance); }
  else {
    // The runtime loads lazily, so the first instance is created here to time it apart from solving.
    const first = await loadNative();
    let fresh: typeof first | undefined = first;
    solver = createCadBenchmarkRuntime(id, async () => { const instance = fresh ?? await loadNative(); fresh = undefined; return instance; },
      id === 'native-first' ? async () => planeGcs(await WebAssembly.compile(await readFile(wasmFile('planegcs')))) : undefined);
  }
  const instantiateMs = performance.now() - initializeStarted;
  const memory = () => (nativeMemory?.buffer.byteLength ?? 0) + (planeGcsMemory?.buffer.byteLength ?? 0);
  if (!memory()) throw new Error(`Cannot observe ${id} WebAssembly.Memory.`);
  return { solver, memoryBytes: memory, planeGcsLoaded: () => planeGcsMemory !== undefined, nativeInstances: () => nativeInstances,
    cold: { localFileReadMs: readMs, compileMs, instantiateAndGlueMs: instantiateMs, totalMs: readMs + compileMs + instantiateMs },
    asset: { bytes: bytes.byteLength, gzipBytes: gzipSync(bytes).byteLength } };
}

/** First public answers from a fresh process, loading modules on demand as the worker does. */
export const CAD_SOLVER_COLD_SCENARIOS = {
  planegcs: 'PlaneGCS alone: load PlaneGCS and solve the die.',
  'native-only': 'Native only: load native and solve the die.',
  'native-first': 'Native first: load native and solve the die, which native answers without PlaneGCS.',
  'native-first-fallback': 'Native first: load native, then PlaneGCS for the overlapping conflicts native cannot attribute, and answer.'
} as const;
type ColdScenario = keyof typeof CAD_SOLVER_COLD_SCENARIOS;

async function coldFirstAnswer(scenario: ColdScenario) {
  const input = scenario === 'native-first-fallback' ? createCadSolverWorkloadCases().find(testCase => testCase.id === 'overlapping-conflicts')!.input : createCadSolverDieInput();
  const started = performance.now();
  const loadNative = async () => loadCadSketchNativeSolver(await readFile(wasmFile('native')));
  const initializePlaneGcs = () => initPlaneGcs({ ...quiet, locateFile: () => wasmFile('planegcs').href });
  const solver = scenario === 'planegcs' ? createCadBenchmarkPlaneGcs(initializePlaneGcs)
    : createCadBenchmarkRuntime(scenario === 'native-only' ? 'native-only' : 'native-first', loadNative, initializePlaneGcs);
  const result = await solver.solve(input), firstAnswerMs = performance.now() - started, record = solver.takeRecord();
  return { scenario, firstAnswerMs, outcome: cadSolverOutcome(result), answer: record && cadSolverRecordKey(record), nativeMs: record?.nativeMs, planeGcsMs: record?.planeGcsMs };
}

function child(args: readonly string[]) {
  // A separate process per probe prevents V8's WASM compilation cache from warming another probe.
  // OS disk caches are not flushed; this is not a browser/network fetch metric.
  const run = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), ...args], { encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, TSX_TSCONFIG_PATH: fileURLToPath(new URL('../tsconfig.app.json', import.meta.url)) } });
  if (run.status !== 0) throw new Error(`Cold probe ${args.join(' ')} failed: ${run.stderr || run.error}`);
  // PlaneGCS prints its own progress lines; the probe's report is the last line.
  return JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1)!) as unknown;
}

/** Module breakdowns once each, then `runs` fresh processes per first-answer scenario in rotating order. */
export function measureColdCadBenchmarkSolvers(runs: number) {
  const modules = (['planegcs', 'native'] as const).map(module => child(['--cold-probe', module === 'native' ? 'native-only' : 'planegcs']));
  const scenarios = Object.keys(CAD_SOLVER_COLD_SCENARIOS) as ColdScenario[];
  const samples = new Map(scenarios.map(scenario => [scenario, [] as Awaited<ReturnType<typeof coldFirstAnswer>>[]]));
  for (let run = 0; run < runs; run++) for (const [index] of scenarios.entries()) {
    const scenario = scenarios[(index + run) % scenarios.length];
    samples.get(scenario)!.push(child(['--cold-answer', scenario]) as Awaited<ReturnType<typeof coldFirstAnswer>>);
  }
  return { modules, firstAnswer: scenarios.map(scenario => {
    const rows = samples.get(scenario)!;
    return { scenario, description: CAD_SOLVER_COLD_SCENARIOS[scenario], firstAnswerMs: cadBenchmarkStats(rows.map(row => row.firstAnswerMs)),
      outcomes: [...new Set(rows.map(row => `${row.outcome} ${row.answer ?? ''}`.trim()))], samples: rows };
  }) };
}

function memoryDelta(before: NodeJS.MemoryUsage, after: NodeJS.MemoryUsage) {
  return { rss: after.rss - before.rss, heapUsed: after.heapUsed - before.heapUsed, external: after.external - before.external, arrayBuffers: after.arrayBuffers - before.arrayBuffers };
}

export async function measureCadSolverMemory(cases: readonly CadSolverWorkloadCase[], repeatedSolves: number, solverIds: readonly CadBenchmarkSolverId[] = CAD_BENCHMARK_SOLVER_IDS) {
  const workloads = [];
  for (const testCase of cases) for (const id of solverIds) {
    const instance = await createNodeCadBenchmarkSolver(id), before = process.memoryUsage(), initialWasmBytes = instance.memoryBytes();
    const result = await instance.solver.solve(testCase.input), record = instance.solver.takeRecord();
    const after = process.memoryUsage();
    workloads.push({ workload: testCase.id, solver: id, outcome: cadSolverOutcome(result), answer: record && cadSolverRecordKey(record), planeGcsLoaded: instance.planeGcsLoaded(),
      initialWasmBytes, peakWasmCapacityBytes: instance.memoryBytes(), processMemoryDeltaBytes: memoryDelta(before, after), failures: checkCadSolverBenchmarkResult(testCase.input, result) });
  }
  // Repeated solves of the solved die, then the die-slot trajectory from its start, frame after frame.
  const trajectory = createCadSolverDragTrajectories().find(item => item.id === 'die-slot')!;
  const repeated = [];
  for (const id of solverIds) for (const kind of ['solves', 'drags'] as const) {
    const instance = await createNodeCadBenchmarkSolver(id), input = kind === 'solves' ? createCadSolverDieInput() : trajectory.input, initial = await instance.solver.solve(input);
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
      nativeInstances: instance.nativeInstances(), nativeResets: resets, planeGcsLoaded: instance.planeGcsLoaded() });
  }
  return { method: 'Fresh instances per workload; WASM capacity is a retained high-water allocation, not live bytes, summed over native and PlaneGCS when native-first loaded both. Process deltas are boundary observations with uncontrolled GC, not attributable peaks. Temporary process allocation peaks and browser/network memory are unavailable.', workloads, repeated };
}

/** Native-first is left out: its capacity is native's, as a group native refuses as too large is too large for PlaneGCS too. */
export async function probeCadSolverWorkloadCapacity(solverIds: readonly ('planegcs' | 'native-only')[] = ['planegcs', 'native-only']) {
  const outcomes = new Map<number, Awaited<ReturnType<typeof measureSize>>>();
  async function measureSize(rectangles: number, orderOffset: number) {
    const input = { graph: createCadBenchmarkRectangleGraph(rectangles, 'r', false, true), parameters: {} };
    const measurements: { solver: string; elapsedMs: number; outcome: string; failures: string[] }[] = [];
    const cpuCalibrationMs = [cadBenchmarkCpuCalibrationMs()];
    for (let run = 0; run < 3; run++) for (const id of (run + orderOffset) % 2 ? [...solverIds].reverse() : solverIds) {
      const instance = await createNodeCadBenchmarkSolver(id);
      const started = performance.now(), result = await instance.solver.solve(input), elapsedMs = performance.now() - started;
      const failures = checkCadSolverBenchmarkResult(input, result);
      measurements.push({ solver: id, elapsedMs, outcome: cadSolverOutcome(result), failures });
    }
    cpuCalibrationMs.push(cadBenchmarkCpuCalibrationMs());
    return { rectangles, entities: rectangles * 4, parameters: rectangles * 8, scalarEquations: rectangles * 8,
      cpuCalibrationMs, throttled: cadSolverCalibrationDrifted(cpuCalibrationMs), measurements,
      solvers: solverIds.map(id => {
        const samples = measurements.filter(row => row.solver === id);
        return { solver: id, totalMs: cadBenchmarkStats(samples.map(row => row.elapsedMs)),
          under1s: samples.every(row => row.outcome === 'solved' && !row.failures.length) && cadBenchmarkStats(samples.map(row => row.elapsedMs)).p50 < 1000 };
      }) };
  }
  const probe = async (size: number) => { if (!outcomes.has(size)) outcomes.set(size, await measureSize(size, outcomes.size)); return outcomes.get(size)!; };
  const limits = [];
  for (const id of solverIds) {
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
  const id = process.argv[process.argv.indexOf('--cold-probe') + 1];
  if (id !== 'native-only' && id !== 'planegcs') throw new Error('Unknown cold probe solver.');
  const instance = await createNodeCadBenchmarkSolver(id);
  console.log(JSON.stringify({ module: id === 'planegcs' ? 'planegcs' : 'native', ...instance.cold, ...instance.asset, wasmMemoryBytes: instance.memoryBytes(), fetch: 'local file read; browser/network fetch unavailable; OS cache not flushed' }));
}
if (process.argv.includes('--cold-answer')) {
  const scenario = process.argv[process.argv.indexOf('--cold-answer') + 1];
  if (!(scenario in CAD_SOLVER_COLD_SCENARIOS)) throw new Error('Unknown cold answer scenario.');
  console.log(JSON.stringify(await coldFirstAnswer(scenario as ColdScenario)));
}
