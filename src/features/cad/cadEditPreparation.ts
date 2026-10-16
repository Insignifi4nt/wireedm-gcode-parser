import type { CadDocument } from '@/domain/cad/cadDocument';
import { CadError } from '@/domain/cad/cadError';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { reduceCadEditIntents, validateCadEditBatch, type CadEdit } from '@/domain/cad/cadOperations';
import { parseCadDocument } from '@/domain/cad/cadSchema';
import type { CadSketchSolveDiagnostics, CadSketchSolverClient } from './sketch-solver/cadSketchSolverTypes';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { Value } from '@sinclair/typebox/value';

export function needsCadSketchPreparation(document: CadDocument, edits: readonly CadEdit[]): boolean {
  return document.features.some(feature => feature.kind === 'sketch' && feature.graph)
    || edits.some(edit => edit.kind === 'append-sketch-entities' || edit.kind === 'offset-sketch-loop' || (edit.kind === 'add-feature' || edit.kind === 'update-feature') && edit.feature.kind === 'sketch' && edit.feature.graph);
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
        throw new CadSketchPreparationError({ sketchId: feature.id, sketchName: feature.name, graph: feature.graph, rejection: result,
          ...(drag?.sketchId === feature.id ? { dragPointId: drag.pointId } : {}) });
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
    if (edit.kind === 'translate-sketch-geometry' || edit.kind === 'split-sketch-entity' || edit.kind === 'trim-sketch-entity' || edit.kind === 'extend-sketch-entity' || edit.kind === 'offset-sketch-loop' || edit.kind === 'mirror-sketch-geometry') {
      await flush();
      const target = reduceCadEditIntents(candidate, [edit]);
      if (Value.Equal(candidate, target)) continue;
      candidate = target;
      await solve();
      // Native success may project targets or propagate to outside points/radii.
      // Exact source edits accept only their complete constructed candidate.
      if (!Value.Equal(candidate, target)) throw edit.kind === 'split-sketch-entity'
        ? new CadError('sketch-split-intent', 'The constraints cannot preserve this exact split without changing geometry. Adjust its relations before splitting.')
        : edit.kind === 'trim-sketch-entity'
          ? new CadError('sketch-trim-intent', 'The constraints cannot preserve this exact trim without changing geometry. Adjust its relations before trimming.')
          : edit.kind === 'extend-sketch-entity'
            ? new CadError('sketch-extend-intent', 'The constraints cannot preserve this exact extension without changing geometry. Adjust its relations before extending.')
            : edit.kind === 'offset-sketch-loop'
              ? new CadError('sketch-offset-intent', 'The constraints cannot preserve this exact offset without changing geometry. Adjust its source or relations before offsetting.')
              : edit.kind === 'mirror-sketch-geometry'
                ? new CadError('sketch-mirror-intent', 'The constraints cannot preserve this exact mirrored copy without changing geometry. Adjust its source or relations before mirroring.')
                : new CadError('sketch-translation-intent', 'The constraints cannot satisfy this exact move without changing other geometry. Adjust the selection or its relations.');
    } else if (edit.kind === 'move-sketch-point') {
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
