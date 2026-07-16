import { resolveInitialWirePosition } from './initialWirePosition';
import { normalizeLegacyOperationTransitions } from './operationTransitions';
import {
  createArcSegment,
  createLineSegment,
  distance,
  orientedSegmentEnd,
  orientedSegmentStart,
  pathCutLength,
  pathEndPoint,
  pathStartPoint,
  pointOnArcAtParameter,
  pointOnCircle,
  segmentMap
} from './segments';
import type {
  MachiningSpan,
  OrientedSegmentRef,
  PathOperation,
  PathPlanningDocument,
  PathSegment,
  Point2
} from './types';

interface SetMachiningSpanInput {
  sourceSegmentId: string;
  range: { start: number; end: number };
  participation: MachiningSpan['participation'];
}

export function setPartialContourCompensationSide(
  document: PathPlanningDocument,
  sourceOperationId: string,
  wireSide: 'left' | 'right' | null
): PathPlanningDocument | null {
  if (!document.plan.operations.some((operation) => operation.id === sourceOperationId)) {
    return null;
  }
  const next = structuredClone(document);
  next.machiningParticipation ??= { spans: [] };
  const settings = next.machiningParticipation.partialContourCompensation ?? [];
  const index = settings.findIndex((setting) => setting.sourceOperationId === sourceOperationId);
  if (wireSide === null) {
    if (index >= 0) settings.splice(index, 1);
  } else if (index >= 0) {
    settings[index] = { sourceOperationId, wireSide };
  } else {
    settings.push({ sourceOperationId, wireSide });
  }
  settings.sort((left, right) => left.sourceOperationId.localeCompare(right.sourceOperationId));
  next.machiningParticipation.partialContourCompensation = settings;
  return next;
}

export function setPartialContourEntryReview(
  document: PathPlanningDocument,
  sourceOperationId: string,
  reviewed: boolean
): PathPlanningDocument | null {
  if (!document.plan.operations.some((operation) => operation.id === sourceOperationId)) {
    return null;
  }
  const derivation = deriveActiveMachiningOperations(document);
  const derivedOperations = derivation.status === 'ready'
    ? derivation.operations.filter(
        (operation) => operation.machiningIntent?.sourceOperationId === sourceOperationId
      )
    : [];
  const entryFingerprint = derivedOperations.length === 1
    ? partialContourEntryFingerprint(derivedOperations[0])
    : null;
  if (reviewed && !entryFingerprint) return null;
  const next = structuredClone(document);
  next.machiningParticipation ??= { spans: [] };
  const reviews = next.machiningParticipation.partialContourEntryReviews ?? [];
  const index = reviews.findIndex((review) => review.sourceOperationId === sourceOperationId);
  if (!reviewed) {
    if (index >= 0) reviews.splice(index, 1);
  } else if (index >= 0) {
    reviews[index] = { sourceOperationId, review: 'reviewed', entryFingerprint: entryFingerprint! };
  } else {
    reviews.push({ sourceOperationId, review: 'reviewed', entryFingerprint: entryFingerprint! });
  }
  reviews.sort((left, right) => left.sourceOperationId.localeCompare(right.sourceOperationId));
  next.machiningParticipation.partialContourEntryReviews = reviews;
  return next;
}

export type ActiveMachiningDerivation =
  | { status: 'ready'; operations: PathOperation[]; segments: PathSegment[] }
  | {
      status: 'blocked';
      reason:
        | 'invalid-span'
        | 'missing-source-segment'
        | 'overlapping-spans'
        | 'multiple-active-groups-require-explicit-semantics';
      operations: [];
      segments: PathSegment[];
    };

export function setMachiningSpanParticipation(
  document: PathPlanningDocument,
  input: SetMachiningSpanInput
): PathPlanningDocument | null {
  const range = normalizeRange(input.range);
  if (!range || !document.segments.some((segment) => segment.id === input.sourceSegmentId)) {
    return null;
  }
  const spans = structuredClone(document.machiningParticipation?.spans ?? []);
  const exactIndex = spans.findIndex((span) =>
    span.sourceSegmentId === input.sourceSegmentId &&
    span.range.start === range.start &&
    span.range.end === range.end
  );
  if (input.participation === 'active-cut') {
    if (exactIndex < 0) return structuredClone(document);
    spans.splice(exactIndex, 1);
  } else {
    if (spans.some((span, index) =>
      index !== exactIndex &&
      span.sourceSegmentId === input.sourceSegmentId &&
      rangesOverlap(span.range, range)
    )) return null;
    const nextSpan: MachiningSpan = {
      id: machiningSpanId(input.sourceSegmentId, range),
      sourceSegmentId: input.sourceSegmentId,
      range,
      participation: input.participation
    };
    if (exactIndex >= 0) spans[exactIndex] = nextSpan;
    else spans.push(nextSpan);
  }
  spans.sort(compareSpans);
  const next = structuredClone(document);
  next.machiningParticipation = {
    ...structuredClone(document.machiningParticipation ?? {}),
    spans
  };
  const affectedOperationIds = new Set(
    document.plan.operations
      .filter((operation) => operation.segmentRefs.some(
        (ref) => ref.segmentId === input.sourceSegmentId
      ))
      .map((operation) => operation.id)
  );
  next.machiningParticipation.partialContourEntryReviews =
    (next.machiningParticipation.partialContourEntryReviews ?? []).filter(
      (review) => !affectedOperationIds.has(review.sourceOperationId)
    );
  return next;
}

export function deriveActiveMachiningOperations(
  document: PathPlanningDocument
): ActiveMachiningDerivation {
  const decisions = (document.machiningParticipation?.spans ?? []).filter(
    (span) => span.participation === 'inactive-reference'
  );
  if (decisions.length === 0) {
    return {
      status: 'ready',
      operations: structuredClone(document.plan.operations),
      segments: structuredClone(document.segments)
    };
  }
  const sourceSegments = segmentMap(document.segments);
  const partialCompensationByOperationId = new Map(
    (document.machiningParticipation?.partialContourCompensation ?? []).map((setting) => [
      setting.sourceOperationId,
      setting.wireSide
    ])
  );
  const reviewedPartialEntryFingerprints = new Map(
    (document.machiningParticipation?.partialContourEntryReviews ?? [])
      .filter((setting) => setting.review === 'reviewed')
      .map((setting) => [setting.sourceOperationId, setting.entryFingerprint])
  );
  const decisionsBySegment = new Map<string, MachiningSpan[]>();
  for (const decision of decisions) {
    if (!sourceSegments.has(decision.sourceSegmentId)) {
      return blocked('missing-source-segment', document.segments);
    }
    if (!normalizeRange(decision.range)) return blocked('invalid-span', document.segments);
    const siblings = decisionsBySegment.get(decision.sourceSegmentId) ?? [];
    if (siblings.some((span) => rangesOverlap(span.range, decision.range))) {
      return blocked('overlapping-spans', document.segments);
    }
    siblings.push(decision);
    decisionsBySegment.set(decision.sourceSegmentId, siblings);
  }
  decisionsBySegment.forEach((spans) => spans.sort(compareSpans));

  const derivedSegments = new Map<string, PathSegment>();
  const operations: PathOperation[] = [];
  for (const sourceOperation of document.plan.operations) {
    const slots = sourceOperation.segmentRefs.flatMap((ref) => {
      const source = sourceSegments.get(ref.segmentId);
      if (!source) return [];
      const partitions = partitionSegment(ref.segmentId, decisionsBySegment.get(ref.segmentId) ?? []);
      const ordered = ref.reversed ? [...partitions].reverse() : partitions;
      return ordered.map((span) => {
        if (span.participation === 'inactive-reference') return { active: false as const };
        const segment = deriveSpanSegment(source, span);
        if (segment.id !== source.id) derivedSegments.set(segment.id, segment);
        return {
          active: true as const,
          ref: { segmentId: segment.id, reversed: ref.reversed },
          spanId: span.id
        };
      });
    });
    const groups = contiguousActiveGroups(slots, sourceOperation.closed);
    if (groups.length === 0) continue;
    if (groups.length > 1) {
      return blocked(
        'multiple-active-groups-require-explicit-semantics',
        document.segments
      );
    }
    const unchanged = groups.length === 1 &&
      groups[0].length === sourceOperation.segmentRefs.length &&
      groups[0].every((item, index) =>
        item.ref.segmentId === sourceOperation.segmentRefs[index]?.segmentId
      );
    if (unchanged) {
      operations.push(structuredClone(sourceOperation));
      continue;
    }
    const effectiveSegments = new Map([...sourceSegments, ...derivedSegments]);
    groups.forEach((group) => {
      const refs = group.map((item) => item.ref);
      const spanIds = group.map((item) => item.spanId);
      const startPoint = pathStartPoint(refs, effectiveSegments)!;
      const endPoint = pathEndPoint(refs, effectiveSegments)!;
      const operation = buildPartialOperation(
        sourceOperation,
        refs,
        spanIds,
        startPoint,
        endPoint,
        effectiveSegments,
        partialCompensationByOperationId.get(sourceOperation.id),
        reviewedPartialEntryFingerprints.get(sourceOperation.id)
      );
      operations.push(operation);
    });
  }

  const allSegments = [...document.segments, ...derivedSegments.values()];
  const allSegmentsById = segmentMap(allSegments);
  const initial = resolveInitialWirePosition(document);
  let current = initial.status === 'ready' ? initial.point : document.options.startPoint;
  operations.forEach((operation, index) => {
    operation.orderIndex = index;
    operation.metrics.rapidInLength = distance(current, operation.startPoint);
    current = operation.endPoint;
  });
  return { status: 'ready', operations, segments: allSegments };
}

function buildPartialOperation(
  source: PathOperation,
  refs: OrientedSegmentRef[],
  spanIds: string[],
  startPoint: Point2,
  endPoint: Point2,
  segmentsById: Map<string, PathSegment>,
  wireSide: 'left' | 'right' | undefined,
  reviewedEntryFingerprint: string | undefined
): PathOperation {
  const key = spanIds.join('__').replace(/[^a-zA-Z0-9_-]/g, '_');
  const transitions = normalizeLegacyOperationTransitions(source);
  let sourceEntryWasReviewed = false;
  if (transitions?.entry) {
    transitions.entry.to = { ...startPoint };
    if (transitions.entry.strategy === 'manual-straight') {
      sourceEntryWasReviewed = transitions.entry.review === 'reviewed';
      transitions.entry.review = 'required';
    }
  }
  if (transitions?.exit) {
    transitions.exit.from = { ...endPoint };
    transitions.exit.review = 'required';
  }
  const overrides = source.overrides ? structuredClone(source.overrides) : undefined;
  if (overrides?.leadIn) {
    overrides.leadIn.to = { ...startPoint };
    overrides.leadIn.sourceSegmentId = refs[0].segmentId;
    overrides.leadIn.sourceSegmentIndex = 0;
  }
  const compensationIntent = wireSide
    ? { mode: 'controller' as const, wireSide, source: 'manual' as const }
    : source.compensationIntent?.mode === 'centerline' && source.compensationIntent.source === 'manual'
      ? structuredClone(source.compensationIntent)
      : undefined;
  const operation: PathOperation = {
    ...structuredClone(source),
    id: `${source.id}__${key}`,
    chainId: `${source.chainId}__${key}`,
    closed: false,
    segmentRefs: refs,
    startPoint,
    endPoint,
    metrics: {
      cutLength: pathCutLength(refs, segmentsById),
      rapidInLength: 0,
      segmentCount: refs.length
    },
    machiningIntent: {
      kind: 'partial-contour',
      sourceOperationId: source.id,
      spanIds
    },
    ...(compensationIntent ? { compensationIntent } : { compensationIntent: undefined }),
    transitions,
    ...(overrides ? { overrides } : {})
  };
  if (
    operation.transitions?.entry?.strategy === 'manual-straight' &&
    sourceEntryWasReviewed &&
    reviewedEntryFingerprint === partialContourEntryFingerprint(operation)
  ) {
    operation.transitions.entry.review = 'reviewed';
  }
  return operation;
}

function partialContourEntryFingerprint(operation: PathOperation): string | null {
  const entry = operation.transitions?.entry;
  if (operation.machiningIntent?.kind !== 'partial-contour' || entry?.strategy !== 'manual-straight') {
    return null;
  }
  return JSON.stringify({
    direction: operation.direction,
    entry: { from: entry.from, to: entry.to },
    segmentRefs: operation.segmentRefs,
    sourceOperationId: operation.machiningIntent.sourceOperationId,
    spanIds: operation.machiningIntent.spanIds,
    startPoint: operation.startPoint
  });
}

function deriveSpanSegment(source: PathSegment, span: MachiningSpan): PathSegment {
  if (span.range.start === 0 && span.range.end === 1) return source;
  const id = `mach_${span.id}`;
  const sourceRef = {
    ...structuredClone(source.source),
    note: `Machining span ${span.range.start}..${span.range.end} of ${source.id}`
  };
  const start = sourcePointAt(source, span.range.start);
  const end = sourcePointAt(source, span.range.end);
  if (source.kind === 'line') return createLineSegment({ id, source: sourceRef, start, end });
  if (source.kind === 'arc') {
    return createArcSegment({
      id,
      source: sourceRef,
      start,
      end,
      center: source.center,
      radius: source.radius,
      clockwise: source.clockwise,
      sweepRadians: source.sweepRadians * (span.range.end - span.range.start)
    });
  }
  return createArcSegment({
    id,
    source: sourceRef,
    start,
    end,
    center: source.center,
    radius: source.radius,
    clockwise: false,
    sweepRadians: Math.PI * 2 * (span.range.end - span.range.start)
  });
}

function sourcePointAt(segment: PathSegment, parameter: number) {
  if (segment.kind === 'line') {
    return {
      x: segment.start.x + (segment.end.x - segment.start.x) * parameter,
      y: segment.start.y + (segment.end.y - segment.start.y) * parameter
    };
  }
  if (segment.kind === 'arc') {
    return pointOnArcAtParameter(segment, { segmentId: segment.id, reversed: false }, parameter);
  }
  const startAngle = Math.atan2(
    segment.preferredStart.y - segment.center.y,
    segment.preferredStart.x - segment.center.x
  );
  return pointOnCircle(segment.center, segment.radius, startAngle + Math.PI * 2 * parameter);
}

function partitionSegment(segmentId: string, decisions: MachiningSpan[]) {
  const partitions: MachiningSpan[] = [];
  let cursor = 0;
  for (const decision of decisions) {
    if (decision.range.start > cursor) {
      partitions.push(activeSpan(segmentId, cursor, decision.range.start));
    }
    partitions.push(structuredClone(decision));
    cursor = decision.range.end;
  }
  if (cursor < 1) partitions.push(activeSpan(segmentId, cursor, 1));
  return partitions;
}

function contiguousActiveGroups(
  slots: Array<{ active: false } | { active: true; ref: OrientedSegmentRef; spanId: string }>,
  closed: boolean
) {
  const groups: Array<Array<{ active: true; ref: OrientedSegmentRef; spanId: string }>> = [];
  let current: Array<{ active: true; ref: OrientedSegmentRef; spanId: string }> = [];
  slots.forEach((slot) => {
    if (slot.active) current.push(slot);
    else if (current.length > 0) {
      groups.push(current);
      current = [];
    }
  });
  if (current.length > 0) groups.push(current);
  if (closed && groups.length > 1 && slots[0]?.active && slots.at(-1)?.active) {
    const first = groups.shift()!;
    const last = groups.pop()!;
    groups.unshift([...last, ...first]);
  }
  return groups;
}

function activeSpan(segmentId: string, start: number, end: number): MachiningSpan {
  const range = { start, end };
  return {
    id: machiningSpanId(segmentId, range),
    sourceSegmentId: segmentId,
    range,
    participation: 'active-cut'
  };
}

function machiningSpanId(segmentId: string, range: { start: number; end: number }) {
  return `span_${segmentId}_${formatParameter(range.start)}_${formatParameter(range.end)}`;
}

function formatParameter(value: number) {
  return value.toFixed(9).replace(/0+$/g, '').replace(/\.$/, '').replace('.', 'p');
}

function normalizeRange(range: { start: number; end: number }) {
  if (
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end) ||
    range.start < 0 ||
    range.end > 1 ||
    range.start >= range.end
  ) return null;
  return { start: range.start, end: range.end };
}

function rangesOverlap(
  left: { start: number; end: number },
  right: { start: number; end: number }
) {
  return Math.max(left.start, right.start) < Math.min(left.end, right.end);
}

function compareSpans(left: MachiningSpan, right: MachiningSpan) {
  return left.sourceSegmentId.localeCompare(right.sourceSegmentId) ||
    left.range.start - right.range.start ||
    left.range.end - right.range.end;
}

function blocked(
  reason: Extract<ActiveMachiningDerivation, { status: 'blocked' }>['reason'],
  segments: PathSegment[]
): ActiveMachiningDerivation {
  return { status: 'blocked', reason, operations: [], segments: structuredClone(segments) };
}
