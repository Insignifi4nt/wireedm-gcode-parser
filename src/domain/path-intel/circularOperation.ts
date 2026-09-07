import { orientedArcSweep, orientedSegmentEnd, orientedSegmentStart, pointsEqual } from './segments';
import type { PathOperation, PathSegment } from './types';

/** A complete, continuous circle, including a circle represented by split arcs. */
export function circularOperationSource({ operation, segments, epsilon }: {
  operation: Pick<PathOperation, 'closed' | 'segmentRefs'>;
  segments: ReadonlyMap<string, PathSegment>;
  epsilon: number;
}) {
  if (!operation.closed || operation.segmentRefs.length === 0) return null;
  const firstRef = operation.segmentRefs[0];
  const first = segments.get(firstRef.segmentId);
  if (!first || first.kind === 'line' || !Number.isFinite(first.radius) || first.radius <= 0) return null;
  let sweep = 0;
  for (let index = 0; index < operation.segmentRefs.length; index++) {
    const ref = operation.segmentRefs[index];
    const nextRef = operation.segmentRefs[(index + 1) % operation.segmentRefs.length];
    const segment = segments.get(ref.segmentId);
    const next = segments.get(nextRef.segmentId);
    if (!segment || !next || segment.kind === 'line' ||
      !pointsEqual(segment.center, first.center, epsilon) || Math.abs(segment.radius - first.radius) > epsilon ||
      !pointsEqual(orientedSegmentEnd(segment, ref), orientedSegmentStart(next, nextRef), epsilon)) return null;
    const segmentSweep = segment.kind === 'circle'
      ? (ref.reversed ? -1 : 1) * Math.PI * 2 : orientedArcSweep(segment, ref);
    if (!Number.isFinite(segmentSweep) || (sweep !== 0 && Math.sign(sweep) !== Math.sign(segmentSweep))) return null;
    sweep += segmentSweep;
  }
  if (Math.abs(Math.abs(sweep) - Math.PI * 2) > Math.max(Number.EPSILON * 64, epsilon / first.radius)) return null;
  return { center: { ...first.center }, radius: first.radius, segmentId: first.id };
}
