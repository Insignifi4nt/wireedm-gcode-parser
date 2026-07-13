import {
  distance,
  orientedArcClockwise,
  orientedCircleClockwise,
  orientedSegmentEnd,
  orientedSegmentStart
} from './segments';
import { DEFAULT_PATH_PLANNING_OPTIONS } from './types';
import {
  pathSegmentHasConsistentArcAngularGeometry,
  pathSegmentHasExecutableCircularGeometry
} from './sanitizeSegments';
import type {
  ArcPathSegment,
  CirclePathSegment,
  OperationPlan,
  OrientedSegmentRef,
  PathDiagnostic,
  PathOperation,
  PathPlanningOptions,
  PathSegment,
  Point2
} from './types';

export type GcodePostedMoveKind = 'rapid' | 'cut';

export type GcodePostedMoveReason =
  | 'operation-start'
  | 'operation-start-approach'
  | 'manual-lead-in'
  | 'segment-cut'
  | 'gap-bridge'
  | 'compensation-lead-out'
  | 'unexpected-gap';

export type GcodeArcCenterMode = 'absolute' | 'incremental';

export interface GcodePostOptions extends PathPlanningOptions {
  arcCenterMode?: GcodeArcCenterMode;
  coordinatePrecision?: number;
  initialPosition?: Point2;
  operationStartMode?: 'rapid' | 'linear';
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
  status: 'ready' | 'blocked';
  body: string;
  diagnostics: PathDiagnostic[];
  metrics: {
    rapidCount: number;
    cutMoveCount: number;
  };
  moves: GcodePostedMove[];
  operations: GcodePostedOperation[];
}

type CoordinateFormatter = (value: number) => string | null;
type FormattedPoint = { x: string; y: string };

interface RenderedSegmentMoves {
  error: string | null;
  moves: Array<Omit<GcodePostedMove, 'bodyLineIndex' | 'contourId' | 'operationId'>>;
}

export function pathPlanToGcodeBody(
  plan: OperationPlan,
  segments: PathSegment[],
  options: GcodePostOptions = {}
) {
  return postPathPlanToGcode(plan, segments, options).body;
}

export interface GcodePostPreflightResult {
  diagnostics: PathDiagnostic[];
  operationStartApproaches: Array<Pick<
    GcodePostedMove,
    'bodyLineIndex' | 'operationId' | 'startPoint' | 'endPoint'
  >>;
  status: GcodePostResult['status'];
}

export function preflightPathPlanToGcode(
  plan: OperationPlan,
  segments: PathSegment[],
  options: GcodePostOptions = {}
): GcodePostPreflightResult {
  const projection = projectPathPlanToGcode(plan, segments, options);
  return {
    status: projection.status,
    diagnostics: projection.diagnostics,
    operationStartApproaches:
      projection.status === 'ready'
        ? projection.moves
            .filter((move) => move.reason === 'operation-start-approach')
            .map(({ bodyLineIndex, operationId, startPoint, endPoint }) => ({
              bodyLineIndex,
              operationId,
              startPoint,
              endPoint
            }))
        : []
  };
}

export function postPathPlanToGcode(
  plan: OperationPlan,
  segments: PathSegment[],
  options: GcodePostOptions = {}
): GcodePostResult {
  return projectPathPlanToGcode(plan, segments, options);
}

function projectPathPlanToGcode(
  plan: OperationPlan,
  segments: PathSegment[],
  options: GcodePostOptions = {}
): GcodePostResult {
  const diagnostics: PathDiagnostic[] = [];
  let diagnosticNumber = 0;
  const nextDiagnosticId = () =>
    `diag_post_${String(++diagnosticNumber).padStart(4, '0')}`;
  const block = (message: string, relatedSegmentIds?: string[]) => {
    diagnostics.push({
      id: nextDiagnosticId(),
      severity: 'error',
      code: 'post-invalid-input',
      message,
      ...(relatedSegmentIds?.length ? { relatedSegmentIds } : {})
    });
    return blockedPost(diagnostics);
  };

  if (!plan || !Array.isArray(plan.operations) || !Array.isArray(segments)) {
    return block('Cannot post because the operation plan or segment collection is invalid.');
  }

  const endpointTolerance = normalizedPostTolerance(
    options.endpointTolerance,
    DEFAULT_PATH_PLANNING_OPTIONS.endpointTolerance
  );
  const coincidenceEpsilon = normalizedPostTolerance(
    options.coincidenceEpsilon,
    DEFAULT_PATH_PLANNING_OPTIONS.coincidenceEpsilon
  );
  if (endpointTolerance === null || coincidenceEpsilon === null) {
    return block('Cannot post because endpoint tolerances must be finite non-negative numbers.');
  }
  const effectiveEndpointTolerance = Math.max(endpointTolerance, coincidenceEpsilon);
  const arcCenterMode = options.arcCenterMode ?? 'incremental';
  if (arcCenterMode !== 'absolute' && arcCenterMode !== 'incremental') {
    return block(`Cannot post unsupported arc-center mode ${String(arcCenterMode)}.`);
  }
  const formatter = createCoordinateFormatter(options.coordinatePrecision);
  const operationStartMode = options.operationStartMode ?? 'rapid';
  if (operationStartMode !== 'rapid' && operationStartMode !== 'linear') {
    return block(`Cannot post unsupported operation-start mode ${String(operationStartMode)}.`);
  }
  const initialPosition = options.initialPosition ?? null;
  const initialFormattedPosition = initialPosition
    ? formattedPoint(initialPosition, formatter)
    : null;
  if (initialPosition && (!finitePoint(initialPosition) || !initialFormattedPosition)) {
    return block('Cannot post a non-finite or unformattable initial machine position.');
  }
  const segmentsById = new Map<string, PathSegment>();
  for (const segment of segments) {
    if (!segment || typeof segment.id !== 'string' || segment.id.length === 0) {
      return block('Cannot post a segment without a valid ID.');
    }
    if (segmentsById.has(segment.id)) {
      return block(`Cannot post duplicate segment ID ${segment.id}.`, [segment.id]);
    }
    const issue = executableSegmentIssue(
      segment,
      arcCenterMode,
      formatter,
      coincidenceEpsilon
    );
    if (issue) return block(issue, [segment.id]);
    segmentsById.set(segment.id, segment);
  }

  const operationIds = new Set<string>();
  for (const operation of plan.operations) {
    const issue = operationIssue(
      operation,
      segmentsById,
      effectiveEndpointTolerance,
      arcCenterMode,
      formatter
    );
    if (issue) return block(issue.message, issue.relatedSegmentIds);
    if (operationIds.has(operation.id)) {
      return block(`Cannot post duplicate operation ID ${operation.id}.`);
    }
    operationIds.add(operation.id);
  }

  const lines: string[] = [];
  const moves: GcodePostedMove[] = [];
  const postedOperations: GcodePostedOperation[] = [];
  let currentPosition: Point2 | null = initialPosition;
  let currentFormattedPosition: FormattedPoint | null = initialFormattedPosition;

  const appendMove = (move: Omit<GcodePostedMove, 'bodyLineIndex'>): GcodePostedMove => {
    const postedMove = { ...move, bodyLineIndex: lines.length };
    lines.push(postedMove.text);
    moves.push(postedMove);
    return postedMove;
  };

  for (const operation of plan.operations) {
    const operationMoves: GcodePostedMove[] = [];
    const appendOperationMove = (
      move: Omit<GcodePostedMove, 'bodyLineIndex' | 'contourId' | 'operationId'>
    ) => {
      const postedMove = appendMove({
        ...move,
        contourId: operation.contourId,
        operationId: operation.id
      });
      operationMoves.push(postedMove);
      currentPosition = postedMove.endPoint;
      currentFormattedPosition = formattedPoint(postedMove.endPoint, formatter);
      return postedMove;
    };

    const entryPoint = operationEntryPoint(operation);
    const formattedEntryPoint = formattedPoint(entryPoint, formatter);
    if (!formattedEntryPoint) {
      return block('Cannot post a non-finite or unformattable operation entry point.');
    }
    const needsOperationStartRapid =
      !pointsEqualNullable(currentPosition, entryPoint, coincidenceEpsilon) ||
      !formattedPointsEqualNullable(currentFormattedPosition, formattedEntryPoint);
    if (needsOperationStartRapid) {
      const command = operationStartMode === 'linear' ? 'G1' as const : 'G0' as const;
      appendOperationMove({
        command,
        endPoint: entryPoint,
        kind: operationStartMode === 'linear' ? 'cut' : 'rapid',
        reason:
          operationStartMode === 'linear'
            ? 'operation-start-approach'
            : 'operation-start',
        segmentId: null,
        startPoint: currentPosition,
        text: `${command} X${formattedEntryPoint.x} Y${formattedEntryPoint.y}`
      });
    }

    const leadIn = operation.overrides?.leadIn;
    if (leadIn && !pointsWithinTolerance(leadIn.from, leadIn.to, coincidenceEpsilon)) {
      const text = xy(leadIn.to, formatter);
      if (!text) return block('Cannot post a non-finite or unformattable manual lead-in point.');
      appendOperationMove({
        command: 'G1',
        endPoint: leadIn.to,
        kind: 'cut',
        reason: 'manual-lead-in',
        segmentId: leadIn.sourceSegmentId,
        startPoint: leadIn.from,
        text: `G1 ${text}`
      });
    }

    for (const ref of operation.segmentRefs) {
      const segment = segmentsById.get(ref.segmentId)!;
      const segmentStart = orientedSegmentStart(segment, ref);
      const bridge = bridgeToSegmentStart(
        currentPosition,
        currentFormattedPosition,
        segmentStart,
        ref,
        effectiveEndpointTolerance,
        coincidenceEpsilon,
        formatter,
        nextDiagnosticId
      );
      diagnostics.push(...bridge.diagnostics);
      if (bridge.blockingMessage) {
        diagnostics.push({
          id: nextDiagnosticId(),
          severity: 'error',
          code: 'post-unexpected-gap',
          message: bridge.blockingMessage,
          relatedSegmentIds: [ref.segmentId],
          details: bridge.details
        });
        return blockedPost(diagnostics);
      }
      if (bridge.move) appendOperationMove(bridge.move);

      const rendered = renderSegmentMoves(segment, ref, arcCenterMode, formatter);
      if (rendered.error) return block(rendered.error, [segment.id]);
      rendered.moves.forEach(appendOperationMove);
    }

    if (operation.closed) {
      const lastRef = operation.segmentRefs[operation.segmentRefs.length - 1];
      const bridge = bridgeToSegmentStart(
        currentPosition,
        currentFormattedPosition,
        operation.startPoint,
        lastRef,
        effectiveEndpointTolerance,
        coincidenceEpsilon,
        formatter,
        nextDiagnosticId
      );
      diagnostics.push(...bridge.diagnostics);
      if (bridge.blockingMessage) {
        diagnostics.push({
          id: nextDiagnosticId(),
          severity: 'error',
          code: 'post-unexpected-gap',
          message: bridge.blockingMessage,
          relatedSegmentIds: [lastRef.segmentId],
          details: bridge.details
        });
        return blockedPost(diagnostics);
      }
      if (bridge.move) appendOperationMove(bridge.move);
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

  return {
    status: 'ready',
    body: lines.join('\n'),
    diagnostics,
    metrics: {
      rapidCount: moves.filter((move) => move.kind === 'rapid').length,
      cutMoveCount: moves.filter((move) => move.kind === 'cut').length
    },
    moves,
    operations: postedOperations
  };
}

function operationIssue(
  operation: PathOperation,
  segmentsById: Map<string, PathSegment>,
  tolerance: number,
  arcCenterMode: GcodeArcCenterMode,
  formatter: CoordinateFormatter
): { message: string; relatedSegmentIds?: string[] } | null {
  if (!operation || typeof operation.id !== 'string' || !Array.isArray(operation.segmentRefs)) {
    return { message: 'Cannot post an invalid operation record.' };
  }
  if (operation.segmentRefs.length === 0) {
    return { message: `Cannot post operation ${operation.id} without segment refs.` };
  }
  if (!finitePoint(operation.startPoint) || !finitePoint(operation.endPoint)) {
    return { message: `Cannot post operation ${operation.id} with non-finite endpoints.` };
  }
  if (!xy(operationEntryPoint(operation), formatter)) {
    return { message: `Cannot post operation ${operation.id} with an unformattable entry point.` };
  }
  const leadIn = operation.overrides?.leadIn;
  if (leadIn) {
    if (!finitePoint(leadIn.from) || !finitePoint(leadIn.to)) {
      return { message: `Cannot post operation ${operation.id} with non-finite lead-in points.` };
    }
    if (!segmentsById.has(leadIn.sourceSegmentId)) {
      return {
        message: `Cannot post operation ${operation.id}; lead-in segment ${leadIn.sourceSegmentId} is missing.`,
        relatedSegmentIds: [leadIn.sourceSegmentId]
      };
    }
    if (!pointsWithinTolerance(leadIn.to, operation.startPoint, tolerance)) {
      return { message: `Cannot post operation ${operation.id}; its lead-in does not end at the operation start.` };
    }
  }

  const resolved: Array<{ ref: OrientedSegmentRef; segment: PathSegment }> = [];
  for (const ref of operation.segmentRefs) {
    if (!ref || typeof ref.segmentId !== 'string' || typeof ref.reversed !== 'boolean') {
      return { message: `Cannot post operation ${operation.id} with an invalid segment ref.` };
    }
    const segment = segmentsById.get(ref.segmentId);
    if (!segment) {
      return {
        message: `Cannot post operation ${operation.id}; segment ${ref.segmentId} is missing.`,
        relatedSegmentIds: [ref.segmentId]
      };
    }
    const rendered = renderSegmentMoves(segment, ref, arcCenterMode, formatter);
    if (rendered.error) return { message: rendered.error, relatedSegmentIds: [segment.id] };
    resolved.push({ ref, segment });
  }

  const actualStart = orientedSegmentStart(resolved[0].segment, resolved[0].ref);
  const actualEnd = orientedSegmentEnd(resolved[resolved.length - 1].segment, resolved.at(-1)!.ref);
  if (!pointsWithinTolerance(operation.startPoint, actualStart, tolerance)) {
    return { message: `Cannot post operation ${operation.id}; its start point disagrees with its first segment.` };
  }
  if (!pointsWithinTolerance(operation.endPoint, operation.closed ? operation.startPoint : actualEnd, tolerance)) {
    return { message: `Cannot post operation ${operation.id}; its end point disagrees with its segment path.` };
  }

  return null;
}

function executableSegmentIssue(
  segment: PathSegment,
  arcCenterMode: GcodeArcCenterMode,
  formatter: CoordinateFormatter,
  coincidenceEpsilon: number
) {
  if (!['line', 'arc', 'circle'].includes(segment.kind)) {
    return `Cannot post segment ${segment.id} with unsupported kind ${String(segment.kind)}.`;
  }
  if (!finitePoint(segment.start) || !finitePoint(segment.end)) {
    return `Cannot post segment ${segment.id} with non-finite endpoints.`;
  }
  if (segment.kind === 'line') {
    return !xy(segment.start, formatter) || !xy(segment.end, formatter)
      ? `Cannot post segment ${segment.id} with unformattable endpoints.`
      : null;
  }
  if (!finitePoint(segment.center) || !finitePositive(segment.radius)) {
    return `Cannot post segment ${segment.id} with invalid circular geometry.`;
  }
  if (segment.kind === 'arc') {
    if (typeof segment.clockwise !== 'boolean') {
      return `Cannot post arc ${segment.id} with an invalid clockwise flag.`;
    }
    if (
      !Number.isFinite(segment.startAngleRadians) ||
      !Number.isFinite(segment.endAngleRadians) ||
      !Number.isFinite(segment.sweepRadians) ||
      segment.sweepRadians === 0
    ) {
      return `Cannot post arc ${segment.id} with invalid angular geometry.`;
    }
    if (arcCenterMode === 'incremental') {
      const i = segment.center.x - segment.start.x;
      const j = segment.center.y - segment.start.y;
      if (!Number.isFinite(i) || !Number.isFinite(j)) {
        return `Cannot post arc ${segment.id}; its incremental arc-center offset is non-finite.`;
      }
    }
    if (!pathSegmentHasConsistentArcAngularGeometry(segment, coincidenceEpsilon)) {
      return `Cannot post arc ${segment.id} because its stored angular geometry disagrees with its endpoints.`;
    }
    if (!pathSegmentHasExecutableCircularGeometry(segment, coincidenceEpsilon)) {
      return `Cannot post segment ${segment.id} because its circular geometry is not executable.`;
    }
    return !xy(segment.start, formatter) || !xy(segment.end, formatter)
      ? `Cannot post segment ${segment.id} with unformattable endpoints.`
      : null;
  }
  if (!finitePoint(segment.preferredStart)) {
    return `Cannot post circle ${segment.id} with a non-finite preferred start.`;
  }
  const opposite = oppositeCirclePoint(segment);
  if (!finitePoint(opposite)) {
    return `Cannot post circle ${segment.id}; its derived opposite point is non-finite.`;
  }
  if (arcCenterMode === 'incremental') {
    for (const start of [segment.preferredStart, opposite]) {
      const i = segment.center.x - start.x;
      const j = segment.center.y - start.y;
      if (!Number.isFinite(i) || !Number.isFinite(j)) {
        return `Cannot post circle ${segment.id}; its incremental arc-center offset is non-finite.`;
      }
    }
  }
  if (!pathSegmentHasExecutableCircularGeometry(segment, coincidenceEpsilon)) {
    return `Cannot post segment ${segment.id} because its circular geometry is not executable.`;
  }
  return !xy(segment.start, formatter) || !xy(segment.end, formatter)
    ? `Cannot post segment ${segment.id} with unformattable endpoints.`
    : null;
}

function bridgeToSegmentStart(
  currentPosition: Point2 | null,
  currentFormattedPosition: FormattedPoint | null,
  target: Point2,
  ref: OrientedSegmentRef,
  endpointTolerance: number,
  coincidenceEpsilon: number,
  formatter: CoordinateFormatter,
  nextDiagnosticId: () => string
) {
  const diagnostics: PathDiagnostic[] = [];
  if (!currentPosition) {
    return { diagnostics, move: null, blockingMessage: null, details: undefined };
  }

  const gap = distance(currentPosition, target);
  const formattedTarget = formattedPoint(target, formatter);
  if (!formattedTarget) {
    return {
      diagnostics,
      move: null,
      blockingMessage: 'Cannot post a non-finite or unformattable segment-start target.',
      details: { gap, endpointTolerance }
    };
  }
  if (pointsWithinTolerance(currentPosition, target, coincidenceEpsilon)) {
    if (formattedPointsEqualNullable(currentFormattedPosition, formattedTarget)) {
      return { diagnostics, move: null, blockingMessage: null, details: undefined };
    }
    return {
      diagnostics,
      move: null,
      blockingMessage:
        'Blocked posting because coincident raw endpoints round to different machine coordinates.',
      details: { gap, endpointTolerance }
    };
  }

  if (Number.isFinite(gap) && gap <= endpointTolerance) {
    const targetWords = `X${formattedTarget.x} Y${formattedTarget.y}`;
    diagnostics.push({
      id: nextDiagnosticId(),
      severity: 'warning',
      code: 'post-bridged-gap',
      message: `Bridged a ${formatDiagnosticNumber(gap)} endpoint gap inside tolerance while posting G-code.`,
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
        text: `G1 ${targetWords}`
      },
      blockingMessage: null,
      details: undefined
    };
  }

  return {
    diagnostics,
    move: null,
    blockingMessage: `Blocked posting across a ${formatDiagnosticNumber(gap)} gap because the next segment is not continuous.`,
    details: { gap, endpointTolerance }
  };
}

function renderSegmentMoves(
  segment: PathSegment,
  ref: OrientedSegmentRef,
  arcCenterMode: GcodeArcCenterMode,
  formatter: CoordinateFormatter
): RenderedSegmentMoves {
  if (segment.kind === 'line') {
    const start = orientedSegmentStart(segment, ref);
    const end = orientedSegmentEnd(segment, ref);
    const endWords = xy(end, formatter);
    if (!endWords) return { moves: [], error: `Cannot format line segment ${segment.id}.` };
    return {
      error: null,
      moves: [
        {
          command: 'G1',
          endPoint: end,
          kind: 'cut',
          reason: 'segment-cut',
          segmentId: segment.id,
          startPoint: start,
          text: `G1 ${endWords}`
        }
      ]
    };
  }
  return segment.kind === 'arc'
    ? renderArcMove(segment, ref, arcCenterMode, formatter)
    : renderCircleMoves(segment, ref, arcCenterMode, formatter);
}

function renderArcMove(
  segment: ArcPathSegment,
  ref: OrientedSegmentRef,
  arcCenterMode: GcodeArcCenterMode,
  formatter: CoordinateFormatter
): RenderedSegmentMoves {
  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);
  const command: 'G2' | 'G3' = orientedArcClockwise(segment, ref) ? 'G2' : 'G3';
  const endWords = xy(end, formatter);
  const centerWords = ij(segment.center, start, arcCenterMode, formatter);
  if (!endWords || !centerWords) {
    return {
      moves: [],
      error: `Cannot format arc ${segment.id}; an X/Y/I/J value is invalid or non-finite.`
    };
  }
  const fullTurn =
    Math.abs(Math.abs(segment.sweepRadians) - 2 * Math.PI) <=
    64 * Number.EPSILON * 2 * Math.PI;
  if (arcMoveHasInvalidFormattedGeometry(segment.center, start, end, arcCenterMode, formatter, fullTurn)) {
    return {
      moves: [],
      error: `Cannot format arc ${segment.id}; selected coordinate precision cannot represent a consistent nonzero radius and endpoints.`
    };
  }
  return {
    error: null,
    moves: [
      {
        command,
        endPoint: end,
        kind: 'cut',
        reason: 'segment-cut',
        segmentId: segment.id,
        startPoint: start,
        text: `${command} ${endWords} ${centerWords}`
      }
    ]
  };
}

function renderCircleMoves(
  segment: CirclePathSegment,
  ref: OrientedSegmentRef,
  arcCenterMode: GcodeArcCenterMode,
  formatter: CoordinateFormatter
): RenderedSegmentMoves {
  const command: 'G2' | 'G3' = orientedCircleClockwise(segment, ref) ? 'G2' : 'G3';
  const start = segment.preferredStart;
  const opposite = oppositeCirclePoint(segment);
  const oppositeWords = xy(opposite, formatter);
  const startWords = xy(start, formatter);
  const firstCenterWords = ij(segment.center, start, arcCenterMode, formatter);
  const secondCenterWords = ij(segment.center, opposite, arcCenterMode, formatter);
  if (!oppositeWords || !startWords || !firstCenterWords || !secondCenterWords) {
    return {
      moves: [],
      error: `Cannot format circle ${segment.id}; a derived X/Y/I/J value is invalid or non-finite.`
    };
  }
  if (
    arcMoveHasInvalidFormattedGeometry(
      segment.center,
      start,
      opposite,
      arcCenterMode,
      formatter,
      false
    ) ||
    arcMoveHasInvalidFormattedGeometry(
      segment.center,
      opposite,
      start,
      arcCenterMode,
      formatter,
      false
    )
  ) {
    return {
      moves: [],
      error: `Cannot format circle ${segment.id}; selected coordinate precision cannot represent consistent nonzero half-turn geometry.`
    };
  }
  return {
    error: null,
    moves: [
      {
        command,
        endPoint: opposite,
        kind: 'cut',
        reason: 'segment-cut',
        segmentId: segment.id,
        startPoint: start,
        text: `${command} ${oppositeWords} ${firstCenterWords}`
      },
      {
        command,
        endPoint: start,
        kind: 'cut',
        reason: 'segment-cut',
        segmentId: segment.id,
        startPoint: opposite,
        text: `${command} ${startWords} ${secondCenterWords}`
      }
    ]
  };
}

function blockedPost(diagnostics: PathDiagnostic[]): GcodePostResult {
  return {
    status: 'blocked',
    body: '',
    diagnostics: [...diagnostics],
    metrics: { rapidCount: 0, cutMoveCount: 0 },
    moves: [],
    operations: []
  };
}

function operationEntryPoint(operation: PathOperation) {
  return operation.overrides?.leadIn?.from ?? operation.startPoint;
}

function oppositeCirclePoint(segment: CirclePathSegment) {
  return {
    x: segment.center.x - (segment.preferredStart.x - segment.center.x),
    y: segment.center.y - (segment.preferredStart.y - segment.center.y)
  };
}

function pointsEqualNullable(a: Point2 | null, b: Point2, epsilon: number) {
  return !!a && pointsWithinTolerance(a, b, epsilon);
}

function pointsWithinTolerance(a: Point2, b: Point2, tolerance: number) {
  const gap = distance(a, b);
  return Number.isFinite(gap) && gap <= tolerance;
}

function xy(point: Point2, formatter: CoordinateFormatter) {
  const formatted = formattedPoint(point, formatter);
  return formatted ? `X${formatted.x} Y${formatted.y}` : null;
}

export function formatGcodePointWords(point: Point2, coordinatePrecision?: number) {
  return xy(point, createCoordinateFormatter(coordinatePrecision));
}

function ij(
  center: Point2,
  start: Point2,
  mode: GcodeArcCenterMode,
  formatter: CoordinateFormatter
) {
  const iValue = mode === 'absolute' ? center.x : center.x - start.x;
  const jValue = mode === 'absolute' ? center.y : center.y - start.y;
  if (!Number.isFinite(iValue) || !Number.isFinite(jValue)) return null;
  const formatted = formattedPoint({ x: iValue, y: jValue }, formatter);
  return formatted ? `I${formatted.x} J${formatted.y}` : null;
}

function arcMoveHasInvalidFormattedGeometry(
  center: Point2,
  start: Point2,
  end: Point2,
  mode: GcodeArcCenterMode,
  formatter: CoordinateFormatter,
  fullTurn: boolean
) {
  const formattedStart = formattedPoint(start, formatter);
  const formattedEnd = formattedPoint(end, formatter);
  const formattedCenter = formattedPoint(
    mode === 'absolute'
      ? center
      : { x: center.x - start.x, y: center.y - start.y },
    formatter
  );
  if (!formattedStart || !formattedEnd || !formattedCenter) return true;

  const numericStart = numericFormattedPoint(formattedStart);
  const numericEnd = numericFormattedPoint(formattedEnd);
  const numericCenterWords = numericFormattedPoint(formattedCenter);
  if (!numericStart || !numericEnd || !numericCenterWords) return true;
  const numericCenter =
    mode === 'absolute'
      ? numericCenterWords
      : {
          x: numericStart.x + numericCenterWords.x,
          y: numericStart.y + numericCenterWords.y
        };
  if (!Number.isFinite(numericCenter.x) || !Number.isFinite(numericCenter.y)) return true;

  const startRadius = Math.hypot(
    numericStart.x - numericCenter.x,
    numericStart.y - numericCenter.y
  );
  const endRadius = Math.hypot(
    numericEnd.x - numericCenter.x,
    numericEnd.y - numericCenter.y
  );
  const coordinateQuantum = formattedCoordinateQuantum(formattedStart.x);
  const maximumRadius = Math.max(startRadius, endRadius);
  const radiusTolerance = Math.max(
    64 * Number.EPSILON * Math.max(1, maximumRadius),
    Math.min(3 * coordinateQuantum, 1e-3 * maximumRadius)
  );
  const radiusCollapses =
    startRadius === 0 || endRadius === 0 || !Number.isFinite(startRadius) || !Number.isFinite(endRadius);
  const radiiDisagree = Math.abs(startRadius - endRadius) > radiusTolerance;
  const endpointsCollapse = !fullTurn && sameFormattedPoint(formattedStart, formattedEnd);
  return radiusCollapses || radiiDisagree || endpointsCollapse;
}

function formattedPoint(point: Point2, formatter: CoordinateFormatter) {
  const x = formatter(point.x);
  const y = formatter(point.y);
  return x === null || y === null ? null : { x, y };
}

function sameFormattedPoint(
  left: FormattedPoint,
  right: FormattedPoint
) {
  return left.x === right.x && left.y === right.y;
}

function formattedPointsEqualNullable(
  left: FormattedPoint | null,
  right: FormattedPoint
) {
  return !!left && sameFormattedPoint(left, right);
}

function numericFormattedPoint(point: FormattedPoint) {
  const x = Number(point.x);
  const y = Number(point.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function formattedCoordinateQuantum(value: string) {
  const fractionDigits = value.includes('.') ? value.length - value.indexOf('.') - 1 : 0;
  return 10 ** -fractionDigits;
}

function createCoordinateFormatter(precision: number | undefined): CoordinateFormatter {
  const normalizedPrecision = normalizePostCoordinatePrecision(precision);
  return (value) => {
    if (!Number.isFinite(value)) return null;
    const formatted = fixedDecimal(value, normalizedPrecision);
    if (!/^-?\d+(?:\.\d+)?$/.test(formatted)) return null;
    return formatted.startsWith('-') && Number(formatted) === 0 ? formatted.slice(1) : formatted;
  };
}

function fixedDecimal(value: number, precision: number) {
  const fixed = value.toFixed(precision);
  if (!/[eE]/.test(fixed)) return fixed;

  const raw = value.toString();
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [coefficient, exponentText = '0'] = unsigned.toLowerCase().split('e');
  const exponent = Number(exponentText);
  const decimalIndex = coefficient.indexOf('.') === -1 ? coefficient.length : coefficient.indexOf('.');
  const digits = coefficient.replace('.', '');
  const shiftedIndex = decimalIndex + exponent;
  const integer =
    shiftedIndex <= 0
      ? '0'
      : shiftedIndex >= digits.length
        ? `${digits}${'0'.repeat(shiftedIndex - digits.length)}`
        : digits.slice(0, shiftedIndex);
  const rawFraction =
    shiftedIndex <= 0
      ? `${'0'.repeat(-shiftedIndex)}${digits}`
      : shiftedIndex < digits.length
        ? digits.slice(shiftedIndex)
        : '';
  const fraction = precision > 0 ? `${rawFraction}${'0'.repeat(precision)}`.slice(0, precision) : '';
  return `${negative ? '-' : ''}${integer}${precision > 0 ? `.${fraction}` : ''}`;
}

function normalizePostCoordinatePrecision(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
    ? value
    : 3;
}

function normalizedPostTolerance(value: number | undefined, fallback: number) {
  const candidate = value ?? fallback;
  return Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
}

function finitePoint(value: unknown): value is Point2 {
  if (!value || typeof value !== 'object') return false;
  const point = value as Point2;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function formatDiagnosticNumber(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(9)).toString() : String(value);
}
