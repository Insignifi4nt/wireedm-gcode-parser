import { CadError } from './cadError';
import { cadOrderedCurveEntities, cadPathClosureTolerance, type CadOrderedCurveEntity } from './cadAnalyticSegments';
import type { CadResolvedCurve } from './cadCurve';
import type { ResolvedCadProfile } from './cadSketchGeometry';
import { cadProfileToEntities } from './cadSketchGeometry';
import { angleIsOnSweep, nextDown, nextUp } from '../path-intel/segments';
import { classifyPathSegmentIntersection } from '../path-intel/intersections';
import type { Bounds2, PathSegment, Point2 } from '../path-intel/types';

export const CAD_SWEEP_NATIVE_PRECISION = 1e-7;
export const CAD_SWEEP_TOPOLOGY_TOLERANCE = 2e-7;
const roundingFactor = 64;
const tau = Math.PI * 2;
type Edge = CadOrderedCurveEntity;
export interface CadSweepClearance {
  readonly profileRadiusMm: number;
  readonly enclosingRadiusMm: number;
  readonly toleranceMm: number;
  readonly transportUncertaintyMm: number;
  readonly minimumRadiusMarginMm: number | null;
  /** Lower bound among broadphase-tested pairs; excluded pairs are safely separated. */
  readonly minimumTestedSeparationMm: number | null;
  readonly envelopeEdgeCount: number;
}
const distance = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);
const point = (x: number, y: number): Point2 => ({ x, y });
function at(edge: Extract<Edge, { type: 'arc' }>, angle: number): Point2 {
  return point(edge.center.x + edge.radius * Math.cos(angle), edge.center.y + edge.radius * Math.sin(angle));
}
function arc(center: Point2, radius: number, startAngle: number, sweepRadians: number): Edge {
  const partial = { type: 'arc' as const, layer: 'SWEEP_CLEARANCE', center, radius, startAngle, endAngle: startAngle + sweepRadians, sweepRadians, clockwise: sweepRadians < 0 };
  return { ...partial, start: at({ ...partial, start: center, end: center }, startAngle), end: at({ ...partial, start: center, end: center }, startAngle + sweepRadians) };
}
function onArc(edge: Extract<Edge, { type: 'arc' }>, angle: number, band = 0): boolean {
  return angleIsOnSweep(angle, edge.startAngle, edge.sweepRadians ?? edge.endAngle - edge.startAngle,
    32 * Number.EPSILON * tau + band / edge.radius);
}
function tangent(edge: Edge, end = false): readonly [number, number] {
  if (edge.type === 'line') {
    const x = edge.end.x - edge.start.x; const y = edge.end.y - edge.start.y; const length = Math.hypot(x, y);
    return [x / length, y / length];
  }
  const angle = end ? edge.endAngle : edge.startAngle; const sign = edge.clockwise ? -1 : 1;
  return [-Math.sin(angle) * sign, Math.cos(angle) * sign];
}

/** Outward bound about the actual rail station. Arc extrema use explicit support. */
export function cadSweepProfileRadius(profile: ResolvedCadProfile, origin: Point2): number {
  if (profile.kind === 'circle') return nextUp(nextUp(Math.hypot(profile.x - origin.x, profile.y - origin.y) + profile.radius));
  const entities = profile.kind === 'path' ? cadOrderedCurveEntities(profile.segments) : cadProfileToEntities(profile);
  let radius = 0;
  for (const entity of entities) {
    if (entity.type === 'circle') { radius = Math.max(radius, Math.hypot(entity.center.x - origin.x, entity.center.y - origin.y) + entity.radius); continue; }
    if (entity.type !== 'line' && entity.type !== 'arc') throw new CadError('unsupported-sweep-section', 'Sweep sections require analytic line and circular boundaries.');
    radius = Math.max(radius, distance(entity.start, origin), distance(entity.end, origin));
    if (entity.type === 'arc') {
      const angle = Math.atan2(entity.center.y - origin.y, entity.center.x - origin.x);
      if (onArc(entity, angle)) radius = Math.max(radius, Math.hypot(entity.center.x - origin.x, entity.center.y - origin.y) + entity.radius);
    }
  }
  return nextUp(nextUp(radius));
}

function edgeBounds(edge: Edge, padding = 0): Bounds2 {
  let minX = Math.min(edge.start.x, edge.end.x); let minY = Math.min(edge.start.y, edge.end.y);
  let maxX = Math.max(edge.start.x, edge.end.x); let maxY = Math.max(edge.start.y, edge.end.y);
  if (edge.type === 'arc') {
    for (const [angle, x, y] of [[0, edge.center.x + edge.radius, edge.center.y], [Math.PI / 2, edge.center.x, edge.center.y + edge.radius],
      [Math.PI, edge.center.x - edge.radius, edge.center.y], [3 * Math.PI / 2, edge.center.x, edge.center.y - edge.radius]]) {
      if (onArc(edge, angle, padding)) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    }
  }
  return { minX: nextDown(minX - padding), minY: nextDown(minY - padding), maxX: nextUp(maxX + padding), maxY: nextUp(maxY + padding) };
}
function segment(edge: Edge, index: number): PathSegment {
  const common = { id: String(index), source: { sourceEntityIndex: index, sourceEntityType: edge.type, layer: null, exact: true }, layer: null, bounds: edgeBounds(edge), start: edge.start, end: edge.end };
  return edge.type === 'line' ? { ...common, kind: 'line', length: distance(edge.start, edge.end) }
    : { ...common, kind: 'arc', center: edge.center, radius: edge.radius, startAngleRadians: edge.startAngle,
      endAngleRadians: edge.endAngle, sweepRadians: edge.sweepRadians ?? edge.endAngle - edge.startAngle, clockwise: !!edge.clockwise,
      length: edge.radius * Math.abs(edge.sweepRadians ?? edge.endAngle - edge.startAngle) };
}
function pointLineDistance(p: Point2, edge: Extract<Edge, { type: 'line' }>): number {
  const x = edge.end.x - edge.start.x; const y = edge.end.y - edge.start.y; const length = Math.hypot(x, y);
  const parameter = Math.max(0, Math.min(length, (p.x - edge.start.x) * x / length + (p.y - edge.start.y) * y / length));
  return Math.hypot(p.x - edge.start.x - parameter * x / length, p.y - edge.start.y - parameter * y / length);
}
function pointEdgeDistance(p: Point2, edge: Edge, band: number): number {
  if (edge.type === 'line') return pointLineDistance(p, edge);
  const dx = p.x - edge.center.x; const dy = p.y - edge.center.y; const radial = Math.hypot(dx, dy);
  const endpoints = Math.min(distance(p, edge.start), distance(p, edge.end));
  return radial <= band || onArc(edge, Math.atan2(dy, dx), band) ? Math.min(endpoints, Math.abs(radial - edge.radius)) : endpoints;
}

/** Finite stationary-point distance enumeration; subtract the arithmetic band. */
export function cadSweepEdgeDistanceLowerBound(first: Edge, second: Edge, band: number): number {
  if (!Number.isFinite(band) || band < 0) throw new CadError('unsupported-sweep-precision', 'Invalid sweep comparison precision.');
  if (classifyPathSegmentIntersection(segment(first, 0), segment(second, 1), band).kind !== 'none') return 0;
  let minimum = Math.min(pointEdgeDistance(first.start, second, band), pointEdgeDistance(first.end, second, band),
    pointEdgeDistance(second.start, first, band), pointEdgeDistance(second.end, first, band));
  if (first.type === 'line' || second.type === 'line') {
    const line = first.type === 'line' ? first : second; const circle = first.type === 'arc' ? first : second;
    if (line.type === 'line' && circle.type === 'arc') {
      const x = line.end.x - line.start.x; const y = line.end.y - line.start.y; const length = Math.hypot(x, y);
      for (const sign of [-1, 1]) {
        const angle = Math.atan2(sign * x / length, -sign * y / length);
        if (onArc(circle, angle, band)) minimum = Math.min(minimum, pointLineDistance(at(circle, angle), line));
      }
    }
  } else {
    const dx = second.center.x - first.center.x; const dy = second.center.y - first.center.y; const centerDistance = Math.hypot(dx, dy);
    // A support-circle lower bound also handles concentric/nested offsets without division.
    const supportLower = Math.max(0, centerDistance - first.radius - second.radius, Math.abs(first.radius - second.radius) - centerDistance);
    if (supportLower > band) return nextDown(Math.max(0, supportLower - band));
    if (centerDistance <= band) return 0; // Direction is uncertain; refuse to guess an angular correspondence.
    const angle = Math.atan2(dy, dx);
    for (const a of [angle, angle + Math.PI]) for (const b of [angle, angle + Math.PI]) {
      if (onArc(first, a, band) && onArc(second, b, band)) minimum = Math.min(minimum, distance(at(first, a), at(second, b)));
    }
  }
  return nextDown(Math.max(0, minimum - band));
}

function envelope(curve: CadResolvedCurve, radius: number): readonly Edge[] {
  const offsets = (side: number) => curve.entities.map((edge): Edge => {
    if (edge.type === 'arc') return arc(edge.center, edge.radius - (edge.clockwise ? -1 : 1) * side * radius, edge.startAngle, edge.sweepRadians ?? edge.endAngle - edge.startAngle);
    const t = tangent(edge); const dx = -t[1] * side * radius; const dy = t[0] * side * radius;
    return { ...edge, start: point(edge.start.x + dx, edge.start.y + dy), end: point(edge.end.x + dx, edge.end.y + dy) };
  });
  const left = offsets(1); const right = offsets(-1).reverse().map((edge): Edge => edge.type === 'line' ? { ...edge, start: edge.end, end: edge.start }
    : arc(edge.center, edge.radius, edge.endAngle, -(edge.sweepRadians ?? edge.endAngle - edge.startAngle)));
  const first = curve.entities[0]; const last = curve.entities[curve.entities.length - 1];
  const endT = tangent(last, true); const startT = tangent(first);
  return [...left, arc(last.end, radius, Math.atan2(endT[0], -endT[1]), -Math.PI), ...right,
    arc(first.start, radius, Math.atan2(-startT[0], startT[1]), -Math.PI)];
}

/** Conservative precision scope for exact prism/revolve transport, not a formal interval proof. */
export function resolveCadSweepClearance(curve: CadResolvedCurve, profileRadiusMm: number, sectionScale: number, initialUncertaintyMm = 0, worldScaleMm = 0): CadSweepClearance {
  if (!Number.isFinite(profileRadiusMm) || profileRadiusMm <= 0 || !Number.isFinite(sectionScale) || !Number.isFinite(initialUncertaintyMm) || initialUncertaintyMm < 0 || !Number.isFinite(worldScaleMm) || worldScaleMm < 0) {
    throw new CadError('unsupported-sweep-precision', 'Sweep dimensions and uncertainty must be finite positive measurements.');
  }
  let scale = Math.max(1, profileRadiusMm, sectionScale, Math.abs(curve.offset), worldScaleMm); let accumulated = initialUncertaintyMm;
  for (let index = 0; index < curve.entities.length; index++) {
    const edge = curve.entities[index];
    const edgeScale = Math.max(1, sectionScale, Math.abs(curve.offset), worldScaleMm, Math.abs(edge.start.x), Math.abs(edge.start.y), Math.abs(edge.end.x), Math.abs(edge.end.y), profileRadiusMm,
      ...(edge.type === 'arc' ? [Math.abs(edge.center.x), Math.abs(edge.center.y), edge.radius] : []));
    scale = Math.max(scale, edgeScale);
    accumulated += roundingFactor * Number.EPSILON * edgeScale;
    if (index > 0) {
      const previous = curve.entities[index - 1]; const a = tangent(previous, true); const b = tangent(edge);
      const residual = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (a[0] * b[0] + a[1] * b[1] <= 0 || residual > roundingFactor * Number.EPSILON) {
        throw new CadError('unsupported-sweep-corner', `Curve joint ${index} must have the same tangent direction. Sweep does not choose a sharp-corner transition.`);
      }
      accumulated += distance(previous.end, edge.start) + profileRadiusMm * residual;
    }
  }
  const band = Math.max(CAD_SWEEP_TOPOLOGY_TOLERANCE, roundingFactor * Number.EPSILON * scale);
  if (!Number.isFinite(profileRadiusMm) || profileRadiusMm <= 0 || accumulated > CAD_SWEEP_NATIVE_PRECISION) {
    throw new CadError('unsupported-sweep-precision', 'The sweep cannot follow this curve precisely enough. Move the sketch and curve nearer the origin or simplify the curve.');
  }
  const radius = nextUp(profileRadiusMm + 4 * band);
  let radiusMargin = Infinity;
  for (let index = 0; index < curve.entities.length; index++) {
    const edge = curve.entities[index]; const length = edge.type === 'line' ? distance(edge.start, edge.end) : edge.radius * Math.abs(edge.sweepRadians ?? edge.endAngle - edge.startAngle);
    if (length <= 8 * band) throw new CadError('unsupported-sweep-precision', `Curve edge ${index + 1} is too short for the sweep precision. Lengthen or remove this edge.`);
    if (edge.type === 'arc') {
      radiusMargin = Math.min(radiusMargin, edge.radius - radius);
      if (edge.radius - radius <= 4 * band) throw new CadError('unsupported-sweep-clearance', `Curve arc ${index + 1} (radius ${+edge.radius.toFixed(4)} mm) is too tight for a section reaching ${+profileRadiusMm.toFixed(4)} mm from the curve. Use a larger arc radius or a smaller section.`);
    }
    if (index === 0) continue;
    const previous = curve.entities[index - 1]; const a = tangent(previous, true); const b = tangent(edge);
    const angularResidual = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (a[0] * b[0] + a[1] * b[1] <= 0 || angularResidual > roundingFactor * Number.EPSILON || radius * angularResidual > band) {
      throw new CadError('unsupported-sweep-corner', `Curve joint ${index} must have the same tangent direction. Sweep does not choose a sharp-corner transition.`);
    }
  }
  const edges = envelope(curve, radius); const paths = edges.map(segment);
  for (let index = 0; index < edges.length; index++) {
    const end = edges[index].end; const start = edges[(index + 1) % edges.length].start;
    if (distance(end, start) > cadPathClosureTolerance([end, start])) throw new CadError('unsupported-sweep-precision', `Sweep offset joint ${index + 1} does not close at the authored precision. Repair the curve's tangent or position.`);
  }
  const entries = edges.map((edge, index) => ({ index, ...edgeBounds(edge, 4 * band) })).sort((a, b) => a.minX - b.minX || a.index - b.index);
  let active: typeof entries = []; let separation = Infinity;
  for (const entry of entries) {
    active = active.filter(other => other.maxX >= entry.minX);
    for (const other of active) {
      if (other.maxY < entry.minY || entry.maxY < other.minY) continue;
      const a = other.index; const b = entry.index; const adjacent = Math.abs(a - b) === 1 || Math.abs(a - b) === edges.length - 1;
      if (adjacent) {
        const joint = (a + 1) % edges.length === b ? edges[a].end : edges[b].end;
        const relation = classifyPathSegmentIntersection(paths[a], paths[b], 0);
        if (relation.kind === 'overlap' || relation.kind === 'points' && relation.points.some(p => distance(p, joint) > cadPathClosureTolerance([p, joint]))) {
          throw new CadError('unsupported-sweep-clearance', `Sweep envelope edges ${a + 1} and ${b + 1} intersect beyond their shared joint.`);
        }
      } else {
        const lower = cadSweepEdgeDistanceLowerBound(edges[a], edges[b], band); separation = Math.min(separation, lower);
        if (lower <= 4 * band) throw new CadError('unsupported-sweep-clearance', `The swept outline would touch itself near curve edges ${a + 1} and ${b + 1}. Reduce the section or move those parts of the curve apart.`);
      }
    }
    active.push(entry);
  }
  return Object.freeze({ profileRadiusMm, enclosingRadiusMm: radius, toleranceMm: band, transportUncertaintyMm: accumulated,
    minimumRadiusMarginMm: Number.isFinite(radiusMargin) ? radiusMargin : null, minimumTestedSeparationMm: Number.isFinite(separation) ? separation : null, envelopeEdgeCount: edges.length });
}
