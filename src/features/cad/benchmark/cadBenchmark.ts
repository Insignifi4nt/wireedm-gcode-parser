import type { CadBuildResult, CadDocument } from '@/domain/cad/cadDocument';
import { prepareCadEdits } from '../cadEditPreparation';
import { prepareCadMeshDisplay } from '../cadMeshDisplay';
import { buildCadKernelModel } from '../kernel/cadKernelModel';
import { createCadKernelRuntime } from '../kernel/cadKernelRuntime';
import { isCadKernelReply, type CadKernelReply } from '../kernel/cadKernelProtocol';
import type { CadSketchSolveInput, CadSketchSolveResult } from '../sketch-solver/cadSketchSolverTypes';
import { cadBenchmarkVolumeMatches, createCadBenchmarkDragPreview, createCadBenchmarkRectangleGraph, type CadBenchmarkStep, type CadKernelBenchmarkCase } from './cadBenchmarkCases';

export interface CadBenchmarkStats { readonly runs: number; readonly p50: number; readonly p95: number; readonly min: number; readonly max: number }
/** Nearest-rank percentiles; a handful of runs makes p95 the slowest-but-one or the maximum. */
export function cadBenchmarkStats(samples: readonly number[]): CadBenchmarkStats {
  if (!samples.length) throw new Error('A benchmark statistic needs at least one sample.');
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = (percentile: number) => sorted[Math.min(sorted.length - 1, Math.ceil(percentile * sorted.length) - 1)];
  const round = (value: number) => Math.round(value * 100) / 100;
  return { runs: sorted.length, p50: round(rank(.5)), p95: round(rank(.95)), min: round(sorted[0]), max: round(sorted.at(-1)!) };
}
function time(run: () => void): number {
  const started = performance.now(); run(); return performance.now() - started;
}
async function timeAsync(run: () => Promise<unknown>): Promise<number> {
  const started = performance.now(); await run(); return performance.now() - started;
}
/**
 * Fixed pure-JavaScript workload. Laptops drop clock speed under sustained load (one dev host
 * runs this 3.5x slower after about three seconds), so every timing records this beside it.
 */
export function cadBenchmarkCpuCalibrationMs(): number {
  let total = 0;
  const elapsed = time(() => { for (let index = 0; index < 2e7; index++) total += Math.sqrt(index); });
  if (!Number.isFinite(total)) throw new Error('The CPU calibration workload overflowed.');
  return Math.round(elapsed * 100) / 100;
}
/** Wrapper finalizers get a turn between builds, as they would between user edits. */
const yieldTurn = () => new Promise(resolve => setTimeout(resolve, 0));

/** Returns every mismatch between a build and its analytic expectations; empty means correct. */
export function checkCadBenchmarkStep(result: CadBuildResult, step: Pick<CadBenchmarkStep, 'label' | 'bodies'>): string[] {
  const failures = result.diagnostics.map(diagnostic => `${step.label}: diagnostic ${diagnostic.code} ${diagnostic.message}`);
  const meshes = new Map(result.meshes.map(mesh => [mesh.featureId, mesh]));
  if (meshes.size !== step.bodies.length) failures.push(`${step.label}: expected ${step.bodies.length} bodies, built ${meshes.size}`);
  for (const body of step.bodies) {
    const mesh = meshes.get(body.featureId);
    if (!mesh) { failures.push(`${step.label}: missing body ${body.featureId}`); continue; }
    if (!cadBenchmarkVolumeMatches(mesh.volume, body.volume)) failures.push(`${step.label}: ${body.featureId} volume ${mesh.volume} != ${body.volume}`);
    if (body.solidCount !== undefined && mesh.solidCount !== body.solidCount) failures.push(`${step.label}: ${body.featureId} solids ${mesh.solidCount} != ${body.solidCount}`);
  }
  return failures;
}

/** Size of the plain-array payload that crosses the worker boundary for one build. */
function payload(result: CadBuildResult) {
  let numbers = 0, triangles = 0;
  for (const mesh of result.meshes) {
    numbers += mesh.positions.length + mesh.normals.length + mesh.indices.length + mesh.edges.length;
    triangles += mesh.indices.length / 3;
  }
  return { triangles, numbers, jsonBytes: JSON.stringify(result).length };
}

async function shippedBuild(runtime: ReturnType<typeof createCadKernelRuntime>, document: CadDocument, id: number) {
  const reply = await runtime.evaluate({ id, kind: 'build', document });
  if (reply.kind !== 'built') throw new Error(`Benchmark build failed: ${reply.kind === 'error' ? reply.message : reply.kind}`);
  return reply;
}

export interface CadKernelStepMeasurement {
  readonly label: string;
  readonly failures: readonly string[];
  /** cadBenchmarkCpuCalibrationMs between this step's measurement groups, so each group is bracketed. */
  readonly cpuCalibrationMs: { readonly beforeBuild: number; readonly beforeEdit: number; readonly beforeMainThread: number; readonly after: number };
  /** First build of this document after WASM initialization; only the first step has one. */
  readonly coldMs?: number;
  /** Uncached native builds of the complete document. */
  readonly buildMs: CadBenchmarkStats;
  /** Edit from the previous step through the shipped worker runtime and its whole-document cache. */
  readonly shippedEditMs?: CadBenchmarkStats;
  /**
   * Uncached build of only the bodies the edit changes, sampled alternately with shippedEditMs so
   * both see the same clock speed. A rebuild that reuses unaffected bodies should not exceed it.
   */
  readonly affectedBodiesMs?: CadBenchmarkStats;
  readonly payload: ReturnType<typeof payload>;
  /** Main-thread work per reply: structured-clone transfer, reply validation and display preparation. */
  readonly mainThread: { readonly cloneMs: CadBenchmarkStats; readonly validateMs: CadBenchmarkStats; readonly displayMs: CadBenchmarkStats };
}
export interface CadKernelCaseMeasurement {
  readonly id: string; readonly description: string; readonly steps: readonly CadKernelStepMeasurement[];
  /** WASM linear-memory capacity after repeated edits through one shipped runtime, alternating the steps. */
  readonly memoryBytesAfterRebuilds: Readonly<Record<string, number>>;
}

/** Times one uncached build; the first run's geometry is checked outside the timer. */
function timedBuild(document: CadDocument, check?: (result: CadBuildResult) => void): number {
  let model: ReturnType<typeof buildCadKernelModel> | undefined;
  try {
    const elapsed = time(() => { model = buildCadKernelModel(document); });
    check?.(model!.result);
    return elapsed;
  } finally { model?.dispose(); }
}

/** The native kernel must already be initialized; memoryBytes reads its linear-memory capacity. */
export async function measureCadKernelCase(testCase: CadKernelBenchmarkCase, options: { runs: number; memoryMarks: readonly number[]; memoryBytes: () => number }): Promise<CadKernelCaseMeasurement> {
  const runtime = createCadKernelRuntime(async () => undefined);
  const steps: CadKernelStepMeasurement[] = [];
  const memoryBytesAfterRebuilds: Record<string, number> = {};
  let id = 0;
  try {
    for (const [index, step] of testCase.steps.entries()) {
      let coldMs: number | undefined;
      const failures: string[] = [];
      const beforeBuild = cadBenchmarkCpuCalibrationMs();
      const builds: number[] = [];
      for (let run = 0; run <= options.runs; run++) {
        const elapsed = timedBuild(step.document);
        if (run === 0) { if (index === 0) coldMs = elapsed; } else builds.push(elapsed);
        await yieldTurn();
      }
      const beforeEdit = cadBenchmarkCpuCalibrationMs();
      const shipped: number[] = [], affected: number[] = [];
      let reply: Extract<CadKernelReply, { kind: 'built' }> | undefined;
      for (let run = 0; run < options.runs; run++) {
        if (index > 0) await shippedBuild(runtime, testCase.steps[index - 1].document, ++id);
        const started = performance.now();
        reply = await shippedBuild(runtime, step.document, ++id);
        if (index > 0) shipped.push(performance.now() - started);
        await yieldTurn();
        const expected = step.affectedBodies;
        if (expected) {
          affected.push(timedBuild(expected.document, run ? undefined : result => failures.push(...checkCadBenchmarkStep(result, { label: `${step.label} affected bodies`, bodies: expected.bodies }))));
          await yieldTurn();
        }
      }
      if (!reply) throw new Error('A benchmark step needs at least one run.');
      failures.unshift(...checkCadBenchmarkStep(reply.result, step));
      const beforeMainThread = cadBenchmarkCpuCalibrationMs();
      const clone: number[] = [], validate: number[] = [], display: number[] = [];
      for (let run = 0; run < options.runs; run++) {
        clone.push(time(() => structuredClone(reply)));
        validate.push(time(() => { if (!isCadKernelReply(reply)) throw new Error('The benchmark reply failed protocol validation.'); }));
        display.push(time(() => { for (const mesh of reply!.result.meshes) prepareCadMeshDisplay(mesh); }));
      }
      steps.push({ label: step.label, failures, cpuCalibrationMs: { beforeBuild, beforeEdit, beforeMainThread, after: cadBenchmarkCpuCalibrationMs() },
        ...(coldMs === undefined ? {} : { coldMs: Math.round(coldMs * 100) / 100 }),
        buildMs: cadBenchmarkStats(builds), ...(shipped.length ? { shippedEditMs: cadBenchmarkStats(shipped) } : {}),
        ...(affected.length ? { affectedBodiesMs: cadBenchmarkStats(affected) } : {}), payload: payload(reply.result),
        mainThread: { cloneMs: cadBenchmarkStats(clone), validateMs: cadBenchmarkStats(validate), displayMs: cadBenchmarkStats(display) } });
    }
    // The last step is cached now. Cycling from the first step defeats the whole-document cache,
    // so every counted cycle replaces the cached model.
    const last = Math.max(0, ...options.memoryMarks);
    if (last && testCase.steps.length < 2) throw new Error(`Memory checkpoints need at least two steps in ${testCase.id}.`);
    for (let cycle = 1; cycle <= last; cycle++) {
      await shippedBuild(runtime, testCase.steps[(cycle - 1) % testCase.steps.length].document, ++id);
      await yieldTurn();
      if (options.memoryMarks.includes(cycle)) memoryBytesAfterRebuilds[cycle] = options.memoryBytes();
    }
  } finally { runtime.dispose(); }
  return { id: testCase.id, description: testCase.description, steps, memoryBytesAfterRebuilds };
}

export interface CadSketchSolver { solve(input: CadSketchSolveInput, signal?: AbortSignal): Promise<CadSketchSolveResult> }
const rectangleCost = (rectangles: number) => ({ rectangles, entities: rectangles * 4, relations: rectangles * 7 });

/** Warm solve latency by independent-rectangle count, plus one drag solve on the middle size. */
export async function measureCadSolverScaling(solver: CadSketchSolver, options: { sizes: readonly number[]; dragSize: number; runs: number }) {
  const sizes = [];
  for (const size of options.sizes) {
    const graph = createCadBenchmarkRectangleGraph(size), samples: number[] = [];
    let result: CadSketchSolveResult | undefined;
    const before = cadBenchmarkCpuCalibrationMs();
    for (let run = 0; run <= options.runs; run++) {
      const elapsed = await timeAsync(async () => { result = await solver.solve({ graph, parameters: {} }); });
      if (run > 0) samples.push(elapsed);
    }
    sizes.push({ ...rectangleCost(size), cpuCalibrationMs: [before, cadBenchmarkCpuCalibrationMs()] as const, outcome: result?.kind ?? 'none', degreesOfFreedom: result?.diagnostics.degreesOfFreedom ?? null, solveMs: cadBenchmarkStats(samples) });
  }
  // Releasing a fixed corner gives the drag freedom to move, as an interactive drag would.
  const free = createCadBenchmarkRectangleGraph(options.dragSize);
  const graph = { ...free, relations: free.relations.filter(relation => relation.id !== 'r0_fixed') };
  const drag: number[] = [];
  let dragOutcome = 'none';
  const beforeDrag = cadBenchmarkCpuCalibrationMs();
  for (let run = 0; run <= options.runs; run++) {
    const position: [number, number] = [1 + run * .1, 2 + run * .1];
    let result: CadSketchSolveResult | undefined;
    const elapsed = await timeAsync(async () => { result = await solver.solve({ graph, parameters: {}, drag: { pointId: 'r0_p0', position } }); });
    dragOutcome = result?.kind ?? 'none';
    if (run > 0) drag.push(elapsed);
  }
  return { sizes, drag: { ...rectangleCost(options.dragSize), cpuCalibrationMs: [beforeDrag, cadBenchmarkCpuCalibrationMs()] as const, outcome: dragOutcome, solveMs: cadBenchmarkStats(drag) } };
}

/**
 * PlaneGCS has fixed linear memory and aborts with OOM, leaving its module unusable, so each
 * size gets a fresh solver. Reports the largest size that solved and the first that did not.
 */
export async function probeCadSolverCapacity(createFreshSolver: () => CadSketchSolver, sizes: readonly number[]) {
  const outcomes: { rectangles: number; outcome: string; message?: string }[] = [];
  let largestSolved: number | null = null, firstFailed: number | null = null;
  for (const size of sizes) {
    try {
      const result = await createFreshSolver().solve({ graph: createCadBenchmarkRectangleGraph(size), parameters: {} });
      outcomes.push({ rectangles: size, outcome: result.kind, ...(result.kind === 'rejected' ? { message: result.message } : {}) });
      if (result.kind === 'solved') largestSolved = size; else firstFailed ??= size;
    } catch (error) {
      outcomes.push({ rectangles: size, outcome: 'aborted', message: error instanceof Error ? error.message.slice(0, 200) : String(error) });
      firstFailed ??= size;
    }
  }
  return { largestSolved, firstFailed, outcomes };
}

/** One drag-preview preparation of a single point move, across documents with more independent sketches. */
export async function measureCadDragPreview(solver: CadSketchSolver, options: { sketchCounts: readonly number[]; rectanglesPerSketch: number; runs: number }) {
  const results = [];
  for (const sketchCount of options.sketchCounts) {
    const { document, edit } = createCadBenchmarkDragPreview(sketchCount, options.rectanglesPerSketch);
    let solves = 0;
    const counted: CadSketchSolver = { solve: (input, signal) => { solves++; return solver.solve(input, signal); } };
    const before = cadBenchmarkCpuCalibrationMs();
    const samples: number[] = [];
    for (let run = 0; run <= options.runs; run++) {
      solves = 0;
      const elapsed = await timeAsync(() => prepareCadEdits(document, [edit], counted));
      if (run > 0) samples.push(elapsed);
    }
    const cpuCalibrationMs = [before, cadBenchmarkCpuCalibrationMs()] as const;
    results.push({ sketchCount, rectanglesPerSketch: options.rectanglesPerSketch, cpuCalibrationMs, solvesPerPreview: solves, prepareMs: cadBenchmarkStats(samples) });
  }
  return results;
}
