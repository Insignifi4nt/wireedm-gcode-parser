import { nearestPointOnSegment } from '@/domain/path-editor/pathPointInference';
import { classifyPathSegmentIntersection } from '@/domain/path-intel/intersections';
import { arcParameterAtAngle, distance, pointOnArcAtParameter, pointOnCircle } from '@/domain/path-intel/segments';
import type { PathSegment, Point2 } from '@/domain/path-intel/types';

type CircularSegment = Exclude<PathSegment, { kind: 'line' }>;
export interface FeatureMeasurement {
  distance: number;
  first: Point2;
  second: Point2;
  centerDistance: number | null;
}

/** Exact finite boundary distance, not filled-area clearance or a sampled polyline.
 * A minimum is an intersection, an endpoint projection, or an interior stationary
 * pair. Circular stationary pairs lie on the center axis; line/circle pairs lie
 * on a line normal. Concentric circular boundaries are covered by endpoint
 * projections (plus a representative point for full circles).
 */
export function measureFeaturePair(first: PathSegment, second: PathSegment): FeatureMeasurement | null {
  if (!validFeature(first) || !validFeature(second)) return null;
  const centerDistance = first.kind !== 'line' && second.kind !== 'line'
    ? distance(first.center, second.center) : null;
  let best: FeatureMeasurement | null = null;
  function consider(a: Point2, b: Point2) {
    const separation = distance(a, b);
    if (Number.isFinite(separation) && (!best || separation < best.distance)) {
      best = { distance: separation, first: a, second: b, centerDistance };
    }
  }
  // No machining coincidence tolerance: a small physical gap remains a gap.
  const intersection = classifyPathSegmentIntersection(first, second, 0);
  for (const point of intersection.points) consider(point, point);
  for (const point of boundaryPoints(first)) consider(point, nearest(second, point));
  for (const point of boundaryPoints(second)) consider(nearest(first, point), point);

  if (first.kind !== 'line' && second.kind !== 'line') {
    const angle = Math.atan2(second.center.y - first.center.y, second.center.x - first.center.x);
    for (const a of radialPoints(first, angle)) {
      for (const b of radialPoints(second, angle)) consider(a, b);
    }
  } else if (first.kind === 'line' && second.kind !== 'line') {
    const normal = Math.atan2(first.end.y - first.start.y, first.end.x - first.start.x) + Math.PI / 2;
    for (const point of radialPoints(second, normal)) consider(nearest(first, point), point);
  } else if (first.kind !== 'line' && second.kind === 'line') {
    const normal = Math.atan2(second.end.y - second.start.y, second.end.x - second.start.x) + Math.PI / 2;
    for (const point of radialPoints(first, normal)) consider(point, nearest(second, point));
  }
  return best;
}

function boundaryPoints(segment: PathSegment): Point2[] {
  return segment.kind === 'circle'
    ? [pointOnCircle(segment.center, segment.radius, 0)] : [segment.start, segment.end];
}

function radialPoints(segment: CircularSegment, angle: number): Point2[] {
  return [angle, angle + Math.PI].flatMap((candidate) => {
    if (segment.kind === 'circle') return [pointOnCircle(segment.center, segment.radius, candidate)];
    const ref = { segmentId: segment.id, reversed: false };
    const parameter = arcParameterAtAngle(segment, ref, candidate);
    return parameter === null ? [] : [pointOnArcAtParameter(segment, ref, parameter)];
  });
}

function nearest(segment: PathSegment, point: Point2): Point2 {
  return nearestPointOnSegment(segment, { segmentId: segment.id, reversed: false }, point).point;
}

function validFeature(segment: PathSegment): boolean {
  const finite = (point: Point2) => Number.isFinite(point.x) && Number.isFinite(point.y);
  if (!finite(segment.start) || !finite(segment.end) || !Number.isFinite(segment.length)) return false;
  if (segment.kind === 'line') return true;
  return finite(segment.center) && Number.isFinite(segment.radius) && segment.radius >= 0 &&
    (segment.kind === 'circle' || (Number.isFinite(segment.startAngleRadians) &&
      Number.isFinite(segment.sweepRadians) && Math.abs(segment.sweepRadians) <= Math.PI * 2));
}
