import type { CadDocument, CadFeature } from '@/domain/cad/cadDocument';
import { CadError } from '@/domain/cad/cadError';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { reduceCadEditIntents, validateCadEditBatch, type CadEdit } from '@/domain/cad/cadOperations';
import { parseCadDocument } from '@/domain/cad/cadSchema';
import type { CadSketchSolveDiagnostics, CadSketchSolverClient } from './sketch-solver/cadSketchSolverTypes';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { Value } from '@sinclair/typebox/value';
import { cadFeatureInputs } from '@/domain/cad/cadFeatureInputs';
import { assertCadSketchExternalReferences, refreshCadSketchExternalReferences } from '@/domain/cad/cadSketchExternalReferences';
import { cadSketchSolutionMatchesInput } from './sketch-solver/cadSketchSolverProtocol';
import { cadSketchPatternSnapshotNeedsExact, cadSketchLinearPatternLockReason } from '@/domain/cad/cadSketchLinearPattern';

export function needsCadSketchPreparation(document: CadDocument, edits: readonly CadEdit[]): boolean {
  return document.features.some(feature => feature.kind === 'sketch' && feature.graph)
    || edits.some(edit => edit.kind === 'append-sketch-entities' || edit.kind === 'offset-sketch-loop' || edit.kind === 'copy-sketch-profile' || edit.kind === 'use-sketch-entity' || (edit.kind === 'add-feature' || edit.kind === 'update-feature') && edit.feature.kind === 'sketch' && edit.feature.graph);
}

function changesReferenceDimensions(document: CadDocument, edit: CadEdit): boolean {
  if (edit.kind === 'append-sketch-entities') return edit.geometry.relations.some(relation => relation.kind === 'reference-dimension');
  const sketchId = edit.kind === 'update-feature' ? edit.feature.id : 'sketchId' in edit ? edit.sketchId : null;
  const sketch = document.features.find(feature => feature.id === sketchId);
  const references = sketch?.kind === 'sketch' ? sketch.graph?.relations.filter(relation => relation.kind === 'reference-dimension') ?? [] : [];
  if (edit.kind === 'set-sketch-relation') return edit.relation.kind === 'reference-dimension' || references.some(relation => relation.id === edit.relation.id);
  if (edit.kind === 'remove-sketch-relation') return references.some(relation => relation.id === edit.relationId);
  if (edit.kind === 'delete-sketch-elements') return references.some(relation => edit.relationIds.includes(relation.id));
  return edit.kind === 'update-feature' && edit.feature.kind === 'sketch'
    && !Value.Equal(references, edit.feature.graph?.relations.filter(relation => relation.kind === 'reference-dimension') ?? []);
}

/** Comparison only: accepted and candidate records keep every authored descriptor. */
function withoutReferenceDimensions(document: CadDocument): CadDocument {
  return { ...document, features: document.features.map(feature => feature.kind === 'sketch' && feature.graph
    ? { ...feature, graph: { ...feature.graph, relations: feature.graph.relations.filter(relation => relation.kind !== 'reference-dimension') } } : feature) };
}

/** Reduce intent, solve numeric copies, then validate the whole part before a session can commit it. */
export async function prepareCadEdits(document: CadDocument, edits: readonly CadEdit[], solver: Pick<CadSketchSolverClient, 'solve'>, signal?: AbortSignal) {
  validateCadEditBatch(edits);
  const captured = structuredClone(edits);
  let candidate = parseCadDocument(document);
  const diagnostics = new Map<string, CadSketchSolveDiagnostics>();
  async function solve(drag?: { sketchId: string; pointId: string; position: readonly [number, number] }, exact?: { sketchId: string; error: () => CadError }) {
    const target = candidate, features: CadFeature[] = [], previous = new Map<string, CadFeature>();
    const end = exact ? target.features.findIndex(feature => feature.id === exact.sketchId) : -1;
    const dependents = new Set(exact ? [exact.sketchId] : []);
    for (const [index, feature] of target.features.entries()) {
      signal?.throwIfAborted();
      if (feature.kind !== 'sketch' || !feature.graph) { features.push(feature); previous.set(feature.id, feature); continue; }
      const refreshed = refreshCadSketchExternalReferences({ sketch: feature, parameters: target.parameters, previous });
      if (!refreshed.graph) throw new CadError('missing-sketch-graph', 'The prepared sketch graph is unavailable.');
      const input = { graph: refreshed.graph, parameters: target.parameters,
        ...(drag?.sketchId === feature.id ? { drag: { pointId: drag.pointId, position: drag.position } } : {}) };
      const result = await solver.solve(input, signal);
      signal?.throwIfAborted();
      diagnostics.set(feature.id, result.diagnostics);
      if (result.kind !== 'solved') {
        throw new CadSketchPreparationError({ sketchId: feature.id, sketchName: feature.name, graph: refreshed.graph, rejection: result,
          ...(drag?.sketchId === feature.id ? { dragPointId: drag.pointId } : {}) });
      }
      const solved = { ...refreshed, graph: result.graph };
      assertCadSketchExternalReferences({ sketch: solved, parameters: target.parameters, previous });
      if (!cadSketchSolutionMatchesInput(input, result.graph)) throw exact?.error() ?? new CadError('invalid-sketch-solution', 'The sketch solution changed source records or fixed geometry.');
      features.push(solved);
      if (exact) {
        if (index === end && !Value.Equal(features, target.features.slice(0, end + 1))) throw exact.error();
        if (index > end) {
          const dependent = cadFeatureInputs(feature).sketchIds.some(id => dependents.has(id));
          // Only later, actual reference dependents may solve their existing
          // numeric components. Their identities, strings and all other fields stay exact.
          if (dependent) {
            dependents.add(feature.id);
            if (!Value.Equal({ ...solved, graph: feature.graph }, feature)) throw exact.error();
          } else if (!Value.Equal(solved, feature)) throw exact.error();
        }
      }
      previous.set(feature.id, solved);
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
    const editedId = edit.kind === 'update-feature' ? edit.feature.id : 'sketchId' in edit ? edit.sketchId : null;
    const pendingFeature = [...pending].reverse().find(earlier => (earlier.kind === 'add-feature' || earlier.kind === 'update-feature') && earlier.feature.id === editedId);
    const editedSketch = candidate.features.find(feature => feature.id === editedId)
      ?? (pendingFeature && 'feature' in pendingFeature ? pendingFeature.feature : undefined);
    const patternEdit = edit.kind === 'set-sketch-relation' && edit.relation.kind === 'linear-pattern'
      || edit.kind === 'remove-sketch-relation' && editedSketch?.kind === 'sketch' && editedSketch.graph?.relations.some(relation => relation.id === edit.relationId && relation.kind === 'linear-pattern')
      || edit.kind === 'update-feature' && edit.feature.kind === 'sketch' && editedSketch?.kind === 'sketch' && cadSketchPatternSnapshotNeedsExact(editedSketch, edit.feature);
    if (patternEdit) {
      await flush();
      const previous = candidate.features.find(feature => feature.id === editedId);
      const target = reduceCadEditIntents(candidate, [edit]);
      if (Value.Equal(candidate, target)) continue;
      candidate = target;
      const updated = edit.kind === 'update-feature' && edit.feature.kind === 'sketch' ? edit.feature : undefined;
      const detached = edit.kind === 'remove-sketch-relation' || updated && previous?.kind === 'sketch'
        && previous.graph?.relations.some(relation => relation.kind === 'linear-pattern'
          && !updated.graph?.relations.some(next => next.id === relation.id && next.kind === 'linear-pattern'));
      const sketchId = detached ? candidate.features.reduce((id, feature) => feature.kind === 'sketch' && feature.graph ? feature.id : id, '')
        : edit.kind === 'update-feature' ? edit.feature.id : 'sketchId' in edit ? edit.sketchId : '';
      await solve(undefined, { sketchId, error: () => new CadError('sketch-pattern-intent', 'The constraints cannot preserve this exact linear pattern edit. Adjust its seed or relations before trying again.') });
      continue;
    }
    if (changesReferenceDimensions(candidate, edit)) {
      await flush();
      const target = reduceCadEditIntents(candidate, [edit]);
      if (Value.Equal(candidate, target)) continue;
      if (Value.Equal(withoutReferenceDimensions(candidate), withoutReferenceDimensions(target))) {
        candidate = target;
        // Passive metadata cannot move even a later linked sketch. Reuse the
        // complete-prefix certificate through the final graph, not its edited owner.
        const sketchId = candidate.features.reduce((id, feature) => feature.kind === 'sketch' && feature.graph ? feature.id : id, '');
        await solve(undefined, { sketchId, error: () => new CadError('sketch-reference-dimension-intent',
          'Saving or removing a reference dimension cannot change sketch geometry. Resolve its constraints before trying again.') });
        continue;
      }
    }
    if (edit.kind === 'translate-sketch-geometry' || edit.kind === 'split-sketch-entity' || edit.kind === 'trim-sketch-entity' || edit.kind === 'extend-sketch-entity' || edit.kind === 'offset-sketch-loop' || edit.kind === 'mirror-sketch-geometry' || edit.kind === 'copy-sketch-profile') {
      await flush();
      const target = reduceCadEditIntents(candidate, [edit]);
      if (Value.Equal(candidate, target)) continue;
      candidate = target;
      const error = () => edit.kind === 'split-sketch-entity'
        ? new CadError('sketch-split-intent', 'The constraints cannot preserve this exact split without changing geometry. Adjust its relations before splitting.')
        : edit.kind === 'trim-sketch-entity'
          ? new CadError('sketch-trim-intent', 'The constraints cannot preserve this exact trim without changing geometry. Adjust its relations before trimming.')
          : edit.kind === 'extend-sketch-entity'
            ? new CadError('sketch-extend-intent', 'The constraints cannot preserve this exact extension without changing geometry. Adjust its relations before extending.')
            : edit.kind === 'offset-sketch-loop'
              ? new CadError('sketch-offset-intent', 'The constraints cannot preserve this exact offset without changing geometry. Adjust its source or relations before offsetting.')
              : edit.kind === 'mirror-sketch-geometry'
                ? new CadError('sketch-mirror-intent', 'The constraints cannot preserve this exact mirrored copy without changing geometry. Adjust its source or relations before mirroring.')
                : edit.kind === 'copy-sketch-profile'
                  ? new CadError('sketch-profile-copy-intent', 'The constraints cannot preserve this exact independent outline without changing geometry. Adjust its source before copying.')
                  : new CadError('sketch-translation-intent', 'The constraints cannot satisfy this exact move without changing other geometry. Adjust the selection or its relations.');
      // Certify the complete edited prefix before any downstream reference refresh.
      // Unrelated suffix features still require complete equality.
      await solve(undefined, { sketchId: edit.kind === 'copy-sketch-profile' ? edit.newSketchId : edit.sketchId, error });
    } else if (edit.kind === 'move-sketch-point') {
      await flush();
      const sketch = candidate.features.find(feature => feature.id === edit.sketchId);
      const point = sketch?.kind === 'sketch' ? sketch.graph?.points.find(point => point.id === edit.pointId) : undefined;
      if (!point) throw new CadError('missing-sketch-point', 'The selected sketch point no longer exists.');
      const reason = sketch?.kind === 'sketch' && sketch.graph ? cadSketchLinearPatternLockReason(sketch.graph, { kind: 'point', id: edit.pointId }) : null;
      if (reason) throw new CadError('owned-sketch-pattern', reason);
      const position = point.position.map((value, index) => evaluateCadScalar(value, candidate.parameters) + evaluateCadScalar(edit.translation[index], candidate.parameters));
      await solve({ sketchId: edit.sketchId, pointId: edit.pointId, position: [position[0], position[1]] });
    } else {
      // Geometry-dependent commands read the preceding solved candidate, never old coordinates.
      const relationId = edit.kind === 'remove-sketch-relation' ? edit.relationId : edit.kind === 'set-sketch-relation' ? edit.relation.id : null;
      const ownerChange = relationId !== null && (edit.kind === 'set-sketch-relation' && edit.relation.kind === 'external-reference'
        || candidate.features.some(feature => feature.kind === 'sketch' && 'sketchId' in edit && feature.id === edit.sketchId
          && feature.graph?.relations.some(relation => relation.kind === 'external-reference' && relation.id === relationId))
        || pending.some(earlier => 'sketchId' in earlier && 'sketchId' in edit && earlier.sketchId === edit.sketchId
          && (earlier.kind === 'use-sketch-entity' || earlier.kind === 'set-sketch-relation' && earlier.relation.kind === 'external-reference' && earlier.relation.id === relationId)));
      if (edit.kind === 'move-sketch-handle' || edit.kind === 'translate-sketch-profiles' || edit.kind === 'set-sketch-dimension' || edit.kind === 'create-sketch-corner' || edit.kind === 'use-sketch-entity' || ownerChange) await flush();
      pending.push(edit);
    }
  }
  await flush();
  signal?.throwIfAborted();
  return { document: parseCadDocument(candidate), sketchDiagnostics: [...diagnostics].map(([sketchId, diagnostics]) => ({ sketchId, diagnostics })) };
}
