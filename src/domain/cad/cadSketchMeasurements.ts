import type { CadSketchGraph } from './cadSketchGraph';
import { checkCadSketchGraph } from './cadSketchGraph';
import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';
import { createArcSegment } from '@/domain/path-intel/segments';
import { cadSketchVirtualPoint } from './sketch-relations/cadSketchVirtualElements';

export type CadSketchEntityMeasurement =
  | { readonly kind: 'line'; readonly lengthMm: number; readonly deltaMm: readonly [number, number] }
  | { readonly kind: 'arc'; readonly radiusMm: number; readonly sweepDegrees: number; readonly lengthMm: number }
  | { readonly kind: 'circle'; readonly radiusMm: number; readonly diameterMm: number; readonly circumferenceMm: number };

/** Read actual local geometry, independently of constraints, material cells or a native solve. */
export function createCadSketchMeasurementReader(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>) {
  const points = new Map(graph.points.map(point => [point.id, point]));
  const entities = new Map(graph.entities.map(entity => [entity.id, entity]));
  const sourcePoint = (id: string) => {
    const value = points.get(id);
    if (!value) throw new CadError('missing-sketch-point', 'The measured point is no longer available.');
    return value;
  };
  // The origin is measured from as any point is.
  const point = (id: string): readonly [number, number] => {
    const source = cadSketchVirtualPoint(id) ?? sourcePoint(id);
    return [evaluateCadScalar(source.position[0], parameters), evaluateCadScalar(source.position[1], parameters)];
  };
  const betweenPoints = (firstId: string, secondId: string) => {
    const first = point(firstId), second = point(secondId), deltaMm = [second[0] - first[0], second[1] - first[1]] as const;
    return { distanceMm: Math.hypot(...deltaMm), deltaMm };
  };
  const entity = (id: string): CadSketchEntityMeasurement => {
    const source = entities.get(id);
    if (!source) throw new CadError('missing-sketch-entity', 'The measured edge is no longer available.');
    const pointIds = source.kind === 'line' ? [source.startPointId, source.endPointId]
      : source.kind === 'arc' ? [source.centerPointId, source.startPointId, source.endPointId] : [source.centerPointId];
    // Reuse the existing geometry checks on just this support; unrelated relation failures do not hide its size.
    const issues = checkCadSketchGraph({ points: pointIds.map(sourcePoint), entities: [source], relations: [] }, parameters);
    if (issues.length) throw new CadError(issues[0].code, issues[0].message);
    if (source.kind === 'line') {
      const measured = betweenPoints(source.startPointId, source.endPointId);
      return { kind: 'line', lengthMm: measured.distanceMm, deltaMm: measured.deltaMm };
    }
    if (source.kind === 'circle') {
      const radiusMm = evaluateCadScalar(source.radius, parameters);
      return { kind: 'circle', radiusMm, diameterMm: radiusMm * 2, circumferenceMm: radiusMm * 2 * Math.PI };
    }
    const coordinate = (id: string) => { const [x, y] = point(id); return { x, y }; };
    const arc = createArcSegment({ id, source: { sourceEntityIndex: 0, sourceEntityType: 'arc', layer: null, exact: true },
      center: coordinate(source.centerPointId), start: coordinate(source.startPointId), end: coordinate(source.endPointId), clockwise: source.direction === 'cw' });
    return { kind: 'arc', radiusMm: arc.radius, sweepDegrees: arc.sweepRadians * 180 / Math.PI, lengthMm: arc.length };
  };
  /** Distance from a point to a line's infinite support, positive to the left of its start to its end. */
  const pointToLine = (pointId: string, lineId: string) => {
    const line = entities.get(lineId);
    if (line?.kind !== 'line') throw new CadError('missing-sketch-entity', 'The measured line is no longer available.');
    entity(lineId);
    const [px, py] = point(pointId), [ax, ay] = point(line.startPointId), [bx, by] = point(line.endPointId);
    const dx = bx - ax, dy = by - ay;
    return { signedMm: (dx * (py - ay) - dy * (px - ax)) / Math.hypot(dx, dy) };
  };
  return { point, betweenPoints, entity, pointToLine };
}
