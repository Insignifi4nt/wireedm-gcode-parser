import {
  orientedArcClockwise,
  orientedSegmentEnd,
  orientedSegmentStart
} from '@/domain/path-intel/segments';
import type { OrientedSegmentRef, PathSegment, Point2 } from '@/domain/path-intel/types';

export interface OrientedEndpointTangents {
  start: Point2;
  end: Point2;
}

export function orientedEndpointTangents(
  segment: PathSegment,
  ref: OrientedSegmentRef
): OrientedEndpointTangents | null {
  if (segment.kind === 'line') {
    const start = orientedSegmentStart(segment, ref);
    const end = orientedSegmentEnd(segment, ref);
    const tangent = strictUnitVector({ x: end.x - start.x, y: end.y - start.y });
    return tangent ? { start: tangent, end: tangent } : null;
  }

  if (!Number.isFinite(segment.radius) || segment.radius <= 0) return null;
  const start = circularTangent(
    orientedSegmentStart(segment, ref),
    segment.center,
    segment.kind === 'circle' ? ref.reversed : orientedArcClockwise(segment, ref)
  );
  const end = circularTangent(
    orientedSegmentEnd(segment, ref),
    segment.center,
    segment.kind === 'circle' ? ref.reversed : orientedArcClockwise(segment, ref)
  );
  return start && end ? { start, end } : null;
}

function circularTangent(point: Point2, center: Point2, clockwise: boolean) {
  const radial = strictUnitVector({ x: point.x - center.x, y: point.y - center.y });
  if (!radial) return null;
  return clockwise
    ? canonicalPoint({ x: radial.y, y: -radial.x })
    : canonicalPoint({ x: -radial.y, y: radial.x });
}

function strictUnitVector(vector: Point2): Point2 | null {
  const scale = Math.max(Math.abs(vector.x), Math.abs(vector.y));
  if (!Number.isFinite(scale) || scale === 0) return null;
  const x = vector.x / scale;
  const y = vector.y / scale;
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length === 0) return null;
  return canonicalPoint({ x: x / length, y: y / length });
}

function canonicalPoint(point: Point2): Point2 {
  return {
    x: Object.is(point.x, -0) ? 0 : point.x,
    y: Object.is(point.y, -0) ? 0 : point.y
  };
}
