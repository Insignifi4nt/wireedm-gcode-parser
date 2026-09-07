import { deriveSourceMachiningOperations } from '@/domain/path-intel/machiningParticipation';
import {
  arcParameterAtPoint,
  arcParameterAtRadial,
  distance,
  orientedArcClockwise,
  orientedSegmentEnd,
  orientedSegmentStart,
  pointOnArcAtParameter,
  pointOnCircle,
  requiredSegment,
  segmentMap
} from '@/domain/path-intel/segments';
import type {
  ArcPathSegment,
  CirclePathSegment,
  OrientedSegmentRef,
  PathElementId,
  PathPlanningDocument,
  PathSegment,
  Point2,
  SegmentId
} from '@/domain/path-intel/types';

export type PathPointInferenceMode =
  | 'endpoint'
  | 'nearest'
  | 'midpoint'
  | 'perpendicular'
  | 'tangent';

export type PathPointRelation =
  | 'endpoint'
  | 'nearest'
  | 'midpoint'
  | 'perpendicular'
  | 'tangent'
  | 'nearest-fallback';

export interface PathPointInferenceRequest {
  hintPoint: Point2;
  mode: PathPointInferenceMode;
  operationId?: string;
  sourcePoint?: Point2;
}

export interface InferredPathPoint {
  distance: number;
  endpointRole: 'start' | 'end' | null;
  guide?: {
    from: Point2;
    to: Point2;
  };
  mode: PathPointInferenceMode;
  operationId: string;
  pathElementId: PathElementId | null;
  point: Point2;
  relation: PathPointRelation;
  segmentId: SegmentId;
  segmentIndex: number;
  sourcePoint?: Point2;
  tangent: Point2;
  t: number;
}

export type MagnetizeMode = Extract<
  PathPointInferenceMode,
  'perpendicular' | 'tangent'
>;

export type MagnetizedPathPoint = InferredPathPoint & {
  mode: MagnetizeMode;
  relation: 'perpendicular' | 'tangent' | 'nearest-fallback';
  sourcePoint: Point2;
};

interface SegmentCandidate {
  point: Point2;
  relation: PathPointRelation;
  tangent: Point2;
  t: number;
}

export function inferPathPoint(
  document: PathPlanningDocument,
  request: PathPointInferenceRequest
): InferredPathPoint | null {
  if (
    !finitePoint(request.hintPoint) ||
    ((request.mode === 'perpendicular' || request.mode === 'tangent') &&
      !finitePoint(request.sourcePoint))
  ) {
    return null;
  }

  const operations = request.operationId
    ? document.plan.operations.filter((operation) => operation.id === request.operationId)
    : document.plan.operations;
  const segmentsById = segmentMap(document.segments);
  let best: InferredPathPoint | null = null;
  let bestSelectionDistance = Number.POSITIVE_INFINITY;

  for (const operation of operations) {
    const pathElementId =
      document.pathElements.find((element) => element.operationId === operation.id)?.id ?? null;
    for (const [segmentIndex, ref] of operation.segmentRefs.entries()) {
      const segment = requiredSegment(segmentsById, ref.segmentId);
      const candidate = candidateForSegment(segment, ref, request);
      if (!candidate) continue;
      const hintDistance = distance(request.hintPoint, candidate.point);
      const selectionDistance =
        request.mode === 'midpoint' || request.mode === 'perpendicular'
          ? distance(
              request.hintPoint,
              nearestPointOnSegment(segment, ref, request.hintPoint).point
            )
          : hintDistance;
      const inferred: InferredPathPoint = {
        ...candidate,
        distance: hintDistance,
        endpointRole: endpointRoleFor(
          segment,
          ref,
          candidate.point,
          document.options.coincidenceEpsilon
        ),
        mode: request.mode,
        operationId: operation.id,
        pathElementId,
        segmentId: ref.segmentId,
        segmentIndex,
        ...(request.sourcePoint
          ? {
              sourcePoint: { ...request.sourcePoint },
              guide: {
                from: { ...request.sourcePoint },
                to: { ...candidate.point }
              }
            }
          : request.mode === 'nearest'
            ? {
                guide: {
                  from: { ...request.hintPoint },
                  to: { ...candidate.point }
                }
              }
          : {})
      };
      if (!best || selectionDistance < bestSelectionDistance) {
        best = inferred;
        bestSelectionDistance = selectionDistance;
      }
    }
  }

  return best;
}

export function inferPathPointOnSegment(
  document: PathPlanningDocument,
  request: PathPointInferenceRequest & {
    operationId: string;
    segmentId: SegmentId;
  }
): InferredPathPoint | null {
  const operation = document.plan.operations.find(
    (candidate) => candidate.id === request.operationId
  );
  const segmentIndex = operation?.segmentRefs.findIndex(
    (ref) => ref.segmentId === request.segmentId
  ) ?? -1;
  const ref = operation?.segmentRefs[segmentIndex];
  if (!operation || !ref) return null;
  if (
    !finitePoint(request.hintPoint) ||
    ((request.mode === 'perpendicular' || request.mode === 'tangent') &&
      !finitePoint(request.sourcePoint))
  ) {
    return null;
  }

  const segment = requiredSegment(segmentMap(document.segments), ref.segmentId);
  const candidate = candidateForSegment(segment, ref, request);
  if (!candidate) return null;
  const pathElementId =
    document.pathElements.find((element) => element.operationId === operation.id)?.id ?? null;
  return {
    ...candidate,
    distance: distance(request.hintPoint, candidate.point),
    endpointRole: endpointRoleFor(
      segment,
      ref,
      candidate.point,
      document.options.coincidenceEpsilon
    ),
    mode: request.mode,
    operationId: operation.id,
    pathElementId,
    segmentId: ref.segmentId,
    segmentIndex,
    ...(request.sourcePoint
      ? {
          sourcePoint: { ...request.sourcePoint },
          guide: { from: { ...request.sourcePoint }, to: { ...candidate.point } }
        }
      : request.mode === 'nearest'
        ? {
            guide: { from: { ...request.hintPoint }, to: { ...candidate.point } }
          }
      : {})
  };
}

export function reinferStoredPathPoint(
  document: PathPlanningDocument,
  snap: Pick<
    MagnetizedPathPoint,
    'mode' | 'operationId' | 'segmentId' | 'sourcePoint'
  >,
  hintPoint: Point2
): MagnetizedPathPoint | null {
  if (snap.mode === 'perpendicular') {
    const nearest = inferPathPointOnSegment(document, {
      mode: 'nearest',
      operationId: snap.operationId,
      segmentId: snap.segmentId,
      hintPoint
    });
    return nearest
      ? {
          ...nearest,
          guide: { from: snap.sourcePoint, to: nearest.point },
          mode: 'perpendicular',
          relation: 'nearest-fallback',
          sourcePoint: snap.sourcePoint
        }
      : null;
  }
  return inferPathPointOnSegment(document, {
    mode: snap.mode,
    operationId: snap.operationId,
    segmentId: snap.segmentId,
    sourcePoint: snap.sourcePoint,
    hintPoint
  }) as MagnetizedPathPoint | null;
}

export function inferPerpendicularOperationOffset(
  document: PathPlanningDocument,
  request: {
    endpoint: 'entry' | 'exit';
    hintPoint: Point2;
    operationId: string;
  }
): MagnetizedPathPoint | null {
  if (!finitePoint(request.hintPoint)) return null;
  const sourceOperation = document.plan.operations.find(
    (candidate) => candidate.id === request.operationId
  );
  if (!sourceOperation) return null;
  const active = deriveSourceMachiningOperations(document, sourceOperation.id);
  if (active?.status !== 'ready' || active.operations.length !== 1) return null;
  const operation = active.operations[0];
  if (operation.segmentRefs.length === 0) return null;
  const segmentIndex =
    request.endpoint === 'entry' ? 0 : operation.segmentRefs.length - 1;
  const ref = operation.segmentRefs[segmentIndex];
  const segment = requiredSegment(segmentMap(active.segments), ref.segmentId);
  const endpointParameter = request.endpoint === 'entry' ? 0 : 1;
  const spanId = operation.machiningIntent?.spanIds[segmentIndex];
  const span = active.activeSpans.find((candidate) => candidate.id === spanId);
  const sourceSegmentId = span?.sourceSegmentId ?? ref.segmentId;
  const sourceSegmentIndex = sourceOperation.segmentRefs.findIndex((candidate) => candidate.segmentId === sourceSegmentId);
  if (sourceSegmentIndex < 0) return null;
  const t = span
    ? request.endpoint === 'entry'
      ? ref.reversed ? 1 - span.range.end : span.range.start
      : ref.reversed ? 1 - span.range.start : span.range.end
    : endpointParameter;
  const sourcePoint =
    request.endpoint === 'entry'
      ? orientedSegmentStart(segment, ref)
      : orientedSegmentEnd(segment, ref);
  const tangent = tangentAt(segment, ref, endpointParameter);
  const normal = { x: -tangent.y, y: tangent.x };
  const offset =
    (request.hintPoint.x - sourcePoint.x) * normal.x +
    (request.hintPoint.y - sourcePoint.y) * normal.y;
  const point = {
    x: sourcePoint.x + normal.x * offset,
    y: sourcePoint.y + normal.y * offset
  };
  const pathElementId =
    document.pathElements.find((element) => element.operationId === sourceOperation.id)?.id ??
    null;

  return {
    distance: distance(request.hintPoint, point),
    endpointRole: null,
    guide: { from: { ...sourcePoint }, to: { ...point } },
    mode: 'perpendicular',
    operationId: sourceOperation.id,
    pathElementId,
    point,
    relation: 'perpendicular',
    segmentId: sourceSegmentId,
    segmentIndex: sourceSegmentIndex,
    sourcePoint,
    tangent,
    t
  };
}

function candidateForSegment(
  segment: PathSegment,
  ref: OrientedSegmentRef,
  request: PathPointInferenceRequest
): SegmentCandidate | null {
  switch (request.mode) {
    case 'endpoint':
      return endpointCandidate(segment, ref, request.hintPoint);
    case 'nearest':
      return {
        ...nearestPointOnSegment(segment, ref, request.hintPoint),
        relation: 'nearest'
      };
    case 'midpoint':
      return midpointCandidate(segment, ref, request.hintPoint);
    case 'perpendicular':
      return perpendicularCandidate(segment, ref, request.sourcePoint!, request.hintPoint);
    case 'tangent':
      return tangentCandidate(segment, ref, request.sourcePoint!, request.hintPoint);
  }
}

function endpointRoleFor(
  segment: PathSegment,
  ref: OrientedSegmentRef,
  point: Point2,
  epsilon: number
) {
  if (distance(point, orientedSegmentStart(segment, ref)) <= epsilon) return 'start';
  if (distance(point, orientedSegmentEnd(segment, ref)) <= epsilon) return 'end';
  return null;
}

function endpointCandidate(
  segment: PathSegment,
  ref: OrientedSegmentRef,
  hintPoint: Point2
): SegmentCandidate {
  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);
  const useStart = distance(hintPoint, start) <= distance(hintPoint, end);
  const point = useStart ? start : end;
  return {
    point,
    relation: 'endpoint',
    tangent: tangentAt(segment, ref, useStart ? 0 : 1),
    t: useStart ? 0 : 1
  };
}

function midpointCandidate(
  segment: PathSegment,
  ref: OrientedSegmentRef,
  hintPoint: Point2
): SegmentCandidate {
  if (segment.kind === 'circle') {
    const nearest = nearestPointOnSegment(segment, ref, hintPoint);
    return { ...nearest, relation: 'midpoint' };
  }
  const point =
    segment.kind === 'line'
      ? average(orientedSegmentStart(segment, ref), orientedSegmentEnd(segment, ref))
      : pointOnArcAtParameter(segment, ref, 0.5);
  return {
    point,
    relation: 'midpoint',
    tangent: tangentAt(segment, ref, 0.5),
    t: 0.5
  };
}

function perpendicularCandidate(
  segment: PathSegment,
  ref: OrientedSegmentRef,
  sourcePoint: Point2,
  hintPoint: Point2
): SegmentCandidate {
  const foot = perpendicularFoot(segment, ref, sourcePoint);
  return foot
    ? { ...foot, relation: 'perpendicular' }
    : {
        ...nearestPointOnSegment(segment, ref, hintPoint),
        relation: 'nearest-fallback'
      };
}

function perpendicularFoot(
  segment: PathSegment,
  ref: OrientedSegmentRef,
  sourcePoint: Point2
): Omit<SegmentCandidate, 'relation'> | null {
  if (segment.kind === 'line') {
    const start = orientedSegmentStart(segment, ref);
    const end = orientedSegmentEnd(segment, ref);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 0) return null;
    const t =
      ((sourcePoint.x - start.x) * dx + (sourcePoint.y - start.y) * dy) /
      lengthSquared;
    if (t < 0 || t > 1) return null;
    return {
      point: { x: start.x + dx * t, y: start.y + dy * t },
      tangent: normalize({ x: dx, y: dy }),
      t
    };
  }

  const radial = {
    x: sourcePoint.x - segment.center.x,
    y: sourcePoint.y - segment.center.y
  };
  if (Math.hypot(radial.x, radial.y) <= 1e-12) return null;
  const unitRadial = normalize(radial);
  const point = {
    x: segment.center.x + segment.radius * unitRadial.x,
    y: segment.center.y + segment.radius * unitRadial.y
  };
  if (segment.kind === 'arc') {
    const t = arcParameterAtPoint(segment, ref, point);
    if (t === null) return null;
    return { point, tangent: tangentAt(segment, ref, t), t };
  }
  return { point, tangent: circleTangent(unitRadial, ref.reversed), t: 0 };
}

export function nearestPointOnSegment(
  segment: PathSegment,
  ref: OrientedSegmentRef,
  point: Point2
): Omit<SegmentCandidate, 'relation'> {
  if (segment.kind === 'line') {
    const start = orientedSegmentStart(segment, ref);
    const end = orientedSegmentEnd(segment, ref);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared <= 0
        ? 0
        : clamp(
            ((point.x - start.x) * dx + (point.y - start.y) * dy) /
              lengthSquared
          );
    return {
      point: { x: start.x + dx * t, y: start.y + dy * t },
      tangent: normalize({ x: dx, y: dy }),
      t
    };
  }

  const angle = Math.atan2(point.y - segment.center.y, point.x - segment.center.x);
  if (segment.kind === 'circle') {
    return {
      point: pointOnCircle(segment.center, segment.radius, angle),
      tangent: circleTangent({ x: Math.cos(angle), y: Math.sin(angle) }, ref.reversed),
      t: 0
    };
  }

  const parameter = arcParameterAtPoint(segment, ref, point);
  if (parameter !== null) {
    return {
      point: pointOnArcAtParameter(segment, ref, parameter),
      tangent: tangentAt(segment, ref, parameter),
      t: parameter
    };
  }
  const start = endpointCandidate(segment, ref, point);
  return { point: start.point, tangent: start.tangent, t: start.t };
}

function tangentCandidate(
  segment: PathSegment,
  ref: OrientedSegmentRef,
  sourcePoint: Point2,
  hintPoint: Point2
): SegmentCandidate {
  if (segment.kind === 'line') {
    return {
      ...nearestPointOnSegment(segment, ref, hintPoint),
      relation: 'nearest-fallback'
    };
  }

  const centerToSource = {
    x: sourcePoint.x - segment.center.x,
    y: sourcePoint.y - segment.center.y
  };
  const sourceDistance = Math.hypot(centerToSource.x, centerToSource.y);
  if (!Number.isFinite(sourceDistance) || sourceDistance <= segment.radius + 1e-9) {
    return {
      ...nearestPointOnSegment(segment, ref, hintPoint),
      relation: 'nearest-fallback'
    };
  }

  const candidates = tangentRadials(centerToSource, segment.radius)
    .filter((radial) => tangentRadialIsValid(segment, ref, radial))
    .map((radial) => {
      const t =
        segment.kind === 'arc' ? arcParameterAtRadial(segment, ref, radial) ?? 0 : 0;
      const point =
        segment.kind === 'arc'
          ? pointOnArcAtParameter(segment, ref, t)
          : {
              x: segment.center.x + segment.radius * radial.x,
              y: segment.center.y + segment.radius * radial.y
            };
      return {
        point,
        relation: 'tangent' as const,
        tangent: circleTangent(
          radial,
          segment.kind === 'circle' ? ref.reversed : orientedArcClockwise(segment, ref)
        ),
        t
      };
    });

  return (
    candidates.sort(
      (first, second) =>
        distance(hintPoint, first.point) - distance(hintPoint, second.point)
    )[0] ?? {
      ...nearestPointOnSegment(segment, ref, hintPoint),
      relation: 'nearest-fallback'
    }
  );
}

function tangentRadials(centerToSource: Point2, radius: number) {
  const scale = Math.max(
    Math.abs(centerToSource.x),
    Math.abs(centerToSource.y),
    radius
  );
  if (!Number.isFinite(scale) || scale <= 0) return [];
  const scaledX = centerToSource.x / scale;
  const scaledY = centerToSource.y / scale;
  const scaledRadius = radius / scale;
  const sourceDistance = Math.hypot(scaledX, scaledY);
  if (!Number.isFinite(sourceDistance) || sourceDistance <= scaledRadius) return [];
  const sourceRadial = {
    x: scaledX / sourceDistance,
    y: scaledY / sourceDistance
  };
  const ratio = scaledRadius / sourceDistance;
  const excessUsingYFactor =
    scaledX * scaledX +
    (Math.abs(scaledY) - scaledRadius) * (Math.abs(scaledY) + scaledRadius);
  const excessUsingXFactor =
    scaledY * scaledY +
    (Math.abs(scaledX) - scaledRadius) * (Math.abs(scaledX) + scaledRadius);
  const squaredTangentLeg =
    Math.abs(scaledX) >= Math.abs(scaledY)
      ? excessUsingXFactor
      : excessUsingYFactor;
  const sideScale = Math.sqrt(Math.max(0, squaredTangentLeg)) / sourceDistance;
  const left = { x: -sourceRadial.y, y: sourceRadial.x };
  return [1, -1].map((side) =>
    normalize({
      x: ratio * sourceRadial.x + side * sideScale * left.x,
      y: ratio * sourceRadial.y + side * sideScale * left.y
    })
  );
}

function tangentRadialIsValid(
  segment: ArcPathSegment | CirclePathSegment,
  ref: OrientedSegmentRef,
  radial: Point2
) {
  return segment.kind === 'circle' || arcParameterAtRadial(segment, ref, radial) !== null;
}

function tangentAt(segment: PathSegment, ref: OrientedSegmentRef, t: number) {
  if (segment.kind === 'line') {
    const start = orientedSegmentStart(segment, ref);
    const end = orientedSegmentEnd(segment, ref);
    return normalize({ x: end.x - start.x, y: end.y - start.y });
  }
  const point =
    segment.kind === 'circle'
      ? pointOnCircle(segment.center, segment.radius, t * Math.PI * 2)
      : pointOnArcAtParameter(segment, ref, t);
  const radial = normalize({
    x: point.x - segment.center.x,
    y: point.y - segment.center.y
  });
  return circleTangent(
    radial,
    segment.kind === 'circle' ? ref.reversed : orientedArcClockwise(segment, ref)
  );
}

function circleTangent(radial: Point2, clockwise: boolean) {
  return clockwise
    ? { x: radial.y, y: -radial.x }
    : { x: -radial.y, y: radial.x };
}

function average(first: Point2, second: Point2) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function normalize(point: Point2) {
  const length = Math.hypot(point.x, point.y);
  return length > 0 ? { x: point.x / length, y: point.y / length } : { x: 0, y: 0 };
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function finitePoint(point: Point2 | undefined): point is Point2 {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}
