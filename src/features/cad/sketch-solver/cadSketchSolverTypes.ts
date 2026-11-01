import type { CadSketchGraph, CadSketchGraphIssue } from '../../../domain/cad/cadSketchGraph';

export interface CadSketchSolveInput {
  readonly graph: CadSketchGraph;
  readonly parameters: Readonly<Record<string, number>>;
  readonly drag?: { readonly pointId: string; readonly position: readonly [number, number] };
  /** Also report which points and entities are fully defined; never with a drag. */
  readonly analyseDefinition?: boolean;
}
/**
 * Which points and entities the solved relations fully define, in graph order. A point is defined
 * when both coordinates are determined and under-defined when either can move; an entity needs its
 * points, and a circle its radius too. The rest are unknown: not analysed, or too close to call.
 */
export interface CadSketchDefinition {
  readonly definedPointIds: readonly string[];
  readonly underDefinedPointIds: readonly string[];
  readonly definedEntityIds: readonly string[];
  readonly underDefinedEntityIds: readonly string[];
}
export interface CadSketchSolveDiagnostics {
  readonly status: 'success' | 'converged' | 'failed' | 'invalid' | null;
  readonly degreesOfFreedom: number | null;
  /** Graph identities, including an entity ID for an implicit structural constraint. */
  readonly conflictingIds: readonly string[];
  readonly redundantIds: readonly string[];
  readonly partiallyRedundantIds: readonly string[];
  readonly issues: readonly CadSketchGraphIssue[];
  /** Present on a solved result exactly when its input asked for definition. */
  readonly definition?: CadSketchDefinition;
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
