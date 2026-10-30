import type { CadScalar } from '@/domain/cad/cadDocument';
import { CadError } from '@/domain/cad/cadError';
import type { CadSketchGraph, CadSketchGraphRelation, CadSketchReferenceDimension } from '@/domain/cad/cadSketchGraph';
import { resolveCadSketchReferenceDimension } from '@/domain/cad/cadSketchReferenceDimensions';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { cadPathClosureTolerance } from '@/domain/cad/cadAnalyticSegments';
import { createArcSegment } from '@/domain/path-intel/segments';
import { resolveCadSketchCornerTopology } from '@/domain/cad/cadSketchCornerGeometry';
import { resolveCadSketchRadialEntity } from '@/domain/cad/cadSketchRadialRelations';
import { cadSketchLineAngleGeometry, resolveCadSketchAngleRays, type CadSketchLineAngleGeometry } from '@/domain/cad/cadSketchAngleRelations';
import { cadSketchLineDirection } from '@/domain/cad/cadSketchLineRelations';
import { cadSketchSignedPointLineDistance, resolveCadSketchPointLineDistanceOperands } from '@/domain/cad/cadSketchPointLineDistanceRelations';
import type { Point2 } from '@/domain/path-intel/types';
import type { SketchPoint } from './cadSketchInteraction';
import { formatCadQuantity } from './cadDisplayQuantity';
import { cadSketchDimensionAngleSectorAt, type CadSketchDimensionPreviewSource } from './cadSketchDimensionPlacement';
import { cadSketchAxisDistanceLine } from './cadSketchDimensionCommands';
import { isCadSketchDimensionRelation } from './cadSketchDimensionSelection';
import { resolveCadSketchPointIdentities } from '@/domain/cad/cadSketchGraphJoints';

export type CadSketchDistanceRelation = Extract<CadSketchGraphRelation, { kind: 'distance' }>;
/** A coordinate held from an axis; one that is not 0 is a distance from that axis. */
export type CadSketchAxisDistanceRelation = Extract<CadSketchGraphRelation, { kind: 'fixed-axis' }>;
export type CadSketchDimensionRelation = Extract<CadSketchGraphRelation, { kind: 'distance' | 'point-line-distance' | 'axis-distance' | 'fixed-axis' | 'radial-size' | 'fillet-corner' | 'chamfer-corner' | 'line-angle' | 'reference-dimension' }>;
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
  { readonly kind: 'distance'; readonly relation: CadSketchDistanceRelation | CadSketchAxisDistanceRelation | CadSketchReferenceDimension }
  | { readonly kind: 'distance-x' | 'distance-y'; readonly relation: Extract<CadSketchDimensionRelation, { kind: 'axis-distance' }> }
  /** Perpendicular from the line's support to the point, with an extension of the line when its foot is beyond the segment. */
  | { readonly kind: 'point-line'; readonly relation: Extract<CadSketchDimensionRelation, { kind: 'point-line-distance' | 'reference-dimension' }> }
  | { readonly kind: 'radius'; readonly relation: Extract<CadSketchDimensionRelation, { kind: 'fillet-corner' | 'radial-size' | 'reference-dimension' }> }
  | { readonly kind: 'diameter'; readonly relation: Extract<CadSketchDimensionRelation, { kind: 'radial-size' | 'reference-dimension' }> }
  | { readonly kind: 'setback'; readonly relation: Extract<CadSketchDimensionRelation, { kind: 'chamfer-corner' }>; readonly side: 0 | 1; readonly lineId: string }
) | DimensionGeometry & { readonly kind: 'angle'; readonly relation: Extract<CadSketchDimensionRelation, { kind: 'line-angle' }>; readonly valueDegrees: number }
  /** An arc about the corner where the lines meet or, where that corner is out of reach, a leader across their picked ends. */
  & ({ readonly arc: CadSketchDimensionAngleArc; readonly line?: undefined } | { readonly line: Pair; readonly arc?: undefined });
export interface CadSketchDimensionAngleArc { readonly center: SketchPoint; readonly radius: number; readonly start: SketchPoint; readonly end: SketchPoint; readonly clockwise: boolean }

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
function alignedGeometry(a: Point2, b: Point2, nx: number, ny: number, mmPerPixel: number, box: { readonly height: number }, placedOffset?: number): Omit<LinearDimensionGeometry, 'valueMm'> {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), ux = length === 0 ? 0 : dx / length, uy = length === 0 ? 0 : dy / length;
  let readX = length === 0 ? -ny : ux, readY = length === 0 ? nx : uy;
  if (readX < -1e-12 || Math.abs(readX) <= 1e-12 && readY < 0) { readX = -readX; readY = -readY; }
  // A dimension being placed sits where the pointer put it, `placedOffset` screen pixels out. With no length, the extensions are one leader
  // out from the point and the label continues it, beyond the line's end, so it never faces the part.
  const upX = -readY, upY = readX, lineOffset = placedOffset ?? (length > 0 && upX * nx + upY * ny < -1e-12 ? 20 + isoInwardClearance : 20);
  const liftX = length === 0 ? nx : upX, liftY = length === 0 ? ny : upY;
  const offset = (point: Point2, pixels: number): SketchPoint => [point.x + nx * pixels * mmPerPixel, point.y + ny * pixels * mmPerPixel];
  const line: Pair = [offset(a, lineOffset), offset(b, lineOffset)];
  const headLength = Math.min(ARROW_LENGTH_PIXELS * mmPerPixel, length / 4), headWidth = Math.min(ARROW_HALF_WIDTH_PIXELS * mmPerPixel, length / 8);
  const arrow = (point: SketchPoint, sign: number): Arrow => [point,
    [point[0] + ux * headLength * sign + nx * headWidth, point[1] + uy * headLength * sign + ny * headWidth],
    [point[0] + ux * headLength * sign - nx * headWidth, point[1] + uy * headLength * sign - ny * headWidth]];
  const lift = (box.height / 2 + isoTextGap) * mmPerPixel;
  return { line, extensions: lineOffset > 3 ? [[offset(a, 3), offset(a, lineOffset + 2)], [offset(b, 3), offset(b, lineOffset + 2)]] : [], arrows: length === 0 ? [] : [arrow(line[0], 1), arrow(line[1], -1)],
    label: [line[0][0] / 2 + line[1][0] / 2 + liftX * lift, line[0][1] / 2 + line[1][1] / 2 + liftY * lift], labelAngle: Math.atan2(readY, readX) };
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

/**
 * A dimension found drawable in its graph, drawn at a zoom. Every check is made before it is returned, so drawing is arithmetic only and
 * always gives at least one mark.
 */
type Draw = (mmPerPixel: number) => readonly CadSketchGraphDimensionLayout[];
interface Resolving {
  readonly graph: CadSketchGraph;
  /** Points whose positions evaluate to finite coordinates; any other point is missing, as is one the graph does not hold. */
  readonly points: ReadonlyMap<string, Point2>;
  /** A driver's value, or NaN when its expression does not evaluate. */
  value(scalar: CadScalar): number;
  /** The middle of the sketch, which aligned distances stand off away from. */
  readonly center: SketchPoint;
  /** Whether a point is within the sketch's own size of its bounds, so marks drawn there stay in sight of its geometry. */
  near(point: Point2): boolean;
}

function pointLineDimension(context: Resolving, relation: Extract<CadSketchDimensionRelation, { kind: 'point-line-distance' | 'reference-dimension' }>): Draw | null {
  const descriptor = relation.kind === 'reference-dimension' ? resolveCadSketchReferenceDimension(context.graph, relation) : relation;
  if (descriptor.kind !== 'point-line-distance') return null;
  const { line } = resolveCadSketchPointLineDistanceOperands(context.graph, descriptor), axis = cadSketchLineDirection(line, context.points), point = context.points.get(descriptor.pointId);
  if (!axis || !point) return null;
  const length = Math.abs(cadSketchSignedPointLineDistance(point, axis)), reference = relation.kind === 'reference-dimension';
  const valueMm = relation.kind === 'reference-dimension' ? length : context.value(relation.value);
  // Every dimension draws at any value, also at 0 with its point on the support.
  if (!Number.isFinite(length) || !Number.isFinite(valueMm)) return null;
  return mmPerPixel => [{ kind: 'point-line', relation, valueMm, ...pointLineGeometry(point, axis, valueMm, mmPerPixel, reference) }];
}
type Support = { readonly x: number; readonly y: number; readonly start: Point2; readonly end: Point2; readonly length: number };
function pointLineGeometry(point: Point2, axis: Support, valueMm: number, mmPerPixel: number, reference: boolean): Omit<LinearDimensionGeometry, 'valueMm'> {
  const signed = cadSketchSignedPointLineDistance(point, axis), length = Math.abs(signed);
  // The dimension line runs from the foot on the support to the point; arrows widen along the support. A dimension that
  // measures zero, its point on the support, keeps its label beside the support, reading along it, without arrows.
  const foot = { x: point.x + axis.y * signed, y: point.y - axis.x * signed };
  const ux = length === 0 ? axis.x : (point.x - foot.x) / length, uy = length === 0 ? axis.y : (point.y - foot.y) / length;
  let readX = ux, readY = uy;
  if (readX < -1e-12 || Math.abs(readX) <= 1e-12 && readY < 0) { readX = -readX; readY = -readY; }
  const box = cadSketchGraphDimensionLabel(valueMm, 'point-line', reference), lift = (box.height / 2 + isoTextGap) * mmPerPixel;
  const headLength = Math.min(ARROW_LENGTH_PIXELS * mmPerPixel, length / 4), headWidth = Math.min(ARROW_HALF_WIDTH_PIXELS * mmPerPixel, length / 8);
  const arrow = (tip: Point2, sign: number): Arrow => [[tip.x, tip.y],
    [tip.x + ux * headLength * sign + axis.x * headWidth, tip.y + uy * headLength * sign + axis.y * headWidth],
    [tip.x + ux * headLength * sign - axis.x * headWidth, tip.y + uy * headLength * sign - axis.y * headWidth]];
  // Beyond either end of the segment the support is drawn out to the foot, a little past it.
  const along = (foot.x - axis.start.x) * axis.x + (foot.y - axis.start.y) * axis.y, beyond = 2 * mmPerPixel;
  const extensions: Pair[] = along < 0 ? [[[axis.start.x, axis.start.y], [foot.x - axis.x * beyond, foot.y - axis.y * beyond]]]
    : along > axis.length ? [[[axis.end.x, axis.end.y], [foot.x + axis.x * beyond, foot.y + axis.y * beyond]]] : [];
  return { line: [[foot.x, foot.y], [point.x, point.y]], extensions, arrows: length === 0 ? [] : [arrow(foot, 1), arrow(point, -1)],
    label: [foot.x / 2 + point.x / 2 - readY * lift, foot.y / 2 + point.y / 2 + readX * lift], labelAngle: Math.atan2(readY, readX) };
}

/**
 * A radius or diameter leader from the center through the curve at `angle`. The label sits just beyond the curve, or `reach` from the center
 * when given, as a preview puts it at the pointer: outside the curve the arrow meets it from the label, inside it from the center.
 */
function radialGeometry(center: Point2, radius: number, angle: number, valueMm: number, kind: 'radius' | 'diameter', mmPerPixel: number, reference = false, reach?: number): Omit<LinearDimensionGeometry, 'valueMm'> {
  const ux = Math.cos(angle), uy = Math.sin(angle), tip: SketchPoint = [center.x + ux * radius, center.y + uy * radius];
  const box = cadSketchGraphDimensionLabel(valueMm, kind, reference);
  const clearance = (Math.abs(ux) * box.width / 2 + Math.abs(uy) * box.height / 2 + 8) * mmPerPixel;
  const distance = reach !== undefined && Number.isFinite(reach) && reach >= 0 ? reach : radius + clearance, outside = distance >= radius ? 1 : -1;
  const label: SketchPoint = [center.x + ux * distance, center.y + uy * distance];
  const headLength = Math.min(ARROW_LENGTH_PIXELS * mmPerPixel, radius / 4) * outside, headWidth = Math.min(ARROW_HALF_WIDTH_PIXELS * mmPerPixel, radius / 8);
  return { line: [[center.x, center.y], outside > 0 ? label : tip], extensions: [], label, labelAngle: 0,
    arrows: [[tip, [tip[0] + ux * headLength - uy * headWidth, tip[1] + uy * headLength + ux * headWidth],
      [tip[0] + ux * headLength + uy * headWidth, tip[1] + uy * headLength - ux * headWidth]]] };
}

/**
 * An angle draws its arc about the corner where its lines meet. Where that corner cannot be placed reliably, as for lines a hair from
 * parallel, or lies beyond the sketch's own size from it, an arc there would be out of sight; the angle is then drawn across the ends its
 * rays point to, a leader from one line to the other with its label beside it.
 */
function angularDimension(context: Resolving, relation: Extract<CadSketchDimensionRelation, { kind: 'line-angle' }>): Draw | null {
  const valueDegrees = context.value(relation.value);
  if (!Number.isFinite(valueDegrees)) return null;
  let geometry: CadSketchLineAngleGeometry | null = null;
  try { geometry = cadSketchLineAngleGeometry(context.graph, relation, context.points); }
  catch (cause) { if (!(cause instanceof CadError && cause.code === 'sketch-angle-precision')) return null; }
  const corner = geometry;
  if (corner && drawableSweep(corner.signedSweepRadians) && context.near(corner.vertex))
    return mmPerPixel => [{ kind: 'angle', relation, ...angleGeometry(corner, relation.sense, valueDegrees, mmPerPixel) }];
  const [first, second] = resolveCadSketchAngleRays(context.graph, relation.rays).map((ray): AngleRay | null => {
    const from = context.points.get(ray.fromPointId), end = context.points.get(ray.towardPointId);
    const dx = end && from ? end.x - from.x : NaN, dy = end && from ? end.y - from.y : NaN, length = Math.hypot(dx, dy);
    return end && Number.isFinite(length) && length > 0 ? { end, direction: { x: dx / length, y: dy / length } } : null;
  });
  if (!first || !second) return null;
  return mmPerPixel => [{ kind: 'angle', relation, ...localAngleGeometry(first, second, valueDegrees, mmPerPixel) }];
}
/** The end a ray points to and its unit direction. */
type AngleRay = { readonly end: Point2; readonly direction: Point2 };
/** An arc is drawn for a sweep strictly between none and a half turn. */
const drawableSweep = (sweep: number) => Number.isFinite(sweep) && sweep !== 0 && Math.abs(sweep) < Math.PI;
type AngleGeometry = DimensionGeometry & { readonly valueDegrees: number; readonly arc: CadSketchDimensionAngleArc };
/** The arc between the two rays, `radiusPixels` out from the corner, with its label beyond the middle of the arc; the sweep must be drawable. */
function angleGeometry(geometry: CadSketchLineAngleGeometry, sense: 'cw' | 'ccw', valueDegrees: number, mmPerPixel: number, radiusPixels = 40): AngleGeometry {
  const { vertex, first, second, signedSweepRadians: sweep } = geometry;
  const radius = radiusPixels * mmPerPixel, sign = sense === 'ccw' ? 1 : -1;
  const at = (direction: Point2, length: number): SketchPoint => [vertex.x + direction.x * length, vertex.y + direction.y * length];
  const start = at(first.direction, radius), end = at(second.direction, radius);
  const mid = Math.atan2(first.direction.y, first.direction.x) + sweep / 2, ux = Math.cos(mid), uy = Math.sin(mid);
  const box = cadSketchGraphDimensionLabel(valueDegrees, 'angle');
  const clearance = (Math.abs(ux) * box.width / 2 + Math.abs(uy) * box.height / 2 + 8) * mmPerPixel;
  const headLength = Math.min(ARROW_LENGTH_PIXELS * mmPerPixel, radius * Math.abs(sweep) / 4), headWidth = Math.min(ARROW_HALF_WIDTH_PIXELS * mmPerPixel, headLength / 2);
  const arrow = (tip: SketchPoint, direction: Point2, into: number): Arrow => [tip,
    [tip[0] - direction.y * headLength * into + direction.x * headWidth, tip[1] + direction.x * headLength * into + direction.y * headWidth],
    [tip[0] - direction.y * headLength * into - direction.x * headWidth, tip[1] + direction.x * headLength * into - direction.y * headWidth]];
  return { valueDegrees, arc: { center: [vertex.x, vertex.y], radius, start, end, clockwise: sign < 0 },
    extensions: [[at(first.direction, 3 * mmPerPixel), at(first.direction, radius + 2 * mmPerPixel)],
      [at(second.direction, 3 * mmPerPixel), at(second.direction, radius + 2 * mmPerPixel)]],
    arrows: [arrow(start, first.direction, sign), arrow(end, second.direction, -sign)],
    label: [vertex.x + ux * (radius + clearance), vertex.y + uy * (radius + clearance)], labelAngle: 0 };
}
/**
 * Each line runs on 14 px past the end its ray points to, and a leader with an arrow at each line joins them 12 px out. The label stands
 * beside the middle of the leader, on the side the rays point to, so it sits between the lines and clear of them.
 */
function localAngleGeometry(first: AngleRay, second: AngleRay, valueDegrees: number, mmPerPixel: number): DimensionGeometry & { readonly valueDegrees: number; readonly line: Pair } {
  const at = (ray: AngleRay, pixels: number): SketchPoint => [ray.end.x + ray.direction.x * pixels * mmPerPixel, ray.end.y + ray.direction.y * pixels * mmPerPixel];
  const line: Pair = [at(first, 12), at(second, 12)], dx = line[1][0] - line[0][0], dy = line[1][1] - line[0][1], length = Math.hypot(dx, dy);
  const ux = length > 0 ? dx / length : -first.direction.y, uy = length > 0 ? dy / length : first.direction.x;
  let nx = -uy, ny = ux;
  if (nx * (first.direction.x + second.direction.x) + ny * (first.direction.y + second.direction.y) < 0) { nx = -nx; ny = -ny; }
  const box = cadSketchGraphDimensionLabel(valueDegrees, 'angle');
  const clearance = (Math.abs(nx) * box.width / 2 + Math.abs(ny) * box.height / 2 + 8) * mmPerPixel;
  const headLength = Math.min(ARROW_LENGTH_PIXELS * mmPerPixel, length / 4), headWidth = Math.min(ARROW_HALF_WIDTH_PIXELS * mmPerPixel, length / 8);
  const arrow = (tip: SketchPoint, sign: number): Arrow => [tip,
    [tip[0] + ux * headLength * sign + nx * headWidth, tip[1] + uy * headLength * sign + ny * headWidth],
    [tip[0] + ux * headLength * sign - nx * headWidth, tip[1] + uy * headLength * sign - ny * headWidth]];
  return { valueDegrees, line, extensions: [[at(first, 3), at(first, 14)], [at(second, 3), at(second, 14)]], arrows: length > 0 ? [arrow(line[0], 1), arrow(line[1], -1)] : [],
    label: [line[0][0] / 2 + line[1][0] / 2 + nx * clearance, line[0][1] / 2 + line[1][1] / 2 + ny * clearance], labelAngle: 0 };
}

function radialDimension(context: Resolving, relation: Extract<CadSketchDimensionRelation, { kind: 'radial-size' | 'reference-dimension' }>): Draw | null {
  const { graph, points } = context, descriptor = relation.kind === 'reference-dimension' ? resolveCadSketchReferenceDimension(graph, relation) : relation;
  if (descriptor.kind !== 'radial-size') return null;
  const entity = resolveCadSketchRadialEntity(graph, descriptor.entityId), center = points.get(entity.centerPointId);
  if (!center) return null;
  const curve = (() => {
    if (entity.kind === 'circle') return { radius: context.value(entity.radius), angle: Math.PI / 4 };
    const start = points.get(entity.startPointId), end = points.get(entity.endPointId); if (!start || !end) return null;
    const arc = createArcSegment({ id: entity.id, center, start, end, clockwise: entity.direction === 'cw',
      source: { sourceEntityIndex: 0, sourceEntityType: 'arc', layer: null, exact: true } });
    return { radius: arc.radius, angle: arc.startAngleRadians + arc.sweepRadians / 2 };
  })();
  if (!curve || !Number.isFinite(curve.radius) || curve.radius <= 0 || !Number.isFinite(curve.angle)) return null;
  const { radius, angle } = curve, quantity = descriptor.quantity, reference = relation.kind === 'reference-dimension';
  const valueMm = relation.kind === 'reference-dimension' ? radius * (quantity === 'diameter' ? 2 : 1) : context.value(relation.value);
  if (!Number.isFinite(valueMm)) return null;
  return mmPerPixel => {
    const geometry = radialGeometry(center, radius, angle, valueMm, quantity, mmPerPixel, reference);
    return quantity === 'radius' ? [{ kind: 'radius', relation, valueMm, ...geometry }] : [{ kind: 'diameter', relation, valueMm, ...geometry }];
  };
}

function cornerDimensions(context: Resolving, relation: Extract<CadSketchDimensionRelation, { kind: 'fillet-corner' | 'chamfer-corner' }>): Draw | null {
  const { graph, points } = context, topology = resolveCadSketchCornerTopology(graph, relation);
  if (relation.kind === 'fillet-corner' && topology.entity.kind === 'arc') {
    const center = points.get(topology.entity.centerPointId), start = points.get(topology.entity.startPointId), end = points.get(topology.entity.endPointId);
    const valueMm = context.value(relation.value);
    if (!center || !start || !end || !Number.isFinite(valueMm)) return null;
    const arc = createArcSegment({ id: topology.entity.id, center, start, end, clockwise: topology.entity.direction === 'cw',
      source: { sourceEntityIndex: 0, sourceEntityType: 'arc', layer: null, exact: true } });
    const radius = arc.radius, angle = arc.startAngleRadians + arc.sweepRadians / 2;
    if (!Number.isFinite(radius) || !Number.isFinite(angle)) return null;
    return mmPerPixel => [{ kind: 'radius', relation, valueMm, ...radialGeometry(center, radius, angle, valueMm, 'radius', mmPerPixel) }];
  }
  if (relation.kind !== 'chamfer-corner') return null;
  const vertex = points.get(topology.vertexId), first = points.get(topology.trimPointIds[0]), second = points.get(topology.trimPointIds[1]);
  if (!vertex || !first || !second) return null;
  const trims = [first, second] as const;
  // A side cut back to its corner has no setback to draw; the other side still does.
  const sides = ([0, 1] as const).flatMap(side => {
    const trim = trims[side], other = trims[side === 0 ? 1 : 0], dx = trim.x - vertex.x, dy = trim.y - vertex.y, length = Math.hypot(dx, dy);
    const valueMm = context.value(relation.values[side]);
    if (!Number.isFinite(length) || length === 0 || !Number.isFinite(valueMm)) return [];
    let nx = -dy / length, ny = dx / length;
    if ((other.x - vertex.x) * nx + (other.y - vertex.y) * ny > 0) { nx = -nx; ny = -ny; }
    return [{ side, trim, nx, ny, valueMm, box: cadSketchGraphDimensionLabel(valueMm, 'setback') }];
  });
  if (!sides.length) return null;
  return mmPerPixel => sides.map(({ side, trim, nx, ny, valueMm, box }): CadSketchGraphDimensionLayout => ({ kind: 'setback', relation, side, lineId: relation.lineIds[side], valueMm,
    ...alignedGeometry(vertex, trim, nx, ny, mmPerPixel, box) }));
}

/** The dimensions of one graph that the canvas draws, at every zoom: a dimension is drawn exactly when its relation ID is in `ids`. */
export interface CadSketchDrawnDimensions { readonly graph: CadSketchGraph; readonly ids: ReadonlySet<string> }
interface Resolution { readonly draws: readonly Draw[]; readonly drawn: CadSketchDrawnDimensions }
const NO_DRAWN_IDS: ReadonlySet<string> = new Set();
// Graphs and parameters are replaced, never changed in place, so a graph is resolved once for its parameters however often it is drawn.
const resolutions = new WeakMap<CadSketchGraph, WeakMap<Readonly<Record<string, number>>, Resolution>>();
function resolved(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>): Resolution {
  let byParameters = resolutions.get(graph);
  if (!byParameters) resolutions.set(graph, byParameters = new WeakMap());
  let resolution = byParameters.get(parameters);
  if (!resolution) byParameters.set(parameters, resolution = resolveDimensions(graph, parameters));
  return resolution;
}

/**
 * Which declared dimensions draw, decided once for a graph and its parameters, apart from the zoom. Every dimension draws at any value
 * its driver takes, also 0; only an expression that does not evaluate, or geometry with nothing to attach to (a missing point, a curve
 * with no radius, an angle's line with no length, a chamfer cut back to its corner on both sides), leaves one out.
 */
function resolveDimensions(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>): Resolution {
  const relations = graph.relations.filter(isCadSketchDimensionRelation);
  if (!relations.length) return { draws: [], drawn: Object.freeze({ graph, ids: NO_DRAWN_IDS }) };
  const value = (scalar: CadScalar) => { try { return evaluateCadScalar(scalar, parameters); } catch { return NaN; } };
  const points = new Map<string, Point2>();
  for (const point of graph.points) {
    const x = value(point.position[0]), y = value(point.position[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) points.set(point.id, { x, y });
  }
  const coordinates = [...points.values()];
  for (const entity of graph.entities) {
    const center = 'centerPointId' in entity ? points.get(entity.centerPointId) : undefined;
    if (entity.kind === 'circle' && center) {
      const radius = value(entity.radius);
      if (Number.isFinite(radius)) coordinates.push({ x: center.x - radius, y: center.y - radius }, { x: center.x + radius, y: center.y + radius });
    } else if (entity.kind === 'arc' && center) {
      const start = points.get(entity.startPointId), end = points.get(entity.endPointId);
      if (!start || !end) continue;
      try {
        const { bounds } = createArcSegment({ id: entity.id, center, start, end, clockwise: entity.direction === 'cw',
          source: { sourceEntityIndex: 0, sourceEntityType: 'arc', layer: null, exact: true } });
        if ([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) coordinates.push({ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY });
      } catch { /* An arc with no circle through its points adds no extent. */ }
    }
  }
  if (!coordinates.length) return { draws: [], drawn: Object.freeze({ graph, ids: NO_DRAWN_IDS }) };
  const bounds = coordinates.reduce((box, point) => ({ minX: Math.min(box.minX, point.x), minY: Math.min(box.minY, point.y),
    maxX: Math.max(box.maxX, point.x), maxY: Math.max(box.maxY, point.y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const center: SketchPoint = [bounds.minX / 2 + bounds.maxX / 2, bounds.minY / 2 + bounds.maxY / 2];
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const context: Resolving = { graph, points, value, center,
    near: point => point.x >= bounds.minX - size && point.x <= bounds.maxX + size && point.y >= bounds.minY - size && point.y <= bounds.maxY + size };
  // An aligned distance stands off on the side away from the middle of the sketch. With no length it has no line of its own: it takes `along`
  // for one, and its extensions are a short leader square to it with the label at its end.
  const aligned = (relation: Extract<CadSketchGraphDimensionLayout, { kind: 'distance' }>['relation'], a: Point2, b: Point2, valueMm: number, along: Point2 = { x: 1, y: 0 }): Draw | null => {
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || !Number.isFinite(valueMm)) return null;
    const ux = length === 0 ? along.x : dx / length, uy = length === 0 ? along.y : dy / length;
    const direction = dx < 0 || dx === 0 && dy < 0 ? -1 : 1;
    let nx = -uy * direction, ny = ux * direction;
    const midpoint: SketchPoint = [a.x / 2 + b.x / 2, a.y / 2 + b.y / 2];
    const outward = (midpoint[0] - center[0]) * nx + (midpoint[1] - center[1]) * ny;
    const tie = Math.abs(outward) <= cadPathClosureTolerance([a, b, { x: center[0], y: center[1] }]);
    if (tie ? Math.abs(dx) >= Math.abs(dy) ? ny > 0 : nx < 0 : outward < 0) { nx = -nx; ny = -ny; }
    const box = cadSketchGraphDimensionLabel(valueMm, 'distance', relation.kind === 'reference-dimension');
    return mmPerPixel => [{ kind: 'distance', relation, valueMm, ...alignedGeometry(a, b, nx, ny, mmPerPixel, box) }];
  };
  let identity: ((pointId: string) => string) | undefined;
  const resolveOne = (relation: CadSketchDimensionRelation): Draw | null => {
    if (relation.kind === 'fixed-axis') {
      // A distance from an axis runs square to the axis, to its point or to the middle of the line Horizontal or Vertical keeps along the
      // axis, and reads as its size on either side of the axis. One that follows a parameter stays a dimension at 0 too, its line taken
      // along the axis it is measured from, so its leader stands square to it, clear of it.
      identity ??= resolveCadSketchPointIdentities(graph);
      const line = cadSketchAxisDistanceLine(graph, relation, identity), start = line && points.get(line.startPointId), end = line && points.get(line.endPointId);
      const to = start && end ? { x: start.x / 2 + end.x / 2, y: start.y / 2 + end.y / 2 } : points.get(relation.pointId);
      if (!to) return null;
      const foot = relation.axis === 'x' ? { x: 0, y: to.y } : { x: to.x, y: 0 }, along = relation.axis === 'x' ? { x: 0, y: 1 } : { x: 1, y: 0 };
      return aligned(relation, foot, to, Math.abs(value(relation.value)), along);
    }
    if (relation.kind === 'line-angle') return angularDimension(context, relation);
    if (relation.kind === 'radial-size' || relation.kind === 'reference-dimension' && relation.measurement.kind === 'radial-size') return radialDimension(context, relation);
    if (relation.kind === 'fillet-corner' || relation.kind === 'chamfer-corner') return cornerDimensions(context, relation);
    if (relation.kind === 'point-line-distance' || relation.kind === 'reference-dimension' && relation.measurement.kind === 'point-line-distance') return pointLineDimension(context, relation);
    if (relation.kind !== 'distance' && relation.kind !== 'axis-distance' && relation.kind !== 'reference-dimension') return null;
    const descriptor = relation.kind === 'reference-dimension' ? resolveCadSketchReferenceDimension(graph, relation) : relation;
    if (descriptor.kind === 'radial-size' || descriptor.kind === 'point-line-distance') return null;
    const a = points.get(descriptor.pointIds[0]), b = points.get(descriptor.pointIds[1]);
    if (!a || !b) return null;
    const valueMm = relation.kind === 'reference-dimension' ? Math.hypot(b.x - a.x, b.y - a.y) : value(relation.value);
    if (relation.kind === 'axis-distance') {
      if (!Number.isFinite(valueMm)) return null;
      const horizontal = relation.axis === 'x', outward = horizontal ? a.y / 2 + b.y / 2 - center[1] : a.x / 2 + b.x / 2 - center[0];
      const tie = Math.abs(outward) <= cadPathClosureTolerance([a, b, { x: center[0], y: center[1] }]);
      const side = tie ? horizontal ? -1 : 1 : outward < 0 ? -1 : 1;
      const nx = horizontal ? 0 : side, ny = horizontal ? side : 0;
      const base = horizontal ? side < 0 ? Math.min(a.y, b.y) : Math.max(a.y, b.y) : side < 0 ? Math.min(a.x, b.x) : Math.max(a.x, b.x);
      const projectedA = horizontal ? { x: a.x, y: base } : { x: base, y: a.y };
      const projectedB = horizontal ? { x: b.x, y: base } : { x: base, y: b.y };
      const box = cadSketchGraphDimensionLabel(valueMm, horizontal ? 'distance-x' : 'distance-y');
      return mmPerPixel => {
        const geometry = alignedGeometry(projectedA, projectedB, nx, ny, mmPerPixel, box);
        return [{ kind: horizontal ? 'distance-x' : 'distance-y', relation, valueMm, ...geometry,
          extensions: [a, b].map((point, index): Pair => [[point.x + nx * 3 * mmPerPixel, point.y + ny * 3 * mmPerPixel],
            [geometry.line[index][0] + nx * 2 * mmPerPixel, geometry.line[index][1] + ny * 2 * mmPerPixel]]) }];
      };
    }
    return aligned(relation, a, b, valueMm);
  };
  const draws: Draw[] = [], ids = new Set<string>();
  for (const relation of relations) {
    let draw: Draw | null;
    // Geometry a dimension cannot resolve against, such as a missing line or point identity, leaves out that dimension only.
    try { draw = resolveOne(relation); } catch { draw = null; }
    if (draw) { draws.push(draw); ids.add(relation.id); }
  }
  return { draws, drawn: Object.freeze({ graph, ids }) };
}

/**
 * The dimensions the canvas draws for a graph, from the same resolution its layout draws with. Canvas selection, editing, Delete and the
 * viewport's dimension flag act only on these, so a dimension that cannot be drawn is never selected unseen; the relations list still has it.
 */
export function cadSketchDrawnDimensions(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>): CadSketchDrawnDimensions {
  return resolved(graph, parameters).drawn;
}

/** Display-only declared dimensions, the marks of each drawn one at this zoom. Scalar drivers and source IDs remain authoritative. */
export function layoutCadSketchGraphDimensions(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>, mmPerPixel: number): readonly CadSketchGraphDimensionLayout[] {
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0) return [];
  const { draws } = resolved(graph, parameters);
  return draws.length ? separateAlignedDimensions(draws.flatMap(draw => draw(mmPerPixel)), mmPerPixel) : [];
}

/** One drawn part of a dimension being placed, with the marks a placed dimension of its kind has. */
export type CadSketchDimensionPreviewMark = DimensionGeometry & { readonly kind: CadSketchGraphDimensionLayout['kind']; readonly value: number }
  & ({ readonly line: Pair; readonly arc?: undefined } | { readonly line?: undefined; readonly arc: CadSketchDimensionAngleArc });

/**
 * A dimension before it is placed, drawn by the placed layouts with its dimension line through the pointer: an aligned distance
 * parallel to its points, a horizontal or vertical one level or upright at the pointer, a radius toward it and an angle in the
 * sector holding it, its arc at the pointer's distance, and a radius or diameter with its label at the pointer, inside or outside the curve.
 * A point to line distance keeps its placed layout. Placed dimensions keep
 * the default offset until dimensions store where they were placed.
 */
export function layoutCadSketchDimensionPreview(source: CadSketchDimensionPreviewSource, pointer: Point2, mmPerPixel: number): readonly CadSketchDimensionPreviewMark[] {
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0 || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return [];
  const linear = (a: Point2, b: Point2, form: 'aligned' | 'horizontal' | 'vertical', value: number): CadSketchDimensionPreviewMark | null => {
    const kind = form === 'aligned' ? 'distance' : form === 'horizontal' ? 'distance-x' : 'distance-y', box = cadSketchGraphDimensionLabel(value, kind);
    if (form === 'aligned') {
      // Points at one position, which only a reference measures, run level like their placed reference.
      const length = Math.hypot(b.x - a.x, b.y - a.y), ux = length > 0 ? (b.x - a.x) / length : 1, uy = length > 0 ? (b.y - a.y) / length : 0;
      if (!Number.isFinite(length)) return null;
      let nx = -uy, ny = ux, out = (pointer.x - a.x) * nx + (pointer.y - a.y) * ny;
      if (out < 0) { nx = -nx; ny = -ny; out = -out; }
      return { kind, value, ...alignedGeometry(a, b, nx, ny, mmPerPixel, box, out / mmPerPixel) };
    }
    // The line runs level or upright through the pointer; each extension reaches it from its own point.
    const horizontal = form === 'horizontal', middle = horizontal ? a.y / 2 + b.y / 2 : a.x / 2 + b.x / 2, side = (horizontal ? pointer.y : pointer.x) >= middle ? 1 : -1;
    const nx = horizontal ? 0 : side, ny = horizontal ? side : 0;
    const project = (point: Point2) => horizontal ? { x: point.x, y: pointer.y } : { x: pointer.x, y: point.y };
    const geometry = alignedGeometry(project(a), project(b), nx, ny, mmPerPixel, box, 0);
    const extension = (point: Point2, end: SketchPoint): Pair => {
      const gap = horizontal ? end[1] - point.y : end[0] - point.x, toward = gap >= 0 ? 1 : -1, clear = Math.min(3 * mmPerPixel, Math.abs(gap));
      return horizontal ? [[point.x, point.y + toward * clear], [end[0], end[1] + toward * 2 * mmPerPixel]] : [[point.x + toward * clear, point.y], [end[0] + toward * 2 * mmPerPixel, end[1]]];
    };
    return { kind, value, ...geometry, extensions: [extension(a, geometry.line[0]), extension(b, geometry.line[1])] };
  };
  switch (source.kind) {
    case 'pair': { const mark = linear(source.points[0], source.points[1], source.form, source.value); return mark ? [mark] : []; }
    case 'datum': return source.axes.flatMap(axis => {
      // A distance from an axis is labelled with its size, as once placed; the sign of the coordinate only gives the side of the axis.
      const from = axis === 'x' ? { x: 0, y: source.point.y } : { x: source.point.x, y: 0 }, value = Math.abs(axis === 'x' ? source.point.x : source.point.y);
      const mark = value > 0 ? linear(from, source.point, axis === 'x' ? 'horizontal' : 'vertical', value) : null;
      return mark ? [{ ...mark, kind: 'distance' as const }] : [];
    });
    case 'point-line': {
      const [start, end] = source.line, length = Math.hypot(end.x - start.x, end.y - start.y);
      if (!(length > 0)) return [];
      const axis = { x: (end.x - start.x) / length, y: (end.y - start.y) / length, start, end, length };
      return [{ kind: 'point-line', value: source.value, ...pointLineGeometry(source.point, axis, source.value, mmPerPixel, false) }];
    }
    case 'radial': {
      const dx = pointer.x - source.center.x, dy = pointer.y - source.center.y, reach = Math.hypot(dx, dy), angle = reach > 0 ? Math.atan2(dy, dx) : Math.PI / 4;
      return [{ kind: source.quantity, value: source.value, ...radialGeometry(source.center, source.radius, angle, source.value, source.quantity, mmPerPixel, false, reach) }];
    }
    case 'angle': {
      const sector = cadSketchDimensionAngleSectorAt(source, pointer);
      if (!sector) return [];
      const { vertex } = sector.geometry, radius = Math.max(12, Math.hypot(pointer.x - vertex.x, pointer.y - vertex.y) / mmPerPixel), value = sector.relation.value as number;
      if (!drawableSweep(sector.geometry.signedSweepRadians) || !Number.isFinite(value)) return [];
      const drawn = angleGeometry(sector.geometry, sector.relation.sense, value, mmPerPixel, radius);
      return [{ kind: 'angle', value: drawn.valueDegrees, ...drawn }];
    }
  }
}
