import { deriveSourceMachiningOperations } from './machiningParticipation';
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

export function programStopValidationError(
  document: PathPlanningDocument,
  operation: PathOperation,
  stop: OperationProgramStop,
  otherStops: readonly OperationProgramStop[]
): string | null {
  const placement = stop.placement;
  if (placement.kind === 'before-operation-end' &&
    (!Number.isFinite(placement.remainingCutLengthMm) || placement.remainingCutLengthMm <= 0)) {
    return 'Remaining cut must be a finite number greater than 0.';
  }
  if (!stop.enabled) return null;
  if (placement.kind === 'before-operation-end') {
    const machining = deriveSourceMachiningOperations(document, operation.id);
    if (!machining || machining.status !== 'ready') {
      return 'Resolve machining participation before adding a remaining-cut stop.';
    }
    const segments = segmentMap(machining.segments);
    const total = machining.operations.reduce(
      (length, active) => length + pathCutLength(active.segmentRefs, segments), 0
    );
    const remaining = placement.remainingCutLengthMm;
    if (remaining >= total) {
      return `Remaining cut must be greater than 0 and less than the contour length (${total.toFixed(3)} mm).`;
    }
  }
  if (otherStops.some((other) => other.id !== stop.id && other.enabled &&
    other.placement.kind === placement.kind &&
    (placement.kind !== 'before-operation-end' ||
      (other.placement.kind === 'before-operation-end' &&
        other.placement.remainingCutLengthMm === placement.remainingCutLengthMm)))) {
    return 'Enabled program stops cannot share an exact placement.';
  }
  return null;
}

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
  return resolveOperationProgramStopPoints(operation, segmentMap(document.segments));
}

export function resolveOperationProgramStopPoints(
  operation: PathOperation,
  segmentsById: Map<string, PathPlanningDocument['segments'][number]>
): ReturnType<typeof resolveProgramStopPoints> {
  const requested = (operation.programStops ?? []).filter(
    (stop) => stop.enabled && stop.placement.kind === 'before-operation-end'
  );
  if (requested.length === 0) return { status: 'ready', stops: [] };
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
