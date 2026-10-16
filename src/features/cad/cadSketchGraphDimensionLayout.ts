import type { CadSketchGraph, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { cadPathClosureTolerance } from '@/domain/cad/cadAnalyticSegments';
import { createArcSegment } from '@/domain/path-intel/segments';
import { resolveCadSketchCornerTopology } from '@/domain/cad/cadSketchCornerGeometry';
import { resolveCadSketchRadialEntity } from '@/domain/cad/cadSketchRadialRelations';
import type { Point2 } from '@/domain/path-intel/types';
import type { SketchPoint } from './cadSketchInteraction';
import { formatCadQuantity } from './cadDisplayQuantity';

export type CadSketchDistanceRelation = Extract<CadSketchGraphRelation, { kind: 'distance' }>;
export type CadSketchDimensionRelation = Extract<CadSketchGraphRelation, { kind: 'distance' | 'radial-size' | 'fillet-corner' | 'chamfer-corner' }>;
type Pair = readonly [SketchPoint, SketchPoint];
type Arrow = readonly [SketchPoint, SketchPoint, SketchPoint];
interface DimensionGeometry {
  readonly valueMm: number;
  readonly line: Pair;
  readonly extensions: readonly Pair[];
  readonly arrows: readonly Arrow[];
  readonly label: SketchPoint;
}
export type CadSketchGraphDimensionLayout = DimensionGeometry & (
  { readonly kind: 'distance'; readonly relation: CadSketchDistanceRelation }
  | { readonly kind: 'radius'; readonly relation: Extract<CadSketchDimensionRelation, { kind: 'fillet-corner' | 'radial-size' }> }
  | { readonly kind: 'diameter'; readonly relation: Extract<CadSketchDimensionRelation, { kind: 'radial-size' }> }
  | { readonly kind: 'setback'; readonly relation: Extract<CadSketchDimensionRelation, { kind: 'chamfer-corner' }>; readonly side: 0 | 1; readonly lineId: string }
);

/** The layout and rendered label share one screen-pixel box. */
export function cadSketchGraphDimensionLabel(valueMm: number, kind: CadSketchGraphDimensionLayout['kind']) {
  const quantity = `${formatCadQuantity(valueMm)} mm`, text = kind === 'radius' ? `R ${quantity}` : kind === 'diameter' ? `Ø ${quantity}` : quantity;
  return { quantity, text, width: Math.max(42, text.length * 7 + 12), height: 18 };
}

/** Shared aligned dimension geometry; the caller chooses its geometric outward side. */
function alignedGeometry(a: Point2, b: Point2, nx: number, ny: number, mmPerPixel: number): Omit<DimensionGeometry, 'valueMm'> {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
  const offset = (point: Point2, pixels: number): SketchPoint => [point.x + nx * pixels * mmPerPixel, point.y + ny * pixels * mmPerPixel];
  const line: Pair = [offset(a, 20), offset(b, 20)];
  const headLength = Math.min(6 * mmPerPixel, length / 4), headWidth = Math.min(2.5 * mmPerPixel, length / 8);
  const arrow = (point: SketchPoint, sign: number): Arrow => [point,
    [point[0] + ux * headLength * sign + nx * headWidth, point[1] + uy * headLength * sign + ny * headWidth],
    [point[0] + ux * headLength * sign - nx * headWidth, point[1] + uy * headLength * sign - ny * headWidth]];
  return { line, extensions: [[offset(a, 3), offset(a, 22)], [offset(b, 3), offset(b, 22)]], arrows: [arrow(line[0], 1), arrow(line[1], -1)],
    label: [a.x / 2 + b.x / 2 + nx * 20 * mmPerPixel, a.y / 2 + b.y / 2 + ny * 20 * mmPerPixel] };
}

function radialGeometry(center: Point2, radius: number, angle: number, valueMm: number, kind: 'radius' | 'diameter', mmPerPixel: number): Omit<DimensionGeometry, 'valueMm'> {
  const ux = Math.cos(angle), uy = Math.sin(angle), tip: SketchPoint = [center.x + ux * radius, center.y + uy * radius];
  const box = cadSketchGraphDimensionLabel(valueMm, kind);
  const clearance = (Math.abs(ux) * box.width / 2 + Math.abs(uy) * box.height / 2 + 8) * mmPerPixel;
  const label: SketchPoint = [tip[0] + ux * clearance, tip[1] + uy * clearance];
  const headLength = Math.min(6 * mmPerPixel, radius / 4), headWidth = Math.min(2.5 * mmPerPixel, radius / 8);
  return { line: [[center.x, center.y], label], extensions: [], label,
    arrows: [[tip, [tip[0] + ux * headLength - uy * headWidth, tip[1] + uy * headLength + ux * headWidth],
      [tip[0] + ux * headLength + uy * headWidth, tip[1] + uy * headLength - ux * headWidth]]] };
}

function radialDimension(graph: CadSketchGraph, relation: Extract<CadSketchDimensionRelation, { kind: 'radial-size' }>,
  points: ReadonlyMap<string, Point2>, parameters: Readonly<Record<string, number>>, mmPerPixel: number): readonly CadSketchGraphDimensionLayout[] {
  const entity = resolveCadSketchRadialEntity(graph, relation.entityId), center = points.get(entity.centerPointId), valueMm = evaluateCadScalar(relation.value, parameters);
  if (!center || !Number.isFinite(valueMm) || valueMm <= 0) return [];
  let radius: number, angle: number;
  if (entity.kind === 'circle') { radius = evaluateCadScalar(entity.radius, parameters); angle = Math.PI / 4; }
  else {
    const start = points.get(entity.startPointId), end = points.get(entity.endPointId); if (!start || !end) return [];
    const arc = createArcSegment({ id: entity.id, center, start, end, clockwise: entity.direction === 'cw',
      source: { sourceEntityIndex: 0, sourceEntityType: 'arc', layer: null, exact: true } });
    radius = arc.radius; angle = arc.startAngleRadians + arc.sweepRadians / 2;
  }
  if (!Number.isFinite(radius) || radius <= 0) return [];
  const geometry = radialGeometry(center, radius, angle, valueMm, relation.quantity, mmPerPixel);
  return relation.quantity === 'radius' ? [{ kind: 'radius', relation, valueMm, ...geometry }] : [{ kind: 'diameter', relation, valueMm, ...geometry }];
}

function cornerDimensions(graph: CadSketchGraph, relation: Extract<CadSketchDimensionRelation, { kind: 'fillet-corner' | 'chamfer-corner' }>,
  points: ReadonlyMap<string, Point2>, parameters: Readonly<Record<string, number>>, mmPerPixel: number): readonly CadSketchGraphDimensionLayout[] {
  const topology = resolveCadSketchCornerTopology(graph, relation);
  if (relation.kind === 'fillet-corner' && topology.entity.kind === 'arc') {
    const center = points.get(topology.entity.centerPointId), start = points.get(topology.entity.startPointId), end = points.get(topology.entity.endPointId);
    const valueMm = evaluateCadScalar(relation.value, parameters);
    if (!center || !start || !end || !Number.isFinite(valueMm) || valueMm <= 0) return [];
    const arc = createArcSegment({ id: topology.entity.id, center, start, end, clockwise: topology.entity.direction === 'cw',
      source: { sourceEntityIndex: 0, sourceEntityType: 'arc', layer: null, exact: true } });
    return [{ kind: 'radius', relation, valueMm, ...radialGeometry(center, arc.radius, arc.startAngleRadians + arc.sweepRadians / 2, valueMm, 'radius', mmPerPixel) }];
  }
  if (relation.kind !== 'chamfer-corner') return [];
  const vertex = points.get(topology.vertexId), first = points.get(topology.trimPointIds[0]), second = points.get(topology.trimPointIds[1]);
  if (!vertex || !first || !second) return [];
  const trims = [first, second] as const;
  return ([0, 1] as const).flatMap((side): CadSketchGraphDimensionLayout[] => {
    const trim = trims[side], other = trims[side === 0 ? 1 : 0], dx = trim.x - vertex.x, dy = trim.y - vertex.y, length = Math.hypot(dx, dy);
    const valueMm = evaluateCadScalar(relation.values[side], parameters);
    if (!Number.isFinite(length) || length === 0 || !Number.isFinite(valueMm) || valueMm <= 0) return [];
    let nx = -dy / length, ny = dx / length;
    if ((other.x - vertex.x) * nx + (other.y - vertex.y) * ny > 0) { nx = -nx; ny = -ny; }
    return [{ kind: 'setback', relation, side, lineId: relation.lineIds[side], valueMm, ...alignedGeometry(vertex, trim, nx, ny, mmPerPixel) }];
  });
}

/** Display-only declared dimensions. Scalar drivers and source IDs remain authoritative. */
export function layoutCadSketchGraphDimensions(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>, mmPerPixel: number): readonly CadSketchGraphDimensionLayout[] {
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0 || !graph.relations.some(relation => relation.kind === 'distance' || relation.kind === 'radial-size' || relation.kind === 'fillet-corner' || relation.kind === 'chamfer-corner')) return [];
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
    if (relation.kind === 'radial-size') return [...radialDimension(graph, relation, points, parameters, mmPerPixel)];
    if (relation.kind === 'fillet-corner' || relation.kind === 'chamfer-corner') return [...cornerDimensions(graph, relation, points, parameters, mmPerPixel)];
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
    return [{ kind: 'distance', relation, valueMm, ...alignedGeometry(a, b, nx, ny, mmPerPixel) }];
  });
}
