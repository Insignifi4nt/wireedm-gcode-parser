import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { cadSketchEntityPointIds, cadSketchRelationEntityIds, cadSketchRelationPointIds } from '@/domain/cad/cadSketchGraphReferences';
import type { CadSketchDefinition, CadSketchSolveDiagnostics } from './sketch-solver/cadSketchSolverTypes';

/** The colour a sketch point or edge takes from its definition or a failed preview; interaction states draw above it. */
export type CadSketchGeometryMark = 'conflicting' | 'redundant' | 'defined' | null;
export interface CadSketchMarkedIds { readonly pointIds: ReadonlySet<string>; readonly entityIds: ReadonlySet<string> }
/** What one accepted analysis proved fully defined. `revision` changes with the sets, so a captured view can tell them apart. */
export interface CadSketchDefinitionMarks extends CadSketchMarkedIds { readonly revision: number }
/** Operands of the relations, edges and points a rejected candidate reported, from its full diagnostic ID lists. */
export interface CadSketchDiagnosisMarks {
  readonly revision: number; readonly sketchId: string;
  readonly conflicting: CadSketchMarkedIds; readonly redundant: CadSketchMarkedIds;
}

let revisions = 0;
const sameIds = (set: ReadonlySet<string>, ids: Iterable<string>) => { const other = new Set(ids); return set.size === other.size && [...other].every(id => set.has(id)); };
const sameMarked = (a: CadSketchMarkedIds, b: CadSketchMarkedIds) => sameIds(a.pointIds, b.pointIds) && sameIds(a.entityIds, b.entityIds);

/** Reuses `previous` when it holds the same IDs, so an equal analysis of a new version keeps its identity. */
export function cadSketchDefinitionMarks(definition: CadSketchDefinition | undefined, previous?: CadSketchDefinitionMarks | null): CadSketchDefinitionMarks | null {
  if (!definition) return null;
  if (previous && sameIds(previous.pointIds, definition.definedPointIds) && sameIds(previous.entityIds, definition.definedEntityIds)) return previous;
  return Object.freeze({ revision: ++revisions, pointIds: new Set(definition.definedPointIds), entityIds: new Set(definition.definedEntityIds) });
}

/**
 * A relation marks every point and edge it holds; an edge reported for an implicit structural constraint marks itself
 * and its points; a point, such as a dragged one, marks itself. IDs the graph no longer holds are skipped. Equal marks
 * reuse `previous`.
 */
export function cadSketchDiagnosisMarks(sketchId: string, graph: CadSketchGraph, diagnostics: Pick<CadSketchSolveDiagnostics, 'conflictingIds' | 'redundantIds' | 'partiallyRedundantIds'>,
  previous?: CadSketchDiagnosisMarks | null): CadSketchDiagnosisMarks | null {
  if (!diagnostics.conflictingIds.length && !diagnostics.redundantIds.length && !diagnostics.partiallyRedundantIds.length) return null;
  const relations = new Map(graph.relations.map(relation => [relation.id, relation])), entities = new Map(graph.entities.map(entity => [entity.id, entity]));
  const points = new Set(graph.points.map(point => point.id));
  const collect = (ids: readonly (readonly string[])[]): CadSketchMarkedIds => {
    const pointIds = new Set<string>(), entityIds = new Set<string>();
    for (const list of ids) for (const id of list) {
      const relation = relations.get(id), entity = entities.get(id);
      if (relation) {
        // A relation whose operands no longer resolve marks nothing; the rejection it belongs to must still reach the user.
        let operands: readonly string[];
        try { operands = cadSketchRelationPointIds(graph, relation); } catch { continue; }
        for (const pointId of operands) pointIds.add(pointId);
        for (const entityId of cadSketchRelationEntityIds(relation)) if (entities.has(entityId)) entityIds.add(entityId);
      } else if (entity) {
        entityIds.add(entity.id);
        for (const pointId of cadSketchEntityPointIds(entity)) pointIds.add(pointId);
      } else if (points.has(id)) pointIds.add(id);
    }
    return Object.freeze({ pointIds, entityIds });
  };
  const conflicting = collect([diagnostics.conflictingIds]), redundant = collect([diagnostics.redundantIds, diagnostics.partiallyRedundantIds]);
  if (previous?.sketchId === sketchId && sameMarked(previous.conflicting, conflicting) && sameMarked(previous.redundant, redundant)) return previous;
  return Object.freeze({ revision: ++revisions, sketchId, conflicting, redundant });
}

/** Conflicting draws above redundant, and both above defined; a failed preview never hides behind an accepted colour. */
export function cadSketchGeometryMark(kind: 'point' | 'entity', id: string, definition: CadSketchDefinitionMarks | null | undefined,
  diagnosis: CadSketchDiagnosisMarks | null | undefined): CadSketchGeometryMark {
  const key = kind === 'point' ? 'pointIds' : 'entityIds';
  return diagnosis?.conflicting[key].has(id) ? 'conflicting' : diagnosis?.redundant[key].has(id) ? 'redundant'
    : definition?.[key].has(id) ? 'defined' : null;
}
