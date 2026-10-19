import type { CadPoint2 } from './cadDocument';
import type { CadSketchGraph, CadSketchGraphRelation } from './cadSketchGraph';
import { cadSketchEntityPointIds, cadSketchRelationEntityIds, cadSketchRelationPointIds } from './cadSketchGraphReferences';
import { CAD_SKETCH_SELECTION_LIMIT, type CadSketchGraphSelection } from './cadSketchGraphSelection';

/** A rigid move that satisfies new positional relations before the solver runs. */
export interface CadSketchRelationPlacement {
  readonly selections: readonly CadSketchGraphSelection[];
  readonly translation: CadPoint2;
}

/** Relations that hold a component in place, so it cannot simply be carried to a new position. */
const ANCHORS: ReadonlySet<CadSketchGraphRelation['kind']> = new Set(['fixed-point', 'fixed-axis', 'external-reference', 'linear-pattern']);

/**
 * Placing a point on the origin, an axis or another shape's point carries the whole free shape it belongs to, as
 * CATIA does, instead of letting the solver stretch it toward the target. Unsigned tangency could otherwise settle on
 * a flipped arc. Returns null when the target is already met, the shape is anchored, the operands share a shape, or the
 * shape is too large for one geometry move; the solver then handles the relation alone.
 */
export function cadSketchRelationPlacement(graph: CadSketchGraph, relations: readonly CadSketchGraphRelation[]): CadSketchRelationPlacement | null {
  const positions = new Map(graph.points.map(point => [point.id, point.position]));
  const numeric = (id: string) => {
    const position = positions.get(id);
    return position && typeof position[0] === 'number' && typeof position[1] === 'number' ? [position[0], position[1]] as const : null;
  };
  let moving: string | null = null, target: [number, number] | null = null, partner: string | null = null;
  for (const relation of relations) {
    if (relation.kind === 'fixed-axis' && typeof relation.value === 'number') {
      const at = numeric(relation.pointId);
      if (!at || moving && moving !== relation.pointId) return null;
      moving = relation.pointId; target ??= [at[0], at[1]];
      target[relation.axis === 'x' ? 0 : 1] = relation.value;
    } else if (relation.kind === 'coincident' && relations.length === 1) {
      const [first, second] = relation.pointIds, at = numeric(second);
      if (!at || !numeric(first)) return null;
      moving = first; partner = second; target = [at[0], at[1]];
    } else return null;
  }
  const from = moving ? numeric(moving) : null;
  if (!moving || !from || !target) return null;
  const translation: CadPoint2 = [target[0] - from[0], target[1] - from[1]];
  if (translation[0] === 0 && translation[1] === 0) return null;
  const component = sketchComponent(graph, moving);
  if (partner && component.points.has(partner)) return null;
  if (graph.relations.some(relation => component.relations.has(relation.id) && ANCHORS.has(relation.kind))) return null;
  if ([...component.points].some(id => !numeric(id))) return null;
  const covered = new Set(graph.entities.filter(entity => component.entities.has(entity.id)).flatMap(cadSketchEntityPointIds));
  const selections = [...graph.entities.filter(entity => component.entities.has(entity.id)).map(entity => ({ kind: 'entity' as const, id: entity.id })),
    ...graph.points.filter(point => component.points.has(point.id) && !covered.has(point.id)).map(point => ({ kind: 'point' as const, id: point.id }))];
  return selections.length <= CAD_SKETCH_SELECTION_LIMIT ? { selections, translation } : null;
}

/** Points, edges and relations reachable from one point through shared points, edges and relations. */
function sketchComponent(graph: CadSketchGraph, start: string) {
  const points = new Set([start]), entities = new Set<string>(), relations = new Set<string>();
  const entityPoints = new Map(graph.entities.map(entity => [entity.id, cadSketchEntityPointIds(entity)]));
  const links = [...graph.entities.map(entity => ({ kind: 'entity' as const, id: entity.id, points: cadSketchEntityPointIds(entity), entities: [] as readonly string[] })),
    // A reference dimension only measures, so it never ties the shapes it reads into one rigid body.
    ...graph.relations.filter(relation => relation.kind !== 'reference-dimension').map(relation => ({ kind: 'relation' as const, id: relation.id, points: cadSketchRelationPointIds(graph, relation), entities: cadSketchRelationEntityIds(relation) }))];
  for (let grown = true; grown;) {
    grown = false;
    for (const link of links) {
      const owned = link.kind === 'entity' ? entities : relations;
      if (owned.has(link.id) || !(link.points.some(id => points.has(id)) || link.entities.some(id => entities.has(id)))) continue;
      owned.add(link.id); grown = true;
      for (const id of link.points) points.add(id);
      for (const id of link.entities) { entities.add(id); for (const point of entityPoints.get(id) ?? []) points.add(point); }
    }
  }
  return { points, entities, relations };
}
