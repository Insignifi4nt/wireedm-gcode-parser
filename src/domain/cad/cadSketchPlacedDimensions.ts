import { Value } from '@sinclair/typebox/value';
import type { CadFeature } from './cadDocument';
import type { CadSketchAngleAnnotation, CadSketchAnnotatedRelation, CadSketchGraph, CadSketchGraphRelation, CadSketchLinearAnnotation, CadSketchRadialAnnotation } from './cadSketchGraph';

/** Where one drawn part of a dimension sits; a chamfer's setback takes the linear form for its side. */
export type CadSketchDimensionPartPlacement = CadSketchLinearAnnotation | CadSketchAngleAnnotation | CadSketchRadialAnnotation;

const annotated = (relation: CadSketchGraphRelation): relation is CadSketchAnnotatedRelation => 'annotation' in relation && relation.annotation !== undefined;

/** The placement a relation stores for its drawn part `side`, which only a chamfer has two of; undefined lays it out automatically. */
export function cadSketchDimensionPlacementOf(relation: CadSketchGraphRelation, side: 0 | 1 = 0): CadSketchDimensionPartPlacement | undefined {
  if (!annotated(relation)) return undefined;
  const annotation = relation.annotation!;
  if (annotation.kind !== 'setbacks') return annotation;
  const placed = annotation.sides[side];
  return placed ? { kind: 'linear', offset: placed.offset, along: placed.along } : undefined;
}

/** `relation` placing its part `side` at `placement`, or laying it out automatically without one. Other fields, and a chamfer's other side, stay. */
export function withCadSketchDimensionPlacement<Relation extends CadSketchGraphRelation>(relation: Relation, side: 0 | 1, placement: CadSketchDimensionPartPlacement | undefined): Relation {
  if (relation.kind === 'chamfer-corner') {
    type Side = { readonly offset: number; readonly along: number } | null;
    const sides: [Side, Side] = [relation.annotation?.sides[0] ?? null, relation.annotation?.sides[1] ?? null];
    sides[side] = placement?.kind === 'linear' ? { offset: placement.offset, along: placement.along } : null;
    return sides[0] || sides[1] ? { ...relation, annotation: { kind: 'setbacks', sides } } : withoutCadSketchDimensionAnnotation(relation);
  }
  return placement ? { ...relation, annotation: placement } : withoutCadSketchDimensionAnnotation(relation);
}

/** `relation` with no stored placement, laid out automatically; it is the relation itself when it has none. */
export function withoutCadSketchDimensionAnnotation<Relation extends CadSketchGraphRelation>(relation: Relation): Relation {
  if (!('annotation' in relation)) return relation;
  const { annotation: _annotation, ...rest } = relation as Relation & { readonly annotation?: unknown };
  return rest as Relation;
}

/** The two points a linear dimension runs between, in the order its placement is taken: its offset is to the left of the first to the second. */
function placementPair(graph: CadSketchGraph, relation: CadSketchGraphRelation): readonly [string, string] | null {
  if (relation.kind === 'distance') return relation.pointIds;
  if (relation.kind !== 'reference-dimension') return null;
  const measurement = relation.measurement;
  if (measurement.kind === 'point-distance') return measurement.pointIds;
  if (measurement.kind !== 'line-length') return null;
  const line = graph.entities.find(entity => entity.id === measurement.entityId);
  return line?.kind === 'line' ? [line.startPointId, line.endPointId] : null;
}

/**
 * `to`, the driving or reference form of the dimension `from`, drawn where `from` was placed. A linear placement taken between the
 * same points in the other order is turned round, so the dimension stays where it was drawn. A placement that `to` cannot take, or
 * `from` with none, leaves `to` laid out automatically.
 */
export function withCadSketchCarriedPlacement<Relation extends CadSketchGraphRelation>(graph: CadSketchGraph, from: CadSketchGraphRelation, to: Relation): Relation {
  const placement = annotated(from) ? from.annotation! : undefined;
  if (!placement) return to;
  const radial = to.kind === 'radial-size' || to.kind === 'reference-dimension' && to.measurement.kind === 'radial-size';
  const linear = to.kind === 'distance' || to.kind === 'point-line-distance' || to.kind === 'reference-dimension' && !radial;
  if (placement.kind === 'radial' ? !radial : placement.kind !== 'linear' || !linear) return withoutCadSketchDimensionAnnotation(to);
  const a = placementPair(graph, from), b = placementPair(graph, to);
  const reversed = placement.kind === 'linear' && a && b && a[0] === b[1] && a[1] === b[0] && a[0] !== a[1];
  return { ...to, annotation: reversed ? { kind: 'linear', offset: -placement.offset, along: 1 - placement.along } : placement };
}

/** Whether two relations differ in nothing but where they are drawn. */
export function cadSketchRelationsEqualButPlacement(a: CadSketchGraphRelation, b: CadSketchGraphRelation): boolean {
  return a === b || Value.Equal(withoutCadSketchDimensionAnnotation(a), withoutCadSketchDimensionAnnotation(b));
}

/**
 * Whether two graphs hold the same points, entities and relations apart from where dimensions are drawn. Placement is display data,
 * so a graph that changes only that needs no solve, analysis or new output.
 */
export function cadSketchGraphsEqualButPlacement(a: CadSketchGraph, b: CadSketchGraph): boolean {
  if (a === b) return true;
  if (a.relations.length !== b.relations.length || !Value.Equal(a.points, b.points) || !Value.Equal(a.entities, b.entities)) return false;
  return a.relations.every((relation, index) => cadSketchRelationsEqualButPlacement(relation, b.relations[index]));
}

/** `graph` with every stored placement removed; the graph itself when it holds none. */
export function cadSketchGraphWithoutPlacement(graph: CadSketchGraph): CadSketchGraph {
  if (!graph.relations.some(annotated)) return graph;
  return { ...graph, relations: graph.relations.map(withoutCadSketchDimensionAnnotation) };
}

/** Whether two sketch features differ in nothing but where their dimensions are drawn. */
export function cadSketchFeaturesEqualButPlacement(a: CadFeature | undefined, b: CadFeature | undefined): boolean {
  if (a === b) return true;
  if (a?.kind !== 'sketch' || b?.kind !== 'sketch' || !a.graph !== !b.graph || a.graph && !cadSketchGraphsEqualButPlacement(a.graph, b.graph!)) return false;
  return Value.Equal({ ...a, graph: null }, { ...b, graph: null });
}
