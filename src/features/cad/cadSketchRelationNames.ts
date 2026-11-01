import type { CadSketchGraph, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { cadSketchRelationKindName, cadSketchRelationMentions, isCadSketchRelationDirected } from '@/domain/cad/sketch-relations/cadSketchRelationRegistry';
import { cadSketchZeroScalar } from '@/domain/cad/sketch-relations/cadSketchRelationPlanning';
import { CAD_SKETCH_VIRTUAL_LABELS, cadSketchAxisOfNormal, isCadSketchVirtualId, type CadSketchVirtualAxisId } from '@/domain/cad/sketch-relations/cadSketchVirtualElements';

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
/**
 * The axis a relation keeps its point on, or null: a coordinate held at 0 keeps the point on the axis across it, a Y of 0 on the H axis.
 * It is the form a point made Coincident with an axis takes, so it is named and drawn as that Coincident.
 */
export function cadSketchRelationAxis(relation: CadSketchGraphRelation): CadSketchVirtualAxisId | null {
  return relation.kind === 'fixed-axis' && cadSketchZeroScalar(relation.value) ? cadSketchAxisOfNormal(relation.axis) : null;
}
/** Sentence-case name of a relation, as the relations list, the constraint issues, the canvas and its status line show it. */
export function cadSketchRelationName(graph: CadSketchGraph, relation: CadSketchGraphRelation, centres?: ReadonlyMap<string, readonly string[]>): string {
  if (isCadSketchConcentric(graph, relation, centres)) return 'Concentric';
  return cadSketchRelationAxis(relation) ? 'Coincident' : cadSketchRelationKindName(relation);
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
    point: id => isCadSketchVirtualId(id) ? CAD_SKETCH_VIRTUAL_LABELS[id] : (points ??= new Map(graph.points.map((point, index) => [point.id, `Point ${index + 1}`]))).get(id) ?? 'Unavailable point',
    entity: id => isCadSketchVirtualId(id) ? CAD_SKETCH_VIRTUAL_LABELS[id] : (entities ??= new Map([...graph.entities].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .map((entity, index) => [entity.id, `${entity.kind[0].toUpperCase()}${entity.kind.slice(1)} ${index + 1}`]))).get(id) ?? 'Unavailable edge' };
}
/** The operands a relation names, in its stored order; a Concentric names its two curves. */
export function cadSketchRelationOperandLabels(graph: CadSketchGraph, relation: CadSketchGraphRelation, labels = createCadSketchRelationLabels(graph)): readonly string[] {
  if (relation.kind === 'coincident' && isCadSketchConcentric(graph, relation, labels.centres)) return relation.pointIds.map(id => labels.entity(labels.centres.get(id)![0]));
  // A point held on an axis names the point and the axis, as the Coincident that keeps it there.
  const axis = cadSketchRelationAxis(relation);
  if (axis && relation.kind === 'fixed-axis') return [labels.point(relation.pointId), CAD_SKETCH_VIRTUAL_LABELS[axis]];
  return cadSketchRelationMentions(relation, labels);
}
/** "Parallel: Line 3 and Line 5", the accessible name of a relation on the canvas. */
export function cadSketchRelationDescription(graph: CadSketchGraph, relation: CadSketchGraphRelation, labels = createCadSketchRelationLabels(graph), name = cadSketchRelationName(graph, relation, labels.centres)): string {
  return `${name}: ${cadSketchRelationOperandLabels(graph, relation, labels).join(isCadSketchRelationDirected(relation) ? ' → ' : ' and ')}`;
}
