import type { CadSketchGraph, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { cadSketchDatumRelationLabel } from './cadSketchGraphSelection';

const relationNames: Record<CadSketchGraphRelation['kind'], string> = {
  'tangent-joint': 'Tangent', 'point-on-line': 'Point on line', 'point-on-curve': 'Point on curve', symmetric: 'Symmetric points', 'linear-pattern': 'Linear pattern', 'reference-dimension': 'Reference dimension', coincident: 'Coincident', midpoint: 'Midpoint', horizontal: 'Horizontal', vertical: 'Vertical', parallel: 'Parallel', perpendicular: 'Perpendicular', collinear: 'Collinear', distance: 'Distance', 'point-line-distance': 'Point to line distance', 'axis-distance': 'Axis distance',
  'equal-length': 'Equal length', 'equal-radius': 'Equal radius', 'line-angle': 'Angle', 'external-reference': 'Linked reference',
  'fixed-point': 'Fixed point', 'fixed-axis': 'Distance', 'fillet-corner': 'Fillet', 'chamfer-corner': 'Chamfer', 'radial-size': 'Radial size'
};

/** The arcs and circles centred on each point; a Coincident between two of these centres is a Concentric relation. */
export function cadSketchCurveCentres(graph: CadSketchGraph): ReadonlyMap<string, readonly string[]> {
  const centres = new Map<string, string[]>();
  for (const entity of graph.entities) if (entity.kind !== 'line') centres.set(entity.centerPointId, [...centres.get(entity.centerPointId) ?? [], entity.id]);
  return centres;
}
/** A Coincident whose two points are both arc or circle centres reads as Concentric; it is stored as Coincident. */
export function isCadSketchConcentric(graph: CadSketchGraph, relation: CadSketchGraphRelation, centres = cadSketchCurveCentres(graph)): boolean {
  return relation.kind === 'coincident' && relation.pointIds.every(id => centres.has(id));
}
/** Sentence-case name of a relation, as the relations list, the constraint issues, the canvas and its status line show it. */
export function cadSketchRelationName(graph: CadSketchGraph, relation: CadSketchGraphRelation, centres?: ReadonlyMap<string, readonly string[]>): string {
  if (isCadSketchConcentric(graph, relation, centres)) return 'Concentric';
  return cadSketchDatumRelationLabel(relation) ?? (relation.kind === 'axis-distance' ? relation.axis === 'x' ? 'Horizontal distance' : 'Vertical distance'
    : relation.kind === 'radial-size' ? relation.quantity === 'radius' ? 'Radius' : 'Diameter' : relationNames[relation.kind]);
}

/** Ordinal labels of one graph snapshot, built once per snapshot so many relations can be named without rescanning it. */
export interface CadSketchRelationLabels {
  readonly centres: ReadonlyMap<string, readonly string[]>;
  point(id: string): string;
  entity(id: string): string;
}
export function createCadSketchRelationLabels(graph: CadSketchGraph): CadSketchRelationLabels {
  let points: Map<string, string> | null = null, entities: Map<string, string> | null = null;
  return { centres: cadSketchCurveCentres(graph),
    point: id => (points ??= new Map(graph.points.map((point, index) => [point.id, `Point ${index + 1}`]))).get(id) ?? 'Unavailable point',
    entity: id => (entities ??= new Map([...graph.entities].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .map((entity, index) => [entity.id, `${entity.kind[0].toUpperCase()}${entity.kind.slice(1)} ${index + 1}`]))).get(id) ?? 'Unavailable edge' };
}
/** The operands a relation names, in its stored order; a Concentric names its two curves. */
export function cadSketchRelationOperandLabels(graph: CadSketchGraph, relation: CadSketchGraphRelation, labels = createCadSketchRelationLabels(graph)): readonly string[] {
  const { point, entity } = labels;
  if (relation.kind === 'coincident' && isCadSketchConcentric(graph, relation, labels.centres)) return relation.pointIds.map(id => entity(labels.centres.get(id)![0]));
  switch (relation.kind) {
    case 'tangent-joint': return relation.endpoints.map(endpoint => `${entity(endpoint.entityId)} at ${point(endpoint.pointId)}`);
    case 'midpoint': case 'point-on-line': case 'point-line-distance': return [point(relation.pointId), entity(relation.lineId)];
    case 'point-on-curve': return [point(relation.pointId), entity(relation.curveId)];
    case 'line-angle': return relation.rays.map(ray => entity(ray.lineId));
    case 'parallel': case 'perpendicular': case 'collinear': case 'equal-length': return relation.lineIds.map(entity);
    case 'equal-radius': return relation.curveIds.map(entity);
    case 'radial-size': case 'external-reference': return [entity(relation.entityId)];
    case 'symmetric': return [...relation.pointIds.map(point), entity(relation.lineId)];
    case 'linear-pattern': return [entity(relation.seed.entityId)];
    case 'reference-dimension': return relation.measurement.kind === 'point-distance' ? relation.measurement.pointIds.map(point)
      : relation.measurement.kind === 'point-line-distance' ? [point(relation.measurement.pointId), entity(relation.measurement.lineId)] : [entity(relation.measurement.entityId)];
    // A distance from an axis names the axis among its operands, as a distance between two lines names both.
    case 'fixed-axis': return cadSketchDatumRelationLabel(relation) ? [point(relation.pointId)] : [point(relation.pointId), relation.axis === 'x' ? 'Y axis' : 'X axis'];
    case 'fixed-point': case 'fillet-corner': case 'chamfer-corner': return [point(relation.pointId)];
    case 'coincident': case 'horizontal': case 'vertical': case 'distance': case 'axis-distance': return relation.pointIds.map(point);
    default: { const unreachable: never = relation; return unreachable; }
  }
}
/** "Parallel: Line 3 and Line 5", the accessible name of a relation on the canvas. */
export function cadSketchRelationDescription(graph: CadSketchGraph, relation: CadSketchGraphRelation, labels = createCadSketchRelationLabels(graph), name = cadSketchRelationName(graph, relation, labels.centres)): string {
  return `${name}: ${cadSketchRelationOperandLabels(graph, relation, labels).join(relation.kind === 'axis-distance' ? ' → ' : ' and ')}`;
}
