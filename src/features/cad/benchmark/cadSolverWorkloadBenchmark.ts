import { checkCadSketchGraph, parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import type { CadSketchSolveInput, CadSketchSolveResult } from '../sketch-solver/cadSketchSolverTypes';
import { cadSketchSolutionMatchesInput } from '../sketch-solver/cadSketchSolverProtocol';
import { cadBenchmarkCpuCalibrationMs, cadBenchmarkStats } from './cadBenchmark';
import type { CadBenchmarkSolver, CadSolverBenchmarkStages } from './cadSolverBenchmarkAdapters';
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

export interface CadSolverBenchmarkOperation {
  readonly id: string;
  /** Preparation is outside timing, and receives only the last accepted solution. */
  prepare(previous: CadSketchSolveInput): CadSketchSolveInput;
}
interface Sample { readonly ms: number; readonly stages: CadSolverBenchmarkStages; readonly result: CadSketchSolveResult }
interface Samples { readonly solver: CadBenchmarkSolver; readonly operation: string; readonly samples: Sample[]; readonly skipped: string[] }

/** Each repetition runs BOTH solvers, reversing their order on the next repetition. All input
 * construction and independent correctness checks are outside the public solve timer. */
export async function measureCadSolverOperations({ id, input, operations, solvers, runs, orderOffset = 0 }: {
  readonly id: string; readonly input: CadSketchSolveInput; readonly operations: readonly CadSolverBenchmarkOperation[];
  readonly solvers: readonly CadBenchmarkSolver[]; readonly runs: number; readonly orderOffset?: number;
}) {
  const collected: Samples[] = solvers.flatMap(solver => operations.map(operation => ({ solver, operation: operation.id, samples: [], skipped: [] })));
  const failures: string[] = [], sampleOrder: string[][] = [];
  const repetition = async (index: number, warmup: boolean) => {
    const ordered = (index + orderOffset) % 2 ? [...solvers].reverse() : solvers;
    if (!warmup) sampleOrder.push(ordered.map(solver => solver.id));
    for (const solver of ordered) {
      let previous = input, accepted = true;
      for (const operation of operations) {
        const row = collected.find(item => item.solver === solver && item.operation === operation.id)!;
        if (!accepted) { if (!warmup) row.skipped.push('previous operation rejected'); continue; }
        const next = operation.prepare(previous);
        const original = structuredClone(next);
        solver.takeStages();
        const started = performance.now(), result = await solver.solve(next), ms = performance.now() - started;
        const stages = solver.takeStages();
        const errors = checkCadSolverBenchmarkResult(original, result);
        if (JSON.stringify(next) !== JSON.stringify(original)) errors.push('mutated input');
        failures.push(...errors.map(error => `${id}/${operation.id}/${solver.id}: ${error}`));
        if (!warmup) row.samples.push({ ms, stages, result });
        accepted = result.kind === 'solved';
        if (result.kind === 'solved') previous = { graph: result.graph, parameters: next.parameters };
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
      const base = { solver: row.solver.id, label: row.solver.label, diagnosis: row.solver.diagnosis, operation: row.operation };
      if (!samples.length) return { ...base, kind: 'skipped' as const, reasons: [...new Set(row.skipped)] };
      return { ...base, kind: 'measured' as const, totalMs: cadBenchmarkStats(samples.map(sample => sample.ms)),
        stagesMs: Object.fromEntries((['parseCompile', 'nativeCall', 'mapping', 'validation'] as const).map(stage => [stage, cadBenchmarkStats(samples.map(sample => sample.stages[stage]))])),
        outcomes: samples.reduce<Record<string, number>>((counts, sample) => { const key = cadSolverOutcome(sample.result); counts[key] = (counts[key] ?? 0) + 1; return counts; }, {}),
        diagnostics: samples.at(-1)!.result.diagnostics, skipped: row.skipped.length };
    }) };
}

export function measureCadSolverWorkload(testCase: CadSolverWorkloadCase, solvers: readonly CadBenchmarkSolver[], runs: number, orderOffset: number) {
  return measureCadSolverOperations({ id: testCase.id, input: testCase.input, solvers, runs, orderOffset,
    operations: [{ id: 'first-solve', prepare: () => testCase.input }, { id: 're-solve', prepare: previous => previous }] });
}

export async function measureCadSolverEdits(solvers: readonly CadBenchmarkSolver[], runs: number) {
  const reference = solvers.find(solver => solver.id === 'planegcs')!;
  const solved = async (input: CadSketchSolveInput) => {
    const result = await reference.solve(input);
    if (result.kind !== 'solved') throw new Error(`Cannot prepare die edits: ${result.message}`);
    return { graph: result.graph, parameters: input.parameters };
  };
  const die = await solved(createCadSolverDieInput()), free = await solved(createCadSolverFreeDieInput());
  const full = createCadSolverDieInput().graph.relations.find(relation => relation.id === 'outline1x')!;
  return [await measureCadSolverOperations({ id: 'die-dimension-edits', input: die, solvers, runs, operations: [
    { id: 'dimension-plus-0.5-mm', prepare: previous => ({ ...previous, parameters: { ...previous.parameters, slotRadius: previous.parameters.slotRadius + .5 } }) },
    { id: 'dimension-plus-20-percent', prepare: previous => ({ ...previous, parameters: { ...previous.parameters, slotRadius: previous.parameters.slotRadius * 1.2 } }) }
  ] }), await measureCadSolverOperations({ id: 'die-constraint-edits', input: free, solvers, runs, orderOffset: 1, operations: [
    { id: 'constraint-addition', prepare: previous => ({ ...previous, graph: parseCadSketchGraph({ ...previous.graph, relations: [...previous.graph.relations, full] }) }) },
    { id: 'constraint-removal', prepare: previous => ({ ...previous, graph: parseCadSketchGraph({ ...previous.graph, relations: previous.graph.relations.filter(relation => relation.id !== full.id) }) }) }
  ] })];
}

/** Releasing only the slot radius leaves a single connected die with one freedom. The target
 * at frame 45 is off that freedom's manifold; PlaneGCS can project it instead of rejecting it. */
export function createCadSolverDragTrajectory() {
  const input = createCadSolverDieInput();
  return { input: { ...input, graph: parseCadSketchGraph({ ...input.graph, relations: input.graph.relations.filter(relation => relation.id !== 'slotSize') }) },
    frames: Array.from({ length: 60 }, (_, index) => ({ pointId: 'slotA', position: [index === 45 ? 100 : -12,
      3 + (index < 30 ? index / 29 : (59 - index) / 29)] as const })) };
}

export async function measureCadSolverDrag(solvers: readonly CadBenchmarkSolver[], runs: number) {
  const trajectory = createCadSolverDragTrajectory(), reports = [];
  for (const solver of solvers) {
    if (solver.drag === 'unsupported') { reports.push({ solver: solver.id, label: solver.label, kind: 'unsupported' as const, reason: 'Native compiler rejects drag targets.' }); continue; }
    const before = cadBenchmarkCpuCalibrationMs(), samples: number[] = [], frames = [], failures: string[] = [];
    for (let run = 0; run < runs; run++) {
      let previous = trajectory.input;
      for (const [index, drag] of trajectory.frames.entries()) {
        const input = { ...previous, drag };
        solver.takeStages();
        const started = performance.now(), result = await solver.solve(input), elapsed = performance.now() - started;
        const stages = solver.takeStages();
        failures.push(...checkCadSolverBenchmarkResult(input, result));
        let targetErrorMm: number | null = null;
        if (result.kind === 'solved') {
          const point = result.graph.points.find(point => point.id === drag.pointId)!;
          targetErrorMm = Math.hypot(Number(point.position[0]) - drag.position[0], Number(point.position[1]) - drag.position[1]);
          previous = { graph: result.graph, parameters: input.parameters };
        }
        samples.push(elapsed); frames.push({ run, frame: index, target: drag.position, outcome: cadSolverOutcome(result), targetErrorMm, totalMs: elapsed, stagesMs: stages });
      }
    }
    const cpuCalibrationMs = [before, cadBenchmarkCpuCalibrationMs()];
    reports.push({ solver: solver.id, label: solver.label, kind: 'measured' as const, framesPerTrajectory: 60, trajectories: runs,
      cpuCalibrationMs, throttled: cadSolverCalibrationDrifted(cpuCalibrationMs), totalMs: cadSolverFrameStats(samples),
      accepted: frames.filter(frame => frame.outcome === 'solved').length, projected: frames.filter(frame => frame.targetErrorMm !== null && frame.targetErrorMm > 1e-6).length,
      frames, failures });
  }
  return reports;
}
