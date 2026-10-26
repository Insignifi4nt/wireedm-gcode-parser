import { checkCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import type { CadSketchSolverModule } from '../sketch-solver/cadSketchSolverModule';
import { createCadSketchSolverRuntime, type CadSketchSolverTimingStage } from '../sketch-solver/cadSketchSolverRuntime';
import { parseCadSketchSolveInput } from '../sketch-solver/cadSketchSolverProtocol';
import type { CadSketchSolveDiagnostics, CadSketchSolveResult } from '../sketch-solver/cadSketchSolverTypes';
import { compileCadSketchEquations } from '../sketch-solver/native/compileCadSketchEquations';
import { applyCadSketchEquationSolution, cadSketchEquationDiagnostics } from '../sketch-solver/native/cadSketchEquationModel';
import type { CadSketchNativeSolver } from '../sketch-solver/native/cadSketchNativeSolver';
import type { CadSketchSolver } from './cadBenchmark';

export type CadSolverBenchmarkStages = Readonly<Record<CadSketchSolverTimingStage, number>>;
export const emptyCadSolverStages = (): Record<CadSketchSolverTimingStage, number> => ({ parseCompile: 0, nativeCall: 0, mapping: 0, validation: 0 });
export interface CadBenchmarkSolver extends CadSketchSolver {
  readonly id: 'planegcs' | 'native';
  readonly label: string;
  readonly diagnosis: 'available' | 'unavailable';
  readonly drag: 'supported' | 'unsupported';
  /** Consume observations from the most recent public solve call. */
  takeStages(): CadSolverBenchmarkStages;
}

function stageCollector() {
  let stages = emptyCadSolverStages();
  return { record(stage: CadSketchSolverTimingStage, elapsedMs: number) { stages[stage] += elapsedMs; },
    take() { const result = stages; stages = emptyCadSolverStages(); return result; } };
}

export function createCadBenchmarkPlaneGcs(initialize: () => Promise<CadSketchSolverModule>): CadBenchmarkSolver {
  const collector = stageCollector();
  return { id: 'planegcs', label: 'PlaneGCS full job', diagnosis: 'available', drag: 'supported',
    ...createCadSketchSolverRuntime(initialize, { onStageTiming: collector.record }), takeStages: collector.take };
}

/** Benchmark adapter for the full native job: solve, then the rank diagnosis at the result, rejected
 * in the same order as the PlaneGCS runtime. A diagnosis too close to call is a failure, never a
 * clean bill of health. A suspected diagnosis reports only its conflicts, as relations that could
 * not be met together from this start, and no freedom. */
export function createCadBenchmarkNative(initialize: () => Promise<CadSketchNativeSolver>): CadBenchmarkSolver {
  const collector = stageCollector();
  const unavailable: CadSketchSolveDiagnostics = { status: null, degreesOfFreedom: null, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] };
  return { id: 'native', label: 'Native full job', diagnosis: 'available', drag: 'unsupported', takeStages: collector.take,
    async solve(source): Promise<CadSketchSolveResult> {
      let stage: CadSketchSolverTimingStage = 'parseCompile', started = performance.now();
      const next = (value: CadSketchSolverTimingStage) => { const now = performance.now(); collector.record(stage, now - started); stage = value; started = now; };
      try {
        let input, model;
        try { input = parseCadSketchSolveInput(source); model = compileCadSketchEquations(input); }
        catch (error) { return { kind: 'rejected', reason: 'invalid-input', message: String(error), diagnostics: unavailable }; }
        next('nativeCall');
        const solution = (await initialize()).solve(model);
        next('mapping');
        if (solution.status === 'too-large') return { kind: 'rejected', reason: 'too-large', message: 'A connected group is too large for the native solver; diagnosis is unavailable.', diagnostics: unavailable };
        const status = solution.status === 'converged' ? 'converged' : 'failed', { diagnosis } = solution;
        if (diagnosis.kind === 'unavailable') return { kind: 'rejected', reason: 'failed', message: 'Native diagnosis is unavailable.', diagnostics: { ...unavailable, status } };
        const ids = cadSketchEquationDiagnostics(model, diagnosis.labels);
        const diagnostics: CadSketchSolveDiagnostics = diagnosis.kind === 'suspected' ? { ...unavailable, status, conflictingIds: ids.conflictingIds }
          : { ...unavailable, status, degreesOfFreedom: diagnosis.kind === 'diagnosed' ? diagnosis.degreesOfFreedom : ids.conflictingIds.length ? null : 0, ...ids };
        if (diagnostics.conflictingIds.length) return { kind: 'rejected', reason: 'conflicting', diagnostics,
          message: diagnosis.kind === 'suspected' ? 'Sketch constraints could not be met together from this start.' : 'Sketch constraints conflict.' };
        if (diagnostics.redundantIds.length || diagnostics.partiallyRedundantIds.length) return { kind: 'rejected', reason: 'redundant', message: 'Sketch constraints are redundant.', diagnostics };
        if (status !== 'converged') return { kind: 'rejected', reason: 'failed', message: 'Native equations did not converge.', diagnostics };
        const graph = applyCadSketchEquationSolution(input.graph, model, solution.values);
        next('validation');
        if (!graph) return { kind: 'rejected', reason: 'invalid-solution', message: 'Native solution changed fixed source geometry.', diagnostics };
        const issues = checkCadSketchGraph(graph, input.parameters);
        if (issues.length) return { kind: 'rejected', reason: 'invalid-solution', message: 'Native solution fails graph checks.', diagnostics: { ...diagnostics, issues } };
        return { kind: 'solved', graph, diagnostics };
      } finally { collector.record(stage, performance.now() - started); }
    }
  };
}
