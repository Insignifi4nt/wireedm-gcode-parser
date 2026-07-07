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
  PathOperation,
  PathDiagnostic,
  PathPlanningOptions,
  PathSegment,
  Point2
} from './types';
import { resolvePathPlanningOptions } from './segments';

export type GcodePostedMoveKind = 'rapid' | 'cut';

export type GcodePostedMoveReason =
  | 'operation-start'
  | 'manual-lead-in'
  | 'segment-cut'
  | 'gap-bridge'
  | 'unexpected-gap';

export type GcodeArcCenterMode = 'absolute' | 'incremental';

export interface GcodePostOptions extends PathPlanningOptions {
  arcCenterMode?: GcodeArcCenterMode;
}

export interface GcodePostedMove {
  bodyLineIndex: number;
  command: 'G0' | 'G1' | 'G2' | 'G3';
  contourId: string | null;
  endPoint: Point2;
  kind: GcodePostedMoveKind;
  operationId: string | null;
  reason: GcodePostedMoveReason;
  segmentId: string | null;
  startPoint: Point2 | null;
  text: string;
}

export interface GcodePostedOperation {
  bodyLineEnd: number;
  bodyLineStart: number;
  classification: PathOperation['classification'];
  closed: boolean;
  contourId: string;
  cutMoveCount: number;
  direction: PathOperation['direction'];
  displayName: string;
  moves: GcodePostedMove[];
  operationId: string;
  orderIndex: number;
  rapidCount: number;
}

export interface GcodePostResult {
  body: string;
  diagnostics: PathDiagnostic[];
  metrics: {
    rapidCount: number;
    cutMoveCount: number;
  };
  moves: GcodePostedMove[];
  operations: GcodePostedOperation[];
}

export function pathPlanToGcodeBody(
  plan: OperationPlan,
  segments: PathSegment[],
  options: GcodePostOptions = {}
) {
  return postPathPlanToGcode(plan, segments, options).body;
}

export function postPathPlanToGcode(
  plan: OperationPlan,
  segments: PathSegment[],
  options: GcodePostOptions = {}
): GcodePostResult {
  const resolved = resolvePathPlanningOptions(options);
  const arcCenterMode = options.arcCenterMode ?? 'incremental';
  const segmentsById = segmentMap(segments);
  const lines: string[] = [];
  const diagnostics: PathDiagnostic[] = [];
  const moves: GcodePostedMove[] = [];
  const postedOperations: GcodePostedOperation[] = [];
  let currentPosition: Point2 | null = null;

  const nextDiagnosticId = () => `diag_post_${String(diagnostics.length + 1).padStart(4, '0')}`;
  const appendMove = (
    move: Omit<GcodePostedMove, 'bodyLineIndex'>
  ): GcodePostedMove => {
    const postedMove = {
      ...move,
      bodyLineIndex: lines.length
    };
    lines.push(postedMove.text);
    moves.push(postedMove);
    return postedMove;
  };

  for (const operation of plan.operations) {
    if (operation.segmentRefs.length === 0) continue;

    const operationMoves: GcodePostedMove[] = [];
    const appendOperationMove = (move: Omit<GcodePostedMove, 'bodyLineIndex' | 'contourId' | 'operationId'>) => {
      const postedMove = appendMove({
        ...move,
        contourId: operation.contourId,
        operationId: operation.id
      });
      operationMoves.push(postedMove);
      currentPosition = postedMove.endPoint;
      return postedMove;
    };

    const entryPoint = operationEntryPoint(operation);
    if (!pointsEqualNullable(currentPosition, entryPoint, resolved.coincidenceEpsilon)) {
      appendOperationMove({
        command: 'G0',
        endPoint: entryPoint,
        kind: 'rapid',
        reason: 'operation-start',
        segmentId: null,
        startPoint: currentPosition,
        text: `G0 ${xy(entryPoint)}`
      });
    }

    const leadIn = operation.overrides?.leadIn;
    if (leadIn && !pointsEqual(leadIn.from, leadIn.to, resolved.coincidenceEpsilon)) {
      appendOperationMove({
        command: 'G1',
        endPoint: leadIn.to,
        kind: 'cut',
        reason: 'manual-lead-in',
        segmentId: leadIn.sourceSegmentId,
        startPoint: leadIn.from,
        text: `G1 ${xy(leadIn.to)}`
      });
    }

    for (const ref of operation.segmentRefs) {
      const segment = requiredSegment(segmentsById, ref.segmentId);
      const segmentStart = orientedSegmentStart(segment, ref);

      const bridge = moveToSegmentStartIfNeeded(
        currentPosition,
        segmentStart,
        ref,
        resolved.endpointTolerance,
        resolved.coincidenceEpsilon,
        nextDiagnosticId
      );
      diagnostics.push(...bridge.diagnostics);
      if (bridge.move) {
        appendOperationMove(bridge.move);
      }

      const move = moveForSegment(segment, ref, arcCenterMode);
      move.moves.forEach((postedMove) => appendOperationMove(postedMove));
    }

    if (operation.closed) {
      const bridge = moveToSegmentStartIfNeeded(
        currentPosition,
        operation.startPoint,
        operation.segmentRefs[operation.segmentRefs.length - 1],
        resolved.endpointTolerance,
        resolved.coincidenceEpsilon,
        nextDiagnosticId
      );
      diagnostics.push(...bridge.diagnostics);
      if (bridge.move) {
        appendOperationMove(bridge.move);
      }
    }

    if (operationMoves.length > 0) {
      postedOperations.push({
        bodyLineEnd: operationMoves[operationMoves.length - 1].bodyLineIndex,
        bodyLineStart: operationMoves[0].bodyLineIndex,
        classification: operation.classification,
        closed: operation.closed,
        contourId: operation.contourId,
        cutMoveCount: operationMoves.filter((move) => move.kind === 'cut').length,
        direction: operation.direction,
        displayName: operation.displayName,
        moves: operationMoves,
        operationId: operation.id,
        orderIndex: operation.orderIndex,
        rapidCount: operationMoves.filter((move) => move.kind === 'rapid').length
      });
    }
  }

  const rapidCount = moves.filter((move) => move.kind === 'rapid').length;
  const cutMoveCount = moves.filter((move) => move.kind === 'cut').length;

  return {
    body: lines.join('\n'),
    diagnostics,
    metrics: {
      rapidCount,
      cutMoveCount
    },
    moves,
    operations: postedOperations
  };
}

function moveToSegmentStartIfNeeded(
  currentPosition: Point2 | null,
  target: Point2,
  ref: OrientedSegmentRef,
  endpointTolerance: number,
  coincidenceEpsilon: number,
  nextDiagnosticId: () => string
) {
  const diagnostics: PathDiagnostic[] = [];

  if (!currentPosition || pointsEqual(currentPosition, target, coincidenceEpsilon)) {
    return { diagnostics, move: null };
  }

  const gap = distance(currentPosition, target);
  if (gap <= endpointTolerance) {
    diagnostics.push({
      id: nextDiagnosticId(),
      severity: 'warning',
      code: 'post-bridged-gap',
      message: `Bridged a ${format(gap)} endpoint gap inside tolerance while posting G-code.`,
      relatedSegmentIds: [ref.segmentId],
      details: { gap, endpointTolerance }
    });
    return {
      diagnostics,
      move: {
        command: 'G1' as const,
        endPoint: target,
        kind: 'cut' as const,
        reason: 'gap-bridge' as const,
        segmentId: ref.segmentId,
        startPoint: currentPosition,
        text: `G1 ${xy(target)}`
      }
    };
  }

  diagnostics.push({
    id: nextDiagnosticId(),
    severity: 'warning',
    code: 'post-unexpected-gap',
    message: `Inserted a rapid move across a ${format(gap)} gap because the next segment was not continuous.`,
    relatedSegmentIds: [ref.segmentId],
    details: { gap, endpointTolerance }
  });
  return {
    diagnostics,
    move: {
      command: 'G0' as const,
      endPoint: target,
      kind: 'rapid' as const,
      reason: 'unexpected-gap' as const,
      segmentId: ref.segmentId,
      startPoint: currentPosition,
      text: `G0 ${xy(target)}`
    }
  };
}

function moveForSegment(segment: PathSegment, ref: OrientedSegmentRef, arcCenterMode: GcodeArcCenterMode) {
  if (segment.kind === 'line') {
    const start = orientedSegmentStart(segment, ref);
    const end = orientedSegmentEnd(segment, ref);
    return {
      moves: [
        {
          command: 'G1' as const,
          endPoint: end,
          kind: 'cut' as const,
          reason: 'segment-cut' as const,
          segmentId: segment.id,
          startPoint: start,
          text: `G1 ${xy(end)}`
        }
      ]
    };
  }

  if (segment.kind === 'arc') {
    return moveForArc(segment, ref, arcCenterMode);
  }

  return moveForCircle(segment, ref, arcCenterMode);
}

function moveForArc(segment: ArcPathSegment, ref: OrientedSegmentRef, arcCenterMode: GcodeArcCenterMode) {
  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);
  const command: 'G2' | 'G3' = orientedArcClockwise(segment, ref) ? 'G2' : 'G3';

  return {
    moves: [
      {
        command,
        endPoint: end,
        kind: 'cut' as const,
        reason: 'segment-cut' as const,
        segmentId: segment.id,
        startPoint: start,
        text: `${command} ${xy(end)} ${ij(segment.center, start, arcCenterMode)}`
      }
    ]
  };
}

function moveForCircle(segment: CirclePathSegment, ref: OrientedSegmentRef, arcCenterMode: GcodeArcCenterMode) {
  const clockwise = orientedCircleClockwise(segment, ref);
  const command: 'G2' | 'G3' = clockwise ? 'G2' : 'G3';
  const start = segment.preferredStart;
  const opposite = {
    x: segment.center.x - (start.x - segment.center.x),
    y: segment.center.y - (start.y - segment.center.y)
  };

  return {
    moves: [
      {
        command,
        endPoint: opposite,
        kind: 'cut' as const,
        reason: 'segment-cut' as const,
        segmentId: segment.id,
        startPoint: start,
        text: `${command} ${xy(opposite)} ${ij(segment.center, start, arcCenterMode)}`
      },
      {
        command,
        endPoint: start,
        kind: 'cut' as const,
        reason: 'segment-cut' as const,
        segmentId: segment.id,
        startPoint: opposite,
        text: `${command} ${xy(start)} ${ij(segment.center, opposite, arcCenterMode)}`
      }
    ],
  };
}

function pointsEqualNullable(a: Point2 | null, b: Point2, epsilon: number) {
  return !!a && pointsEqual(a, b, epsilon);
}

function operationEntryPoint(operation: PathOperation) {
  return operation.overrides?.leadIn?.from ?? operation.startPoint;
}

function xy(point: Point2) {
  return `X${format(point.x)} Y${format(point.y)}`;
}

function ij(center: Point2, start: Point2, mode: GcodeArcCenterMode) {
  if (mode === 'absolute') return `I${format(center.x)} J${format(center.y)}`;

  return `I${format(center.x - start.x)} J${format(center.y - start.y)}`;
}

function format(value: number) {
  return value.toFixed(3);
}
