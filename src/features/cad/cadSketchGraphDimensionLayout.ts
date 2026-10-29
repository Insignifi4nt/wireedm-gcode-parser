import type { CadSketchGraph, CadSketchGraphRelation, CadSketchReferenceDimension } from '@/domain/cad/cadSketchGraph';
import { resolveCadSketchReferenceDimension } from '@/domain/cad/cadSketchReferenceDimensions';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { cadPathClosureTolerance } from '@/domain/cad/cadAnalyticSegments';
import { createArcSegment } from '@/domain/path-intel/segments';
import { resolveCadSketchCornerTopology } from '@/domain/cad/cadSketchCornerGeometry';
import { resolveCadSketchRadialEntity } from '@/domain/cad/cadSketchRadialRelations';
import { cadSketchLineAngleGeometry } from '@/domain/cad/cadSketchAngleRelations';
import { cadSketchLineDirection } from '@/domain/cad/cadSketchLineRelations';
import { cadSketchSignedPointLineDistance, resolveCadSketchPointLineDistanceOperands } from '@/domain/cad/cadSketchPointLineDistanceRelations';
import type { Point2 } from '@/domain/path-intel/types';
import type { SketchPoint } from './cadSketchInteraction';
import { formatCadQuantity } from './cadDisplayQuantity';

export type CadSketchDistanceRelation = Extract<CadSketchGraphRelation, { kind: 'distance' }>;
export type CadSketchDimensionRelation = Extract<CadSketchGraphRelation, { kind: 'distance' | 'point-line-distance' | 'axis-distance' | 'radial-size' | 'fillet-corner' | 'chamfer-corner' | 'line-angle' | 'reference-dimension' }>;
type Pair = readonly [SketchPoint, SketchPoint];
/** Slim screen-pixel arrowheads: 5 px long and 3.5 px wide. */
const ARROW_LENGTH_PIXELS = 5, ARROW_HALF_WIDTH_PIXELS = 1.75;
type Arrow = readonly [SketchPoint, SketchPoint, SketchPoint];
interface DimensionGeometry {
  readonly extensions: readonly Pair[];
  readonly arrows: readonly Arrow[];
  readonly label: SketchPoint;
  /** Text direction in sketch radians; aligned dimensions read along their line (ISO 129), others stay horizontal. */
  readonly labelAngle: number;
}
interface LinearDimensionGeometry extends DimensionGeometry { readonly valueMm: number; readonly line: Pair }
export type CadSketchGraphDimensionLayout = LinearDimensionGeometry & (
  { readonly kind: 'distance'; readonly relation: CadSketchDistanceRelation | CadSketchReferenceDimension }
  | { readonly kind: 'distance-x' | 'distance-y'; readonly relation: Extract<CadSketchDimensionRelation, { kind: 'axis-distance' }> }
  /** Perpendicular from the line's support to the point, with an extension of the line when its foot is beyond the segment. */
  | { readonly kind: 'point-line'; readonly relation: Extract<CadSketchDimensionRelation, { kind: 'point-line-distance' | 'reference-dimension' }> }
  | { readonly kind: 'radius'; readonly relation: Extract<CadSketchDimensionRelation, { kind: 'fillet-corner' | 'radial-size' | 'reference-dimension' }> }
  | { readonly kind: 'diameter'; readonly relation: Extract<CadSketchDimensionRelation, { kind: 'radial-size' | 'reference-dimension' }> }
  | { readonly kind: 'setback'; readonly relation: Extract<CadSketchDimensionRelation, { kind: 'chamfer-corner' }>; readonly side: 0 | 1; readonly lineId: string }
) | DimensionGeometry & { readonly kind: 'angle'; readonly relation: Extract<CadSketchDimensionRelation, { kind: 'line-angle' }>;
  readonly valueDegrees: number; readonly arc: { readonly center: SketchPoint; readonly radius: number; readonly start: SketchPoint; readonly end: SketchPoint; readonly clockwise: boolean } };

/** The layout and rendered label share one screen-pixel box. */
export function cadSketchGraphDimensionLabel(value: number, kind: CadSketchGraphDimensionLayout['kind'], reference = false) {
  const quantity = `${formatCadQuantity(value)}${kind === 'angle' ? '°' : ' mm'}`, text = kind === 'radius' ? `R ${quantity}` : kind === 'diameter' ? `Ø ${quantity}`
    : kind === 'distance-x' ? `ΔX ${quantity}` : kind === 'distance-y' ? `ΔY ${quantity}` : quantity;
  const label = reference ? `(${text})` : text;
  return { quantity, text: label, width: Math.max(42, label.length * 7 + 12), height: 18 };
}

/**
 * Shared aligned dimension geometry; the caller chooses its geometric outward side.
 * ISO 129 text runs parallel to an unbroken dimension line, above it and readable from the bottom or right.
 * When "above" faces the measured geometry the line moves further out so the text stays clear of the part.
 */
function alignedGeometry(a: Point2, b: Point2, nx: number, ny: number, mmPerPixel: number, box: { readonly height: number }): Omit<LinearDimensionGeometry, 'valueMm'> {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), ux = length === 0 ? 0 : dx / length, uy = length === 0 ? 0 : dy / length;
  let readX = length === 0 ? -ny : ux, readY = length === 0 ? nx : uy;
  if (readX < -1e-12 || Math.abs(readX) <= 1e-12 && readY < 0) { readX = -readX; readY = -readY; }
  const upX = -readY, upY = readX, lineOffset = upX * nx + upY * ny < -1e-12 ? 20 + isoInwardClearance : 20;
  const offset = (point: Point2, pixels: number): SketchPoint => [point.x + nx * pixels * mmPerPixel, point.y + ny * pixels * mmPerPixel];
  const line: Pair = [offset(a, lineOffset), offset(b, lineOffset)];
  const headLength = Math.min(ARROW_LENGTH_PIXELS * mmPerPixel, length / 4), headWidth = Math.min(ARROW_HALF_WIDTH_PIXELS * mmPerPixel, length / 8);
  const arrow = (point: SketchPoint, sign: number): Arrow => [point,
    [point[0] + ux * headLength * sign + nx * headWidth, point[1] + uy * headLength * sign + ny * headWidth],
    [point[0] + ux * headLength * sign - nx * headWidth, point[1] + uy * headLength * sign - ny * headWidth]];
  const lift = (box.height / 2 + isoTextGap) * mmPerPixel;
  return { line, extensions: [[offset(a, 3), offset(a, lineOffset + 2)], [offset(b, 3), offset(b, lineOffset + 2)]], arrows: length === 0 ? [] : [arrow(line[0], 1), arrow(line[1], -1)],
    label: [line[0][0] / 2 + line[1][0] / 2 + upX * lift, line[0][1] / 2 + line[1][1] / 2 + upY * lift], labelAngle: Math.atan2(readY, readX) };
}
/** Screen pixels between an ISO dimension line and its text, and the extra line offset when text faces the part. */
const isoTextGap = 2, isoInwardClearance = 8;

type AlignedDimension = Extract<CadSketchGraphDimensionLayout, { kind: 'distance' | 'distance-x' | 'distance-y' | 'setback' }>;
const isAlignedDimension = (dimension: CadSketchGraphDimensionLayout): dimension is AlignedDimension =>
  dimension.kind === 'distance' || dimension.kind === 'distance-x' || dimension.kind === 'distance-y' || dimension.kind === 'setback';

/** Pack parallel occupied strips outward; keep source attachments and returned relation order intact. */
function separateAlignedDimensions(dimensions: readonly CadSketchGraphDimensionLayout[], mmPerPixel: number): readonly CadSketchGraphDimensionLayout[] {
  const result = [...dimensions], placed: AlignedDimension[] = [];
  const length = (dimension: AlignedDimension) => Math.hypot(dimension.line[1][0] - dimension.line[0][0], dimension.line[1][1] - dimension.line[0][1]);
  const key = (dimension: AlignedDimension) => dimension.relation.id + '/' + dimension.kind + (dimension.kind === 'setback' ? dimension.side : '');
  const ordered = dimensions.flatMap((dimension, index) => isAlignedDimension(dimension) ? [{ dimension, index }] : [])
    .sort((a, b) => length(a.dimension) - length(b.dimension) || (key(a.dimension) < key(b.dimension) ? -1 : key(a.dimension) > key(b.dimension) ? 1 : 0));
  // Each label is sized and turned once, not again for every dimension it is compared with.
  const boxes = new Map<AlignedDimension, { readonly width: number; readonly height: number; readonly cos: number; readonly sin: number }>();
  const halfBox = (dimension: AlignedDimension, x: number, y: number) => {
    let box = boxes.get(dimension);
    if (!box) {
      const { width, height } = cadSketchGraphDimensionLabel(dimension.valueMm, dimension.kind, dimension.relation.kind === 'reference-dimension');
      boxes.set(dimension, box = { width, height, cos: Math.cos(dimension.labelAngle), sin: Math.sin(dimension.labelAngle) });
    }
    const { cos, sin } = box;
    return (Math.abs(x * cos + y * sin) * box.width + Math.abs(y * cos - x * sin) * box.height) * mmPerPixel / 2;
  };
  const span = (dimension: AlignedDimension, x: number, y: number) => {
    const first = dimension.line[0][0] * x + dimension.line[0][1] * y, second = dimension.line[1][0] * x + dimension.line[1][1] * y;
    const center = dimension.label[0] * x + dimension.label[1] * y, half = halfBox(dimension, x, y);
    return [Math.min(first, second, center - half), Math.max(first, second, center + half)] as const;
  };
  const strip = (dimension: AlignedDimension, x: number, y: number) => {
    const base = dimension.line[0][0] * x + dimension.line[0][1] * y, center = dimension.label[0] * x + dimension.label[1] * y, half = halfBox(dimension, x, y);
    return [Math.min(base, center - half), Math.max(base, center + half)] as const;
  };
  for (const { dimension, index } of ordered) {
    const guide = dimension.extensions[0], dx = guide[1][0] - guide[0][0], dy = guide[1][1] - guide[0][1], guideLength = Math.hypot(dx, dy);
    if (!guideLength) { placed.push(dimension); continue; }
    const lineLength = length(dimension), ux = lineLength ? (dimension.line[1][0] - dimension.line[0][0]) / lineLength : -dy / guideLength;
    const uy = lineLength ? (dimension.line[1][1] - dimension.line[0][1]) / lineLength : dx / guideLength;
    const side = -uy * dx + ux * dy < 0 ? -1 : 1, nx = -uy * side, ny = ux * side, occupied = span(dimension, ux, uy);
    const forbidden = placed.flatMap(other => {
      const vx = other.line[1][0] - other.line[0][0], vy = other.line[1][1] - other.line[0][1], otherLength = Math.hypot(vx, vy);
      const otherGuide = other.extensions[0], ox = otherGuide[1][0] - otherGuide[0][0], oy = otherGuide[1][1] - otherGuide[0][1];
      if (otherLength ? Math.abs(ux * vy - uy * vx) > otherLength * 1e-12 : Math.abs(nx * oy - ny * ox) > Math.hypot(ox, oy) * 1e-12) return [];
      const interval = span(other, ux, uy);
      if (occupied[0] > interval[1] || occupied[1] < interval[0]) return [];
      // Each strip holds its line and its lifted text; a shift must clear the other strip by the margin.
      const mine = strip(dimension, nx, ny), theirs = strip(other, nx, ny), margin = 8 * mmPerPixel;
      return [[theirs[0] - margin - mine[1], theirs[1] + margin - mine[0]] as const];
    }).sort((a, b) => a[0] - b[0]);
    let offset = 0;
    for (const [start, end] of forbidden) { if (offset < start) break; if (offset < end) offset = end; }
    if (offset === 0) { placed.push(dimension); continue; }
    const shift = (point: SketchPoint): SketchPoint => [point[0] + nx * offset, point[1] + ny * offset];
    const shifted: AlignedDimension = { ...dimension, line: [shift(dimension.line[0]), shift(dimension.line[1])], label: shift(dimension.label),
      arrows: dimension.arrows.map(arrow => [shift(arrow[0]), shift(arrow[1]), shift(arrow[2])]),
      extensions: dimension.extensions.map(guide => [guide[0], shift(guide[1])]) };
    result[index] = shifted; placed.push(shifted);
  }
  return result;
}

function pointLineDimension(graph: CadSketchGraph, relation: Extract<CadSketchDimensionRelation, { kind: 'point-line-distance' | 'reference-dimension' }>,
  points: ReadonlyMap<string, Point2>, parameters: Readonly<Record<string, number>>, mmPerPixel: number): readonly CadSketchGraphDimensionLayout[] {
  try {
    const descriptor = relation.kind === 'reference-dimension' ? resolveCadSketchReferenceDimension(graph, relation) : relation;
    if (descriptor.kind !== 'point-line-distance') return [];
    const { line } = resolveCadSketchPointLineDistanceOperands(graph, descriptor), axis = cadSketchLineDirection(line, points), point = points.get(descriptor.pointId);
    if (!axis || !point) return [];
    const signed = cadSketchSignedPointLineDistance(point, axis), length = Math.abs(signed);
    const valueMm = relation.kind === 'reference-dimension' ? length : evaluateCadScalar(relation.value, parameters);
    if (!Number.isFinite(length) || !Number.isFinite(valueMm) || (relation.kind === 'reference-dimension' ? valueMm < 0 : length === 0 || valueMm <= 0)) return [];
    // The dimension line runs from the foot on the support to the point; arrows widen along the support. A reference that
    // measures zero, its point on the support, keeps its label beside the support, reading along it, without arrows.
    const foot = { x: point.x + axis.y * signed, y: point.y - axis.x * signed };
    const ux = length === 0 ? axis.x : (point.x - foot.x) / length, uy = length === 0 ? axis.y : (point.y - foot.y) / length;
    let readX = ux, readY = uy;
    if (readX < -1e-12 || Math.abs(readX) <= 1e-12 && readY < 0) { readX = -readX; readY = -readY; }
    const box = cadSketchGraphDimensionLabel(valueMm, 'point-line', relation.kind === 'reference-dimension'), lift = (box.height / 2 + isoTextGap) * mmPerPixel;
    const headLength = Math.min(6 * mmPerPixel, length / 4), headWidth = Math.min(2.5 * mmPerPixel, length / 8);
    const arrow = (tip: Point2, sign: number): Arrow => [[tip.x, tip.y],
      [tip.x + ux * headLength * sign + axis.x * headWidth, tip.y + uy * headLength * sign + axis.y * headWidth],
      [tip.x + ux * headLength * sign - axis.x * headWidth, tip.y + uy * headLength * sign - axis.y * headWidth]];
    // Beyond either end of the segment the support is drawn out to the foot, a little past it.
    const along = (foot.x - axis.start.x) * axis.x + (foot.y - axis.start.y) * axis.y, beyond = 2 * mmPerPixel;
    const extensions: Pair[] = along < 0 ? [[[axis.start.x, axis.start.y], [foot.x - axis.x * beyond, foot.y - axis.y * beyond]]]
      : along > axis.length ? [[[axis.end.x, axis.end.y], [foot.x + axis.x * beyond, foot.y + axis.y * beyond]]] : [];
    return [{ kind: 'point-line', relation, valueMm, line: [[foot.x, foot.y], [point.x, point.y]], extensions, arrows: length === 0 ? [] : [arrow(foot, 1), arrow(point, -1)],
      label: [foot.x / 2 + point.x / 2 - readY * lift, foot.y / 2 + point.y / 2 + readX * lift], labelAngle: Math.atan2(readY, readX) }];
  } catch { return []; }
}

function radialGeometry(center: Point2, radius: number, angle: number, valueMm: number, kind: 'radius' | 'diameter', mmPerPixel: number, reference = false): Omit<LinearDimensionGeometry, 'valueMm'> {
  const ux = Math.cos(angle), uy = Math.sin(angle), tip: SketchPoint = [center.x + ux * radius, center.y + uy * radius];
  const box = cadSketchGraphDimensionLabel(valueMm, kind, reference);
  const clearance = (Math.abs(ux) * box.width / 2 + Math.abs(uy) * box.height / 2 + 8) * mmPerPixel;
  const label: SketchPoint = [tip[0] + ux * clearance, tip[1] + uy * clearance];
  const headLength = Math.min(ARROW_LENGTH_PIXELS * mmPerPixel, radius / 4), headWidth = Math.min(ARROW_HALF_WIDTH_PIXELS * mmPerPixel, radius / 8);
  return { line: [[center.x, center.y], label], extensions: [], label, labelAngle: 0,
    arrows: [[tip, [tip[0] + ux * headLength - uy * headWidth, tip[1] + uy * headLength + ux * headWidth],
      [tip[0] + ux * headLength + uy * headWidth, tip[1] + uy * headLength - ux * headWidth]]] };
}

function angularDimension(graph: CadSketchGraph, relation: Extract<CadSketchDimensionRelation, { kind: 'line-angle' }>,
  points: ReadonlyMap<string, Point2>, parameters: Readonly<Record<string, number>>, mmPerPixel: number): readonly CadSketchGraphDimensionLayout[] {
  try {
    const geometry = cadSketchLineAngleGeometry(graph, relation, points), { vertex, first, second, signedSweepRadians: sweep } = geometry;
    const valueDegrees = evaluateCadScalar(relation.value, parameters);
    if (!Number.isFinite(valueDegrees) || valueDegrees <= 0 || valueDegrees >= 180 || !Number.isFinite(sweep) || Math.abs(sweep) >= Math.PI || sweep === 0) return [];
    const radius = 40 * mmPerPixel, sign = relation.sense === 'ccw' ? 1 : -1;
    const at = (direction: Point2, length: number): SketchPoint => [vertex.x + direction.x * length, vertex.y + direction.y * length];
    const start = at(first.direction, radius), end = at(second.direction, radius);
    const mid = Math.atan2(first.direction.y, first.direction.x) + sweep / 2, ux = Math.cos(mid), uy = Math.sin(mid);
    const box = cadSketchGraphDimensionLabel(valueDegrees, 'angle');
    const clearance = (Math.abs(ux) * box.width / 2 + Math.abs(uy) * box.height / 2 + 8) * mmPerPixel;
    const headLength = Math.min(ARROW_LENGTH_PIXELS * mmPerPixel, radius * Math.abs(sweep) / 4), headWidth = Math.min(ARROW_HALF_WIDTH_PIXELS * mmPerPixel, headLength / 2);
    const arrow = (tip: SketchPoint, direction: Point2, into: number): Arrow => [tip,
      [tip[0] - direction.y * headLength * into + direction.x * headWidth, tip[1] + direction.x * headLength * into + direction.y * headWidth],
      [tip[0] - direction.y * headLength * into - direction.x * headWidth, tip[1] + direction.x * headLength * into - direction.y * headWidth]];
    return [{ kind: 'angle', relation, valueDegrees, arc: { center: [vertex.x, vertex.y], radius, start, end, clockwise: sign < 0 },
      extensions: [[at(first.direction, 3 * mmPerPixel), at(first.direction, radius + 2 * mmPerPixel)],
        [at(second.direction, 3 * mmPerPixel), at(second.direction, radius + 2 * mmPerPixel)]],
      arrows: [arrow(start, first.direction, sign), arrow(end, second.direction, -sign)],
      label: [vertex.x + ux * (radius + clearance), vertex.y + uy * (radius + clearance)], labelAngle: 0 }];
  } catch { return []; } // A remote or uncertain support intersection cannot safely place an annotation.
}

function radialDimension(graph: CadSketchGraph, relation: Extract<CadSketchDimensionRelation, { kind: 'radial-size' | 'reference-dimension' }>,
  points: ReadonlyMap<string, Point2>, parameters: Readonly<Record<string, number>>, mmPerPixel: number): readonly CadSketchGraphDimensionLayout[] {
  const descriptor = relation.kind === 'reference-dimension' ? resolveCadSketchReferenceDimension(graph, relation) : relation;
  if (descriptor.kind !== 'radial-size') return [];
  const entity = resolveCadSketchRadialEntity(graph, descriptor.entityId), center = points.get(entity.centerPointId);
  if (!center) return [];
  let radius: number, angle: number;
  if (entity.kind === 'circle') { radius = evaluateCadScalar(entity.radius, parameters); angle = Math.PI / 4; }
  else {
    const start = points.get(entity.startPointId), end = points.get(entity.endPointId); if (!start || !end) return [];
    const arc = createArcSegment({ id: entity.id, center, start, end, clockwise: entity.direction === 'cw',
      source: { sourceEntityIndex: 0, sourceEntityType: 'arc', layer: null, exact: true } });
    radius = arc.radius; angle = arc.startAngleRadians + arc.sweepRadians / 2;
  }
  if (!Number.isFinite(radius) || radius <= 0) return [];
  const valueMm = relation.kind === 'reference-dimension' ? radius * (descriptor.quantity === 'diameter' ? 2 : 1) : evaluateCadScalar(relation.value, parameters);
  if (!Number.isFinite(valueMm) || valueMm <= 0) return [];
  const geometry = radialGeometry(center, radius, angle, valueMm, descriptor.quantity, mmPerPixel, relation.kind === 'reference-dimension');
  return descriptor.quantity === 'radius' ? [{ kind: 'radius', relation, valueMm, ...geometry }] : [{ kind: 'diameter', relation, valueMm, ...geometry }];
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
    return [{ kind: 'setback', relation, side, lineId: relation.lineIds[side], valueMm, ...alignedGeometry(vertex, trim, nx, ny, mmPerPixel, cadSketchGraphDimensionLabel(valueMm, 'setback')) }];
  });
}

/** Display-only declared dimensions. Scalar drivers and source IDs remain authoritative. */
export function layoutCadSketchGraphDimensions(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>, mmPerPixel: number): readonly CadSketchGraphDimensionLayout[] {
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0 || !graph.relations.some(relation => relation.kind === 'distance' || relation.kind === 'point-line-distance' || relation.kind === 'axis-distance' || relation.kind === 'radial-size' || relation.kind === 'fillet-corner' || relation.kind === 'chamfer-corner' || relation.kind === 'line-angle' || relation.kind === 'reference-dimension')) return [];
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
  const dimensions = graph.relations.flatMap((relation): CadSketchGraphDimensionLayout[] => {
    if (relation.kind === 'line-angle') return [...angularDimension(graph, relation, points, parameters, mmPerPixel)];
    if (relation.kind === 'radial-size' || relation.kind === 'reference-dimension' && relation.measurement.kind === 'radial-size') return [...radialDimension(graph, relation, points, parameters, mmPerPixel)];
    if (relation.kind === 'fillet-corner' || relation.kind === 'chamfer-corner') return [...cornerDimensions(graph, relation, points, parameters, mmPerPixel)];
    if (relation.kind === 'point-line-distance' || relation.kind === 'reference-dimension' && relation.measurement.kind === 'point-line-distance')
      return [...pointLineDimension(graph, relation, points, parameters, mmPerPixel)];
    if (relation.kind !== 'distance' && relation.kind !== 'axis-distance' && relation.kind !== 'reference-dimension') return [];
    const descriptor = relation.kind === 'reference-dimension' ? resolveCadSketchReferenceDimension(graph, relation) : relation;
    if (descriptor.kind === 'radial-size' || descriptor.kind === 'point-line-distance') return [];
    const a = points.get(descriptor.pointIds[0]), b = points.get(descriptor.pointIds[1]);
    if (!a || !b) return [];
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), valueMm = relation.kind === 'reference-dimension' ? length : evaluateCadScalar(relation.value, parameters);
    if (relation.kind === 'axis-distance') {
      if (!Number.isFinite(valueMm)) return [];
      const horizontal = relation.axis === 'x', outward = horizontal ? a.y / 2 + b.y / 2 - center[1] : a.x / 2 + b.x / 2 - center[0];
      const tie = Math.abs(outward) <= cadPathClosureTolerance([a, b, { x: center[0], y: center[1] }]);
      const side = tie ? horizontal ? -1 : 1 : outward < 0 ? -1 : 1;
      const nx = horizontal ? 0 : side, ny = horizontal ? side : 0;
      const base = horizontal ? side < 0 ? Math.min(a.y, b.y) : Math.max(a.y, b.y) : side < 0 ? Math.min(a.x, b.x) : Math.max(a.x, b.x);
      const projectedA = horizontal ? { x: a.x, y: base } : { x: base, y: a.y };
      const projectedB = horizontal ? { x: b.x, y: base } : { x: base, y: b.y };
      const geometry = alignedGeometry(projectedA, projectedB, nx, ny, mmPerPixel, cadSketchGraphDimensionLabel(valueMm, horizontal ? 'distance-x' : 'distance-y'));
      return [{ kind: horizontal ? 'distance-x' : 'distance-y', relation, valueMm, ...geometry,
        extensions: [a, b].map((point, index): Pair => [[point.x + nx * 3 * mmPerPixel, point.y + ny * 3 * mmPerPixel],
          [geometry.line[index][0] + nx * 2 * mmPerPixel, geometry.line[index][1] + ny * 2 * mmPerPixel]]) }];
    }
    if (!Number.isFinite(length) || !Number.isFinite(valueMm) || (relation.kind === 'reference-dimension' ? valueMm < 0 : length === 0 || valueMm <= 0)) return [];
    const ux = length === 0 ? 1 : dx / length, uy = length === 0 ? 0 : dy / length;
    const direction = dx < 0 || dx === 0 && dy < 0 ? -1 : 1;
    let nx = -uy * direction, ny = ux * direction;
    const midpoint: SketchPoint = [a.x / 2 + b.x / 2, a.y / 2 + b.y / 2];
    const outward = (midpoint[0] - center[0]) * nx + (midpoint[1] - center[1]) * ny;
    const tie = Math.abs(outward) <= cadPathClosureTolerance([a, b, { x: center[0], y: center[1] }]);
    if (tie ? Math.abs(dx) >= Math.abs(dy) ? ny > 0 : nx < 0 : outward < 0) { nx = -nx; ny = -ny; }
    return [{ kind: 'distance', relation, valueMm, ...alignedGeometry(a, b, nx, ny, mmPerPixel, cadSketchGraphDimensionLabel(valueMm, 'distance', relation.kind === 'reference-dimension')) }];
  });
  return separateAlignedDimensions(dimensions, mmPerPixel);
}
