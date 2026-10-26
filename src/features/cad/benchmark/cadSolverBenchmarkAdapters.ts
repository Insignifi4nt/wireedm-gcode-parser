import { createCadSketchNativeFirstRuntime, type CadSketchSolveRecord } from '../sketch-solver/cadSketchNativeFirstRuntime';
import type { CadSketchSolverModule } from '../sketch-solver/cadSketchSolverModule';
import { createCadSketchSolverRuntime } from '../sketch-solver/cadSketchSolverRuntime';
import type { CadSketchSolverTimingStage } from '../sketch-solver/cadSketchSolverStages';
import type { CadSketchNativeSolver } from '../sketch-solver/native/cadSketchNativeSolver';
import type { CadSketchSolver } from './cadBenchmark';

export type CadSolverBenchmarkStages = Readonly<Record<CadSketchSolverTimingStage, number>>;
export const emptyCadSolverStages = (): Record<CadSketchSolverTimingStage, number> => ({ parseCompile: 0, nativeCall: 0, mapping: 0, validation: 0 });
/** `planegcs` is the app before 0.0.746, `native-first` the app since, and `native-only` the app without PlaneGCS. */
export type CadBenchmarkSolverId = 'planegcs' | 'native-only' | 'native-first';
export const CAD_BENCHMARK_SOLVER_LABELS: Readonly<Record<CadBenchmarkSolverId, string>> = { planegcs: 'PlaneGCS alone', 'native-only': 'Native only', 'native-first': 'Native first' };
export interface CadBenchmarkSolver extends CadSketchSolver {
  readonly id: CadBenchmarkSolverId;
  readonly label: string;
  /** Consume observations from the most recent public solve call. */
  takeStages(): CadSolverBenchmarkStages;
  /** Consume how the most recent public solve was answered; PlaneGCS alone records nothing. */
  takeRecord(): CadSketchSolveRecord | undefined;
}

function stageCollector() {
  let stages = emptyCadSolverStages();
  return { record(stage: CadSketchSolverTimingStage, elapsedMs: number) { stages[stage] += elapsedMs; },
    take() { const result = stages; stages = emptyCadSolverStages(); return result; } };
}

export function createCadBenchmarkPlaneGcs(initialize: () => Promise<CadSketchSolverModule>): CadBenchmarkSolver {
  const collector = stageCollector();
  return { id: 'planegcs', label: CAD_BENCHMARK_SOLVER_LABELS.planegcs, ...createCadSketchSolverRuntime(initialize, { onStageTiming: collector.record }),
    takeStages: collector.take, takeRecord: () => undefined };
}

/**
 * The app's own runtime, so every decision is production's: acceptance, kept and snapped groups,
 * and in `native-first` the PlaneGCS fallback, whose stages add to native's. `loadNative` runs
 * whenever the runtime needs a fresh instance; `initializePlaneGcs` only on the first fallback.
 */
export function createCadBenchmarkRuntime(mode: 'native-only' | 'native-first', loadNative: () => Promise<CadSketchNativeSolver>,
  initializePlaneGcs?: () => Promise<CadSketchSolverModule>): CadBenchmarkSolver {
  const collector = stageCollector();
  let record: CadSketchSolveRecord | undefined;
  const runtime = createCadSketchNativeFirstRuntime({ mode, loadNative, onStageTiming: collector.record, onSolve: value => { record = value; },
    async loadPlaneGcs() {
      if (!initializePlaneGcs) throw new Error('This benchmark solver has no PlaneGCS.');
      return createCadSketchSolverRuntime(initializePlaneGcs, { onStageTiming: collector.record });
    } });
  return { id: mode, label: CAD_BENCHMARK_SOLVER_LABELS[mode], solve: input => runtime.solve(input), takeStages: collector.take,
    takeRecord() { const value = record; record = undefined; return value; } };
}
