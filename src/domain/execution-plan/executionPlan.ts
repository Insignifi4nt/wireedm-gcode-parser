import { resolveControllerCompensation } from '@/domain/compensation/resolveControllerCompensation';
import { deriveActiveMachiningOperations } from '@/domain/path-intel/machiningParticipation';
import { resolveInitialWirePosition } from '@/domain/path-intel/initialWirePosition';
import { classifyPositioningMaterial } from '@/domain/path-intel/positioningMaterial';
import { orderedPathOperations } from '@/domain/path-intel/operationExecutionOrder';
import { operationEntryPoint } from '@/domain/path-intel/operationTransitions';
import { resolveOperationProgramStopPoints } from '@/domain/path-intel/programStops';
import {
  orientedArcClockwise,
  orientedCircleClockwise,
  orientedSegmentEnd,
  orientedSegmentStart,
  pointsEqual as coincidentPoints,
  segmentMap
} from '@/domain/path-intel/segments';
import type {
  MachiningSpan,
  OperationProgramStop,
  OperationThreadingTransition,
  PathOperation,
  PathPlanningDocument,
  PathSegment,
  Point2
} from '@/domain/path-intel/types';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';

export const EXECUTION_PLAN_SCHEMA_VERSION = 1 as const;

interface ExecutionEventBase {
  readonly id: string;
  readonly ordinal: number;
  readonly operationId: string | null;
  readonly trace: readonly [ExecutionSourceRef, ...ExecutionSourceRef[]];
}

export type ExecutionSourceRef =
  | { readonly kind: 'program' }
  | { readonly kind: 'operation'; readonly operationId: string }
  | {
      readonly kind: 'segment';
      readonly operationId: string;
      readonly segmentId: string;
      readonly sourceRange: { readonly start: number; readonly end: number };
    }
  | {
      readonly kind: 'transition';
      readonly operationId: string;
      readonly role: 'entry' | 'exit' | 'position' | 'threading';
    }
  | {
      readonly kind: 'program-stop';
      readonly operationId: string;
      readonly stopId: string;
    };

export type ExecutionMotionRole = 'entry' | 'contour' | 'exit';

export type WireEdmExecutionEvent =
  | (ExecutionEventBase & {
      readonly kind: 'program-start';
      readonly initialWirePosition: Point2;
    })
  | (ExecutionEventBase & {
      readonly kind: 'operation-start';
      readonly name: string;
      readonly orderIndex: number;
    })
  | (ExecutionEventBase & {
      readonly kind: 'pass-start';
      readonly passId: string;
      readonly passOrdinal: 1;
      readonly purpose: 'single-cut';
      readonly technology: { readonly kind: 'none' };
    })
  | (ExecutionEventBase & {
      readonly kind: 'wire-continue';
    })
  | (ExecutionEventBase & {
      readonly kind: 'wire-separate';
      readonly method: 'manual' | 'automatic';
    })
  | (ExecutionEventBase & {
      readonly kind: 'wire-thread';
      readonly method: 'manual' | 'automatic';
    })
  | (ExecutionEventBase & {
      readonly kind: 'position';
      readonly from: Point2;
      readonly to: Point2;
      readonly separatesWire?: true;
    })
  | (ExecutionEventBase & {
      readonly kind: 'compensation-start';
      readonly wireSide: 'left' | 'right';
      readonly keptMaterial: 'inside' | 'outside' | null;
      readonly source: 'automatic' | 'manual';
    })
  | (ExecutionEventBase & {
      readonly kind: 'motion';
      readonly motion: 'linear' | 'circular';
      readonly role: ExecutionMotionRole;
      readonly start: Point2;
      readonly end: Point2;
      readonly center?: Point2;
      readonly clockwise?: boolean;
      readonly fullCircle?: boolean;
      readonly sourceSegmentId: string | null;
      readonly sourceRange?: { readonly start: number; readonly end: number };
    })
  | (ExecutionEventBase & {
      readonly kind: 'program-stop';
      readonly stopId: string;
      readonly placement: OperationProgramStop['placement']['kind'];
      readonly reason: OperationProgramStop['reason'];
      readonly note: string | null;
      readonly point: Point2;
    })
  | (ExecutionEventBase & { readonly kind: 'compensation-end' })
  | (ExecutionEventBase & { readonly kind: 'pass-end'; readonly passId: string })
  | (ExecutionEventBase & { readonly kind: 'operation-end' })
  | (ExecutionEventBase & { readonly kind: 'program-end' });

export interface WireEdmExecutionRequirements {
  readonly circularInterpolation: readonly ('clockwise' | 'counterclockwise')[];
  readonly controllerCompensation: boolean;
  readonly operationCount: number;
  readonly programStops: boolean;
  readonly threading: readonly Exclude<OperationThreadingTransition['mode'], 'continuous'>[];
  readonly wireSeparation: boolean;
}

export interface WireEdmExecutionPlan {
  readonly format: 'wire-edm-execution-plan';
  readonly schemaVersion: typeof EXECUTION_PLAN_SCHEMA_VERSION;
  readonly coordinateFrame: {
    readonly units: 'millimeters';
    readonly axes: 'xy';
    readonly geometryBasis: PathPlanningDocument['geometryBasis'];
  };
  readonly tolerance: {
    readonly endpointMm: number;
    readonly coincidenceMm: number;
  };
  readonly source: {
    readonly upidSchemaVersion: PathPlanningDocument['schemaVersion'];
    readonly operationIds: readonly string[];
  };
  readonly events: readonly WireEdmExecutionEvent[];
  readonly requirements: WireEdmExecutionRequirements;
}

export type ExecutionPlanDiagnosticCode =
  | 'EXECUTION_PLAN_INVALID_UPID'
  | 'EXECUTION_PLAN_MACHINING_UNRESOLVED'
  | 'EXECUTION_PLAN_EMPTY'
  | 'EXECUTION_PLAN_INITIAL_WIRE_REQUIRED'
  | 'EXECUTION_PLAN_THREADING_REQUIRED'
  | 'EXECUTION_PLAN_THREADING_INVALID'
  | 'EXECUTION_PLAN_COMPENSATION_UNRESOLVED'
  | 'EXECUTION_PLAN_TRANSITION_REVIEW_REQUIRED'
  | 'EXECUTION_PLAN_DEGENERATE_TRANSITION'
  | 'EXECUTION_PLAN_DISCONTINUOUS_GEOMETRY'
  | 'EXECUTION_PLAN_PROGRAM_STOP_INVALID';

export interface ExecutionPlanDiagnostic {
  readonly code: ExecutionPlanDiagnosticCode;
  readonly message: string;
  readonly operationId: string | null;
}

export type ExecutionPlanResult =
  | { readonly ok: true; readonly plan: WireEdmExecutionPlan }
  | { readonly ok: false; readonly diagnostics: readonly ExecutionPlanDiagnostic[] };

type ExecutionPlanFailure = Extract<ExecutionPlanResult, { ok: false }>;
type ExecutionEventInput = WireEdmExecutionEvent extends infer Event
  ? Event extends ExecutionEventBase
    ? Omit<Event, keyof ExecutionEventBase>
      & Pick<Event, 'operationId'>
    : never
  : never;

interface MutableEventContext {
  events: WireEdmExecutionEvent[];
  nextEventNumber: number;
  sourceOperationIds: Map<string, string>;
}

export function compileWireEdmExecutionPlan(
  sourceDocument: PathPlanningDocument
): ExecutionPlanResult {
  const validation = validateUpidDocument(sourceDocument);
  if (!validation.valid) {
    return blocked('EXECUTION_PLAN_INVALID_UPID', validation.blockingDiagnostics
      .map(({ message }) => message)
      .join(' '));
  }

  const machining = deriveActiveMachiningOperations(sourceDocument);
  if (machining.status === 'blocked') {
    return blocked(
      'EXECUTION_PLAN_MACHINING_UNRESOLVED',
      `Machining participation could not be resolved: ${machining.reason}.`
    );
  }
  const operations = orderedPathOperations(machining.operations);
  if (operations.length === 0) {
    return blocked('EXECUTION_PLAN_EMPTY', 'The saved UPID contains no active cutting operations.');
  }

  const initialWire = resolveInitialWirePosition(sourceDocument);
  if (initialWire.status === 'blocked') {
    return blocked(
      'EXECUTION_PLAN_INITIAL_WIRE_REQUIRED',
      `A reviewed initial wire position is required: ${initialWire.reason}.`
    );
  }

  const document: PathPlanningDocument = {
    ...sourceDocument,
    segments: machining.segments,
    plan: {
      ...sourceDocument.plan,
      operations
    }
  };
  const segmentsById = segmentMap(document.segments);
  const sourceSpansById = new Map(machining.activeSpans.map((span) => [span.id, span]));
  const sourceOperationIds = new Map(operations.map((operation) => [operation.id,
    operation.machiningIntent?.sourceOperationId ?? operation.id]));
  const context: MutableEventContext = { events: [], nextEventNumber: 1, sourceOperationIds };
  appendEvent(context, {
    kind: 'program-start',
    operationId: null,
    initialWirePosition: copyPoint(initialWire.point)
  });
  let currentPosition = copyPoint(initialWire.point);

  for (const [operationIndex, operation] of operations.entries()) {
    const compiled = compileOperation({
      context,
      currentPosition,
      document,
      operation,
      operationIndex,
      segmentsById,
      sourceSpansById
    });
    if (!compiled.ok) return compiled;
    currentPosition = compiled.endPoint;
  }

  appendEvent(context, { kind: 'program-end', operationId: null });
  const events = context.events;
  const threading = unique(events.flatMap((event) =>
    event.kind === 'wire-thread' ? [event.method] : []
  ));
  const circularInterpolation = unique(events.flatMap((event) =>
    event.kind === 'motion' && event.motion === 'circular'
      ? [event.clockwise ? 'clockwise' as const : 'counterclockwise' as const]
      : []
  ));

  return {
    ok: true,
    plan: deepFreeze({
      format: 'wire-edm-execution-plan' as const,
      schemaVersion: EXECUTION_PLAN_SCHEMA_VERSION,
      coordinateFrame: {
        units: 'millimeters' as const,
        axes: 'xy' as const,
        geometryBasis: document.geometryBasis
      },
      tolerance: {
        endpointMm: document.options.endpointTolerance,
        coincidenceMm: document.options.coincidenceEpsilon
      },
      source: {
        upidSchemaVersion: document.schemaVersion,
        operationIds: [...new Set(sourceOperationIds.values())]
      },
      events,
      requirements: {
        circularInterpolation,
        controllerCompensation: events.some(({ kind }) => kind === 'compensation-start'),
        operationCount: operations.length,
        programStops: events.some(({ kind }) => kind === 'program-stop'),
        threading,
        wireSeparation: events.some((event) => event.kind === 'wire-separate' ||
          (event.kind === 'position' && event.separatesWire === true))
      }
    })
  };
}

function compileOperation(input: {
  context: MutableEventContext;
  currentPosition: Point2;
  document: PathPlanningDocument;
  operation: PathOperation;
  operationIndex: number;
  segmentsById: Map<string, PathSegment>;
  sourceSpansById: Map<string, MachiningSpan>;
}): ExecutionPlanFailure | { ok: true; endPoint: Point2 } {
  const { context, document, operation, operationIndex, segmentsById } = input;
  for (const role of ['entry', 'exit'] as const) {
    const lead = operation.transitions?.[role];
    if (lead && lead.strategy !== 'none' &&
      coincidentPoints(lead.from, lead.to, document.options.coincidenceEpsilon)) {
      return blockedForOperation(
        'EXECUTION_PLAN_DEGENERATE_TRANSITION',
        `Operation ${operation.displayName} ${role} lead has no distinct travel. Choose a different endpoint or explicitly use no ${role}.`,
        operation
      );
    }
  }
  appendEvent(context, {
    kind: 'operation-start',
    operationId: operation.id,
    name: operation.displayName,
    orderIndex: operation.orderIndex
  });
  const passId = `${operation.id}.pass-1`;
  appendEvent(context, {
    kind: 'pass-start',
    operationId: operation.id,
    passId,
    passOrdinal: 1,
    purpose: 'single-cut',
    technology: { kind: 'none' }
  });

  const stops = enabledStops(operation);
  const stopIssue = validateStopIdentity(stops);
  if (stopIssue) return blockedForOperation('EXECUTION_PLAN_PROGRAM_STOP_INVALID', stopIssue, operation);
  appendPlacementStops(context, stops, 'before-entry', operation, input.currentPosition);

  const threading = operationIndex > 0
    ? explicitThreadingTransition(document, operation)
    : null;
  if (operationIndex > 0) {
    if (!threading) {
      return blockedForOperation(
        'EXECUTION_PLAN_THREADING_REQUIRED',
        `Operation ${operation.displayName} requires an explicit threading transition.`,
        operation
      );
    }
    const threadingIssue = threadingTransitionIssue(
      threading,
      operation
    );
    if (threadingIssue) {
      return blockedForOperation('EXECUTION_PLAN_THREADING_INVALID', threadingIssue, operation);
    }
    if (threading.mode === 'continuous') {
      appendEvent(context, { kind: 'wire-continue', operationId: operation.id });
    } else if (threading.wireSeparation !== 'already-separated' &&
      threading.wireSeparation !== 'automatic-during-positioning') {
      appendEvent(context, {
        kind: 'wire-separate',
        operationId: operation.id,
        method: threading.mode
      });
    }
  }

  const entryPoint = operationEntryPoint(operation);
  const material = operationIndex > 0
    ? classifyPositioningMaterial(document, input.currentPosition, entryPoint)
    : null;
  if (threading?.mode === 'continuous' && material?.status === 'crosses-finished-material') {
    return blockedForOperation('EXECUTION_PLAN_THREADING_INVALID',
      `Positioning to ${operation.displayName} crosses ${material.materialLengthMm.toFixed(3)} mm of finished-part material. Separate and rethread the wire.`, operation);
  }
  if (threading?.mode === 'manual' && threading.wireSeparation === 'already-separated' &&
    material?.status === 'crosses-finished-material') {
    return blockedForOperation('EXECUTION_PLAN_THREADING_INVALID',
      `Positioning to ${operation.displayName} crosses finished-part material. Select rapid separation or separate the wire before positioning.`, operation);
  }
  if (threading?.wireSeparation === 'automatic-during-positioning' &&
    pointsEqual(input.currentPosition, entryPoint, document.options.coincidenceEpsilon)) {
    return blockedForOperation('EXECUTION_PLAN_THREADING_INVALID',
      `Operation ${operation.displayName} needs a distinct positioning move to separate the wire.`, operation);
  }
  if (!pointsEqual(input.currentPosition, entryPoint, document.options.coincidenceEpsilon)) {
    appendEvent(context, {
      kind: 'position',
      operationId: operation.id,
      from: copyPoint(input.currentPosition),
      to: copyPoint(entryPoint),
      ...(threading?.wireSeparation === 'automatic-during-positioning' ? { separatesWire: true as const } : {})
    });
  }
  appendPlacementStops(context, stops, 'after-positioning', operation, entryPoint);
  if (threading && threading.mode !== 'continuous') {
    appendEvent(context, {
      kind: 'wire-thread',
      operationId: operation.id,
      method: threading.mode
    });
  }

  const compensation = document.geometryBasis === 'finished-contour' && operation.compensationIntent?.mode === 'controller'
    ? resolveControllerCompensation({ document, operation })
    : null;
  if (compensation?.status === 'blocked') {
    return blockedForOperation(
      'EXECUTION_PLAN_COMPENSATION_UNRESOLVED',
      `Controller compensation for ${operation.displayName} is unresolved: ${compensation.reason}.`,
      operation
    );
  }
  if (compensation?.status === 'ready') {
    const intent = operation.compensationIntent;
    if (!intent || intent.mode !== 'controller') {
      return blockedForOperation(
        'EXECUTION_PLAN_COMPENSATION_UNRESOLVED',
        `Controller compensation for ${operation.displayName} has no controller-side source intent.`,
        operation
      );
    }
    appendEvent(context, {
      kind: 'compensation-start',
      operationId: operation.id,
      wireSide: compensation.wireSide,
      keptMaterial: compensation.keptMaterial,
      source: intent.source
    });
  }

  const entry = operation.transitions?.entry;
  if (entry?.strategy === 'none' && entry.review !== 'reviewed') {
    return blockedForOperation(
      'EXECUTION_PLAN_TRANSITION_REVIEW_REQUIRED',
      `Operation ${operation.displayName} entry decision requires review.`,
      operation
    );
  }
  if (entry && entry.strategy !== 'none') {
    if ('review' in entry && entry.review !== 'reviewed') {
      return blockedForOperation(
        'EXECUTION_PLAN_TRANSITION_REVIEW_REQUIRED',
        `Operation ${operation.displayName} entry transition requires review.`,
        operation
      );
    }
    appendMotion(context, operation.id, 'entry', entry.from, entry.to, null);
  }

  const contourMotions = compileContourMotions(
    operation, segmentsById, document.options.coincidenceEpsilon, input.sourceSpansById
  );
  if (!contourMotions.ok) return contourMotions;
  const distanceStops = resolveOperationProgramStopPoints(operation, segmentsById);
  if (distanceStops.status === 'blocked') {
    return blockedForOperation(
      'EXECUTION_PLAN_PROGRAM_STOP_INVALID',
      `A remaining-distance program stop for ${operation.displayName} cannot be resolved.`,
      operation
    );
  }
  const interleaved = interleaveDistanceStops(contourMotions.motions, distanceStops.stops, operation);
  if (!interleaved.ok) return interleaved;
  for (const item of interleaved.items) {
    if (item.kind === 'motion') appendEvent(context, item.event);
    else appendProgramStop(context, item.stop, operation, item.point);
  }
  const contourEnd = contourMotions.motions.at(-1)?.end ?? entryPoint;
  appendPlacementStops(context, stops, 'after-contour', operation, contourEnd);

  const exit = operation.transitions?.exit;
  let endPoint = copyPoint(contourEnd);
  if (exit?.strategy === 'none' && exit.review !== 'reviewed') {
    return blockedForOperation(
      'EXECUTION_PLAN_TRANSITION_REVIEW_REQUIRED',
      `Operation ${operation.displayName} exit decision requires review.`,
      operation
    );
  }
  if (exit && exit.strategy !== 'none') {
    if (exit.review !== 'reviewed') {
      return blockedForOperation(
        'EXECUTION_PLAN_TRANSITION_REVIEW_REQUIRED',
        `Operation ${operation.displayName} exit transition requires review.`,
        operation
      );
    }
    if (!pointsEqual(contourEnd, exit.from, document.options.coincidenceEpsilon)) {
      return blockedForOperation(
        'EXECUTION_PLAN_DISCONTINUOUS_GEOMETRY',
        `Operation ${operation.displayName} exit is disconnected from its contour.`,
        operation
      );
    }
    appendMotion(context, operation.id, 'exit', exit.from, exit.to, null);
    endPoint = copyPoint(exit.to);
  }
  appendPlacementStops(context, stops, 'after-exit', operation, endPoint);

  if (compensation?.status === 'ready') {
    appendEvent(context, { kind: 'compensation-end', operationId: operation.id });
  }
  appendEvent(context, { kind: 'pass-end', operationId: operation.id, passId });
  appendEvent(context, { kind: 'operation-end', operationId: operation.id });
  return { ok: true, endPoint };
}

type ContourMotionEvent = Extract<ExecutionEventInput, { kind: 'motion' }>;

function compileContourMotions(
  operation: PathOperation,
  segmentsById: Map<string, PathSegment>,
  tolerance: number,
  sourceSpansById: Map<string, MachiningSpan>
): { ok: true; motions: ContourMotionEvent[] } | ExecutionPlanFailure {
  const motions: ContourMotionEvent[] = [];
  let previousEnd: Point2 | null = null;
  for (const [index, ref] of operation.segmentRefs.entries()) {
    const segment = segmentsById.get(ref.segmentId);
    if (!segment) {
      return blockedForOperation(
        'EXECUTION_PLAN_DISCONTINUOUS_GEOMETRY',
        `Operation ${operation.displayName} references missing segment ${ref.segmentId}.`,
        operation
      );
    }
    const start = orientedSegmentStart(segment, ref);
    const end = orientedSegmentEnd(segment, ref);
    if (previousEnd && !pointsEqual(previousEnd, start, tolerance)) {
      return blockedForOperation(
        'EXECUTION_PLAN_DISCONTINUOUS_GEOMETRY',
        `Operation ${operation.displayName} has a gap before segment ${segment.id}.`,
        operation
      );
    }
    const spanId = operation.machiningIntent?.spanIds[index];
    const span = spanId === undefined ? undefined : sourceSpansById.get(spanId);
    const range = span?.range ?? { start: 0, end: 1 };
    motions.push({
      kind: 'motion',
      operationId: operation.id,
      motion: segment.kind === 'line' ? 'linear' : 'circular',
      role: 'contour',
      start: copyPoint(start),
      end: copyPoint(end),
      ...(segment.kind === 'line' ? {} : {
        center: copyPoint(segment.center),
        clockwise: segment.kind === 'arc'
          ? orientedArcClockwise(segment, ref)
          : orientedCircleClockwise(segment, ref),
        fullCircle: segment.kind === 'circle' || Math.abs(segment.sweepRadians) === Math.PI * 2
      }),
      sourceSegmentId: span?.sourceSegmentId ?? segment.id,
      sourceRange: ref.reversed ? { start: range.end, end: range.start } : { ...range }
    });
    previousEnd = end;
  }
  return { ok: true, motions };
}

function interleaveDistanceStops(
  motions: readonly ContourMotionEvent[],
  stops: readonly {
    id: string;
    placement: 'before-operation-end';
    point: Point2;
    remainingCutLengthMm: number;
  }[],
  operation: PathOperation
):
  | { ok: true; items: Array<{ kind: 'motion'; event: ContourMotionEvent } | { kind: 'stop'; stop: OperationProgramStop; point: Point2 }> }
  | ExecutionPlanFailure {
  const stopById = new Map(enabledStops(operation).map((stop) => [stop.id, stop]));
  const totalLength = motions.reduce((total, motion) => total + motionLength(motion), 0);
  const pending = stops
    .map((stop) => ({ ...stop, distanceFromStart: totalLength - stop.remainingCutLengthMm }))
    .sort((left, right) => left.distanceFromStart - right.distanceFromStart);
  const items: Array<
    { kind: 'motion'; event: ContourMotionEvent } |
    { kind: 'stop'; stop: OperationProgramStop; point: Point2 }
  > = [];
  let distanceFromStart = 0;
  let stopIndex = 0;

  for (const motion of motions) {
    const length = motionLength(motion);
    const motionEndDistance = distanceFromStart + length;
    let currentStart = copyPoint(motion.start);
    let currentSourceParameter = motion.sourceRange?.start;
    let splitCurrentMotion = false;
    while (pending[stopIndex] && pending[stopIndex].distanceFromStart <= motionEndDistance) {
      const pendingStop = pending[stopIndex];
      const stop = stopById.get(pendingStop.id);
      if (!stop || pendingStop.distanceFromStart <= distanceFromStart) {
        return blockedForOperation(
          'EXECUTION_PLAN_PROGRAM_STOP_INVALID',
          `Program stop ${pendingStop.id} does not lie inside a contour motion.`,
          operation
        );
      }
      if (!pointsEqual(currentStart, pendingStop.point, 0)) {
        const fraction = (pendingStop.distanceFromStart - distanceFromStart) / length;
        const stopSourceParameter = motion.sourceRange
          ? motion.sourceRange.start +
            (motion.sourceRange.end - motion.sourceRange.start) * fraction
          : undefined;
        items.push({
          kind: 'motion',
          event: {
            ...motion,
            start: currentStart,
            end: copyPoint(pendingStop.point),
            fullCircle: false,
            ...(currentSourceParameter === undefined || stopSourceParameter === undefined
              ? {}
              : { sourceRange: { start: currentSourceParameter, end: stopSourceParameter } })
          }
        });
        currentSourceParameter = stopSourceParameter;
      }
      items.push({ kind: 'stop', stop, point: copyPoint(pendingStop.point) });
      currentStart = copyPoint(pendingStop.point);
      splitCurrentMotion = true;
      stopIndex += 1;
    }
    if (!pointsEqual(currentStart, motion.end, 0) || motion.fullCircle) {
      items.push({
        kind: 'motion',
        event: {
          ...motion,
          start: currentStart,
          fullCircle: motion.fullCircle && !splitCurrentMotion,
          ...(currentSourceParameter === undefined || !motion.sourceRange
            ? {}
            : { sourceRange: { start: currentSourceParameter, end: motion.sourceRange.end } })
        }
      });
    }
    distanceFromStart = motionEndDistance;
  }
  if (stopIndex !== pending.length) {
    return blockedForOperation(
      'EXECUTION_PLAN_PROGRAM_STOP_INVALID',
      `A remaining-distance program stop for ${operation.displayName} is outside its contour.`,
      operation
    );
  }
  return { ok: true, items };
}

function motionLength(motion: ContourMotionEvent) {
  if (motion.motion === 'linear') return distance(motion.start, motion.end);
  if (!motion.center) return Number.NaN;
  const radius = distance(motion.center, motion.start);
  if (motion.fullCircle) return Math.PI * 2 * radius;
  const startAngle = Math.atan2(motion.start.y - motion.center.y, motion.start.x - motion.center.x);
  const endAngle = Math.atan2(motion.end.y - motion.center.y, motion.end.x - motion.center.x);
  const delta = motion.clockwise
    ? positiveAngle(startAngle - endAngle)
    : positiveAngle(endAngle - startAngle);
  return radius * delta;
}

function enabledStops(operation: PathOperation) {
  return (operation.programStops ?? []).filter(({ enabled }) => enabled);
}

function validateStopIdentity(stops: readonly OperationProgramStop[]) {
  const ids = new Set<string>();
  const placements = new Set<string>();
  for (const stop of stops) {
    if (!stop.id || ids.has(stop.id)) return 'Enabled program stops require unique non-empty IDs.';
    ids.add(stop.id);
    const placement = stop.placement.kind === 'before-operation-end'
      ? `${stop.placement.kind}:${stop.placement.remainingCutLengthMm}`
      : stop.placement.kind;
    if (placements.has(placement)) return 'Enabled program stops cannot share an exact placement.';
    placements.add(placement);
  }
  return null;
}

function appendPlacementStops(
  context: MutableEventContext,
  stops: readonly OperationProgramStop[],
  placement: 'before-entry' | 'after-positioning' | 'after-contour' | 'after-exit',
  operation: PathOperation,
  point: Point2
) {
  for (const stop of stops) {
    if (stop.placement.kind === placement) appendProgramStop(context, stop, operation, point);
  }
}

function appendProgramStop(
  context: MutableEventContext,
  stop: OperationProgramStop,
  operation: PathOperation,
  point: Point2
) {
  appendEvent(context, {
    kind: 'program-stop',
    operationId: operation.id,
    stopId: stop.id,
    placement: stop.placement.kind,
    reason: stop.reason,
    note: stop.note ?? null,
    point: copyPoint(point)
  });
}

function appendMotion(
  context: MutableEventContext,
  operationId: string,
  role: ExecutionMotionRole,
  start: Point2,
  end: Point2,
  sourceSegmentId: string | null
) {
  appendEvent(context, {
    kind: 'motion',
    operationId,
    motion: 'linear',
    role,
    start: copyPoint(start),
    end: copyPoint(end),
    sourceSegmentId
  });
}

function explicitThreadingTransition(
  document: PathPlanningDocument,
  operation: PathOperation
): OperationThreadingTransition | null {
  if (operation.threadingTransition) {
    return { ...operation.threadingTransition, source: 'operation-override' };
  }
  return document.setup?.threadingDefault
    ? { ...document.setup.threadingDefault, source: 'project-default' }
    : null;
}

function threadingTransitionIssue(
  transition: OperationThreadingTransition,
  operation: PathOperation
) {
  if (transition.mode === 'continuous') {
    return transition.wireSeparation === 'already-separated'
      ? null
      : `Continuous threading for ${operation.displayName} cannot request wire separation.`;
  }
  if (transition.mode === 'manual') {
    return transition.wireSeparation === 'already-separated' ||
      transition.wireSeparation === 'manual-before-positioning' ||
      transition.wireSeparation === 'automatic-during-positioning'
      ? null
      : `Manual threading for ${operation.displayName} has an incompatible wire-separation strategy.`;
  }
  return transition.wireSeparation === 'automatic-before-positioning'
    ? null
    : `Automatic threading for ${operation.displayName} requires automatic wire separation.`;
}

function appendEvent(
  context: MutableEventContext,
  event: ExecutionEventInput
) {
  const ordinal = context.nextEventNumber++;
  context.events.push({
    ...event,
    id: `event-${String(ordinal).padStart(6, '0')}`,
    ordinal,
    trace: eventTrace(event, context.sourceOperationIds)
  } as WireEdmExecutionEvent);
}

function eventTrace(
  event: ExecutionEventInput,
  sourceOperationIds: Map<string, string>
): [ExecutionSourceRef, ...ExecutionSourceRef[]] {
  if (event.kind === 'program-start' || event.kind === 'program-end') {
    return [{ kind: 'program' }];
  }
  const operationId = event.operationId === null ? null : sourceOperationIds.get(event.operationId);
  if (!operationId) throw new Error(`Execution event ${event.kind} requires operation ownership.`);
  if (event.kind === 'motion' && event.sourceSegmentId && event.sourceRange) {
    return [{
      kind: 'segment',
      operationId,
      segmentId: event.sourceSegmentId,
      sourceRange: { ...event.sourceRange }
    }];
  }
  if (event.kind === 'motion' && (event.role === 'entry' || event.role === 'exit')) {
    return [{ kind: 'transition', operationId, role: event.role }];
  }
  if (event.kind === 'position') {
    return [{ kind: 'transition', operationId, role: 'position' }];
  }
  if (event.kind === 'wire-continue' || event.kind === 'wire-separate' || event.kind === 'wire-thread') {
    return [{ kind: 'transition', operationId, role: 'threading' }];
  }
  if (event.kind === 'program-stop') {
    return [{ kind: 'program-stop', operationId, stopId: event.stopId }];
  }
  return [{ kind: 'operation', operationId }];
}

function blocked(
  code: ExecutionPlanDiagnosticCode,
  message: string
): ExecutionPlanFailure {
  return { ok: false, diagnostics: [{ code, message, operationId: null }] };
}

function blockedForOperation(
  code: ExecutionPlanDiagnosticCode,
  message: string,
  operation: PathOperation
): ExecutionPlanFailure {
  return { ok: false, diagnostics: [{ code, message, operationId: operation.id }] };
}

function pointsEqual(first: Point2, second: Point2, tolerance: number) {
  return distance(first, second) <= Math.max(0, tolerance);
}

function distance(first: Point2, second: Point2) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function positiveAngle(value: number) {
  const fullTurn = Math.PI * 2;
  const remainder = value % fullTurn;
  return remainder < 0 ? remainder + fullTurn : remainder;
}

function copyPoint(point: Point2): Point2 {
  return { x: point.x, y: point.y };
}

function unique<Value>(values: readonly Value[]) {
  return [...new Set(values)];
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((entry) => deepFreeze(entry));
  }
  return value;
}
