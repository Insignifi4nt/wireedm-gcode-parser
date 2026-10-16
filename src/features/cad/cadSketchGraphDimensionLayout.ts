import type { CadSketchGraph, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { cadPathClosureTolerance } from '@/domain/cad/cadAnalyticSegments';
import { createArcSegment } from '@/domain/path-intel/segments';
import type { SketchPoint } from './cadSketchInteraction';

export type CadSketchDistanceRelation = Extract<CadSketchGraphRelation, { kind: 'distance' }>;
type Pair = readonly [SketchPoint, SketchPoint];
export interface CadSketchGraphDimensionLayout {
  readonly relation: CadSketchDistanceRelation;
  readonly valueMm: number;
  readonly line: Pair;
  readonly extensions: readonly [Pair, Pair];
  readonly arrows: readonly [readonly [SketchPoint, SketchPoint, SketchPoint], readonly [SketchPoint, SketchPoint, SketchPoint]];
  readonly label: SketchPoint;
}

/** Display-only geometry. Only declared distances are annotated; scalars and source IDs stay intact. */
export function layoutCadSketchGraphDimensions(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>, mmPerPixel: number): readonly CadSketchGraphDimensionLayout[] {
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0 || !graph.relations.some(relation => relation.kind === 'distance')) return [];
  const points = new Map(graph.points.map(point => [point.id, {
    x: evaluateCadScalar(point.position[0], parameters), y: evaluateCadScalar(point.position[1], parameters)
  }]));
  const coordinates = [...points.values()];
  for (const entity of graph.entities) {
    const center = 'centerPointId' in entity ? points.get(entity.centerPointId) : undefined;
    if (entity.kind === 'circle' && center) {
      const radius = evaluateCadScalar(entity.radius, parameters);
      coordinates.push({ x: center.x - radius, y: center.y - radius }, { x: center.x + radius, y: center.y + radius });
    } else if (entity.kind === 'arc' && center) {
      const start = points.get(entity.startPointId), end = points.get(entity.endPointId);
      if (!start || !end) continue;
      const { bounds } = createArcSegment({ id: entity.id, center, start, end, clockwise: entity.direction === 'cw',
        source: { sourceEntityIndex: 0, sourceEntityType: 'arc', layer: null, exact: true } });
      coordinates.push({ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY });
    }
  }
  if (!coordinates.length) return [];
  const bounds = coordinates.reduce((box, point) => ({ minX: Math.min(box.minX, point.x), minY: Math.min(box.minY, point.y),
    maxX: Math.max(box.maxX, point.x), maxY: Math.max(box.maxY, point.y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const center: SketchPoint = [bounds.minX / 2 + bounds.maxX / 2, bounds.minY / 2 + bounds.maxY / 2];
  return graph.relations.flatMap((relation): CadSketchGraphDimensionLayout[] => {
    if (relation.kind !== 'distance') return [];
    const a = points.get(relation.pointIds[0]), b = points.get(relation.pointIds[1]);
    if (!a || !b) return [];
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), valueMm = evaluateCadScalar(relation.value, parameters);
    if (!Number.isFinite(length) || length === 0 || !Number.isFinite(valueMm) || valueMm <= 0) return [];
    const ux = dx / length, uy = dy / length;
    const direction = dx < 0 || dx === 0 && dy < 0 ? -1 : 1;
    let nx = -uy * direction, ny = ux * direction;
    const midpoint: SketchPoint = [a.x / 2 + b.x / 2, a.y / 2 + b.y / 2];
    const outward = (midpoint[0] - center[0]) * nx + (midpoint[1] - center[1]) * ny;
    const tie = Math.abs(outward) <= cadPathClosureTolerance([a, b, { x: center[0], y: center[1] }]);
    if (tie ? Math.abs(dx) >= Math.abs(dy) ? ny > 0 : nx < 0 : outward < 0) { nx = -nx; ny = -ny; }
    const offset = (point: { x: number; y: number }, pixels: number): SketchPoint => [point.x + nx * pixels * mmPerPixel, point.y + ny * pixels * mmPerPixel];
    const line: Pair = [offset(a, 20), offset(b, 20)];
    const headLength = Math.min(6 * mmPerPixel, length / 4), headWidth = Math.min(2.5 * mmPerPixel, length / 8);
    const arrow = (point: SketchPoint, sign: number): readonly [SketchPoint, SketchPoint, SketchPoint] => [
      point,
      [point[0] + ux * headLength * sign + nx * headWidth, point[1] + uy * headLength * sign + ny * headWidth],
      [point[0] + ux * headLength * sign - nx * headWidth, point[1] + uy * headLength * sign - ny * headWidth]
    ];
    return [{ relation, valueMm, line, extensions: [[offset(a, 3), offset(a, 22)], [offset(b, 3), offset(b, 22)]],
      arrows: [arrow(line[0], 1), arrow(line[1], -1)], label: [midpoint[0] + nx * 20 * mmPerPixel, midpoint[1] + ny * 20 * mmPerPixel] }];
  });
}
