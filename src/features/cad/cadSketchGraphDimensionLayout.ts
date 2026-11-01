import type { CadScalar } from '@/domain/cad/cadDocument';
import { CadError } from '@/domain/cad/cadError';
import type { CadSketchGraph, CadSketchGraphRelation, CadSketchLinearAnnotation, CadSketchRadialAnnotation, CadSketchReferenceDimension } from '@/domain/cad/cadSketchGraph';
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
import { CAD_PRECISION } from '@/domain/precision/cadPrecision';
import { CadSketchPositions } from '@/domain/cad/sketch-relations/cadSketchVirtualElements';
import type { SketchPoint } from './cadSketchInteraction';
import { formatCadQuantity } from './cadDisplayQuantity';
import { cadSketchAxisDistanceLine } from './cadSketchDimensionCommands';
import { isCadSketchDimensionRelation } from './cadSketchDimensionSelection';
import { resolveCadSketchPointIdentities } from '@/domain/cad/cadSketchGraphJoints';
import { cadSketchDimensionPlacementOf, withCadSketchDimensionPlacement, type CadSketchDimensionPartPlacement } from '@/domain/cad/cadSketchPlacedDimensions';

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
/** `large` marks an arc drawn past a half turn, as one reaching text placed beyond its sweep. */
export interface CadSketchDimensionAngleArc { readonly center: SketchPoint; readonly radius: number; readonly start: SketchPoint; readonly end: SketchPoint; readonly clockwise: boolean; readonly large?: boolean }
/** The SVG path of an angle's arc, drawn about `center` as the canvas origin. */
export function cadSketchDimensionArcPath(arc: CadSketchDimensionAngleArc, center: SketchPoint): string {
  return `M ${arc.start[0] - center[0]} ${arc.start[1] - center[1]} A ${arc.radius} ${arc.radius} 0 ${arc.large ? 1 : 0} ${arc.clockwise ? 0 : 1} ${arc.end[0] - center[0]} ${arc.end[1] - center[1]}`;
}

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
  // With no length the line keeps the direction square to its normal, so a dimension at 0 is drawn as one a hair long is: its extensions
  // are one leader out from the point to the line, and its text reads along the line above it.
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), ux = length === 0 ? -ny : dx / length, uy = length === 0 ? nx : dy / length;
  const { x: readX, y: readY } = reading(ux, uy);
  // A dimension being placed sits where the pointer put it, `placedOffset` screen pixels out.
  const upX = -readY, upY = readX, lineOffset = placedOffset ?? (upX * nx + upY * ny < -CAD_PRECISION.annotationReadingTie ? 20 + isoInwardClearance : 20);
  const liftX = upX, liftY = upY;
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

/**
 * Pack parallel occupied strips outward; keep source attachments and returned relation order intact. A dimension in `fixed` stays where
 * it was placed, and the others keep clear of it.
 */
function separateAlignedDimensions(dimensions: readonly CadSketchGraphDimensionLayout[], mmPerPixel: number, fixed: ReadonlySet<CadSketchGraphDimensionLayout>): readonly CadSketchGraphDimensionLayout[] {
  const result = [...dimensions], placed: AlignedDimension[] = dimensions.filter((dimension): dimension is AlignedDimension => fixed.has(dimension) && isAlignedDimension(dimension));
  const length = (dimension: AlignedDimension) => Math.hypot(dimension.line[1][0] - dimension.line[0][0], dimension.line[1][1] - dimension.line[0][1]);
  const key = (dimension: AlignedDimension) => dimension.relation.id + '/' + dimension.kind + (dimension.kind === 'setback' ? dimension.side : '');
  const ordered = dimensions.flatMap((dimension, index) => isAlignedDimension(dimension) && !fixed.has(dimension) ? [{ dimension, index }] : [])
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
      // A placed dimension close to its geometry has no extensions; with no length either it has no direction to compare.
      const otherGuide = other.extensions[0], ox = otherGuide ? otherGuide[1][0] - otherGuide[0][0] : 0, oy = otherGuide ? otherGuide[1][1] - otherGuide[0][1] : 0;
      if (!otherLength && !otherGuide) return [];
      if (otherLength ? Math.abs(ux * vy - uy * vx) > otherLength * CAD_PRECISION.annotationParallelRelative : Math.abs(nx * oy - ny * ox) > Math.hypot(ox, oy) * CAD_PRECISION.annotationParallelRelative) return [];
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

/** A dimension's drawn marks apart from what it measures: its line or arc, extensions, arrows and label. */
type Marks = DimensionGeometry & ({ readonly line: Pair; readonly arc?: undefined } | { readonly line?: undefined; readonly arc: CadSketchDimensionAngleArc });
type LinearMarks = Omit<LinearDimensionGeometry, 'valueMm'>;
/**
 * One drawn part of a dimension in the frame of the geometry it measures, which every placement is relative to. Placing, the preview,
 * the placed layout and a drag all draw a part through it, so a placement draws the same marks wherever it came from.
 */
interface Part {
  readonly kind: CadSketchGraphDimensionLayout['kind'];
  /** Millimetres, or degrees for an angle. */
  readonly value: number;
  /** A chamfer's setback side. */
  readonly side?: 0 | 1;
  /** Marks laid out automatically. */
  auto(mmPerPixel: number): Marks;
  /** Marks at `placement`, or null when it does not fit this part, which is then laid out automatically. */
  at(placement: CadSketchDimensionPartPlacement, mmPerPixel: number): Marks | null;
  /** The placement putting the dimension line or arc through `pointer`, its text centred, or a radial label at it. */
  through(pointer: Point2, mmPerPixel: number): CadSketchDimensionPartPlacement;
  /** The placement putting the text at `label`. */
  labelAt(label: Point2, mmPerPixel: number): CadSketchDimensionPartPlacement;
  /** `start` with its line or arc carried by the pointer from `from` to `to`; the text keeps its place along it. */
  moved(start: CadSketchDimensionPartPlacement, from: Point2, to: Point2, mmPerPixel: number): CadSketchDimensionPartPlacement;
  /** The placement that draws automatic `marks`, which separation may have moved out. */
  of(marks: Marks, mmPerPixel: number): CadSketchDimensionPartPlacement;
  /** `placement` taken `distance` millimetres further out from what the dimension measures, as one click steps a dimension clear of another. */
  outward(placement: CadSketchDimensionPartPlacement, distance: number): CadSketchDimensionPartPlacement;
}
const linear = (offset: number, along: number): CadSketchLinearAnnotation => ({ kind: 'linear', offset, along });
const wrapAngle = (angle: number) => angle - 2 * Math.PI * Math.floor((angle + Math.PI) / (2 * Math.PI));
/** The read-up direction of text along a line, ISO 129: readable from the bottom or right. */
function reading(ux: number, uy: number): Point2 {
  return ux < -CAD_PRECISION.annotationReadingTie || Math.abs(ux) <= CAD_PRECISION.annotationReadingTie && uy < 0 ? { x: -ux, y: -uy } : { x: ux, y: uy };
}
/**
 * A linear placement's `along` is the text's place on its dimension line as a fraction of the line's length from its start, taken of at
 * least this many millimetres: a dimension at or near 0 still takes a drag along its line, and its text stays put as its length passes
 * through zero.
 */
const ALONG_SCALE_MM = 1;
/** The text's shift from the middle of a dimension line `length` long for `along`, and the `along` of a shift. */
const alongShift = (along: number, length: number) => (along - 0.5) * Math.max(length, ALONG_SCALE_MM);
const alongOf = (shift: number, length: number) => 0.5 + shift / Math.max(length, ALONG_SCALE_MM);
/**
 * Text moved `shift` millimetres from the middle of its dimension line, along `t`. Past either end the line runs on beneath the whole
 * text; the arrows stay where they were drawn.
 */
function placeAlong<T extends { readonly line: Pair; readonly label: SketchPoint }>(marks: T, shift: number, t: Point2, halfWidth: number): T {
  if (shift === 0 || !Number.isFinite(shift)) return marks;
  const [start, end] = marks.line, mx = start[0] / 2 + end[0] / 2, my = start[1] / 2 + end[1] / 2;
  const label: SketchPoint = [marks.label[0] + t.x * shift, marks.label[1] + t.y * shift];
  if (Math.abs(shift) <= Math.abs((end[0] - start[0]) * t.x + (end[1] - start[1]) * t.y) / 2) return { ...marks, label };
  const reach = shift + Math.sign(shift) * halfWidth, beyond: SketchPoint = [mx + t.x * reach, my + t.y * reach];
  const startPassed = ((start[0] - mx) * t.x + (start[1] - my) * t.y) * shift > 0;
  return { ...marks, label, line: startPassed ? [beyond, end] : [start, beyond] } as T;
}

/**
 * A linear dimension from `a` to `b`, its line `offset` out along `normal` and its text `along` it in the direction `t`, the frame
 * that every placement is taken in. `extensions` redraws the extensions of one whose base is not its measured points. With no length
 * the line keeps `t`.
 */
function linearPart(kind: LinearKind, value: number, reference: boolean, a: Point2, b: Point2, t: Point2, normal: Point2, auto: (mmPerPixel: number) => LinearMarks,
  extensions?: (line: Pair, mmPerPixel: number) => readonly Pair[], side?: 0 | 1): Part {
  const box = cadSketchGraphDimensionLabel(value, kind, reference), length = Math.abs((b.x - a.x) * t.x + (b.y - a.y) * t.y), read = reading(t.x, t.y);
  const mx = a.x / 2 + b.x / 2, my = a.y / 2 + b.y / 2;
  const at = (placement: CadSketchDimensionPartPlacement, mmPerPixel: number): LinearMarks | null => {
    if (placement.kind !== 'linear') return null;
    const sign = placement.offset < 0 ? -1 : 1, geometry = alignedGeometry(a, b, normal.x * sign, normal.y * sign, mmPerPixel, box, Math.abs(placement.offset) / mmPerPixel);
    return placeAlong(extensions ? { ...geometry, extensions: extensions(geometry.line, mmPerPixel) } : geometry, alongShift(placement.along, length), t, box.width * mmPerPixel / 2);
  };
  // The text stands above its line; take that off and the rest is the line's offset and the text's place along it.
  const labelAt = (label: Point2, mmPerPixel: number) => {
    const lift = (box.height / 2 + isoTextGap) * mmPerPixel, px = label.x + read.y * lift, py = label.y - read.x * lift;
    return linear((px - a.x) * normal.x + (py - a.y) * normal.y, alongOf((px - mx) * t.x + (py - my) * t.y, length));
  };
  return { kind, value, side, auto, at, labelAt,
    through: pointer => linear((pointer.x - a.x) * normal.x + (pointer.y - a.y) * normal.y, 0.5),
    moved: (start, from, to) => start.kind === 'linear' ? linear(start.offset + (to.x - from.x) * normal.x + (to.y - from.y) * normal.y, start.along) : start,
    of: (marks, mmPerPixel) => linear((marks.line![0][0] - a.x) * normal.x + (marks.line![0][1] - a.y) * normal.y, labelAt({ x: marks.label[0], y: marks.label[1] }, mmPerPixel).along),
    outward: (placement, distance) => placement.kind === 'linear' ? linear(placement.offset + (placement.offset < 0 ? -distance : distance), placement.along) : placement };
}
type LinearKind = 'distance' | 'distance-x' | 'distance-y' | 'setback' | 'point-line';

/**
 * An aligned distance, standing off automatically along `auto`. Its placement is taken in the frame from a to b, or in `frame` when given,
 * which a distance from an axis keeps on either side of the axis; points that meet take the sketch X axis.
 */
function alignedPart(kind: 'distance' | 'setback', value: number, reference: boolean, a: Point2, b: Point2, auto: Point2, frame?: Point2, side?: 0 | 1): Part {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), t = frame ?? (length > 0 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 });
  const box = cadSketchGraphDimensionLabel(value, kind, reference);
  return linearPart(kind, value, reference, a, b, t, { x: -t.y, y: t.x }, mmPerPixel => alignedGeometry(a, b, auto.x, auto.y, mmPerPixel, box), undefined, side);
}

/**
 * A horizontal or vertical distance between `a` and `b` in their order, its line level or upright. A placement's offset is from the
 * middle of the points, toward +Y for a horizontal distance and +X for a vertical one, and each extension reaches the line from its own point.
 * Automatically the line stands off beyond both points on `side`.
 */
function axisPart(value: number, a: Point2, b: Point2, horizontal: boolean, side: number): Part {
  const kind = horizontal ? 'distance-x' : 'distance-y', box = cadSketchGraphDimensionLabel(value, kind);
  const middle = horizontal ? a.y / 2 + b.y / 2 : a.x / 2 + b.x / 2;
  const baseA = horizontal ? { x: a.x, y: middle } : { x: middle, y: a.y }, baseB = horizontal ? { x: b.x, y: middle } : { x: middle, y: b.y };
  const extensions = (line: Pair, mmPerPixel: number) => [a, b].map((point, index): Pair => {
    const end = line[index], gap = horizontal ? end[1] - point.y : end[0] - point.x, toward = gap >= 0 ? 1 : -1, clear = Math.min(3 * mmPerPixel, Math.abs(gap));
    return horizontal ? [[point.x, point.y + toward * clear], [end[0], end[1] + toward * 2 * mmPerPixel]] : [[point.x + toward * clear, point.y], [end[0] + toward * 2 * mmPerPixel, end[1]]];
  });
  const nx = horizontal ? 0 : side, ny = horizontal ? side : 0;
  const base = horizontal ? side < 0 ? Math.min(a.y, b.y) : Math.max(a.y, b.y) : side < 0 ? Math.min(a.x, b.x) : Math.max(a.x, b.x);
  const projectedA = horizontal ? { x: a.x, y: base } : { x: base, y: a.y }, projectedB = horizontal ? { x: b.x, y: base } : { x: base, y: b.y };
  const auto = (mmPerPixel: number): LinearMarks => {
    const geometry = alignedGeometry(projectedA, projectedB, nx, ny, mmPerPixel, box);
    return { ...geometry, extensions: [a, b].map((point, index): Pair => [[point.x + nx * 3 * mmPerPixel, point.y + ny * 3 * mmPerPixel],
      [geometry.line[index][0] + nx * 2 * mmPerPixel, geometry.line[index][1] + ny * 2 * mmPerPixel]]) };
  };
  return linearPart(kind, value, false, baseA, baseB, horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 }, horizontal ? { x: 0, y: 1 } : { x: 1, y: 0 }, auto, extensions);
}

type Support = { readonly x: number; readonly y: number; readonly start: Point2; readonly end: Point2; readonly length: number };
/**
 * A point to line distance; a placement slides its line `offset` along the support and puts its text `along` it, in the direction to the
 * left of the support, whichever side the point is on, so the text stays put as a measured point crosses the support.
 */
function pointLinePart(point: Point2, axis: Support, value: number, reference: boolean): Part {
  const signed = cadSketchSignedPointLineDistance(point, axis), length = Math.abs(signed), foot = { x: point.x + axis.y * signed, y: point.y - axis.x * signed };
  // The text reads along the dimension line, square to the support, also with the point on the support.
  const t = { x: -axis.y, y: axis.x }, mx = foot.x + t.x * signed / 2, my = foot.y + t.y * signed / 2, read = reading(t.x, t.y);
  const box = cadSketchGraphDimensionLabel(value, 'point-line', reference);
  const slide = (pointer: Point2) => (pointer.x - foot.x) * axis.x + (pointer.y - foot.y) * axis.y;
  const labelAt = (label: Point2, mmPerPixel: number) => {
    const lift = (box.height / 2 + isoTextGap) * mmPerPixel, px = label.x + read.y * lift, py = label.y - read.x * lift;
    return linear(slide({ x: px, y: py }), alongOf((px - mx) * t.x + (py - my) * t.y, length));
  };
  return { kind: 'point-line', value, labelAt,
    auto: mmPerPixel => pointLineGeometry(point, axis, value, mmPerPixel, reference),
    at: (placement, mmPerPixel) => placement.kind !== 'linear' ? null
      : placeAlong(pointLineGeometry(point, axis, value, mmPerPixel, reference, placement.offset), alongShift(placement.along, length), t, box.width * mmPerPixel / 2),
    through: pointer => linear(slide(pointer), 0.5),
    moved: (start, from, to) => start.kind === 'linear' ? linear(start.offset + slide(to) - slide(from), start.along) : start,
    of: (marks, mmPerPixel) => linear(slide({ x: marks.line![0][0], y: marks.line![0][1] }), labelAt({ x: marks.label[0], y: marks.label[1] }, mmPerPixel).along),
    outward: (placement, distance) => placement.kind === 'linear' ? linear(placement.offset + (placement.offset < 0 ? -distance : distance), placement.along) : placement };
}

/** A radius or diameter; a placement turns its leader to `angle` and puts its text `distance` from the centre. */
function radialPart(center: Point2, radius: number, angle: number, value: number, kind: 'radius' | 'diameter', reference: boolean): Part {
  const toward = (pointer: Point2): CadSketchRadialAnnotation => {
    const dx = pointer.x - center.x, dy = pointer.y - center.y, reach = Math.hypot(dx, dy);
    return { kind: 'radial', angle: reach > 0 ? Math.atan2(dy, dx) : Math.PI / 4, distance: reach };
  };
  return { kind, value, through: toward, labelAt: toward,
    auto: mmPerPixel => radialGeometry(center, radius, angle, value, kind, mmPerPixel, reference),
    at: (placement, mmPerPixel) => placement.kind !== 'radial' ? null : radialGeometry(center, radius, placement.angle, value, kind, mmPerPixel, reference, placement.distance),
    // The leader turns with the pointer about the centre; the text keeps its distance.
    moved: (start, from, to) => start.kind !== 'radial' ? start
      : { ...start, angle: wrapAngle(start.angle + Math.atan2(to.y - center.y, to.x - center.x) - Math.atan2(from.y - center.y, from.x - center.x)) },
    of: marks => toward({ x: marks.label[0], y: marks.label[1] }),
    outward: (placement, distance) => placement.kind === 'radial' ? { ...placement, distance: placement.distance + distance } : placement };
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
 * rays point to, a leader from one line to the other with its label beside it. An arc placed where it was put stays an arc; `placing`
 * resolves the arc a pointer would place.
 */
function angularParts(context: Resolving, relation: Extract<CadSketchDimensionRelation, { kind: 'line-angle' }>, placing: boolean): readonly Part[] | null {
  const valueDegrees = context.value(relation.value);
  if (!Number.isFinite(valueDegrees)) return null;
  let geometry: CadSketchLineAngleGeometry | null = null;
  try { geometry = cadSketchLineAngleGeometry(context.graph, relation, context.points); }
  catch (cause) { if (!(cause instanceof CadError && cause.code === 'sketch-angle-precision')) return null; }
  const corner = geometry;
  if (corner && drawableSweep(corner.signedSweepRadians) && (placing || relation.annotation?.kind === 'angle' || context.near(corner.vertex)))
    return [anglePart(corner, relation.sense, valueDegrees)];
  const [first, second] = resolveCadSketchAngleRays(context.graph, relation.rays).map((ray): AngleRay | null => {
    const from = context.points.get(ray.fromPointId), end = context.points.get(ray.towardPointId);
    const dx = end && from ? end.x - from.x : NaN, dy = end && from ? end.y - from.y : NaN, length = Math.hypot(dx, dy);
    return end && Number.isFinite(length) && length > 0 ? { end, direction: { x: dx / length, y: dy / length } } : null;
  });
  if (!first || !second) return null;
  return [leaderPart(first, second, valueDegrees)];
}
/** The end a ray points to and its unit direction. */
type AngleRay = { readonly end: Point2; readonly direction: Point2 };
/** An arc is drawn for a sweep strictly between none and a half turn. */
const drawableSweep = (sweep: number) => Number.isFinite(sweep) && sweep !== 0 && Math.abs(sweep) < Math.PI;
type AngleGeometry = DimensionGeometry & { readonly valueDegrees: number; readonly arc: CadSketchDimensionAngleArc };

/** An angle's arc; a placement sets its radius from the vertex and puts its text `along` the sweep, from the first ray. */
function anglePart(geometry: CadSketchLineAngleGeometry, sense: 'cw' | 'ccw', value: number): Part {
  const { vertex, first, signedSweepRadians: sweep } = geometry, startAngle = Math.atan2(first.direction.y, first.direction.x);
  const box = cadSketchGraphDimensionLabel(value, 'angle');
  // Text beyond the sweep draws the arc out to it, never round past a full turn.
  const fits = (along: number) => Math.abs(sweep) * (Math.max(1, along) - Math.min(0, along)) < 2 * Math.PI - CAD_PRECISION.annotationFullTurnSlackRad;
  const distance = (pointer: Point2) => Math.hypot(pointer.x - vertex.x, pointer.y - vertex.y);
  const bounded = (radius: number) => Math.min(CAD_PRECISION.modelExtentMm, Math.max(CAD_PRECISION.annotationMinimumRadiusMm, radius));
  return { kind: 'angle', value,
    auto: mmPerPixel => angleGeometry(geometry, sense, value, mmPerPixel),
    at: (placement, mmPerPixel) => placement.kind !== 'angle' || !fits(placement.along) ? null
      : angleGeometry(geometry, sense, value, mmPerPixel, Math.max(12, placement.radius / mmPerPixel), placement.along),
    through: (pointer, mmPerPixel) => ({ kind: 'angle', radius: bounded(distance(pointer) > 0 ? distance(pointer) : 12 * mmPerPixel), along: 0.5 }),
    labelAt: (label, mmPerPixel) => {
      const direction = Math.atan2(label.y - vertex.y, label.x - vertex.x), ux = Math.cos(direction), uy = Math.sin(direction);
      const clearance = (Math.abs(ux) * box.width / 2 + Math.abs(uy) * box.height / 2 + 8) * mmPerPixel;
      // The text's turn from the first ray is taken within a half turn of the middle of the sweep, which keeps the arc reaching it short.
      const turn = wrapAngle(direction - startAngle - sweep / 2) + sweep / 2;
      return { kind: 'angle', radius: bounded(distance(label) - clearance), along: turn / sweep };
    },
    moved: (start, from, to, mmPerPixel) => start.kind !== 'angle' ? start
      : { ...start, radius: bounded(Math.max(12 * mmPerPixel, start.radius) + distance(to) - distance(from)) },
    of: marks => ({ kind: 'angle', radius: bounded(marks.arc ? marks.arc.radius : 40), along: 0.5 }),
    outward: (placement, distance) => placement.kind === 'angle' ? { ...placement, radius: bounded(placement.radius + distance) } : placement };
}
/**
 * The arc between the two rays, `radiusPixels` out from the corner, with its label beyond the arc `along` the sweep from the first ray;
 * the sweep must be drawable. Text beyond the sweep draws the arc on to it, with the arrows still at the rays.
 */
function angleGeometry(geometry: CadSketchLineAngleGeometry, sense: 'cw' | 'ccw', valueDegrees: number, mmPerPixel: number, radiusPixels = 40, along = 0.5): AngleGeometry {
  const { vertex, first, second, signedSweepRadians: sweep } = geometry;
  const radius = radiusPixels * mmPerPixel, sign = sense === 'ccw' ? 1 : -1;
  const at = (direction: Point2, length: number): SketchPoint => [vertex.x + direction.x * length, vertex.y + direction.y * length];
  const start = at(first.direction, radius), end = at(second.direction, radius), base = Math.atan2(first.direction.y, first.direction.x);
  const mid = base + sweep * along, ux = Math.cos(mid), uy = Math.sin(mid);
  const box = cadSketchGraphDimensionLabel(valueDegrees, 'angle');
  const clearance = (Math.abs(ux) * box.width / 2 + Math.abs(uy) * box.height / 2 + 8) * mmPerPixel;
  const headLength = Math.min(ARROW_LENGTH_PIXELS * mmPerPixel, radius * Math.abs(sweep) / 4), headWidth = Math.min(ARROW_HALF_WIDTH_PIXELS * mmPerPixel, headLength / 2);
  const arrow = (tip: SketchPoint, direction: Point2, into: number): Arrow => [tip,
    [tip[0] - direction.y * headLength * into + direction.x * headWidth, tip[1] + direction.x * headLength * into + direction.y * headWidth],
    [tip[0] - direction.y * headLength * into - direction.x * headWidth, tip[1] + direction.x * headLength * into - direction.y * headWidth]];
  const beyond = along < 0 || along > 1, from = base + sweep * Math.min(0, along), to = base + sweep * Math.max(1, along);
  const arc: CadSketchDimensionAngleArc = beyond ? { center: [vertex.x, vertex.y], radius, start: at({ x: Math.cos(from), y: Math.sin(from) }, radius),
    end: at({ x: Math.cos(to), y: Math.sin(to) }, radius), clockwise: sign < 0, large: Math.abs(to - from) > Math.PI }
    : { center: [vertex.x, vertex.y], radius, start, end, clockwise: sign < 0 };
  return { valueDegrees, arc,
    extensions: [[at(first.direction, 3 * mmPerPixel), at(first.direction, radius + 2 * mmPerPixel)],
      [at(second.direction, 3 * mmPerPixel), at(second.direction, radius + 2 * mmPerPixel)]],
    arrows: [arrow(start, first.direction, sign), arrow(end, second.direction, -sign)],
    label: [vertex.x + ux * (radius + clearance), vertex.y + uy * (radius + clearance)], labelAngle: 0 };
}

/**
 * The leader of an angle whose corner is out of reach; a placement takes it `offset` millimetres past the picked ends and its text
 * `along` it from the first line.
 */
function leaderPart(first: AngleRay, second: AngleRay, value: number): Part {
  const middle = { x: first.end.x / 2 + second.end.x / 2, y: first.end.y / 2 + second.end.y / 2 };
  // Moving out along both rays carries the leader's middle along their mean; rays pointing apart carry it along the first.
  let wx = first.direction.x + second.direction.x, wy = first.direction.y + second.direction.y;
  if (Math.hypot(wx, wy) < 0.5) { wx = 2 * first.direction.x; wy = 2 * first.direction.y; }
  const reach = (pointer: Point2) => 2 * ((pointer.x - middle.x) * wx + (pointer.y - middle.y) * wy) / (wx * wx + wy * wy);
  const box = cadSketchGraphDimensionLabel(value, 'angle');
  // The leader's own direction is the frame its text moves along; with no length it runs square to the first line.
  const frame = (line: Pair) => {
    const dx = line[1][0] - line[0][0], dy = line[1][1] - line[0][1], length = Math.hypot(dx, dy);
    return { length, t: length > 0 ? { x: dx / length, y: dy / length } : { x: -first.direction.y, y: first.direction.x } };
  };
  const at = (offset: number, along: number, mmPerPixel: number) => {
    const geometry = localAngleGeometry(first, second, value, mmPerPixel, offset / mmPerPixel), { length, t } = frame(geometry.line);
    return placeAlong(geometry, alongShift(along, length), t, box.width * mmPerPixel / 2);
  };
  return { kind: 'angle', value,
    auto: mmPerPixel => localAngleGeometry(first, second, value, mmPerPixel),
    at: (placement, mmPerPixel) => placement.kind === 'linear' ? at(placement.offset, placement.along, mmPerPixel) : null,
    through: pointer => linear(reach(pointer), 0.5),
    labelAt: (label, mmPerPixel) => {
      // The text stands off the leader on the side the rays point to; take that off and find the leader through the rest.
      const guess = localAngleGeometry(first, second, value, mmPerPixel, reach(label) / mmPerPixel);
      const point = { x: label.x - (guess.label[0] - (guess.line[0][0] / 2 + guess.line[1][0] / 2)), y: label.y - (guess.label[1] - (guess.line[0][1] / 2 + guess.line[1][1] / 2)) };
      const offset = reach(point), line = localAngleGeometry(first, second, value, mmPerPixel, offset / mmPerPixel).line, { length, t } = frame(line);
      return linear(offset, alongOf((point.x - line[0][0] / 2 - line[1][0] / 2) * t.x + (point.y - line[0][1] / 2 - line[1][1] / 2) * t.y, length));
    },
    moved: (start, from, to) => start.kind === 'linear' ? linear(start.offset + reach(to) - reach(from), start.along) : start,
    of: marks => linear((marks.line![0][0] - first.end.x) * first.direction.x + (marks.line![0][1] - first.end.y) * first.direction.y, 0.5),
    outward: (placement, distance) => placement.kind === 'linear' ? linear(placement.offset + distance, placement.along) : placement };
}
/**
 * Each line runs on 2 px past the leader, which joins them `pixels` past the ends their rays point to, 12 px unless placed, with an arrow at
 * each line. The label stands beside the middle of the leader, on the side the rays point to, so it sits between the lines and clear of them.
 */
function localAngleGeometry(first: AngleRay, second: AngleRay, valueDegrees: number, mmPerPixel: number, pixels = 12): DimensionGeometry & { readonly valueDegrees: number; readonly line: Pair } {
  const at = (ray: AngleRay, pixels: number): SketchPoint => [ray.end.x + ray.direction.x * pixels * mmPerPixel, ray.end.y + ray.direction.y * pixels * mmPerPixel];
  const line: Pair = [at(first, pixels), at(second, pixels)], dx = line[1][0] - line[0][0], dy = line[1][1] - line[0][1], length = Math.hypot(dx, dy);
  const ux = length > 0 ? dx / length : -first.direction.y, uy = length > 0 ? dy / length : first.direction.x;
  let nx = -uy, ny = ux;
  if (nx * (first.direction.x + second.direction.x) + ny * (first.direction.y + second.direction.y) < 0) { nx = -nx; ny = -ny; }
  const box = cadSketchGraphDimensionLabel(valueDegrees, 'angle');
  const clearance = (Math.abs(nx) * box.width / 2 + Math.abs(ny) * box.height / 2 + 8) * mmPerPixel;
  const headLength = Math.min(ARROW_LENGTH_PIXELS * mmPerPixel, length / 4), headWidth = Math.min(ARROW_HALF_WIDTH_PIXELS * mmPerPixel, length / 8);
  const arrow = (tip: SketchPoint, sign: number): Arrow => [tip,
    [tip[0] + ux * headLength * sign + nx * headWidth, tip[1] + uy * headLength * sign + ny * headWidth],
    [tip[0] + ux * headLength * sign - nx * headWidth, tip[1] + uy * headLength * sign - ny * headWidth]];
  return { valueDegrees, line, extensions: pixels > 3 ? [[at(first, 3), at(first, pixels + 2)], [at(second, 3), at(second, pixels + 2)]] : [],
    arrows: length > 0 ? [arrow(line[0], 1), arrow(line[1], -1)] : [],
    label: [line[0][0] / 2 + line[1][0] / 2 + nx * clearance, line[0][1] / 2 + line[1][1] / 2 + ny * clearance], labelAngle: 0 };
}

function radialParts(context: Resolving, relation: Extract<CadSketchDimensionRelation, { kind: 'radial-size' | 'reference-dimension' }>): readonly Part[] | null {
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
  return [radialPart(center, radius, angle, valueMm, quantity, reference)];
}

function cornerParts(context: Resolving, relation: Extract<CadSketchDimensionRelation, { kind: 'fillet-corner' | 'chamfer-corner' }>): readonly Part[] | null {
  const { graph, points } = context, topology = resolveCadSketchCornerTopology(graph, relation);
  if (relation.kind === 'fillet-corner' && topology.entity.kind === 'arc') {
    const center = points.get(topology.entity.centerPointId), start = points.get(topology.entity.startPointId), end = points.get(topology.entity.endPointId);
    const valueMm = context.value(relation.value);
    if (!center || !start || !end || !Number.isFinite(valueMm)) return null;
    const arc = createArcSegment({ id: topology.entity.id, center, start, end, clockwise: topology.entity.direction === 'cw',
      source: { sourceEntityIndex: 0, sourceEntityType: 'arc', layer: null, exact: true } });
    const radius = arc.radius, angle = arc.startAngleRadians + arc.sweepRadians / 2;
    if (!Number.isFinite(radius) || !Number.isFinite(angle)) return null;
    return [radialPart(center, radius, angle, valueMm, 'radius', false)];
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
    return [alignedPart('setback', valueMm, false, vertex, trim, { x: nx, y: ny }, undefined, side)];
  });
  return sides.length ? sides : null;
}

function pointLineParts(context: Resolving, relation: Extract<CadSketchDimensionRelation, { kind: 'point-line-distance' | 'reference-dimension' }>): readonly Part[] | null {
  const descriptor = relation.kind === 'reference-dimension' ? resolveCadSketchReferenceDimension(context.graph, relation) : relation;
  if (descriptor.kind !== 'point-line-distance') return null;
  const { line } = resolveCadSketchPointLineDistanceOperands(context.graph, descriptor), axis = cadSketchLineDirection(line, context.points), point = context.points.get(descriptor.pointId);
  if (!axis || !point) return null;
  const length = Math.abs(cadSketchSignedPointLineDistance(point, axis)), reference = relation.kind === 'reference-dimension';
  const valueMm = relation.kind === 'reference-dimension' ? length : context.value(relation.value);
  // Every dimension draws at any value, also at 0 with its point on the support.
  if (!Number.isFinite(length) || !Number.isFinite(valueMm)) return null;
  return [pointLinePart(point, axis, valueMm, reference)];
}
/**
 * The perpendicular from the line's support to the point, `shift` along the support when placed there. The support is drawn out to a foot
 * beyond the segment and the point reaches a line moved off it by an extension along the support.
 */
function pointLineGeometry(point: Point2, axis: Support, valueMm: number, mmPerPixel: number, reference: boolean, shift = 0): Omit<LinearDimensionGeometry, 'valueMm'> {
  const signed = cadSketchSignedPointLineDistance(point, axis), length = Math.abs(signed);
  // The dimension line runs from the foot on the support to the point; arrows widen along the support. A dimension that measures
  // zero, its point on the support, is drawn as one a hair long is, without arrows: its text reads square to the support beside the point.
  const foot = { x: point.x + axis.y * signed, y: point.y - axis.x * signed };
  const ux = length === 0 ? -axis.y : (point.x - foot.x) / length, uy = length === 0 ? axis.x : (point.y - foot.y) / length;
  let readX = ux, readY = uy;
  if (readX < -CAD_PRECISION.annotationReadingTie || Math.abs(readX) <= CAD_PRECISION.annotationReadingTie && readY < 0) { readX = -readX; readY = -readY; }
  const box = cadSketchGraphDimensionLabel(valueMm, 'point-line', reference), lift = (box.height / 2 + isoTextGap) * mmPerPixel;
  const headLength = Math.min(ARROW_LENGTH_PIXELS * mmPerPixel, length / 4), headWidth = Math.min(ARROW_HALF_WIDTH_PIXELS * mmPerPixel, length / 8);
  const arrow = (tip: Point2, sign: number): Arrow => [[tip.x, tip.y],
    [tip.x + ux * headLength * sign + axis.x * headWidth, tip.y + uy * headLength * sign + axis.y * headWidth],
    [tip.x + ux * headLength * sign - axis.x * headWidth, tip.y + uy * headLength * sign - axis.y * headWidth]];
  const from = shift ? { x: foot.x + axis.x * shift, y: foot.y + axis.y * shift } : foot, to = shift ? { x: point.x + axis.x * shift, y: point.y + axis.y * shift } : point;
  // Beyond either end of the segment the support is drawn out to the foot, a little past it.
  const along = (from.x - axis.start.x) * axis.x + (from.y - axis.start.y) * axis.y, beyond = 2 * mmPerPixel;
  const extensions: Pair[] = along < 0 ? [[[axis.start.x, axis.start.y], [from.x - axis.x * beyond, from.y - axis.y * beyond]]]
    : along > axis.length ? [[[axis.end.x, axis.end.y], [from.x + axis.x * beyond, from.y + axis.y * beyond]]] : [];
  const clear = 3 * mmPerPixel, toward = shift < 0 ? -1 : 1;
  if (Math.abs(shift) > clear) extensions.push([[point.x + axis.x * toward * clear, point.y + axis.y * toward * clear], [to.x + axis.x * toward * beyond, to.y + axis.y * toward * beyond]]);
  return { line: [[from.x, from.y], [to.x, to.y]], extensions, arrows: length === 0 ? [] : [arrow(from, 1), arrow(to, -1)],
    label: [from.x / 2 + to.x / 2 - readY * lift, from.y / 2 + to.y / 2 + readX * lift], labelAngle: Math.atan2(readY, readX) };
}

/** A dimension found drawable in its graph: its relation and the parts drawn for it. Every check is made before it is returned. */
interface ResolvedDimension { readonly relation: CadSketchDimensionRelation; readonly parts: readonly Part[] }
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
  /** Source point identities, resolved once when a distance from an axis first needs them. */
  identity(pointId: string): string;
}

/** The numeric frame dimensions of `graph` resolve against, or null when it has no extent to draw them in. */
function resolving(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>): Resolving | null {
  const value = (scalar: CadScalar) => { try { return evaluateCadScalar(scalar, parameters); } catch { return NaN; } };
  // The origin and the axis samples resolve as points too, so distances and angles from them draw.
  const points = new CadSketchPositions();
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
  if (!coordinates.length) return null;
  const bounds = coordinates.reduce((box, point) => ({ minX: Math.min(box.minX, point.x), minY: Math.min(box.minY, point.y),
    maxX: Math.max(box.maxX, point.x), maxY: Math.max(box.maxY, point.y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const center: SketchPoint = [bounds.minX / 2 + bounds.maxX / 2, bounds.minY / 2 + bounds.maxY / 2];
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  let identity: ((pointId: string) => string) | undefined;
  return { graph, points, value, center,
    near: point => point.x >= bounds.minX - size && point.x <= bounds.maxX + size && point.y >= bounds.minY - size && point.y <= bounds.maxY + size,
    identity: pointId => (identity ??= resolveCadSketchPointIdentities(graph))(pointId) };
}

/**
 * The parts drawn for one dimension relation, which need not be in the graph yet, or null when it has nothing to attach to. An aligned
 * distance stands off on the side away from the middle of the sketch. It is placed in the frame from its first point to its second, or
 * in `frame` when given; with no length and no frame it takes the sketch X axis, and its extensions are a short leader square to it.
 */
function resolveParts(context: Resolving, relation: CadSketchDimensionRelation, placing = false): readonly Part[] | null {
  const { graph, points, value, center } = context;
  const aligned = (a: Point2, b: Point2, valueMm: number, frame?: Point2): readonly Part[] | null => {
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || !Number.isFinite(valueMm)) return null;
    const { x: ux, y: uy } = frame ?? (length === 0 ? { x: 1, y: 0 } : { x: dx / length, y: dy / length });
    const direction = ux < 0 || ux === 0 && uy < 0 ? -1 : 1;
    let nx = -uy * direction, ny = ux * direction;
    const midpoint: SketchPoint = [a.x / 2 + b.x / 2, a.y / 2 + b.y / 2];
    const outward = (midpoint[0] - center[0]) * nx + (midpoint[1] - center[1]) * ny;
    const tie = Math.abs(outward) <= cadPathClosureTolerance([a, b, { x: center[0], y: center[1] }]);
    if (tie ? Math.abs(ux) >= Math.abs(uy) ? ny > 0 : nx < 0 : outward < 0) { nx = -nx; ny = -ny; }
    return [alignedPart('distance', valueMm, relation.kind === 'reference-dimension', a, b, { x: nx, y: ny }, frame)];
  };
  if (relation.kind === 'fixed-axis') {
    // A distance from an axis runs square to the axis, to its point or to the middle of the line Horizontal or Vertical keeps along the
    // axis, and reads as its size on either side of the axis. Its frame is the direction it measures along on both sides of the axis, so
    // a coordinate a parameter takes through 0 keeps its placement; at 0 its leader runs along the axis it is measured from.
    const line = cadSketchAxisDistanceLine(graph, relation, context.identity), start = line && points.get(line.startPointId), end = line && points.get(line.endPointId);
    const to = start && end ? { x: start.x / 2 + end.x / 2, y: start.y / 2 + end.y / 2 } : points.get(relation.pointId);
    if (!to) return null;
    const foot = relation.axis === 'x' ? { x: 0, y: to.y } : { x: to.x, y: 0 }, measured = relation.axis === 'x' ? { x: 1, y: 0 } : { x: 0, y: 1 };
    return aligned(foot, to, Math.abs(value(relation.value)), measured);
  }
  if (relation.kind === 'line-angle') return angularParts(context, relation, placing);
  if (relation.kind === 'radial-size' || relation.kind === 'reference-dimension' && relation.measurement.kind === 'radial-size') return radialParts(context, relation);
  if (relation.kind === 'fillet-corner' || relation.kind === 'chamfer-corner') return cornerParts(context, relation);
  if (relation.kind === 'point-line-distance' || relation.kind === 'reference-dimension' && relation.measurement.kind === 'point-line-distance') return pointLineParts(context, relation);
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
    return [axisPart(valueMm, a, b, horizontal, tie ? horizontal ? -1 : 1 : outward < 0 ? -1 : 1)];
  }
  return aligned(a, b, valueMm);
}

// A graph's numeric frame is resolved once for its parameters, for the dimensions it draws and for each click a pointer previews on it.
const frames = new WeakMap<CadSketchGraph, WeakMap<Readonly<Record<string, number>>, Resolving | null>>();
function frameOf(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>): Resolving | null {
  let byParameters = frames.get(graph);
  if (!byParameters) frames.set(graph, byParameters = new WeakMap());
  if (!byParameters.has(parameters)) byParameters.set(parameters, resolving(graph, parameters));
  return byParameters.get(parameters) ?? null;
}

/** A part's marks as the layout of its relation. */
function partLayout(relation: CadSketchDimensionRelation, part: Part, marks: Marks): CadSketchGraphDimensionLayout {
  if (part.kind === 'angle') return { kind: 'angle', relation, valueDegrees: part.value, ...marks } as CadSketchGraphDimensionLayout;
  if (part.kind === 'setback') return { kind: 'setback', relation, side: part.side, lineId: (relation as CadSketchCornerRelation).lineIds[part.side!], valueMm: part.value, ...marks } as CadSketchGraphDimensionLayout;
  return { kind: part.kind, relation, valueMm: part.value, ...marks } as CadSketchGraphDimensionLayout;
}
type CadSketchCornerRelation = Extract<CadSketchDimensionRelation, { kind: 'chamfer-corner' }>;
/** A part where its relation placed it, when that placement fits the part; otherwise null and the part lays out automatically. */
function placedMarks(relation: CadSketchDimensionRelation, part: Part, mmPerPixel: number): Marks | null {
  const placement = cadSketchDimensionPlacementOf(relation, part.side ?? 0);
  return placement ? part.at(placement, mmPerPixel) : null;
}

/** The dimensions of one graph that the canvas draws, at every zoom: a dimension is drawn exactly when its relation ID is in `ids`. */
export interface CadSketchDrawnDimensions { readonly graph: CadSketchGraph; readonly ids: ReadonlySet<string> }
interface Resolution { readonly dimensions: readonly ResolvedDimension[]; readonly drawn: CadSketchDrawnDimensions }
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
  const context = relations.length ? frameOf(graph, parameters) : null;
  if (!context) return { dimensions: [], drawn: Object.freeze({ graph, ids: NO_DRAWN_IDS }) };
  const dimensions: ResolvedDimension[] = [], ids = new Set<string>();
  for (const relation of relations) {
    let parts: readonly Part[] | null;
    // Geometry a dimension cannot resolve against, such as a missing line or point identity, leaves out that dimension only.
    try { parts = resolveParts(context, relation); } catch { parts = null; }
    if (parts?.length) { dimensions.push({ relation, parts }); ids.add(relation.id); }
  }
  return { dimensions, drawn: Object.freeze({ graph, ids }) };
}

/**
 * The dimensions the canvas draws for a graph, from the same resolution its layout draws with. Canvas selection, editing, Delete and the
 * viewport's dimension flag act only on these, so a dimension that cannot be drawn is never selected unseen; the relations list still has it.
 */
export function cadSketchDrawnDimensions(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>): CadSketchDrawnDimensions {
  return resolved(graph, parameters).drawn;
}

/**
 * Display-only declared dimensions, the marks of each drawn one at this zoom. Scalar drivers and source IDs remain authoritative. A
 * dimension is drawn where it was placed; one with no placement, or a placement that no longer fits it, is laid out automatically
 * and kept clear of the others.
 */
export function layoutCadSketchGraphDimensions(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>, mmPerPixel: number): readonly CadSketchGraphDimensionLayout[] {
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0) return [];
  const { dimensions } = resolved(graph, parameters);
  if (!dimensions.length) return [];
  const fixed = new Set<CadSketchGraphDimensionLayout>();
  const layouts = dimensions.flatMap(({ relation, parts }) => parts.map(part => {
    const placed = placedMarks(relation, part, mmPerPixel), layout = partLayout(relation, part, placed ?? part.auto(mmPerPixel));
    if (placed) fixed.add(layout);
    return layout;
  }));
  return separateAlignedDimensions(layouts, mmPerPixel, fixed);
}

/** Which drawn part of a dimension a drag holds: its text, or its line, arc or leader. */
export type CadSketchDimensionGrab = 'label' | 'line';
/** One drawn part of a placed dimension as a drag moves it. Every move is arithmetic on the part's resolved frame; nothing solves. */
export interface CadSketchDimensionMove {
  readonly relation: CadSketchDimensionRelation;
  readonly side: 0 | 1;
  /** The part as drawn when the drag began. */
  readonly layout: CadSketchGraphDimensionLayout;
  /** The placement that draws it so. */
  readonly start: CadSketchDimensionPartPlacement;
  /**
   * The placement for the pointer moved from `from` to `to`. The text follows the pointer, which sets both of its components; the line,
   * arc or leader moves only its offset, radius or turn and keeps the text's place along it.
   */
  placementAt(grab: CadSketchDimensionGrab, from: Point2, to: Point2): CadSketchDimensionPartPlacement;
  /** The part's layout at `placement`. */
  layoutAt(placement: CadSketchDimensionPartPlacement): CadSketchGraphDimensionLayout;
  /** The relation storing `placement` for this part. */
  relationAt(placement: CadSketchDimensionPartPlacement): CadSketchDimensionRelation;
}

const placementValues = (placement: CadSketchDimensionPartPlacement) =>
  placement.kind === 'linear' ? [placement.offset, placement.along] : placement.kind === 'angle' ? [placement.radius, placement.along] : [placement.angle, placement.distance];
const samePlacement = (a: CadSketchDimensionPartPlacement, b: CadSketchDimensionPartPlacement) => {
  const first = placementValues(a), second = placementValues(b);
  return a.kind === b.kind && first.every((value, index) => value === second[index]);
};
/** Placements stay within the schema's bounds; one with a value that is not finite is refused. */
function boundedPlacement(placement: CadSketchDimensionPartPlacement): CadSketchDimensionPartPlacement | null {
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
  if (!placementValues(placement).every(Number.isFinite)) return null;
  if (placement.kind === 'linear') return { kind: 'linear', offset: clamp(placement.offset, -CAD_PRECISION.modelExtentMm, CAD_PRECISION.modelExtentMm), along: clamp(placement.along, -1e4, 1e4) };
  if (placement.kind === 'angle') return { kind: 'angle', radius: clamp(placement.radius, CAD_PRECISION.annotationMinimumRadiusMm, CAD_PRECISION.modelExtentMm), along: clamp(placement.along, -1e4, 1e4) };
  return { kind: 'radial', angle: clamp(placement.angle, -Math.PI, Math.PI), distance: clamp(placement.distance, 0, CAD_PRECISION.modelExtentMm) };
}

/**
 * The drag of a drawn dimension part, `side` 1 only for a chamfer's second setback; null when the graph does not draw it. The drag
 * starts from the part as drawn, also where automatic layout moved it clear of others.
 */
export function cadSketchDimensionMove(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>, mmPerPixel: number, relationId: string, side: 0 | 1 = 0): CadSketchDimensionMove | null {
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0) return null;
  const dimension = resolved(graph, parameters).dimensions.find(item => item.relation.id === relationId);
  const part = dimension?.parts.find(item => (item.side ?? 0) === side);
  const layout = part && layoutCadSketchGraphDimensions(graph, parameters, mmPerPixel)
    .find(item => item.relation.id === relationId && (item.kind === 'setback' ? item.side : 0) === side);
  if (!dimension || !part || !layout) return null;
  const { relation } = dimension, stored = cadSketchDimensionPlacementOf(relation, side);
  const marks = layout as Marks, start = stored && part.at(stored, mmPerPixel) ? stored : part.of(marks, mmPerPixel);
  return { relation, side, layout, start,
    placementAt: (grab, from, to) => boundedPlacement(grab === 'label'
      ? part.labelAt({ x: layout.label[0] + to.x - from.x, y: layout.label[1] + to.y - from.y }, mmPerPixel)
      : part.moved(start, from, to, mmPerPixel)) ?? start,
    layoutAt: placement => partLayout(relation, part, part.at(placement, mmPerPixel) ?? part.auto(mmPerPixel)),
    relationAt: placement => withCadSketchDimensionPlacement(relation, side, placement) };
}

/** One drawn part of a dimension being placed, with the marks a placed dimension of its kind has. */
export type CadSketchDimensionPreviewMark = DimensionGeometry & { readonly kind: CadSketchGraphDimensionLayout['kind']; readonly value: number }
  & ({ readonly line: Pair; readonly arc?: undefined } | { readonly line?: undefined; readonly arc: CadSketchDimensionAngleArc });
/** Dimensions one click places: the relations it stores, and the marks its preview draws for their dimensions, part by part in order. */
export interface CadSketchPlacedDimensions<Relation extends CadSketchGraphRelation> { readonly relations: readonly Relation[]; readonly marks: readonly CadSketchDimensionPreviewMark[] }
const NO_MARKS: readonly CadSketchDimensionPreviewMark[] = Object.freeze([]);
/** Label heights a dimension steps out at most to clear the others one click places. */
const MAX_STAGGER_STEPS = 12;

/**
 * `relations` placed by a click at `pointer`, with the marks the preview draws for them from this same placement, so a click stores what
 * its preview drew. Each dimension's line or arc runs through the pointer with its text centred, and a radius or diameter has its text at
 * the pointer. One that would be drawn over another of the click steps out from what it measures, a label height at a time, until it is
 * clear. A chamfer's two setbacks, a dimension with no placement through the pointer and one already placed there are returned as they
 * are, as are other relations such as an implied Parallel. All resolve against `graph` holding them, which they need not be in.
 */
export function placeCadSketchDimensions<Relation extends CadSketchGraphRelation>(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>,
  relations: readonly Relation[], pointer: Point2, mmPerPixel: number): CadSketchPlacedDimensions<Relation> {
  const unplaced: CadSketchPlacedDimensions<Relation> = { relations, marks: NO_MARKS };
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0 || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y) || !relations.some(isCadSketchDimensionRelation)) return unplaced;
  const frame = frameOf(graph, parameters);
  if (!frame) return unplaced;
  const ids = new Set(relations.map(relation => relation.id)), held: CadSketchGraph = { ...graph, relations: [...graph.relations.filter(relation => !ids.has(relation.id)), ...relations] };
  // Point identities follow Coincident relations, which a click does not add, so the graph's own hold unless one is among them.
  let identity: ((pointId: string) => string) | undefined;
  const context: Resolving = relations.some(relation => relation.kind === 'coincident')
    ? { ...frame, graph: held, identity: pointId => (identity ??= resolveCadSketchPointIdentities(held))(pointId) } : { ...frame, graph: held };
  const marks: CadSketchDimensionPreviewMark[] = [], taken: Footprint[] = [];
  const draw = (part: Part, reference: boolean, shown: Marks) => {
    marks.push({ kind: part.kind, value: part.value, ...shown } as CadSketchDimensionPreviewMark);
    taken.push(footprint(part, reference, shown, mmPerPixel));
  };
  const placed = relations.map(relation => {
    if (!isCadSketchDimensionRelation(relation)) return relation;
    let parts: readonly Part[] | null = null;
    try { parts = resolveParts(context, relation, true); } catch { /* A dimension that cannot resolve keeps its automatic layout. */ }
    if (!parts?.length) return relation;
    const reference = relation.kind === 'reference-dimension', part = parts.length === 1 ? parts[0] : null;
    const start = part && boundedPlacement(part.through(pointer, mmPerPixel)), through = part && start && part.at(start, mmPerPixel);
    if (!part || !start || !through) {
      for (const each of parts) draw(each, reference, placedMarks(relation, each, mmPerPixel) ?? each.auto(mmPerPixel));
      return relation;
    }
    let placement = start, shown = through;
    const pitch = (cadSketchGraphDimensionLabel(part.value, part.kind, reference).height + 8) * mmPerPixel;
    for (let step = 1; step <= MAX_STAGGER_STEPS; step++) {
      const at = footprint(part, reference, shown, mmPerPixel);
      if (!taken.some(other => clashes(at, other, 4 * mmPerPixel))) break;
      const next = boundedPlacement(part.outward(start, step * pitch)), stepped = next && part.at(next, mmPerPixel);
      if (!next || !stepped) break;
      placement = next; shown = stepped;
    }
    draw(part, reference, shown);
    // A dimension already where the click puts it is the relation itself, so placing it again edits nothing.
    const stored = cadSketchDimensionPlacementOf(relation, part.side ?? 0);
    return stored && samePlacement(stored, placement) ? relation : withCadSketchDimensionPlacement(relation, part.side ?? 0, placement) as Relation;
  });
  return { relations: placed, marks };
}

/** A drawn part's text as a box turned with it, in millimetres about its centre. */
interface Footprint { readonly x: number; readonly y: number; readonly cos: number; readonly sin: number; readonly halfWidth: number; readonly halfHeight: number }
function footprint(part: Part, reference: boolean, marks: Marks, mmPerPixel: number): Footprint {
  const { width, height } = cadSketchGraphDimensionLabel(part.value, part.kind, reference);
  return { x: marks.label[0], y: marks.label[1], cos: Math.cos(marks.labelAngle), sin: Math.sin(marks.labelAngle),
    halfWidth: width * mmPerPixel / 2, halfHeight: height * mmPerPixel / 2 };
}
/** Whether two parts' texts come within `margin` of each other. */
function clashes(a: Footprint, b: Footprint, margin: number): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const reach = (box: Footprint, ax: number, ay: number) => box.halfWidth * Math.abs(box.cos * ax + box.sin * ay) + box.halfHeight * Math.abs(box.cos * ay - box.sin * ax);
  // Two turned boxes are apart when a side of either separates them.
  return ![[a.cos, a.sin], [-a.sin, a.cos], [b.cos, b.sin], [-b.sin, b.cos]].some(([ax, ay]) => Math.abs(dx * ax + dy * ay) >= reach(a, ax, ay) + reach(b, ax, ay) + margin);
}
