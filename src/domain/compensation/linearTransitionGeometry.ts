import { classifyPathSegmentIntersection, expandBounds } from '@/domain/path-intel/intersections';
import {
  createLineSegment,
  mergeBounds,
  orientedSegmentStart,
  rotatePathRefs,
  segmentMap
} from '@/domain/path-intel/segments';
import type {
  Bounds2,
  OrientedSegmentRef,
  PathOperation,
  PathPlanningDocument,
  Point2
} from '@/domain/path-intel/types';
import type { MachineWorkArea } from '@/domain/workbench/types';

import { orientedEndpointTangents } from './pathTangents';

export interface LinearCompensationTransitionInput {
  document: PathPlanningDocument;
  operation: PathOperation;
  leadLengthMm: number;
  expectedMaximumOffsetMm: number | null;
  coordinatePrecision: number;
  workArea: MachineWorkArea;
}

export type LinearTransitionBlockedReason =
  | 'missing-envelope'
  | 'sharp-manual-start'
  | 'collision'
  | 'outside-work-area'
  | 'precision-collapse'
  | 'no-safe-candidate';

export type LinearTransitionResult =
  | {
      status: 'ready';
      effectiveRefs: OrientedSegmentRef[];
      startPoint: Point2;
      leadIn: { start: Point2; end: Point2 };
      leadOut: { start: Point2; end: Point2 };
      selectedCandidateIndex: number;
      reason: 'manual-start' | 'automatic-safe-start';
    }
  | {
      status: 'blocked';
      reason: LinearTransitionBlockedReason;
    };

const SMOOTH_TANGENT_DOT_MINIMUM = 1 - 1e-9;
const transitionSource = {
  sourceEntityIndex: -1,
  sourceEntityType: 'generated-compensation-transition',
  layer: null,
  exact: true
};

export function generateLinearCompensationTransition(
  input: LinearCompensationTransitionInput
): LinearTransitionResult {
  const envelope = input.expectedMaximumOffsetMm;
  if (!Number.isFinite(envelope) || envelope == null || envelope <= 0) {
    return { status: 'blocked', reason: 'missing-envelope' };
  }
  if (!Number.isFinite(input.leadLengthMm) || input.leadLengthMm <= 0) {
    return { status: 'blocked', reason: 'no-safe-candidate' };
  }

  const manual = Boolean(input.operation.overrides?.start);
  const candidateCount = manual ? Math.min(1, input.operation.segmentRefs.length) : input.operation.segmentRefs.length;
  const failures = new Set<LinearTransitionBlockedReason>();

  for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
    const candidate = evaluateCandidate(input, candidateIndex, envelope);
    if (candidate.status === 'ready') {
      return {
        ...candidate,
        reason: manual ? 'manual-start' : 'automatic-safe-start'
      };
    }
    if (manual && candidate.reason === 'no-safe-candidate') {
      return { status: 'blocked', reason: 'sharp-manual-start' };
    }
    failures.add(candidate.reason);
  }

  for (const reason of ['precision-collapse', 'collision', 'outside-work-area'] as const) {
    if (failures.has(reason)) return { status: 'blocked', reason };
  }
  return { status: 'blocked', reason: 'no-safe-candidate' };
}

function evaluateCandidate(
  input: LinearCompensationTransitionInput,
  candidateIndex: number,
  envelope: number
): Exclude<LinearTransitionResult, { status: 'blocked'; reason: 'missing-envelope' | 'sharp-manual-start' }> {
  const effectiveRefs = rotatePathRefs(input.operation.segmentRefs, candidateIndex);
  const firstRef = effectiveRefs[0];
  const lastRef = effectiveRefs.at(-1);
  if (!firstRef || !lastRef) return { status: 'blocked', reason: 'no-safe-candidate' };

  const segmentsById = segmentMap(input.document.segments);
  const first = segmentsById.get(firstRef.segmentId);
  const last = segmentsById.get(lastRef.segmentId);
  if (!first || !last) return { status: 'blocked', reason: 'no-safe-candidate' };
  const firstTangents = orientedEndpointTangents(first, firstRef);
  const lastTangents = orientedEndpointTangents(last, lastRef);
  if (!firstTangents || !lastTangents) return { status: 'blocked', reason: 'no-safe-candidate' };
  if (dot(firstTangents.start, lastTangents.end) < SMOOTH_TANGENT_DOT_MINIMUM) {
    return { status: 'blocked', reason: 'no-safe-candidate' };
  }

  const startPoint = orientedSegmentStart(first, firstRef);
  const leadIn = {
    start: addScaled(startPoint, firstTangents.start, -input.leadLengthMm),
    end: { ...startPoint }
  };
  const leadOut = {
    start: { ...startPoint },
    end: addScaled(startPoint, lastTangents.end, input.leadLengthMm)
  };
  if (![startPoint, leadIn.start, leadIn.end, leadOut.start, leadOut.end].every(finitePoint)) {
    return { status: 'blocked', reason: 'no-safe-candidate' };
  }
  if (
    formattedPointsEqual(leadIn.start, leadIn.end, input.coordinatePrecision) ||
    formattedPointsEqual(leadOut.start, leadOut.end, input.coordinatePrecision)
  ) {
    return { status: 'blocked', reason: 'precision-collapse' };
  }

  const incidentSegmentIds = new Set([firstRef.segmentId, lastRef.segmentId]);
  if (
    transitionCollides(input.document, leadIn, startPoint, incidentSegmentIds, envelope, 'lead-in') ||
    transitionCollides(input.document, leadOut, startPoint, incidentSegmentIds, envelope, 'lead-out')
  ) {
    return { status: 'blocked', reason: 'collision' };
  }
  if (outsideWorkArea(input.document, leadIn, leadOut, envelope, input.workArea)) {
    return { status: 'blocked', reason: 'outside-work-area' };
  }

  return {
    status: 'ready',
    effectiveRefs,
    startPoint,
    leadIn,
    leadOut,
    selectedCandidateIndex: candidateIndex,
    reason: 'automatic-safe-start'
  };
}

function transitionCollides(
  document: PathPlanningDocument,
  transition: { start: Point2; end: Point2 },
  intendedContact: Point2,
  incidentSegmentIds: Set<string>,
  envelope: number,
  label: string
) {
  const line = createLineSegment({
    id: `generated-${label}`,
    source: transitionSource,
    start: transition.start,
    end: transition.end
  });
  const epsilon = document.options.coincidenceEpsilon;

  for (const segment of document.segments) {
    const relation = classifyPathSegmentIntersection(line, segment, epsilon);
    if (relation.kind === 'overlap') return true;
    if (
      relation.kind === 'points' &&
      relation.points.some(
        (point) => !incidentSegmentIds.has(segment.id) || !pointsWithin(point, intendedContact, epsilon)
      )
    ) {
      return true;
    }
    if (
      !incidentSegmentIds.has(segment.id) &&
      boundsOverlap(expandBounds(line.bounds, envelope), segment.bounds)
    ) {
      return true;
    }
  }
  return false;
}

function outsideWorkArea(
  document: PathPlanningDocument,
  leadIn: { start: Point2; end: Point2 },
  leadOut: { start: Point2; end: Point2 },
  envelope: number,
  workArea: MachineWorkArea
) {
  if (workArea.widthMm == null && workArea.lengthMm == null) return false;
  let bounds: Bounds2 = {
    minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity
  };
  document.segments.forEach((segment) => {
    bounds = mergeBounds(bounds, segment.bounds);
  });
  bounds = mergeBounds(bounds, boundsFromTransition(leadIn));
  bounds = mergeBounds(bounds, boundsFromTransition(leadOut));
  bounds = expandBounds(bounds, envelope);
  const width = bounds.maxX - bounds.minX;
  const length = bounds.maxY - bounds.minY;
  return (
    !Number.isFinite(width) ||
    !Number.isFinite(length) ||
    (workArea.widthMm != null && width > workArea.widthMm) ||
    (workArea.lengthMm != null && length > workArea.lengthMm)
  );
}

function boundsFromTransition(transition: { start: Point2; end: Point2 }): Bounds2 {
  return {
    minX: Math.min(transition.start.x, transition.end.x),
    minY: Math.min(transition.start.y, transition.end.y),
    maxX: Math.max(transition.start.x, transition.end.x),
    maxY: Math.max(transition.start.y, transition.end.y)
  };
}

function boundsOverlap(left: Bounds2, right: Bounds2) {
  return !(
    left.maxX < right.minX || left.minX > right.maxX ||
    left.maxY < right.minY || left.minY > right.maxY
  );
}

function addScaled(point: Point2, direction: Point2, scale: number): Point2 {
  return { x: point.x + direction.x * scale, y: point.y + direction.y * scale };
}

function dot(left: Point2, right: Point2) {
  return left.x * right.x + left.y * right.y;
}

function finitePoint(point: Point2) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function pointsWithin(left: Point2, right: Point2, epsilon: number) {
  return Math.hypot(right.x - left.x, right.y - left.y) <= epsilon;
}

function formattedPointsEqual(left: Point2, right: Point2, precision: number) {
  const normalizedPrecision = Number.isInteger(precision) && precision >= 0 && precision <= 8
    ? precision
    : 3;
  return formattedCoordinate(left.x, normalizedPrecision) === formattedCoordinate(right.x, normalizedPrecision) &&
    formattedCoordinate(left.y, normalizedPrecision) === formattedCoordinate(right.y, normalizedPrecision);
}

function formattedCoordinate(value: number, precision: number) {
  const formatted = value.toFixed(precision);
  return Number(formatted) === 0 ? formatted.replace(/^-/, '') : formatted;
}
