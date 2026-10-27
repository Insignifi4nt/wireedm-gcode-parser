import { createCadSketchNativeRuntime, type CadSketchSolveRecord } from '../sketch-solver/cadSketchNativeRuntime';
import type { CadSketchSolverTimingStage } from '../sketch-solver/cadSketchSolverStages';
import type { CadSketchNativeSolver } from '../sketch-solver/native/cadSketchNativeSolver';
import type { CadSketchSolver } from './cadBenchmark';

export type CadSolverBenchmarkStages = Readonly<Record<CadSketchSolverTimingStage, number>>;
export const emptyCadSolverStages = (): Record<CadSketchSolverTimingStage, number> => ({ parseCompile: 0, nativeCall: 0, mapping: 0, validation: 0 });
/** The app's one sketch solver since PlaneGCS was removed in 0.0.757; reports keep a list of solvers. */
export type CadBenchmarkSolverId = 'native';
export const CAD_BENCHMARK_SOLVER_LABELS: Readonly<Record<CadBenchmarkSolverId, string>> = { native: 'Native' };
export interface CadBenchmarkSolver extends CadSketchSolver {
  readonly id: CadBenchmarkSolverId;
  readonly label: string;
  /** Consume observations from the most recent public solve call. */
  takeStages(): CadSolverBenchmarkStages;
  /** Consume how the most recent public solve was answered. */
  takeRecord(): CadSketchSolveRecord | undefined;
}

/**
 * The app's own runtime, so every decision is production's: acceptance, diagnosis, kept and snapped
 * groups, and instance replacement. `loadNative` runs whenever the runtime needs a fresh instance.
 */
export function createCadBenchmarkRuntime(loadNative: () => Promise<CadSketchNativeSolver>): CadBenchmarkSolver {
  let stages = emptyCadSolverStages(), record: CadSketchSolveRecord | undefined;
  const runtime = createCadSketchNativeRuntime({ loadNative, onStageTiming: (stage, elapsedMs) => { stages[stage] += elapsedMs; }, onSolve: value => { record = value; } });
  return { id: 'native', label: CAD_BENCHMARK_SOLVER_LABELS.native, solve: input => runtime.solve(input),
    takeStages() { const value = stages; stages = emptyCadSolverStages(); return value; },
    takeRecord() { const value = record; record = undefined; return value; } };
}
