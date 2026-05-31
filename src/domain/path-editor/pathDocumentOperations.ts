import { analyzeContours } from '@/domain/path-intel/contours';
import {
  angleIsOnSweep,
  createArcSegment,
  createLineSegment,
  distance,
  orientedArcClockwise,
  orientedSegmentEnd,
  orientedSegmentStart,
  pathCutLength,
  pathEndPoint,
  pathStartPoint,
  pointOnCircle,
  pointsEqual,
  requiredSegment,
  reversePathRefs,
  rotatePathRefs,
  segmentMap,
  signedSweep
} from '@/domain/path-intel/segments';
import type {
  ArcPathSegment,
  CirclePathSegment,
  OperationPlan,
  OrientedSegmentRef,
  PathChain,
  PathOperation,
  PathPlanningDocument,
  PathSegment,
  Point2,
  SegmentId
} from '@/domain/path-intel/types';

export interface NearestPathPoint {
  distance: number;
  operationId: string;
  point: Point2;
  segmentId: SegmentId;
  segmentIndex: number;
  tangent: Point2;
  t: number;
}

export type MagnetizeMode = 'perpendicular' | 'tangent';

export interface MagnetizedPathPoint extends NearestPathPoint {
  mode: MagnetizeMode;
  sourcePoint: Point2;
  tangent: Point2;
}

export function movePathOperation(
  document: PathPlanningDocument,
  operationId: string,
  direction: -1 | 1
) {
  const index = document.plan.operations.findIndex((operation) => operation.id === operationId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= document.plan.operations.length) return null;

  const next = cloneDocument(document);
  const [operation] = next.plan.operations.splice(index, 1);
  next.plan.operations.splice(targetIndex, 0, operation);
  refreshPlan(next);
  return next;
}

export function reversePathOperation(document: PathPlanningDocument, operationId: string) {
  const next = cloneDocument(document);
  const operation = next.plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation) return null;

  operation.segmentRefs = reversePathRefs(operation.segmentRefs);
  operation.direction = operation.direction === 'forward' ? 'reverse' : 'forward';
  syncChainRefs(next, operation);
  refreshPlan(next);
  return next;
}

export function setClosedOperationStartNearPoint(
  document: PathPlanningDocument,
  operationId: string,
  point: Point2
) {
  const next = cloneDocument(document);
  const operation = next.plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation || !operation.closed) return null;

  const nearest = nearestPointOnOperation(next, operation.id, point);
  if (!nearest) return null;

  const split = splitOperationSegmentAtPoint(next, operation, nearest);
  const refs = split?.refs ?? operation.segmentRefs;
  const startIndex = split?.startIndex ?? nearest.segmentIndex;
  operation.segmentRefs = rotatePathRefs(refs, startIndex);
  syncChainRefs(next, operation);
  refreshPlan(next);
  return next;
}

export function nearestPointOnOperation(
  document: PathPlanningDocument,
  operationId: string,
  point: Point2
): NearestPathPoint | null {
  const operation = document.plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation) return null;

  const segmentsById = segmentMap(document.segments);
  let nearest: NearestPathPoint | null = null;

  operation.segmentRefs.forEach((ref, segmentIndex) => {
    const segment = requiredSegment(segmentsById, ref.segmentId);
    const candidate = nearestPointOnSegment(segment, ref, point);
    if (!candidate) return;
    const item: NearestPathPoint = {
      ...candidate,
      operationId,
      segmentId: ref.segmentId,
      segmentIndex
    };
    if (!nearest || item.distance < nearest.distance) nearest = item;
  });

  return nearest;
}

export function magnetizePointToPath(
  document: PathPlanningDocument,
  point: Point2,
  mode: MagnetizeMode
): MagnetizedPathPoint | null {
  const nearest = nearestPointOnDocument(document, point);
  if (!nearest) return null;

  const operation = document.plan.operations.find((candidate) => candidate.id === nearest.operationId);
  if (!operation?.segmentRefs[nearest.segmentIndex]) return null;

  return {
    ...nearest,
    mode,
    sourcePoint: point,
    tangent: nearest.tangent
  };
}

function nearestPointOnDocument(document: PathPlanningDocument, point: Point2) {
  let nearest: NearestPathPoint | null = null;

  for (const operation of document.plan.operations) {
    const candidate = nearestPointOnOperation(document, operation.id, point);
    if (!candidate) continue;
    if (!nearest || candidate.distance < nearest.distance) nearest = candidate;
  }

  return nearest;
}

function splitOperationSegmentAtPoint(
  document: PathPlanningDocument,
  operation: PathOperation,
  nearest: NearestPathPoint
) {
  const ref = operation.segmentRefs[nearest.segmentIndex];
  if (!ref) return null;

  const segmentsById = segmentMap(document.segments);
  const segment = requiredSegment(segmentsById, ref.segmentId);
  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);
  const epsilon = document.options.coincidenceEpsilon;

  if (pointsEqual(nearest.point, start, epsilon)) {
    return { refs: operation.segmentRefs, startIndex: nearest.segmentIndex };
  }

  if (pointsEqual(nearest.point, end, epsilon)) {
    return {
      refs: operation.segmentRefs,
      startIndex: (nearest.segmentIndex + 1) % operation.segmentRefs.length
    };
  }

  const splitSegments = splitSegment(segment, ref, nearest.point, document);
  if (!splitSegments) return null;

  document.segments.push(...splitSegments);
  const replacementRefs = splitSegments.map((splitSegment) => ({
    segmentId: splitSegment.id,
    reversed: false
  }));
  const refs = [
    ...operation.segmentRefs.slice(0, nearest.segmentIndex),
    ...replacementRefs,
    ...operation.segmentRefs.slice(nearest.segmentIndex + 1)
  ];

  return {
    refs,
    startIndex: segment.kind === 'circle' ? nearest.segmentIndex : nearest.segmentIndex + 1
  };
}

function splitSegment(
  segment: PathSegment,
  ref: OrientedSegmentRef,
  point: Point2,
  document: PathPlanningDocument
): PathSegment[] | null {
  const source = {
    ...segment.source,
    note: segment.source.note ? `${segment.source.note}; user split` : 'user split'
  };
  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);

  if (segment.kind === 'line') {
    const [firstId, secondId] = nextEditSegmentIds(document, 2);
    return [
      createLineSegment({ id: firstId, source, start, end: point }),
      createLineSegment({ id: secondId, source, start: point, end })
    ];
  }

  if (segment.kind === 'arc') {
    const clockwise = orientedArcClockwise(segment, ref);
    const [firstId, secondId] = nextEditSegmentIds(document, 2);
    return [
      createArcSegment({
        id: firstId,
        source,
        start,
        end: point,
        center: segment.center,
        radius: segment.radius,
        clockwise
      }),
      createArcSegment({
        id: secondId,
        source,
        start: point,
        end,
        center: segment.center,
        radius: segment.radius,
        clockwise
      })
    ];
  }

  return splitCircle(segment, ref, point, document);
}

function splitCircle(
  segment: CirclePathSegment,
  ref: OrientedSegmentRef,
  point: Point2,
  document: PathPlanningDocument
): PathSegment[] {
  const clockwise = ref.reversed;
  const startAngle = Math.atan2(point.y - segment.center.y, point.x - segment.center.x);
  const middle = pointOnCircle(segment.center, segment.radius, startAngle + (clockwise ? -Math.PI : Math.PI));
  const source = {
    ...segment.source,
    note: segment.source.note ? `${segment.source.note}; user split circle` : 'user split circle'
  };
  const [firstId, secondId] = nextEditSegmentIds(document, 2);

  return [
    createArcSegment({
      id: firstId,
      source,
      start: point,
      end: middle,
      center: segment.center,
      radius: segment.radius,
      clockwise
    }),
    createArcSegment({
      id: secondId,
      source,
      start: middle,
      end: point,
      center: segment.center,
      radius: segment.radius,
      clockwise
    })
  ];
}

function nearestPointOnSegment(segment: PathSegment, ref: OrientedSegmentRef, point: Point2) {
  if (segment.kind === 'line') {
    const start = orientedSegmentStart(segment, ref);
    const end = orientedSegmentEnd(segment, ref);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared <= 0 ? 0 : clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared);
    const candidate = {
      x: start.x + dx * t,
      y: start.y + dy * t
    };
    return { distance: distance(point, candidate), point: candidate, tangent: normalize({ x: dx, y: dy }), t };
  }

  if (segment.kind === 'circle') {
    const angle = Math.atan2(point.y - segment.center.y, point.x - segment.center.x);
    const candidate = pointOnCircle(segment.center, segment.radius, angle);
    return {
      distance: distance(point, candidate),
      point: candidate,
      tangent: circleTangent(angle, ref.reversed),
      t: 0
    };
  }

  return nearestPointOnArc(segment, ref, point);
}

function nearestPointOnArc(segment: ArcPathSegment, ref: OrientedSegmentRef, point: Point2) {
  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);
  const startAngle = Math.atan2(start.y - segment.center.y, start.x - segment.center.x);
  const endAngle = Math.atan2(end.y - segment.center.y, end.x - segment.center.x);
  const clockwise = orientedArcClockwise(segment, ref);
  const sweep = signedSweep(startAngle, endAngle, clockwise);
  const projectedAngle = Math.atan2(point.y - segment.center.y, point.x - segment.center.x);

  if (angleIsOnSweep(projectedAngle, startAngle, sweep)) {
    const projected = pointOnCircle(segment.center, segment.radius, projectedAngle);
    return {
      distance: distance(point, projected),
      point: projected,
      tangent: circleTangent(projectedAngle, clockwise),
      t: Math.abs(signedSweep(startAngle, projectedAngle, clockwise) / sweep)
    };
  }

  const startDistance = distance(point, start);
  const endDistance = distance(point, end);
  return startDistance <= endDistance
    ? { distance: startDistance, point: start, tangent: circleTangent(startAngle, clockwise), t: 0 }
    : { distance: endDistance, point: end, tangent: circleTangent(endAngle, clockwise), t: 1 };
}

function syncChainRefs(document: PathPlanningDocument, operation: PathOperation) {
  const chain = document.chains.find((candidate) => candidate.id === operation.chainId);
  if (!chain) return;

  chain.segmentRefs = operation.segmentRefs.map((ref) => ({ ...ref }));
  chain.metrics = {
    ...chain.metrics,
    segmentCount: chain.segmentRefs.length,
    cutLength: pathCutLength(chain.segmentRefs, segmentMap(document.segments))
  };
}

function refreshPlan(document: PathPlanningDocument) {
  const segmentsById = segmentMap(document.segments);
  let current = document.options.startPoint;

  document.plan.operations.forEach((operation, index) => {
    operation.orderIndex = index;
    operation.startPoint = pathStartPoint(operation.segmentRefs, segmentsById) ?? operation.startPoint;
    operation.endPoint = operation.closed
      ? operation.startPoint
      : pathEndPoint(operation.segmentRefs, segmentsById) ?? operation.endPoint;
    operation.metrics = {
      cutLength: pathCutLength(operation.segmentRefs, segmentsById),
      rapidInLength: distance(current, operation.startPoint),
      segmentCount: operation.segmentRefs.length
    };
    current = operation.endPoint;
  });

  document.plan.metrics = planMetrics(document.plan);
  const contourResult = analyzeContours(document.chains, document.segments, document.options);
  document.contours = document.contours.map((contour) => {
    const refreshed = contourResult.contours.find((candidate) => candidate.id === contour.id);
    return refreshed ?? contour;
  });
}

function planMetrics(plan: OperationPlan) {
  return {
    operationCount: plan.operations.length,
    totalCutLength: plan.operations.reduce((total, operation) => total + operation.metrics.cutLength, 0),
    totalRapidLength: plan.operations.reduce((total, operation) => total + operation.metrics.rapidInLength, 0)
  };
}

function nextEditSegmentIds(document: PathPlanningDocument, count: number) {
  const ids: string[] = [];
  let index = 1;
  const existingIds = new Set(document.segments.map((segment) => segment.id));

  while (ids.length < count) {
    const id = `seg_edit_${String(index).padStart(4, '0')}`;
    if (!existingIds.has(id)) {
      ids.push(id);
      existingIds.add(id);
    }
    index++;
  }

  return ids;
}

function cloneDocument(document: PathPlanningDocument): PathPlanningDocument {
  return structuredClone(document);
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function circleTangent(angle: number, clockwise: boolean): Point2 {
  return clockwise ? { x: Math.sin(angle), y: -Math.cos(angle) } : { x: -Math.sin(angle), y: Math.cos(angle) };
}

function normalize(vector: Point2): Point2 {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= 0) return { x: 0, y: 0 };
  return { x: vector.x / length, y: vector.y / length };
}
