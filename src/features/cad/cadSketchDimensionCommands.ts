import type { CadSketchGraph, CadSketchGraphRelation, CadSketchReferenceDimension } from '@/domain/cad/cadSketchGraph';
import { cadSketchReferenceDimensionToDriving, resolveCadSketchReferenceDimension } from '@/domain/cad/cadSketchReferenceDimensions';
import { cadSketchLinearPatternLockReason } from '@/domain/cad/cadSketchLinearPattern';
import { cadSketchExternalReferenceLockReason } from '@/domain/cad/cadSketchExternalReferences';

/** Both relations name the same two points, in either order. */
export const cadSketchRelationHasPointPair = (relation: CadSketchGraphRelation, pointIds: readonly [string, string]) => 'pointIds' in relation
  && relation.pointIds.includes(pointIds[0]) && relation.pointIds.includes(pointIds[1]);
/** The driving distance, or the horizontal or vertical distance, between two points. */
export const cadSketchDistanceForPair = (graph: CadSketchGraph, pointIds: readonly [string, string], axis?: 'x' | 'y') => graph.relations.find(
  (relation): relation is Extract<CadSketchGraphRelation, { kind: 'distance' | 'axis-distance' }> =>
    (axis === undefined ? relation.kind === 'distance' : relation.kind === 'axis-distance' && relation.axis === axis) && cadSketchRelationHasPointPair(relation, pointIds));
/** The radius, diameter or fillet that already drives a curve. */
export const cadSketchRadialRelationForEntity = (graph: CadSketchGraph, entityId: string) => graph.relations.find(relation => relation.kind === 'radial-size' && relation.entityId === entityId
  || relation.kind === 'fillet-corner' && relation.arcId === entityId);
export function cadSketchMatchingReference(graph: CadSketchGraph, measurement: CadSketchReferenceDimension['measurement']) {
  return graph.relations.find((r): r is CadSketchReferenceDimension => r.kind === 'reference-dimension' && (r.measurement.kind === 'point-distance'
    ? measurement.kind === 'point-distance' && r.measurement.pointIds.every(id => measurement.pointIds.includes(id))
    : measurement.kind !== 'point-distance' && r.measurement.kind === measurement.kind && r.measurement.entityId === measurement.entityId
      && (r.measurement.kind !== 'radial-size' || measurement.kind === 'radial-size' && r.measurement.quantity === measurement.quantity)));
}
/** Why a reference dimension cannot become driving, or null when it can. */
export function cadSketchReferenceDrivingLock(graph: CadSketchGraph, relation: CadSketchReferenceDimension): string | null {
  const target = resolveCadSketchReferenceDimension(graph, relation);
  const selections = target.kind === 'distance' ? target.pointIds.map(id => ({kind:'point' as const,id})) : [{kind:'entity' as const,id:target.entityId}];
  const owned = selections.map(atom => cadSketchLinearPatternLockReason(graph,atom)).find(Boolean); if (owned) return owned;
  if (target.kind === 'distance') {
    const linked = relation.measurement.kind === 'line-length' ? cadSketchExternalReferenceLockReason(graph, {kind:'entity',id:relation.measurement.entityId}) : null;
    if (linked) return linked;
    if (cadSketchDistanceForPair(graph, target.pointIds)) return 'An existing dimension already drives this distance. Edit that dimension instead.';
  } else {
    const linked = cadSketchExternalReferenceLockReason(graph, { kind:'entity', id:target.entityId });
    if (linked) return linked;
    if (cadSketchRadialRelationForEntity(graph, target.entityId)) return 'An existing dimension already drives this curve. Edit that dimension instead.';
    const entity = graph.entities.find(e => e.id === target.entityId);
    if (entity?.kind === 'circle' && typeof entity.radius === 'string') return 'The circle radius is driven by its source expression. Edit that expression instead.';
  }
  return null;
}

/** One dimension command for the canvas menu: the relation to set, or why the command does not apply. */
export type CadSketchDimensionConversion = { readonly relation: CadSketchGraphRelation; readonly reason: null } | { readonly relation: null; readonly reason: string };
const unavailable = (reason: string): CadSketchDimensionConversion => ({ relation: null, reason });

/** A driving length, distance, radius or diameter becomes a reference that measures the same thing and keeps its identity. */
export function cadSketchDimensionToReference(graph: CadSketchGraph, relation: CadSketchGraphRelation): CadSketchDimensionConversion {
  if (relation.kind === 'reference-dimension') return unavailable('This is already a reference dimension.');
  if (relation.kind === 'fillet-corner' || relation.kind === 'chamfer-corner') return unavailable('A corner treatment owns its fillet or chamfer size. Edit the corner instead.');
  if (relation.kind !== 'distance' && relation.kind !== 'radial-size') return unavailable('Reference dimensions measure lengths, point distances, radii and diameters.');
  const line = relation.kind === 'distance' && graph.entities.find(entity => entity.kind === 'line' && cadSketchRelationHasPointPair(relation, [entity.startPointId, entity.endPointId]));
  const measurement: CadSketchReferenceDimension['measurement'] = relation.kind === 'radial-size' ? { kind: 'radial-size', entityId: relation.entityId, quantity: relation.quantity }
    : line ? { kind: 'line-length', entityId: line.id } : { kind: 'point-distance', pointIds: relation.pointIds };
  if (cadSketchMatchingReference(graph, measurement)) return unavailable('A reference dimension already measures this. Delete this dimension instead.');
  return { relation: { id: relation.id, kind: 'reference-dimension', measurement }, reason: null };
}
/** A reference becomes the driving dimension it measures, at its current value. */
export function cadSketchDimensionToDriving(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>, relation: CadSketchGraphRelation): CadSketchDimensionConversion {
  if (relation.kind !== 'reference-dimension') return unavailable('This dimension already drives the geometry.');
  try {
    const lock = cadSketchReferenceDrivingLock(graph, relation);
    return lock ? unavailable(lock) : { relation: cadSketchReferenceDimensionToDriving(graph, parameters, relation), reason: null };
  } catch { return unavailable('The measured geometry is no longer available.'); }
}
