import { checkCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import type { CadSketchSolverModule } from '../sketch-solver/cadSketchSolverModule';
import { createCadSketchSolverRuntime, type CadSketchSolverTimingStage } from '../sketch-solver/cadSketchSolverRuntime';
import { cadSketchSolutionMatchesInput, parseCadSketchSolveInput } from '../sketch-solver/cadSketchSolverProtocol';
import type { CadSketchSolveDiagnostics, CadSketchSolveResult } from '../sketch-solver/cadSketchSolverTypes';
import { compileCadSketchEquations } from '../sketch-solver/native/compileCadSketchEquations';
import { applyCadSketchEquationSolution } from '../sketch-solver/native/cadSketchEquationModel';
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

/** Benchmark adapter only. Null DOF and empty diagnostic ids mean UNAVAILABLE, never a clean
 * bill of health. In particular, accepting redundant equations is not full-job acceptance. */
export function createCadBenchmarkNative(initialize: () => Promise<CadSketchNativeSolver>): CadBenchmarkSolver {
  const collector = stageCollector();
  const unavailable: CadSketchSolveDiagnostics = { status: null, degreesOfFreedom: null, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] };
  return { id: 'native', label: 'Native solve only, no diagnosis', diagnosis: 'unavailable', drag: 'unsupported', takeStages: collector.take,
    async solve(source): Promise<CadSketchSolveResult> {
      let stage: CadSketchSolverTimingStage = 'parseCompile', started = performance.now();
      const next = (value: CadSketchSolverTimingStage) => { const now = performance.now(); collector.record(stage, now - started); stage = value; started = now; };
      try {
        let input, model;
        try { input = parseCadSketchSolveInput(source); model = compileCadSketchEquations(input); }
        catch (error) { return { kind: 'rejected', reason: 'invalid-input', message: String(error), diagnostics: unavailable }; }
        next('nativeCall');
        const solution = (await initialize()).solve(model);
        if (solution.status !== 'converged') return { kind: 'rejected', reason: 'failed', message: 'Native equations did not converge; diagnosis is unavailable.', diagnostics: { ...unavailable, status: 'failed' } };
        next('mapping');
        const graph = applyCadSketchEquationSolution(input.graph, model, solution.values);
        next('validation');
        const diagnostics = { ...unavailable, status: 'converged' } as const;
        if (!cadSketchSolutionMatchesInput(input, graph)) return { kind: 'rejected', reason: 'invalid-solution', message: 'Native solution changed fixed source geometry.', diagnostics };
        const issues = checkCadSketchGraph(graph, input.parameters);
        if (issues.length) return { kind: 'rejected', reason: 'invalid-solution', message: 'Native solution fails graph checks.', diagnostics: { ...diagnostics, issues } };
        return { kind: 'solved', graph, diagnostics };
      } finally { collector.record(stage, performance.now() - started); }
    }
  };
}
