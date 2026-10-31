import type { CadScalar } from './cadDocument';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphRelation } from './cadSketchGraph';
import { CadError } from './cadError';
import { cadSketchRelationDefinition, cadSketchRelationSignature, cadSketchSignatureSlots } from './sketch-relations/cadSketchRelationRegistry';

export function cadSketchEntityPointIds(entity: CadSketchGraphEntity): readonly string[] {
  return entity.kind === 'line' ? [entity.startPointId, entity.endPointId]
    : entity.kind === 'arc' ? [entity.centerPointId, entity.startPointId, entity.endPointId] : [entity.centerPointId];
}
/** The edges a relation names, in stored order, then the edges it made and keeps. */
export function cadSketchRelationEntityIds(relation: CadSketchGraphRelation): readonly string[] {
  const definition = cadSketchRelationDefinition(relation), ids = definition.operands(relation), slots = cadSketchSignatureSlots(cadSketchRelationSignature(relation)).entities;
  // Operands that are all edges are the relation's own stored list.
  const named = slots.length === ids.length ? ids : slots.map(index => ids[index]), owned = definition.owns?.(relation).entityIds;
  return owned?.length ? [...named, ...owned] : named;
}
/**
 * The points a relation references: its point operands, then the points of every edge it names or keeps, each once. A relation on points
 * alone lists them as they are, so the parse refuses one that names a point twice.
 */
export function cadSketchRelationPointIds(graph: CadSketchGraph, relation: CadSketchGraphRelation): readonly string[] {
  const definition = cadSketchRelationDefinition(relation);
  if (definition.pointIds) return definition.pointIds(graph, relation);
  const ids = definition.operands(relation), slots = cadSketchSignatureSlots(cadSketchRelationSignature(relation)).points, entityIds = cadSketchRelationEntityIds(relation);
  // Operands that are all points are the relation's own stored list.
  if (!entityIds.length) return slots.length === ids.length ? ids : slots.map(index => ids[index]);
  const points = slots.map(index => ids[index]);
  for (const id of entityIds) {
    const entity = graph.entities.find(entity => entity.id === id);
    if (!entity) throw new CadError('missing-sketch-entity', `Sketch relation "${relation.id}" references missing entity "${id}".`);
    points.push(...cadSketchEntityPointIds(entity));
  }
  return [...new Set(points)];
}
/** The relation with each driving value mapped, keyed by its path in the relation's data; a relation without one is returned as it is. */
export function mapCadSketchRelationScalars(relation: CadSketchGraphRelation, map: (value: CadScalar, key: string) => CadScalar): CadSketchGraphRelation {
  const scalars = cadSketchRelationDefinition(relation).scalars;
  return scalars ? scalars.write(relation, scalars.read(relation).map((value, index) => map(value, scalars.keys[index]))) : relation;
}
