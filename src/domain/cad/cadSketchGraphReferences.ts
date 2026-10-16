import type { CadScalar } from './cadDocument';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphRelation } from './cadSketchGraph';
import { CadError } from './cadError';
import { cadSketchLinearPatternInstances } from './cadSketchLinearPattern';

export function cadSketchEntityPointIds(entity: CadSketchGraphEntity): readonly string[] {
  return entity.kind === 'line' ? [entity.startPointId, entity.endPointId]
    : entity.kind === 'arc' ? [entity.centerPointId, entity.startPointId, entity.endPointId] : [entity.centerPointId];
}
export function cadSketchRelationEntityIds(relation: CadSketchGraphRelation): readonly string[] {
  if (relation.kind === 'linear-pattern') return [relation.seed.entityId, ...cadSketchLinearPatternInstances(relation).filter(member => member.active).map(member => member.entityId)];
  return relation.kind === 'reference-dimension' ? relation.measurement.kind === 'point-distance' ? [] : [relation.measurement.entityId] : relation.kind === 'external-reference' ? [relation.entityId] : relation.kind === 'midpoint' ? [relation.lineId] : relation.kind === 'line-angle' ? relation.rays.map(ray => ray.lineId) : relation.kind === 'radial-size' ? [relation.entityId]
    : relation.kind === 'parallel' || relation.kind === 'perpendicular' || relation.kind === 'collinear' || relation.kind === 'equal-length' ? relation.lineIds
    : relation.kind === 'equal-radius' ? relation.curveIds
    : relation.kind === 'fillet-corner' ? [...relation.lineIds, relation.arcId]
    : relation.kind === 'chamfer-corner' ? [...relation.lineIds, relation.chamferId] : [];
}
export function cadSketchRelationPointIds(graph: CadSketchGraph, relation: CadSketchGraphRelation): readonly string[] {
  if (relation.kind === 'reference-dimension' && relation.measurement.kind === 'point-distance') return relation.measurement.pointIds;
  if ('pointIds' in relation) return relation.pointIds;
  const ids = 'pointId' in relation ? [relation.pointId] : [];
  for (const id of cadSketchRelationEntityIds(relation)) {
    const entity = graph.entities.find(entity => entity.id === id);
    if (!entity) throw new CadError('missing-sketch-entity', `Sketch relation "${relation.id}" references missing entity "${id}".`);
    ids.push(...cadSketchEntityPointIds(entity));
  }
  return [...new Set(ids)];
}
export function mapCadSketchRelationScalars(relation: CadSketchGraphRelation, map: (value: CadScalar, key: string) => CadScalar): CadSketchGraphRelation {
  switch (relation.kind) {
    case 'linear-pattern': return { ...relation, spacing: map(relation.spacing, 'spacing') };
    case 'fixed-point': return { ...relation, position: [map(relation.position[0], 'position.0'), map(relation.position[1], 'position.1')] };
    case 'fixed-axis': case 'distance': case 'axis-distance': case 'fillet-corner': case 'radial-size': case 'line-angle': return { ...relation, value: map(relation.value, 'value') };
    case 'chamfer-corner': return { ...relation, values: [map(relation.values[0], 'values.0'), map(relation.values[1], 'values.1')] };
    case 'reference-dimension': case 'external-reference': case 'coincident': case 'horizontal': case 'vertical': case 'parallel': case 'perpendicular': case 'collinear': case 'equal-length': case 'equal-radius': case 'midpoint': return relation;
    default: { const exhaustive: never = relation; return exhaustive; }
  }
}
