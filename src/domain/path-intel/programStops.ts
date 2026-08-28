import {
  orientedCircleClockwise,
  orientedSegmentEnd,
  orientedSegmentStart,
  pointOnArcAtParameter,
  pointOnCircle,
  pathCutLength,
  requiredSegment,
  segmentMap
} from './segments';
import type {
  OperationProgramStop,
  PathOperation,
  PathPlanningDocument,
  Point2
} from './types';

export function resolveProgramStopPoints(
  document: PathPlanningDocument,
  operationId: string
):
  | {
      status: 'ready';
      stops: Array<{
        id: string;
        placement: 'before-operation-end';
        point: Point2;
        remainingCutLengthMm: number;
      }>;
    }
  | { status: 'blocked'; reason: 'operation-not-found' | 'invalid-program-stop' } {
  const operation = document.plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation) return { status: 'blocked', reason: 'operation-not-found' };
  const requested = (operation.programStops ?? []).filter(
    (stop) => stop.enabled && stop.placement.kind === 'before-operation-end'
  );
  const segmentsById = segmentMap(document.segments);
  const total = pathCutLength(operation.segmentRefs, segmentsById);
  const stops = [];
  for (const stop of requested) {
    if (stop.placement.kind !== 'before-operation-end') continue;
    const remaining = stop.placement.remainingCutLengthMm;
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining >= total) {
      return { status: 'blocked', reason: 'invalid-program-stop' };
    }
    let distanceFromStart = total - remaining;
    let point: Point2 | null = null;
    for (const ref of operation.segmentRefs) {
      const segment = requiredSegment(segmentsById, ref.segmentId);
      if (distanceFromStart <= segment.length) {
        point = pointAtParameter(segment, ref, distanceFromStart / segment.length);
        break;
      }
      distanceFromStart -= segment.length;
    }
    if (!point) return { status: 'blocked', reason: 'invalid-program-stop' };
    stops.push({
      id: stop.id,
      placement: 'before-operation-end' as const,
      point,
      remainingCutLengthMm: remaining
    });
  }
  return { status: 'ready', stops };
}

function pointAtParameter(
  segment: PathPlanningDocument['segments'][number],
  ref: PathOperation['segmentRefs'][number],
  parameter: number
) {
  const clamped = Math.min(1, Math.max(0, parameter));
  if (segment.kind === 'line') {
    const start = orientedSegmentStart(segment, ref);
    const end = orientedSegmentEnd(segment, ref);
    return {
      x: start.x + (end.x - start.x) * clamped,
      y: start.y + (end.y - start.y) * clamped
    };
  }
  if (segment.kind === 'arc') return pointOnArcAtParameter(segment, ref, clamped);
  const start = orientedSegmentStart(segment, ref);
  const startAngle = Math.atan2(start.y - segment.center.y, start.x - segment.center.x);
  const direction = orientedCircleClockwise(segment, ref) ? -1 : 1;
  return pointOnCircle(segment.center, segment.radius, startAngle + direction * Math.PI * 2 * clamped);
}
