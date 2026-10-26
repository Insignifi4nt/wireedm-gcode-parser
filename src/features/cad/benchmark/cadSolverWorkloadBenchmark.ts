import { checkCadSketchGraph, parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import type { CadSketchSolveRecord } from '../sketch-solver/cadSketchNativeFirstRuntime';
import type { CadSketchSolveInput, CadSketchSolveResult } from '../sketch-solver/cadSketchSolverTypes';
import { cadSketchSolutionMatchesInput, parseCadSketchSolveInput } from '../sketch-solver/cadSketchSolverProtocol';
import { cadBenchmarkCpuCalibrationMs, cadBenchmarkStats } from './cadBenchmark';
import type { CadBenchmarkSolver, CadSolverBenchmarkStages } from './cadSolverBenchmarkAdapters';
import { createCadSolverDragSweep, createCadSolverDragTrajectories, type CadSolverDrag, type CadSolverDragTrajectory } from './cadSolverDragCases';
import { createCadSolverDieInput, createCadSolverFreeDieInput, type CadSolverWorkloadCase } from './cadSolverWorkloadCases';

export const cadSolverCalibrationDrifted = (values: readonly number[]) => Math.max(...values) > 1.5 * Math.min(...values);
/** A boundary compares its two probes, so their brackets must agree with each other as well as within themselves. */
export const cadSolverBoundaryThrottled = (probes: readonly ({ cpuCalibrationMs: readonly number[] } | undefined)[]) =>
  cadSolverCalibrationDrifted(probes.flatMap(probe => probe?.cpuCalibrationMs ?? []));
export function cadSolverFrameStats(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { ...cadBenchmarkStats(samples), p99: Math.round(sorted[Math.ceil(sorted.length * .99) - 1] * 100) / 100,
    framesOver8Ms: samples.filter(value => value > 8).length };
}

export function checkCadSolverBenchmarkResult(input: CadSketchSolveInput, result: CadSketchSolveResult): string[] {
  if (result.kind !== 'solved') return [];
  return [...(!cadSketchSolutionMatchesInput(input, result.graph) ? ['changed fixed input or source intent'] : []),
    ...checkCadSketchGraph(result.graph, input.parameters).map(issue => `${issue.source.id}: ${issue.code}`)];
}
export const cadSolverOutcome = (result: CadSketchSolveResult) => result.kind === 'solved' ? 'solved' : `rejected:${result.reason}`;
/** Who answered and why, as `answeredBy:native outcome`, with PlaneGCS's outcome when it was asked. */
export const cadSolverRecordKey = (record: CadSketchSolveRecord) => `${record.answeredBy}:${record.native ?? 'skipped'}${record.planeGcs ? `:planegcs-${record.planeGcs}` : ''}`;
const count = (counts: Record<string, number>, key: string | undefined) => { if (key !== undefined) counts[key] = (counts[key] ?? 0) + 1; return counts; };
/** Solvers in turn, starting one later on each repetition, so no solver always runs first or after the same one. */
const rotated = <T>(items: readonly T[], offset: number) => items.map((_, index) => items[(index + offset) % items.length]);

export interface CadSolverBenchmarkOperation {
  readonly id: string;
  /** Preparation is outside timing, and receives only the last accepted solution. */
  prepare(previous: CadSketchSolveInput): CadSketchSolveInput;
}
interface Sample { readonly ms: number; readonly stages: CadSolverBenchmarkStages; readonly result: CadSketchSolveResult; readonly record?: CadSketchSolveRecord }
interface Samples { readonly solver: CadBenchmarkSolver; readonly operation: string; readonly samples: Sample[]; readonly skipped: string[] }

/** One timed public call, with its stages and record taken from that call alone. */
async function timedSolve(solver: CadBenchmarkSolver, input: CadSketchSolveInput) {
  solver.takeStages(); solver.takeRecord();
  const started = performance.now(), result = await solver.solve(input), ms = performance.now() - started;
  return { ms, result, stages: solver.takeStages(), record: solver.takeRecord() };
}

/** Each repetition runs EVERY solver, rotating their order on the next repetition. All input
 * construction and independent correctness checks are outside the public solve timer. */
export async function measureCadSolverOperations({ id, input, operations, solvers, runs, orderOffset = 0 }: {
  readonly id: string; readonly input: CadSketchSolveInput; readonly operations: readonly CadSolverBenchmarkOperation[];
  readonly solvers: readonly CadBenchmarkSolver[]; readonly runs: number; readonly orderOffset?: number;
}) {
  const collected: Samples[] = solvers.flatMap(solver => operations.map(operation => ({ solver, operation: operation.id, samples: [], skipped: [] })));
  const failures: string[] = [], sampleOrder: string[][] = [];
  const repetition = async (index: number, warmup: boolean) => {
    const ordered = rotated(solvers, index + orderOffset);
    if (!warmup) sampleOrder.push(ordered.map(solver => solver.id));
    for (const solver of ordered) {
      let previous = input, accepted = true;
      for (const operation of operations) {
        const row = collected.find(item => item.solver === solver && item.operation === operation.id)!;
        if (!accepted) { if (!warmup) row.skipped.push('previous operation rejected'); continue; }
        const next = operation.prepare(previous);
        const original = structuredClone(next);
        const sample = await timedSolve(solver, next);
        const errors = checkCadSolverBenchmarkResult(original, sample.result);
        if (JSON.stringify(next) !== JSON.stringify(original)) errors.push('mutated input');
        failures.push(...errors.map(error => `${id}/${operation.id}/${solver.id}: ${error}`));
        if (!warmup) row.samples.push(sample);
        accepted = sample.result.kind === 'solved';
        if (sample.result.kind === 'solved') previous = { graph: sample.result.graph, parameters: next.parameters };
      }
    }
  };
  await repetition(0, true);
  const before = cadBenchmarkCpuCalibrationMs();
  for (let index = 0; index < runs; index++) await repetition(index, false);
  const after = cadBenchmarkCpuCalibrationMs(), cpuCalibrationMs = [before, after];
  return { id, cpuCalibrationMs, throttled: cadSolverCalibrationDrifted(cpuCalibrationMs), sampleOrder, failures,
    measurements: collected.map(row => {
      const samples = row.samples;
      const base = { solver: row.solver.id, label: row.solver.label, operation: row.operation };
      if (!samples.length) return { ...base, kind: 'skipped' as const, reasons: [...new Set(row.skipped)] };
      return { ...base, kind: 'measured' as const, totalMs: cadBenchmarkStats(samples.map(sample => sample.ms)),
        stagesMs: Object.fromEntries((['parseCompile', 'nativeCall', 'mapping', 'validation'] as const).map(stage => [stage, cadBenchmarkStats(samples.map(sample => sample.stages[stage]))])),
        outcomes: samples.reduce<Record<string, number>>((counts, sample) => count(counts, cadSolverOutcome(sample.result)), {}),
        answers: samples.reduce<Record<string, number>>((counts, sample) => count(counts, sample.record && cadSolverRecordKey(sample.record)), {}),
        diagnostics: samples.at(-1)!.result.diagnostics, skipped: row.skipped.length };
    }) };
}

export function measureCadSolverWorkload(testCase: CadSolverWorkloadCase, solvers: readonly CadBenchmarkSolver[], runs: number, orderOffset: number) {
  return measureCadSolverOperations({ id: testCase.id, input: testCase.input, solvers, runs, orderOffset,
    operations: [{ id: 'first-solve', prepare: () => testCase.input }, { id: 're-solve', prepare: previous => previous }] });
}

/** Solves a start once with the first solver, outside timing, so every solver edits or drags the same accepted geometry. */
async function settled(solvers: readonly CadBenchmarkSolver[], input: CadSketchSolveInput, label: string) {
  const result = await solvers[0].solve(input);
  if (result.kind !== 'solved') throw new Error(`Cannot prepare ${label}: ${result.message}`);
  return { graph: result.graph, parameters: input.parameters };
}

export async function measureCadSolverEdits(solvers: readonly CadBenchmarkSolver[], runs: number) {
  const die = await settled(solvers, createCadSolverDieInput(), 'die edits'), free = await settled(solvers, createCadSolverFreeDieInput(), 'die edits');
  const full = createCadSolverDieInput().graph.relations.find(relation => relation.id === 'outline1x')!;
  return [await measureCadSolverOperations({ id: 'die-dimension-edits', input: die, solvers, runs, operations: [
    { id: 'dimension-plus-0.5-mm', prepare: previous => ({ ...previous, parameters: { ...previous.parameters, slotRadius: previous.parameters.slotRadius + .5 } }) },
    { id: 'dimension-plus-20-percent', prepare: previous => ({ ...previous, parameters: { ...previous.parameters, slotRadius: previous.parameters.slotRadius * 1.2 } }) }
  ] }), await measureCadSolverOperations({ id: 'die-constraint-edits', input: free, solvers, runs, orderOffset: 1, operations: [
    { id: 'constraint-addition', prepare: previous => ({ ...previous, graph: parseCadSketchGraph({ ...previous.graph, relations: [...previous.graph.relations, full] }) }) },
    { id: 'constraint-removal', prepare: previous => ({ ...previous, graph: parseCadSketchGraph({ ...previous.graph, relations: previous.graph.relations.filter(relation => relation.id !== full.id) }) }) }
  ] })];
}

const targetError = (result: CadSketchSolveResult, drag: CadSolverDrag) => {
  if (result.kind !== 'solved') return null;
  const point = result.graph.points.find(point => point.id === drag.pointId)!;
  return Math.hypot(Number(point.position[0]) - drag.position[0], Number(point.position[1]) - drag.position[1]);
};

/**
 * `from-start` solves every frame from the trajectory's start, as the editor's previews do;
 * `chained` solves each frame from the previous accepted one. Each run plays the whole trajectory
 * once per solver, rotating their order. A target error above 1e-6 mm counts as projected for
 * PlaneGCS, which reports no drag outcome; native's own outcome comes from its record.
 */
export async function measureCadSolverDrag(solvers: readonly CadBenchmarkSolver[], runs: number,
  trajectories: readonly CadSolverDragTrajectory[] = createCadSolverDragTrajectories(), modes: readonly ('from-start' | 'chained')[] = ['from-start', 'chained']) {
  const groups = [];
  for (const [index, trajectory] of trajectories.entries()) for (const mode of modes) {
    const frames = new Map(solvers.map(solver => [solver, [] as { run: number; frame: number; target: readonly [number, number]; outcome: string; targetErrorMm: number | null;
      totalMs: number; stagesMs: CadSolverBenchmarkStages; drag?: CadSketchSolveRecord['drag']; answer?: string }[]]));
    const failures: string[] = [], sampleOrder: string[][] = [];
    const before = cadBenchmarkCpuCalibrationMs();
    for (let run = 0; run < runs; run++) {
      const ordered = rotated(solvers, run + index);
      sampleOrder.push(ordered.map(solver => solver.id));
      for (const solver of ordered) {
        let previous = trajectory.input;
        for (const [frame, drag] of trajectory.frames.entries()) {
          const input = { ...(mode === 'chained' ? previous : trajectory.input), drag };
          const sample = await timedSolve(solver, input);
          failures.push(...checkCadSolverBenchmarkResult(input, sample.result).map(error => `${trajectory.id}/${mode}/${solver.id}/${frame}: ${error}`));
          frames.get(solver)!.push({ run, frame, target: drag.position, outcome: cadSolverOutcome(sample.result), targetErrorMm: targetError(sample.result, drag),
            totalMs: sample.ms, stagesMs: sample.stages, drag: sample.record?.drag, answer: sample.record && cadSolverRecordKey(sample.record) });
          if (sample.result.kind === 'solved') previous = { graph: sample.result.graph, parameters: input.parameters };
        }
      }
    }
    const cpuCalibrationMs = [before, cadBenchmarkCpuCalibrationMs()];
    groups.push({ trajectory: trajectory.id, description: trajectory.description, mode, framesPerTrajectory: trajectory.frames.length, trajectories: runs,
      cpuCalibrationMs, throttled: cadSolverCalibrationDrifted(cpuCalibrationMs), sampleOrder, failures,
      solvers: solvers.map(solver => {
        const rows = frames.get(solver)!, errors = rows.flatMap(row => row.targetErrorMm === null ? [] : [row.targetErrorMm]);
        return { solver: solver.id, label: solver.label, totalMs: cadSolverFrameStats(rows.map(row => row.totalMs)),
          outcomes: rows.reduce<Record<string, number>>((counts, row) => count(counts, row.outcome), {}),
          dragOutcomes: rows.reduce<Record<string, number>>((counts, row) => count(counts, row.drag?.outcome ?? (row.targetErrorMm === null ? undefined : row.targetErrorMm > 1e-6 ? 'projected' : 'reached')), {}),
          answers: rows.reduce<Record<string, number>>((counts, row) => count(counts, row.answer), {}),
          largestTargetErrorMm: errors.length ? Math.max(...errors) : null, frames: rows };
      }) });
  }
  return groups;
}

/**
 * Every sweep drag once per solver from the same settled start, timed, with the drags where a
 * solver ends further from its target than the first solver (beyond 1e-6 mm) or is rejected where
 * the first solver is not. Settling runs outside timing.
 */
export async function measureCadSolverDragSweep(solvers: readonly CadBenchmarkSolver[]) {
  const sweeps = [];
  for (const sweep of createCadSolverDragSweep()) {
    const start = await settled(solvers, sweep.input, `${sweep.id} sweep`);
    const drags = start.graph.points.filter(point => typeof point.position[0] === 'number' && typeof point.position[1] === 'number').flatMap(point => sweep.moves.map(([dx, dy]) =>
      ({ pointId: point.id, position: [Number(point.position[0]) + dx, Number(point.position[1]) + dy] as const })))
      // The app refuses to drag pattern-generated or referenced geometry; its own input check decides.
      .filter(drag => { try { parseCadSketchSolveInput({ ...start, drag }); return true; } catch { return false; } });
    const before = cadBenchmarkCpuCalibrationMs(), failures: string[] = [];
    const rows = new Map(solvers.map(solver => [solver, [] as { drag: CadSolverDrag; ms: number; outcome: string; targetErrorMm: number | null; record?: CadSketchSolveRecord }[]]));
    for (const [index, drag] of drags.entries()) for (const solver of rotated(solvers, index)) {
      const input = { ...start, drag }, sample = await timedSolve(solver, input);
      failures.push(...checkCadSolverBenchmarkResult(input, sample.result).map(error => `${sweep.id}/${solver.id}/${drag.pointId}: ${error}`));
      rows.get(solver)!.push({ drag, ms: sample.ms, outcome: cadSolverOutcome(sample.result), targetErrorMm: targetError(sample.result, drag), record: sample.record });
    }
    const cpuCalibrationMs = [before, cadBenchmarkCpuCalibrationMs()], reference = rows.get(solvers[0])!;
    sweeps.push({ id: sweep.id, drags: drags.length, cpuCalibrationMs, throttled: cadSolverCalibrationDrifted(cpuCalibrationMs), failures,
      solvers: solvers.map(solver => {
        const own = rows.get(solver)!;
        return { solver: solver.id, label: solver.label, totalMs: cadSolverFrameStats(own.map(row => row.ms)), sumMs: Math.round(own.reduce((sum, row) => sum + row.ms, 0) * 10) / 10,
          outcomes: own.reduce<Record<string, number>>((counts, row) => count(counts, row.outcome), {}),
          dragOutcomes: own.reduce<Record<string, number>>((counts, row) => count(counts, row.record?.drag?.outcome), {}),
          answers: own.reduce<Record<string, number>>((counts, row) => count(counts, row.record && cadSolverRecordKey(row.record)), {}),
          worseThanFirst: own.flatMap((row, index) => {
            const first = reference[index].targetErrorMm;
            return first !== null && (row.targetErrorMm === null || row.targetErrorMm > first + 1e-6)
              ? [{ pointId: row.drag.pointId, target: row.drag.position, outcome: row.outcome, targetErrorMm: row.targetErrorMm, firstTargetErrorMm: first }] : [];
          }) };
      }) });
  }
  return sweeps;
}
