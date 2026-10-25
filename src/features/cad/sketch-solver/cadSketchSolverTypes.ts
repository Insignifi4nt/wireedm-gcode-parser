import type { CadSketchGraph, CadSketchGraphIssue } from '../../../domain/cad/cadSketchGraph';

export interface CadSketchSolveInput {
  readonly graph: CadSketchGraph;
  readonly parameters: Readonly<Record<string, number>>;
  readonly drag?: { readonly pointId: string; readonly position: readonly [number, number] };
}
export interface CadSketchSolveDiagnostics {
  readonly status: 'success' | 'converged' | 'failed' | 'invalid' | null;
  readonly degreesOfFreedom: number | null;
  /** Graph identities, including an entity ID for an implicit structural constraint. */
  readonly conflictingIds: readonly string[];
  readonly redundantIds: readonly string[];
  readonly partiallyRedundantIds: readonly string[];
  readonly issues: readonly CadSketchGraphIssue[];
}
export type CadSketchSolveResult = {
  readonly kind: 'solved'; readonly graph: CadSketchGraph; readonly diagnostics: CadSketchSolveDiagnostics;
} | {
  readonly kind: 'rejected'; readonly reason: 'invalid-input' | 'too-large' | 'conflicting' | 'redundant' | 'failed' | 'invalid-solution';
  readonly message: string; readonly diagnostics: CadSketchSolveDiagnostics;
};
export interface CadSketchSolverClient {
  solve(input: CadSketchSolveInput, signal?: AbortSignal): Promise<CadSketchSolveResult>;
  dispose(): void;
}
