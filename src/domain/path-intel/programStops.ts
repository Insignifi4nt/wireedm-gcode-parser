import type { MachineProfile } from '@/domain/workbench/types';

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

export type ProgramStopValidation =
  | { status: 'ready'; stops: OperationProgramStop[]; code: 'M00' }
  | {
      status: 'blocked';
      reason:
        | 'program-stops-unsupported'
        | 'program-stop-placement-unsupported'
        | 'program-stop-compensation-state-unsupported'
        | 'invalid-program-stop'
        | 'duplicate-program-stop';
      message: string;
    };

export function validateProgramStops(
  operation: PathOperation,
  machine: MachineProfile,
  segments?: PathPlanningDocument['segments']
): ProgramStopValidation {
  const stops = (operation.programStops ?? []).filter((stop) => stop.enabled);
  if (stops.length === 0) return { status: 'ready', stops: [], code: 'M00' };
  if (!machine.programStops.supported) {
    return blocked(
      'program-stops-unsupported',
      'The selected machine profile does not authorize program-stop output.'
    );
  }
  const seenIds = new Set<string>();
  const seenPlacements = new Set<string>();
  for (const stop of stops) {
    if (
      !stop.id ||
      seenIds.has(stop.id) ||
      !['operator-check', 'part-retention', 'manual'].includes(stop.reason)
    ) {
      return blocked('invalid-program-stop', 'Program stops require unique IDs and a valid reason.');
    }
    seenIds.add(stop.id);
    const kind = stop.placement.kind;
    if (!machine.programStops.allowedPlacements.includes(kind)) {
      return blocked(
        'program-stop-placement-unsupported',
        `The selected machine profile does not authorize ${kind} stops.`
      );
    }
    const activeCompensation = kind !== 'before-entry';
    if (activeCompensation && !machine.programStops.allowCompensationActive) {
      return blocked(
        'program-stop-compensation-state-unsupported',
        `The selected machine profile does not authorize ${kind} while compensation is active.`
      );
    }
    const placementKey = kind === 'before-operation-end'
      ? `${kind}:${stop.placement.remainingCutLengthMm}`
      : kind;
    if (seenPlacements.has(placementKey)) {
      return blocked('duplicate-program-stop', 'Two enabled program stops resolve to the same placement.');
    }
    seenPlacements.add(placementKey);
    if (
      kind === 'before-operation-end' &&
      (!Number.isFinite(stop.placement.remainingCutLengthMm) ||
        stop.placement.remainingCutLengthMm <= 0 ||
        stop.placement.remainingCutLengthMm >= contourCutLength(operation, segments))
    ) {
      return blocked(
        'invalid-program-stop',
        'Remaining cut length must be finite, positive, and shorter than the contour cut length.'
      );
    }
  }
  return { status: 'ready', stops: structuredClone(stops), code: machine.programStops.code };
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

function contourCutLength(
  operation: PathOperation,
  segments: PathPlanningDocument['segments'] | undefined
) {
  return segments
    ? pathCutLength(operation.segmentRefs, segmentMap(segments))
    : operation.metrics.cutLength;
}

function blocked(
  reason: Extract<ProgramStopValidation, { status: 'blocked' }>['reason'],
  message: string
): ProgramStopValidation {
  return { status: 'blocked', reason, message };
}
