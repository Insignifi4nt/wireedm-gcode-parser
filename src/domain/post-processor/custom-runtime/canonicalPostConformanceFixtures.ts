import type {
  WireEdmExecutionEvent,
  WireEdmExecutionPlan
} from '@/domain/execution-plan/executionPlan';

const operationId = 'canonical.closed-contour';
const passId = `${operationId}.pass-1`;

const events: readonly WireEdmExecutionEvent[] = [
  {
    kind: 'program-start',
    id: 'event-000001',
    ordinal: 1,
    operationId: null,
    trace: [{ kind: 'program' }],
    initialWirePosition: { x: 0, y: 0 }
  },
  {
    kind: 'operation-start',
    id: 'event-000002',
    ordinal: 2,
    operationId,
    trace: [{ kind: 'operation', operationId }],
    name: 'Canonical closed contour',
    orderIndex: 0
  },
  {
    kind: 'pass-start',
    id: 'event-000003',
    ordinal: 3,
    operationId,
    trace: [{ kind: 'operation', operationId }],
    passId,
    passOrdinal: 1,
    purpose: 'single-cut',
    technology: { kind: 'none' }
  },
  motionEvent(4, 'segment.bottom', { x: 0, y: 0 }, { x: 10, y: 0 }),
  motionEvent(5, 'segment.right', { x: 10, y: 0 }, { x: 10, y: 10 }),
  motionEvent(6, 'segment.top', { x: 10, y: 10 }, { x: 0, y: 10 }),
  motionEvent(7, 'segment.left', { x: 0, y: 10 }, { x: 0, y: 0 }),
  {
    kind: 'pass-end',
    id: 'event-000008',
    ordinal: 8,
    operationId,
    trace: [{ kind: 'operation', operationId }],
    passId
  },
  {
    kind: 'operation-end',
    id: 'event-000009',
    ordinal: 9,
    operationId,
    trace: [{ kind: 'operation', operationId }]
  },
  {
    kind: 'program-end',
    id: 'event-000010',
    ordinal: 10,
    operationId: null,
    trace: [{ kind: 'program' }]
  }
];

const singleClosedContour: WireEdmExecutionPlan = {
  format: 'wire-edm-execution-plan',
  schemaVersion: 1,
  coordinateFrame: {
    units: 'millimeters',
    axes: 'xy',
    geometryBasis: 'wire-centre'
  },
  tolerance: {
    endpointMm: 0.001,
    coincidenceMm: 0.001
  },
  source: {
    upidSchemaVersion: 1,
    operationIds: [operationId]
  },
  events,
  requirements: {
    circularInterpolation: [],
    controllerCompensation: false,
    operationCount: 1,
    programStops: false,
    threading: [],
    wireSeparation: false
  }
};

const singleCompensatedDirectContour: WireEdmExecutionPlan = {
  format: 'wire-edm-execution-plan',
  schemaVersion: 1,
  coordinateFrame: { units: 'millimeters', axes: 'xy', geometryBasis: 'finished-contour' },
  tolerance: { endpointMm: 0.001, coincidenceMm: 0.001 },
  source: { upidSchemaVersion: 1, operationIds: ['canonical.direct'] },
  events: [
    programStart(1, { x: 0, y: 0 }),
    operationStart(2, 'canonical.direct', 'Direct compensated contour', 0),
    passStart(3, 'canonical.direct'),
    operationEvent(4, 'canonical.direct', {
      kind: 'compensation-start',
      wireSide: 'left',
      keptMaterial: 'outside',
      source: 'manual'
    }),
    contourMotion(5, 'canonical.direct', 'direct.bottom', { x: 0, y: 0 }, { x: 10, y: 0 }),
    contourMotion(6, 'canonical.direct', 'direct.right', { x: 10, y: 0 }, { x: 10, y: 10 }),
    contourMotion(7, 'canonical.direct', 'direct.top', { x: 10, y: 10 }, { x: 0, y: 10 }),
    contourMotion(8, 'canonical.direct', 'direct.left', { x: 0, y: 10 }, { x: 0, y: 0 }),
    operationEvent(9, 'canonical.direct', { kind: 'compensation-end' }),
    passEnd(10, 'canonical.direct'),
    operationEvent(11, 'canonical.direct', { kind: 'operation-end' }),
    programEnd(12)
  ],
  requirements: {
    circularInterpolation: [],
    controllerCompensation: true,
    operationCount: 1,
    programStops: false,
    threading: [],
    wireSeparation: false
  }
};

const multiCompensatedManualContour: WireEdmExecutionPlan = {
  format: 'wire-edm-execution-plan',
  schemaVersion: 1,
  coordinateFrame: { units: 'millimeters', axes: 'xy', geometryBasis: 'finished-contour' },
  tolerance: { endpointMm: 0.001, coincidenceMm: 0.001 },
  source: { upidSchemaVersion: 1, operationIds: ['canonical.clockwise', 'canonical.counterclockwise'] },
  events: [
    programStart(1, { x: 0, y: 0 }),
    operationStart(2, 'canonical.clockwise', 'Clockwise circle', 0),
    passStart(3, 'canonical.clockwise'),
    operationEvent(4, 'canonical.clockwise', {
      kind: 'compensation-start',
      wireSide: 'right',
      keptMaterial: 'inside',
      source: 'manual'
    }),
    circleMotion(5, 'canonical.clockwise', 'circle.clockwise', { x: 0, y: 0 }, { x: 5, y: 0 }, true),
    operationEvent(6, 'canonical.clockwise', {
      kind: 'program-stop',
      stopId: 'inspect-circle',
      placement: 'after-contour',
      reason: 'operator-check',
      note: 'Inspect the first contour.',
      point: { x: 0, y: 0 }
    }),
    operationEvent(7, 'canonical.clockwise', { kind: 'compensation-end' }),
    passEnd(8, 'canonical.clockwise'),
    operationEvent(9, 'canonical.clockwise', { kind: 'operation-end' }),
    operationStart(10, 'canonical.counterclockwise', 'Counterclockwise circle', 1),
    passStart(11, 'canonical.counterclockwise'),
    operationEvent(12, 'canonical.counterclockwise', { kind: 'wire-separate', method: 'manual' }),
    operationEvent(13, 'canonical.counterclockwise', {
      kind: 'position',
      from: { x: 0, y: 0 },
      to: { x: 20, y: 0 }
    }),
    operationEvent(14, 'canonical.counterclockwise', { kind: 'wire-thread', method: 'manual' }),
    operationEvent(15, 'canonical.counterclockwise', {
      kind: 'compensation-start',
      wireSide: 'left',
      keptMaterial: 'outside',
      source: 'manual'
    }),
    circleMotion(16, 'canonical.counterclockwise', 'circle.counterclockwise', { x: 20, y: 0 }, { x: 25, y: 0 }, false),
    operationEvent(17, 'canonical.counterclockwise', { kind: 'compensation-end' }),
    passEnd(18, 'canonical.counterclockwise'),
    operationEvent(19, 'canonical.counterclockwise', { kind: 'operation-end' }),
    programEnd(20)
  ],
  requirements: {
    circularInterpolation: ['clockwise', 'counterclockwise'],
    controllerCompensation: true,
    operationCount: 2,
    programStops: true,
    threading: ['manual'],
    wireSeparation: true
  }
};

export const CANONICAL_POST_PLAN_FIXTURES: Readonly<Record<string, WireEdmExecutionPlan>> =
  deepFreeze({
    'core.single-closed-contour.v1': singleClosedContour,
    'core.single-compensated-direct.v1': singleCompensatedDirectContour,
    'core.multi-compensated-manual.v1': multiCompensatedManualContour
  });

function programStart(ordinal: number, initialWirePosition: Readonly<{ x: number; y: number }>): WireEdmExecutionEvent {
  return {
    kind: 'program-start',
    id: eventId(ordinal),
    ordinal,
    operationId: null,
    trace: [{ kind: 'program' }],
    initialWirePosition
  };
}

function programEnd(ordinal: number): WireEdmExecutionEvent {
  return {
    kind: 'program-end',
    id: eventId(ordinal),
    ordinal,
    operationId: null,
    trace: [{ kind: 'program' }]
  };
}

function operationStart(
  ordinal: number,
  ownedOperationId: string,
  name: string,
  orderIndex: number
): WireEdmExecutionEvent {
  return operationEvent(ordinal, ownedOperationId, { kind: 'operation-start', name, orderIndex });
}

function passStart(ordinal: number, ownedOperationId: string): WireEdmExecutionEvent {
  return operationEvent(ordinal, ownedOperationId, {
    kind: 'pass-start',
    passId: `${ownedOperationId}.pass-1`,
    passOrdinal: 1,
    purpose: 'single-cut',
    technology: { kind: 'none' }
  });
}

function passEnd(ordinal: number, ownedOperationId: string): WireEdmExecutionEvent {
  return operationEvent(ordinal, ownedOperationId, {
    kind: 'pass-end',
    passId: `${ownedOperationId}.pass-1`
  });
}

type EventWithoutMetadata<Event> = Event extends WireEdmExecutionEvent
  ? Omit<Event, 'id' | 'ordinal' | 'operationId' | 'trace'>
  : never;
type OperationEventInput = EventWithoutMetadata<Exclude<
  WireEdmExecutionEvent,
  { kind: 'program-start' | 'program-end' | 'motion' }
>>;

function operationEvent(
  ordinal: number,
  ownedOperationId: string,
  event: OperationEventInput
): WireEdmExecutionEvent {
  return {
    ...event,
    id: eventId(ordinal),
    ordinal,
    operationId: ownedOperationId,
    trace: [{ kind: 'operation', operationId: ownedOperationId }]
  } as WireEdmExecutionEvent;
}

function contourMotion(
  ordinal: number,
  ownedOperationId: string,
  segmentId: string,
  start: Readonly<{ x: number; y: number }>,
  end: Readonly<{ x: number; y: number }>
): WireEdmExecutionEvent {
  return {
    kind: 'motion',
    id: eventId(ordinal),
    ordinal,
    operationId: ownedOperationId,
    trace: [{ kind: 'segment', operationId: ownedOperationId, segmentId, sourceRange: { start: 0, end: 1 } }],
    motion: 'linear',
    role: 'contour',
    start,
    end,
    sourceSegmentId: segmentId,
    sourceRange: { start: 0, end: 1 }
  };
}

function circleMotion(
  ordinal: number,
  ownedOperationId: string,
  segmentId: string,
  start: Readonly<{ x: number; y: number }>,
  center: Readonly<{ x: number; y: number }>,
  clockwise: boolean
): WireEdmExecutionEvent {
  return {
    kind: 'motion',
    id: eventId(ordinal),
    ordinal,
    operationId: ownedOperationId,
    trace: [{ kind: 'segment', operationId: ownedOperationId, segmentId, sourceRange: { start: 0, end: 1 } }],
    motion: 'circular',
    role: 'contour',
    start,
    end: start,
    center,
    clockwise,
    fullCircle: true,
    sourceSegmentId: segmentId,
    sourceRange: { start: 0, end: 1 }
  };
}

function eventId(ordinal: number) {
  return `event-${String(ordinal).padStart(6, '0')}`;
}

function motionEvent(
  ordinal: number,
  segmentId: string,
  start: Readonly<{ x: number; y: number }>,
  end: Readonly<{ x: number; y: number }>
): WireEdmExecutionEvent {
  return {
    kind: 'motion',
    id: `event-${String(ordinal).padStart(6, '0')}`,
    ordinal,
    operationId,
    trace: [{
      kind: 'segment',
      operationId,
      segmentId,
      sourceRange: { start: 0, end: 1 }
    }],
    motion: 'linear',
    role: 'contour',
    start,
    end,
    sourceSegmentId: segmentId,
    sourceRange: { start: 0, end: 1 }
  };
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((entry) => deepFreeze(entry));
  }
  return value;
}
