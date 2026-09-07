import { classifyPathSegmentIntersection } from './intersections';
import { createLineSegment, pointsEqual } from './segments';
import type { PathSegment, Point2 } from './types';

/** Source-geometry intersections, excluding the intended contour attachment. */
export function findLeadIntersections(
  from: Point2,
  to: Point2,
  attachment: Point2,
  segments: readonly PathSegment[],
  epsilon: number
): { segmentId: string; kind: 'crossing' | 'overlap' }[] {
  return findSourceIntersections(from, to, [attachment], segments, epsilon);
}

/** Source contacts along a positioning route; either endpoint may be an intended attachment. */
export function findPositioningIntersections(
  from: Point2,
  to: Point2,
  segments: readonly PathSegment[],
  epsilon: number
): { segmentId: string; kind: 'crossing' | 'overlap' }[] {
  return findSourceIntersections(from, to, [from, to], segments, epsilon);
}

function findSourceIntersections(
  from: Point2,
  to: Point2,
  attachments: readonly Point2[],
  segments: readonly PathSegment[],
  epsilon: number
): { segmentId: string; kind: 'crossing' | 'overlap' }[] {
  if (!segments.length || pointsEqual(from, to, epsilon)) return [];
  const lead = createLineSegment({ id: 'lead-inspection', source: segments[0].source, start: from, end: to });
  return segments.flatMap<{ segmentId: string; kind: 'crossing' | 'overlap' }>((segment) => {
    const intersection = classifyPathSegmentIntersection(lead, segment, epsilon);
    if (intersection.kind === 'overlap') return [{ segmentId: segment.id, kind: 'overlap' as const }];
    if (intersection.points.some((point) => !attachments.some((attachment) => pointsEqual(point, attachment, epsilon)))) {
      return [{ segmentId: segment.id, kind: 'crossing' as const }];
    }
    return [];
  });
}
