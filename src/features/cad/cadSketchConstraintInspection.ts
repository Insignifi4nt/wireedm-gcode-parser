import type { CadDocument, CadScalar } from '@/domain/cad/cadDocument';
import { CadError } from '@/domain/cad/cadError';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { parseCadDocument } from '@/domain/cad/cadSchema';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { page } from '@/features/webmcp/siteTools';
import { summarizeMessage, summarizeDiagnostic } from '@/features/webmcp/diagnosticSummaries';
import type { CadSketchSolveDiagnostics, CadSketchSolveResult, CadSketchSolverClient } from './sketch-solver/cadSketchSolverTypes';
import type { CadSketchConstraintSection } from './cadToolSchemas';

export type CadSketchConstraintAnalysis = { readonly kind: 'solved'; readonly diagnostics: CadSketchSolveDiagnostics }
  | { readonly kind: 'rejected'; readonly reason: Extract<CadSketchSolveResult, { kind: 'rejected' }>['reason']; readonly message: string; readonly diagnostics: CadSketchSolveDiagnostics }
  | { readonly kind: 'unavailable' | 'legacy'; readonly message: string; readonly diagnostics: CadSketchSolveDiagnostics };
export interface CadSketchConstraintInspection {
  readonly sketchId: string;
  readonly pointCount: number; readonly entityCount: number; readonly relationCount: number;
  readonly legacyProfileCount: number; readonly legacyDimensionCount: number;
  /** Native freedom describes graph variables only, not legacy primitive groups. */
  readonly degreesOfFreedomScope: 'graph';
  readonly analysis: CadSketchConstraintAnalysis;
  readonly graph: CadSketchGraph | null;
  readonly parameters: CadDocument['parameters'];
}
const unknownDiagnostics = (): CadSketchSolveDiagnostics => ({ status: null, degreesOfFreedom: null,
  conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] });
function freezeData(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeData(child);
  Object.freeze(value);
}

/** Analyze copied numeric geometry; the accepted source and its exact drivers remain authoritative. */
export async function inspectCadSketchConstraints(document: CadDocument, sketchId: string,
  getSolver: () => Promise<Pick<CadSketchSolverClient, 'solve'>>, signal?: AbortSignal): Promise<CadSketchConstraintInspection> {
  signal?.throwIfAborted();
  const accepted = parseCadDocument(document), sketch = accepted.features.find(feature => feature.id === sketchId);
  if (sketch?.kind !== 'sketch') throw new CadError('missing-sketch', 'Choose an existing sketch to inspect its constraints.');
  const graph = sketch.graph ?? null;
  let analysis: CadSketchConstraintAnalysis;
  if (!graph) analysis = { kind: 'legacy', message: 'Legacy profiles keep their primitive dimensions. General graph freedom is unavailable.', diagnostics: unknownDiagnostics() };
  else {
    try {
      const solver = await getSolver(); signal?.throwIfAborted();
      const result = await solver.solve({ graph, parameters: accepted.parameters }, signal); signal?.throwIfAborted();
      const diagnostics = { ...result.diagnostics, degreesOfFreedom: result.diagnostics.degreesOfFreedom !== null && result.diagnostics.degreesOfFreedom >= 0
        ? result.diagnostics.degreesOfFreedom : null };
      analysis = result.kind === 'solved' ? { kind: 'solved', diagnostics }
        : { kind: 'rejected', reason: result.reason, message: result.message, diagnostics };
    } catch (error) {
      signal?.throwIfAborted();
      analysis = { kind: 'unavailable', message: error instanceof Error ? error.message : 'Constraint analysis is unavailable. Retry to restart the solver.', diagnostics: unknownDiagnostics() };
    }
  }
  const result: CadSketchConstraintInspection = { sketchId, graph, parameters: accepted.parameters,
    pointCount: graph?.points.length ?? 0, entityCount: graph?.entities.length ?? 0, relationCount: graph?.relations.length ?? 0,
    legacyProfileCount: sketch.profiles.length, legacyDimensionCount: sketch.profiles.reduce((total, profile) => total + (profile.constraints?.length ?? 0), 0),
    degreesOfFreedomScope: 'graph', analysis };
  freezeData(result); return result;
}

const relationMeanings: Record<CadSketchGraphRelation['kind'], string> = {
  coincident: 'Keeps two distinct source points at the same location.', horizontal: 'Keeps two points at the same Y coordinate.',
  vertical: 'Keeps two points at the same X coordinate.', 'fixed-point': 'Fixes a point at its driving X and Y coordinates.',
  'fixed-axis': 'Fixes one point coordinate; the other axis can remain free.', distance: 'Keeps the straight-line distance between two points.'
};
const entityPoints = (entity: CadSketchGraphEntity) => entity.kind === 'line' ? [entity.startPointId, entity.endPointId]
  : entity.kind === 'arc' ? [entity.centerPointId, entity.startPointId, entity.endPointId] : [entity.centerPointId];

/** Exact source rows are paged separately from bounded native diagnostic summaries. */
export function pageCadSketchConstraints(inspection: CadSketchConstraintInspection, input: { section?: CadSketchConstraintSection; offset?: number; limit?: number }) {
  const graph = inspection.graph, points = new Map(graph?.points.map(point => [point.id, point]));
  const analysis = inspection.analysis, diagnostics = analysis.diagnostics;
  const conflicting = new Set(diagnostics.conflictingIds), redundant = new Set(diagnostics.redundantIds), partiallyRedundant = new Set(diagnostics.partiallyRedundantIds);
  const diagnosticState = (id: string) => analysis.kind === 'unavailable' || analysis.kind === 'legacy' ? null
    : { conflicting: conflicting.has(id), redundant: redundant.has(id), partiallyRedundant: partiallyRedundant.has(id) };
  const adjacency = new Map<string, string[]>();
  for (const entity of graph?.entities ?? []) for (const id of entityPoints(entity)) {
    const edges = adjacency.get(id) ?? []; edges.push(entity.id); adjacency.set(id, edges);
  }
  const scalar = (value: CadScalar, driving = false) => ({ scalar: value, valueMm: evaluateCadScalar(value, inspection.parameters),
    role: typeof value === 'string' ? 'expression-driver' : driving ? 'constant-driver' : 'solver-variable' });
  const point = (id: string) => {
    const source = points.get(id); if (!source) throw new CadError('missing-sketch-point', 'The inspected point no longer exists.');
    const entities = adjacency.get(id) ?? [];
    return { id, position: source.position.map(value => scalar(value)), diagnostics: diagnosticState(id), entityIds: entities.slice(0, 8), entityCount: entities.length,
      omittedEntityCount: Math.max(0, entities.length - 8) };
  };
  if (input.section === 'points') return page(graph?.points ?? [], input, source => point(source.id));
  if (input.section === 'entities') return page(graph?.entities ?? [], input, source => ({ source, diagnostics: diagnosticState(source.id), points: entityPoints(source).map(point),
    ...(source.kind === 'circle' ? { radius: scalar(source.radius) } : {}) }));
  return page(graph?.relations ?? [], input, source => ({ source, meaning: relationMeanings[source.kind], diagnostics: diagnosticState(source.id),
    points: ('pointIds' in source ? source.pointIds : [source.pointId]).map(point),
    ...(source.kind === 'distance' || source.kind === 'fixed-axis' ? { value: scalar(source.value, true) }
      : source.kind === 'fixed-point' ? { position: source.position.map(value => scalar(value, true)) } : {}) }));
}

/** Do not duplicate unbounded native ID/message arrays beside a source page. */
export function summarizeCadSketchConstraintAnalysis(analysis: CadSketchConstraintAnalysis) {
  const { diagnostics } = analysis;
  const ids = (values: readonly string[]) => ({ ids: values.slice(0, 8), count: values.length, omittedCount: Math.max(0, values.length - 8) });
  return { kind: analysis.kind, status: diagnostics.status, degreesOfFreedom: diagnostics.degreesOfFreedom,
    ...(analysis.kind === 'rejected' ? { reason: analysis.reason } : {}),
    ...('message' in analysis ? summarizeMessage(analysis.message) : {}),
    conflicting: ids(diagnostics.conflictingIds), redundant: ids(diagnostics.redundantIds), partiallyRedundant: ids(diagnostics.partiallyRedundantIds),
    issues: diagnostics.issues.slice(0, 2).map(summarizeDiagnostic), issueCount: diagnostics.issues.length,
    omittedIssueCount: Math.max(0, diagnostics.issues.length - 2) };
}
