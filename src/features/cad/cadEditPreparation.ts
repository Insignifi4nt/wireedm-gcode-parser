import type { CadDocument } from '@/domain/cad/cadDocument';
import { CadError } from '@/domain/cad/cadError';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { reduceCadEditIntents, validateCadEditBatch, type CadEdit } from '@/domain/cad/cadOperations';
import { parseCadDocument } from '@/domain/cad/cadSchema';
import type { CadSketchSolveDiagnostics, CadSketchSolverClient } from './sketch-solver/cadSketchSolverTypes';

export function needsCadSketchPreparation(document: CadDocument, edits: readonly CadEdit[]): boolean {
  return document.features.some(feature => feature.kind === 'sketch' && feature.graph)
    || edits.some(edit => edit.kind === 'append-sketch-entities' || (edit.kind === 'add-feature' || edit.kind === 'update-feature') && edit.feature.kind === 'sketch' && edit.feature.graph);
}

/** Reduce intent, solve numeric copies, then validate the whole part before a session can commit it. */
export async function prepareCadEdits(document: CadDocument, edits: readonly CadEdit[], solver: Pick<CadSketchSolverClient, 'solve'>, signal?: AbortSignal) {
  validateCadEditBatch(edits);
  const captured = structuredClone(edits);
  let candidate = parseCadDocument(document);
  const diagnostics = new Map<string, CadSketchSolveDiagnostics>();
  async function solve(drag?: { sketchId: string; pointId: string; position: readonly [number, number] }) {
    const features = [];
    for (const feature of candidate.features) {
      signal?.throwIfAborted();
      if (feature.kind !== 'sketch' || !feature.graph) { features.push(feature); continue; }
      const result = await solver.solve({ graph: feature.graph, parameters: candidate.parameters,
        ...(drag?.sketchId === feature.id ? { drag: { pointId: drag.pointId, position: drag.position } } : {}) }, signal);
      signal?.throwIfAborted();
      diagnostics.set(feature.id, result.diagnostics);
      if (result.kind !== 'solved') {
        const ids = [...result.diagnostics.conflictingIds, ...result.diagnostics.redundantIds, ...result.diagnostics.partiallyRedundantIds];
        throw new CadError(`sketch-${result.reason}`, `${feature.name}: ${result.message}${ids.length ? ` Relations: ${ids.join(', ')}.` : ''}`);
      }
      features.push({ ...feature, graph: result.graph });
    }
    candidate = { ...candidate, features };
  }
  let pending: CadEdit[] = [];
  async function flush() {
    if (!pending.length) return;
    candidate = reduceCadEditIntents(candidate, pending); pending = [];
    await solve();
  }
  for (const edit of captured) {
    signal?.throwIfAborted();
    if (edit.kind === 'move-sketch-point') {
      await flush();
      const sketch = candidate.features.find(feature => feature.id === edit.sketchId);
      const point = sketch?.kind === 'sketch' ? sketch.graph?.points.find(point => point.id === edit.pointId) : undefined;
      if (!point) throw new CadError('missing-sketch-point', 'The selected sketch point no longer exists.');
      const position = point.position.map((value, index) => evaluateCadScalar(value, candidate.parameters) + evaluateCadScalar(edit.translation[index], candidate.parameters));
      await solve({ sketchId: edit.sketchId, pointId: edit.pointId, position: [position[0], position[1]] });
    } else {
      // Geometry-dependent commands read the preceding solved candidate, never old coordinates.
      if (edit.kind === 'move-sketch-handle' || edit.kind === 'translate-sketch-profiles' || edit.kind === 'set-sketch-dimension' || edit.kind === 'create-sketch-corner') await flush();
      pending.push(edit);
    }
  }
  await flush();
  signal?.throwIfAborted();
  return { document: parseCadDocument(candidate), sketchDiagnostics: [...diagnostics].map(([sketchId, diagnostics]) => ({ sketchId, diagnostics })) };
}
