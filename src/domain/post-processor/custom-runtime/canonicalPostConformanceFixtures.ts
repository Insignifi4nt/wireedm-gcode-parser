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

export const CANONICAL_POST_PLAN_FIXTURES: Readonly<Record<string, WireEdmExecutionPlan>> =
  deepFreeze({
    'core.single-closed-contour.v1': singleClosedContour
  });

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
