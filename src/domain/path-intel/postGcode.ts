import {
  distance,
  orientedArcClockwise,
  orientedCircleClockwise,
  orientedSegmentEnd,
  orientedSegmentStart,
  pointsEqual,
  requiredSegment,
  segmentMap
} from './segments';
import type {
  ArcPathSegment,
  CirclePathSegment,
  OperationPlan,
  OrientedSegmentRef,
  PathDiagnostic,
  PathPlanningOptions,
  PathSegment,
  Point2
} from './types';
import { resolvePathPlanningOptions } from './segments';

export interface GcodePostResult {
  body: string;
  diagnostics: PathDiagnostic[];
  metrics: {
    rapidCount: number;
    cutMoveCount: number;
  };
}

export function pathPlanToGcodeBody(
  plan: OperationPlan,
  segments: PathSegment[],
  options: PathPlanningOptions = {}
) {
  return postPathPlanToGcode(plan, segments, options).body;
}

export function postPathPlanToGcode(
  plan: OperationPlan,
  segments: PathSegment[],
  options: PathPlanningOptions = {}
): GcodePostResult {
  const resolved = resolvePathPlanningOptions(options);
  const segmentsById = segmentMap(segments);
  const lines: string[] = [];
  const diagnostics: PathDiagnostic[] = [];
  let currentPosition: Point2 | null = null;
  let rapidCount = 0;
  let cutMoveCount = 0;

  const nextDiagnosticId = () => `diag_post_${String(diagnostics.length + 1).padStart(4, '0')}`;

  for (const operation of plan.operations) {
    if (operation.segmentRefs.length === 0) continue;

    if (!pointsEqualNullable(currentPosition, operation.startPoint, resolved.coincidenceEpsilon)) {
      lines.push(`G0 ${xy(operation.startPoint)}`);
      rapidCount++;
      currentPosition = operation.startPoint;
    }

    for (const ref of operation.segmentRefs) {
      const segment = requiredSegment(segmentsById, ref.segmentId);
      const segmentStart = orientedSegmentStart(segment, ref);

      const bridge = moveToSegmentStartIfNeeded(
        lines,
        currentPosition,
        segmentStart,
        ref,
        resolved.endpointTolerance,
        resolved.coincidenceEpsilon,
        nextDiagnosticId
      );
      diagnostics.push(...bridge.diagnostics);
      rapidCount += bridge.rapidCount;
      cutMoveCount += bridge.cutMoveCount;

      const move = moveForSegment(segment, ref);
      lines.push(...move.lines);
      cutMoveCount += move.cutMoveCount;
      currentPosition = move.endPoint;
    }

    if (operation.closed) {
      const bridge = moveToSegmentStartIfNeeded(
        lines,
        currentPosition,
        operation.startPoint,
        operation.segmentRefs[operation.segmentRefs.length - 1],
        resolved.endpointTolerance,
        resolved.coincidenceEpsilon,
        nextDiagnosticId
      );
      diagnostics.push(...bridge.diagnostics);
      rapidCount += bridge.rapidCount;
      cutMoveCount += bridge.cutMoveCount;
      currentPosition = operation.startPoint;
    }
  }

  return {
    body: lines.join('\n'),
    diagnostics,
    metrics: {
      rapidCount,
      cutMoveCount
    }
  };
}

function moveToSegmentStartIfNeeded(
  lines: string[],
  currentPosition: Point2 | null,
  target: Point2,
  ref: OrientedSegmentRef,
  endpointTolerance: number,
  coincidenceEpsilon: number,
  nextDiagnosticId: () => string
) {
  const diagnostics: PathDiagnostic[] = [];

  if (!currentPosition || pointsEqual(currentPosition, target, coincidenceEpsilon)) {
    return { diagnostics, rapidCount: 0, cutMoveCount: 0 };
  }

  const gap = distance(currentPosition, target);
  if (gap <= endpointTolerance) {
    lines.push(`G1 ${xy(target)}`);
    diagnostics.push({
      id: nextDiagnosticId(),
      severity: 'warning',
      code: 'post-bridged-gap',
      message: `Bridged a ${format(gap)} endpoint gap inside tolerance while posting G-code.`,
      relatedSegmentIds: [ref.segmentId],
      details: { gap, endpointTolerance }
    });
    return { diagnostics, rapidCount: 0, cutMoveCount: 1 };
  }

  lines.push(`G0 ${xy(target)}`);
  diagnostics.push({
    id: nextDiagnosticId(),
    severity: 'warning',
    code: 'post-unexpected-gap',
    message: `Inserted a rapid move across a ${format(gap)} gap because the next segment was not continuous.`,
    relatedSegmentIds: [ref.segmentId],
    details: { gap, endpointTolerance }
  });
  return { diagnostics, rapidCount: 1, cutMoveCount: 0 };
}

function moveForSegment(segment: PathSegment, ref: OrientedSegmentRef) {
  if (segment.kind === 'line') {
    return {
      lines: [`G1 ${xy(orientedSegmentEnd(segment, ref))}`],
      endPoint: orientedSegmentEnd(segment, ref),
      cutMoveCount: 1
    };
  }

  if (segment.kind === 'arc') {
    return moveForArc(segment, ref);
  }

  return moveForCircle(segment, ref);
}

function moveForArc(segment: ArcPathSegment, ref: OrientedSegmentRef) {
  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);
  const command = orientedArcClockwise(segment, ref) ? 'G2' : 'G3';

  return {
    lines: [`${command} ${xy(end)} ${ij(segment.center, start)}`],
    endPoint: end,
    cutMoveCount: 1
  };
}

function moveForCircle(segment: CirclePathSegment, ref: OrientedSegmentRef) {
  const clockwise = orientedCircleClockwise(segment, ref);
  const command = clockwise ? 'G2' : 'G3';
  const start = segment.preferredStart;
  const opposite = {
    x: segment.center.x - (start.x - segment.center.x),
    y: segment.center.y - (start.y - segment.center.y)
  };

  return {
    lines: [
      `${command} ${xy(opposite)} ${ij(segment.center, start)}`,
      `${command} ${xy(start)} ${ij(segment.center, opposite)}`
    ],
    endPoint: start,
    cutMoveCount: 2
  };
}

function pointsEqualNullable(a: Point2 | null, b: Point2, epsilon: number) {
  return !!a && pointsEqual(a, b, epsilon);
}

function xy(point: Point2) {
  return `X${format(point.x)} Y${format(point.y)}`;
}

function ij(center: Point2, start: Point2) {
  return `I${format(center.x - start.x)} J${format(center.y - start.y)}`;
}

function format(value: number) {
  return value.toFixed(3);
}
