import type { CadScalar } from './cadDocument';
import type { CadSketchGraph, CadSketchReferenceDimension } from './cadSketchGraph';
import { CadError } from './cadError';
import { createCadSketchMeasurementReader } from './cadSketchMeasurements';
import { cadSketchPointLineSide, resolveCadSketchPointLineDistanceOperands } from './cadSketchPointLineDistanceRelations';

/** Resolve authored identity only. A line reference follows its current retained endpoints. */
export function resolveCadSketchReferenceDimension(graph: CadSketchGraph, relation: CadSketchReferenceDimension) {
  const measurement = relation.measurement;
  if (measurement.kind === 'point-distance') return { id: relation.id, kind: 'distance' as const, pointIds: measurement.pointIds };
  if (measurement.kind === 'point-line-distance') {
    const { point, line } = resolveCadSketchPointLineDistanceOperands(graph, measurement);
    return { id: relation.id, kind: 'point-line-distance' as const, pointId: point.id, lineId: line.id };
  }
  const entity = graph.entities.find(entity => entity.id === measurement.entityId);
  if (measurement.kind === 'line-length') {
    if (entity?.kind !== 'line') throw new CadError('invalid-sketch-reference-dimension', 'A reference length needs an existing line.');
    return { id: relation.id, kind: 'distance' as const, pointIds: [entity.startPointId, entity.endPointId] as const };
  }
  if (!entity || entity.kind === 'line') throw new CadError('invalid-sketch-reference-dimension', 'A reference radius or diameter needs an existing arc or circle.');
  return { id: relation.id, kind: 'radial-size' as const, entityId: entity.id, quantity: measurement.quantity };
}

/** Calculated from actual local geometry; never stored as a driver or written into the graph. */
export function measureCadSketchReferenceDimension(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>, relation: CadSketchReferenceDimension): number {
  const source = resolveCadSketchReferenceDimension(graph, relation), reader = createCadSketchMeasurementReader(graph, parameters);
  if (source.kind === 'distance') return reader.betweenPoints(...source.pointIds).distanceMm;
  if (source.kind === 'point-line-distance') return Math.abs(reader.pointToLine(source.pointId, source.lineId).signedMm);
  const curve = reader.entity(source.entityId);
  if (curve.kind === 'line') throw new CadError('invalid-sketch-reference-dimension', 'The measured radial support is no longer available.');
  return curve.radiusMm * (source.quantity === 'diameter' ? 2 : 1);
}

/** Intent factory only: the ordinary prepared set-relation operation validates the new driver. A point keeps the side it is measured on. */
export function cadSketchReferenceDimensionToDriving(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>,
  relation: CadSketchReferenceDimension, value?: CadScalar) {
  const source = resolveCadSketchReferenceDimension(graph, relation), measured = value ?? measureCadSketchReferenceDimension(graph, parameters, relation);
  if (source.kind !== 'point-line-distance') return { ...source, value: measured };
  const side = cadSketchPointLineSide(createCadSketchMeasurementReader(graph, parameters).pointToLine(source.pointId, source.lineId).signedMm);
  return { ...source, side, value: measured };
}
