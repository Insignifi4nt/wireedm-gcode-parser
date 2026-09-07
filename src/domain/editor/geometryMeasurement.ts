import { nearestPointOnSegment } from '@/domain/path-editor/pathPointInference';
import { distance, pointOnArcAtParameter } from '@/domain/path-intel/segments';
import type { PathSegment, Point2 } from '@/domain/path-intel/types';

export type MeasurementSnapKind = 'endpoint' | 'midpoint' | 'center' | 'quadrant' | 'nearest';

export type MeasurementPick =
  | { kind: 'free'; point: Point2 }
  | { kind: 'geometry'; point: Point2; segmentId: string; snap: MeasurementSnapKind };

/** Semantic points win over edge projections, but only inside the visible pick radius. */
export function pickMeasurementPoint({
  segments,
  cursor,
  worldUnitsPerPixel,
  snapEnabled = true,
  radiusPixels = 10
}: {
  segments: readonly PathSegment[];
  cursor: Point2;
  worldUnitsPerPixel: number;
  snapEnabled?: boolean;
  radiusPixels?: number;
}): MeasurementPick | null {
  if (!finitePoint(cursor)) return null;
  const free: MeasurementPick = { kind: 'free', point: { ...cursor } };
  if (!snapEnabled || !Number.isFinite(worldUnitsPerPixel) || worldUnitsPerPixel <= 0 ||
      !Number.isFinite(radiusPixels) || radiusPixels <= 0) return free;
  const radius = worldUnitsPerPixel * radiusPixels;
  let best: Extract<MeasurementPick, { kind: 'geometry' }> | null = null;
  let bestDistance = Infinity;
  let bestPriority = Infinity;

  for (const segment of segments) {
    for (const candidate of segmentSnapPoints(segment, cursor)) {
      const separation = distance(candidate.point, cursor);
      const priority = candidate.snap === 'nearest' ? 1 : 0;
      if (!Number.isFinite(separation) || separation > radius) continue;
      if (priority > bestPriority || (priority === bestPriority && separation >= bestDistance)) continue;
      best = { kind: 'geometry', segmentId: segment.id, ...candidate };
      bestDistance = separation;
      bestPriority = priority;
    }
  }
  return best ?? free;
}

function segmentSnapPoints(segment: PathSegment, cursor: Point2): Array<{
  snap: MeasurementSnapKind;
  point: Point2;
}> {
  const ref = { segmentId: segment.id, reversed: false };
  const points: Array<{ snap: MeasurementSnapKind; point: Point2 }> = [];
  if (segment.kind !== 'circle') {
    points.push({ snap: 'endpoint', point: segment.start }, { snap: 'endpoint', point: segment.end });
    points.push({
      snap: 'midpoint',
      point: segment.kind === 'arc'
        ? pointOnArcAtParameter(segment, ref, 0.5)
        : { x: (segment.start.x + segment.end.x) / 2, y: (segment.start.y + segment.end.y) / 2 }
    });
  }
  if (segment.kind !== 'line') {
    points.push({ snap: 'center', point: segment.center });
    if (segment.kind === 'circle') {
      const { center, radius } = segment;
      points.push(
        { snap: 'quadrant', point: { x: center.x + radius, y: center.y } },
        { snap: 'quadrant', point: { x: center.x - radius, y: center.y } },
        { snap: 'quadrant', point: { x: center.x, y: center.y + radius } },
        { snap: 'quadrant', point: { x: center.x, y: center.y - radius } }
      );
    }
  }
  points.push({ snap: 'nearest', point: nearestPointOnSegment(segment, ref, cursor).point });
  return points;
}

export function measurePointPair(first: Point2, second: Point2) {
  if (!finitePoint(first) || !finitePoint(second)) return null;
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length)) return null;
  return {
    distance: length,
    dx,
    dy,
    angleDegrees: length === 0 ? null : Math.atan2(dy, dx) * 180 / Math.PI
  };
}

export function measureSegment(segment: PathSegment) {
  if (segment.kind === 'line') {
    return { kind: 'line', length: segment.length } as const;
  }
  const circular = { length: segment.length, radius: segment.radius, diameter: segment.radius * 2 };
  if (segment.kind === 'arc') {
    return { kind: 'arc', ...circular, sweepDegrees: Math.abs(segment.sweepRadians) * 180 / Math.PI } as const;
  }
  return { kind: 'circle', ...circular, area: Math.PI * segment.radius ** 2 } as const;
}

function finitePoint(point: Point2) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
