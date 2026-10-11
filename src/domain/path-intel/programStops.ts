import { deriveSourceMachiningOperations } from './machiningParticipation';
import { resolveSourceAfterContourTravel, travelDistanceError } from './afterContourTravel';
import {
  orientedSegmentEnd,
  orientedSegmentStart,
  pointOnArcAtParameter,
  pointOnCircleAtParameter,
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
  if (placement.kind === 'after-contour-distance' &&
    (!Number.isFinite(placement.travelLengthMm) || placement.travelLengthMm <= 0)) {
    return 'Travel distance must be a finite number greater than 0.';
  }
  if (!stop.enabled) return null;
  if (placement.kind === 'after-contour-distance') {
    const route = resolveSourceAfterContourTravel(document, operation.id);
    if (route.status === 'blocked') return route.message;
    const error = travelDistanceError(route.path, placement.travelLengthMm);
    if (error) return error;
    if (placement.travelLengthMm === route.path.exitLengthMm &&
      otherStops.some((other) => other.id !== stop.id && other.enabled && other.placement.kind === 'after-exit')) {
      return 'The travel-distance stop coincides with an enabled After exit stop. Keep one pause at that boundary.';
    }
  }
  if (placement.kind === 'after-exit' && otherStops.some((other) => other.id !== stop.id && other.enabled &&
    other.placement.kind === 'after-contour-distance')) {
    const route = resolveSourceAfterContourTravel(document, operation.id);
    if (route.status === 'ready' && otherStops.some((other) => other.id !== stop.id && other.enabled &&
      other.placement.kind === 'after-contour-distance' && other.placement.travelLengthMm === route.path.exitLengthMm)) {
      return 'The After exit stop coincides with an enabled travel-distance stop. Keep one pause at that boundary.';
    }
  }
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
    (placement.kind === 'after-contour-distance'
      ? other.placement.kind === 'after-contour-distance' && other.placement.travelLengthMm === placement.travelLengthMm
      : placement.kind !== 'before-operation-end' ||
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
  const resolved = resolveOperationProgramStopLocations(operation, segmentsById);
  if (resolved.status === 'blocked') return resolved;
  return {
    status: 'ready',
    stops: resolved.stops.map(stop => ({
      id: stop.id,
      placement: stop.placement,
      point: stop.point,
      remainingCutLengthMm: stop.remainingCutLengthMm
    }))
  };
}

export interface ResolvedOperationProgramStopLocation {
  id: string;
  placement: 'before-operation-end';
  point: Point2;
  remainingCutLengthMm: number;
  segmentRefIndex: number;
  parameter: number;
}

export function resolveOperationProgramStopLocations(
  operation: PathOperation,
  segmentsById: Map<string, PathPlanningDocument['segments'][number]>
):
  | { status: 'ready'; stops: ResolvedOperationProgramStopLocation[] }
  | Extract<ReturnType<typeof resolveProgramStopPoints>, { status: 'blocked' }> {
  const requested = (operation.programStops ?? []).filter(
    (stop) => stop.enabled && stop.placement.kind === 'before-operation-end'
  );
  if (requested.length === 0) return { status: 'ready', stops: [] };
  const total = pathCutLength(operation.segmentRefs, segmentsById);
  const stops: ResolvedOperationProgramStopLocation[] = [];
  for (const stop of requested) {
    if (stop.placement.kind !== 'before-operation-end') continue;
    const remaining = stop.placement.remainingCutLengthMm;
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining >= total) {
      return { status: 'blocked', reason: 'invalid-program-stop' };
    }
    // Remaining cut is measured from the end. Subtracting it from a much larger
    // contour total can erase a short final segment or its stop parameter.
    let distanceFromEnd = remaining;
    let location: Pick<ResolvedOperationProgramStopLocation, 'point' | 'segmentRefIndex' | 'parameter'> | null = null;
    for (let segmentRefIndex = operation.segmentRefs.length - 1; segmentRefIndex >= 0; segmentRefIndex -= 1) {
      const ref = operation.segmentRefs[segmentRefIndex];
      const segment = requiredSegment(segmentsById, ref.segmentId);
      if (distanceFromEnd < segment.length) {
        const parameter = (segment.length - distanceFromEnd) / segment.length;
        // Internal joins may round to their exact stored endpoint. At either
        // contour boundary, that would turn an interior stop into a start/end stop.
        if (distanceFromEnd > 0 && (
          (parameter <= 0 && segmentRefIndex === 0) ||
          (parameter >= 1 && segmentRefIndex === operation.segmentRefs.length - 1)
        )) {
          return { status: 'blocked', reason: 'invalid-program-stop' };
        }
        const point = pointAtParameter(segment, ref, parameter);
        if (parameter > 0 && parameter < 1) {
          const start = orientedSegmentStart(segment, ref);
          const end = orientedSegmentEnd(segment, ref);
          if ((point.x === start.x && point.y === start.y) || (point.x === end.x && point.y === end.y)) {
            return { status: 'blocked', reason: 'invalid-program-stop' };
          }
        }
        location = { point, segmentRefIndex, parameter };
        break;
      }
      distanceFromEnd -= segment.length;
    }
    if (!location) return { status: 'blocked', reason: 'invalid-program-stop' };
    stops.push({
      id: stop.id,
      placement: 'before-operation-end' as const,
      ...location,
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
    if (clamped === 0) return start;
    if (clamped === 1) return end;
    return {
      x: start.x + (end.x - start.x) * clamped,
      y: start.y + (end.y - start.y) * clamped
    };
  }
  if (segment.kind === 'arc') return pointOnArcAtParameter(segment, ref, clamped);
  return pointOnCircleAtParameter(segment, ref, clamped);
}
