import { analyzeContours } from '@/domain/path-intel/contours';
import { clusterSegmentEndpoints } from '@/domain/path-intel/endpointClusters';
import { buildPathElements } from '@/domain/path-intel/pathElements';
import { buildContourDisplayNames } from '@/domain/path-intel/pathNaming';
import {
  angleIsOnSweep,
  createArcSegment,
  createLineSegment,
  distance,
  endpointKey,
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
  ContourClassification,
  EndpointClusterId,
  EndpointSide,
  OperationPlan,
  OrientedSegmentRef,
  PathChain,
  PathElementId,
  PathOperation,
  PathPlanningDocument,
  PathSegment,
  Point2,
  SegmentId
} from '@/domain/path-intel/types';

export interface NearestPathPoint {
  distance: number;
  operationId: string;
  pathElementId: PathElementId | null;
  point: Point2;
  segmentId: SegmentId;
  segmentIndex: number;
  tangent: Point2;
  t: number;
}

export type MagnetizeMode = 'perpendicular' | 'tangent';

export interface MagnetizedPathPoint extends NearestPathPoint {
  mode: MagnetizeMode;
  relation: 'perpendicular' | 'tangent' | 'nearest-fallback';
  sourcePoint: Point2;
  tangent: Point2;
}

export interface PathStartPreview {
  operationId: string;
  pathElementId: PathElementId | null;
  point: Point2;
  relation: 'existing-point' | 'new-split-point';
  segmentId: SegmentId;
  segmentIndex: number;
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
  recordManualOrderOverrides(next);
  refreshPathElements(next);
  return next;
}

export function setPathOperationClassification(
  document: PathPlanningDocument,
  operationId: string,
  classification: ContourClassification
) {
  const next = cloneDocument(document);
  const operation = next.plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation) return null;
  if (!operation.closed && classification !== 'open-chain') return null;

  operation.classification = classification;
  operation.overrides = {
    ...operation.overrides,
    classification: {
      kind: 'manual',
      classification
    }
  };

  const contour = next.contours.find((candidate) => candidate.id === operation.contourId);
  if (contour) contour.classification = classification;

  refreshOperationDisplayNames(next);
  refreshPathElements(next);
  return next;
}

export function reversePathOperation(document: PathPlanningDocument, operationId: string) {
  const next = cloneDocument(document);
  const operation = next.plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation) return null;

  operation.segmentRefs = reversePathRefs(operation.segmentRefs);
  operation.direction = operation.direction === 'forward' ? 'reverse' : 'forward';
  operation.overrides = {
    ...operation.overrides,
    direction: {
      kind: 'manual',
      direction: operation.direction
    }
  };
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
  operation.overrides = {
    ...operation.overrides,
    start: {
      kind: 'manual',
      point: { ...nearest.point },
      createdSegmentIds: split?.createdSegmentIds ?? []
    }
  };
  syncChainRefs(next, operation);
  refreshPlan(next);
  return next;
}

export function setClosedOperationStartAtExistingPointNearPoint(
  document: PathPlanningDocument,
  operationId: string,
  point: Point2
) {
  const operation = document.plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation || !operation.closed) return null;

  const endpoint = nearestExistingOperationEndpoint(document, operation, point);
  if (!endpoint) return null;

  return setClosedOperationStartNearPoint(document, operationId, endpoint.point);
}

export function previewClosedOperationStartNearPoint(
  document: PathPlanningDocument,
  operationId: string,
  point: Point2,
  allowSegmentSplit: boolean
): PathStartPreview | null {
  const operation = document.plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation || !operation.closed) return null;

  if (!allowSegmentSplit) {
    const endpoint = nearestExistingOperationEndpoint(document, operation, point);
    return endpoint
      ? {
          operationId,
          pathElementId: endpoint.pathElementId,
          point: endpoint.point,
          relation: 'existing-point',
          segmentId: endpoint.segmentId,
          segmentIndex: endpoint.segmentIndex
        }
      : null;
  }

  const nearest = nearestPointOnOperation(document, operationId, point);
  if (!nearest) return null;

  const ref = operation.segmentRefs[nearest.segmentIndex];
  if (!ref) return null;

  const segment = requiredSegment(segmentMap(document.segments), ref.segmentId);
  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);
  const relation =
    pointsEqual(nearest.point, start, document.options.coincidenceEpsilon) ||
    pointsEqual(nearest.point, end, document.options.coincidenceEpsilon)
      ? 'existing-point'
      : 'new-split-point';

  return {
    operationId,
    pathElementId: nearest.pathElementId,
    point: nearest.point,
    relation,
    segmentId: nearest.segmentId,
    segmentIndex: nearest.segmentIndex
  };
}

export function nearestPointOnOperation(
  document: PathPlanningDocument,
  operationId: string,
  point: Point2
): NearestPathPoint | null {
  const operation = document.plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation) return null;

  const segmentsById = segmentMap(document.segments);
  const pathElementId = pathElementIdForOperation(document, operationId);
  let nearest: NearestPathPoint | null = null;

  operation.segmentRefs.forEach((ref, segmentIndex) => {
    const segment = requiredSegment(segmentsById, ref.segmentId);
    const candidate = nearestPointOnSegment(segment, ref, point);
    if (!candidate) return;
    const item: NearestPathPoint = {
      ...candidate,
      operationId,
      pathElementId,
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
  return constructMagnetizedPoint(document, point, point, mode);
}

export function constructMagnetizedPoint(
  document: PathPlanningDocument,
  sourcePoint: Point2,
  contourHintPoint: Point2,
  mode: MagnetizeMode
): MagnetizedPathPoint | null {
  const hint = nearestPointOnDocument(document, contourHintPoint);
  if (!hint) return null;

  const operation = document.plan.operations.find((candidate) => candidate.id === hint.operationId);
  const ref = operation?.segmentRefs[hint.segmentIndex];
  if (!ref) return null;

  const segment = requiredSegment(segmentMap(document.segments), ref.segmentId);
  const candidate =
    mode === 'tangent'
      ? tangentPointOnSegment(segment, ref, sourcePoint, contourHintPoint)
      : {
          ...nearestPointOnSegment(segment, ref, sourcePoint),
          relation: 'perpendicular' as const
        };
  if (!candidate) return null;

  return {
    ...hint,
    distance: distance(sourcePoint, candidate.point),
    mode,
    point: candidate.point,
    relation: candidate.relation,
    sourcePoint,
    tangent: candidate.tangent,
    t: candidate.t
  };
}

export function slideMagnetizedPointOnSegment(
  document: PathPlanningDocument,
  snap: {
    mode: MagnetizeMode;
    operationId: string;
    pathElementId: PathElementId | null;
    relation: MagnetizedPathPoint['relation'];
    segmentId: SegmentId;
    sourcePoint: Point2;
  },
  contourHintPoint: Point2
): MagnetizedPathPoint | null {
  const operation = operationForSnap(document, snap.operationId, snap.pathElementId);
  if (!operation) return null;

  const storedSegmentIndex = operation.segmentRefs.findIndex((ref) => ref.segmentId === snap.segmentId);
  const fallbackNearest =
    storedSegmentIndex >= 0 ? null : nearestPointOnOperation(document, operation.id, contourHintPoint);
  const segmentIndex = storedSegmentIndex >= 0 ? storedSegmentIndex : fallbackNearest?.segmentIndex ?? -1;
  const ref = segmentIndex >= 0 ? operation.segmentRefs[segmentIndex] : null;
  if (!ref) return null;

  const segment = requiredSegment(segmentMap(document.segments), ref.segmentId);
  const candidate =
    snap.mode === 'tangent' && snap.relation === 'tangent'
      ? tangentPointOnSegment(segment, ref, snap.sourcePoint, contourHintPoint)
      : {
          ...nearestPointOnSegment(segment, ref, contourHintPoint),
          relation: snap.relation === 'nearest-fallback' ? ('nearest-fallback' as const) : ('perpendicular' as const)
        };
  if (!candidate) return null;

  return {
    distance: distance(snap.sourcePoint, candidate.point),
    mode: snap.mode,
    operationId: operation.id,
    pathElementId: pathElementIdForOperation(document, operation.id),
    point: candidate.point,
    relation: candidate.relation,
    segmentId: ref.segmentId,
    segmentIndex,
    sourcePoint: snap.sourcePoint,
    tangent: candidate.tangent,
    t: candidate.t
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

function nearestExistingOperationEndpoint(
  document: PathPlanningDocument,
  operation: PathOperation,
  point: Point2
) {
  const segmentsById = segmentMap(document.segments);
  const pathElementId = pathElementIdForOperation(document, operation.id);
  let nearest: {
    distance: number;
    pathElementId: PathElementId | null;
    point: Point2;
    segmentId: SegmentId;
    segmentIndex: number;
  } | null = null;

  for (const [segmentIndex, ref] of operation.segmentRefs.entries()) {
    const segment = requiredSegment(segmentsById, ref.segmentId);
    const candidates = [orientedSegmentStart(segment, ref), orientedSegmentEnd(segment, ref)];
    for (const candidate of candidates) {
      const candidateDistance = distance(point, candidate);
      if (!nearest || candidateDistance < nearest.distance) {
        nearest = {
          distance: candidateDistance,
          pathElementId,
          point: candidate,
          segmentId: ref.segmentId,
          segmentIndex
        };
      }
    }
  }

  return nearest ?? null;
}

function pathElementIdForOperation(document: PathPlanningDocument, operationId: string) {
  return document.pathElements.find((element) => element.operationId === operationId)?.id ?? null;
}

function operationForSnap(
  document: PathPlanningDocument,
  operationId: string,
  pathElementId?: PathElementId | null
) {
  const elementOperationId = pathElementId
    ? document.pathElements.find((element) => element.id === pathElementId)?.operationId
    : null;
  return document.plan.operations.find((candidate) => candidate.id === (elementOperationId ?? operationId));
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

  replaceDocumentSegment(document, segment.id, splitSegments);
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
    startIndex: segment.kind === 'circle' ? nearest.segmentIndex : nearest.segmentIndex + 1,
    createdSegmentIds: splitSegments.map((splitSegment) => splitSegment.id)
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

function replaceDocumentSegment(document: PathPlanningDocument, segmentId: SegmentId, replacements: PathSegment[]) {
  const index = document.segments.findIndex((segment) => segment.id === segmentId);
  if (index < 0) {
    document.segments.push(...replacements);
    return;
  }

  document.segments.splice(index, 1, ...replacements);
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

function tangentPointOnSegment(
  segment: PathSegment,
  ref: OrientedSegmentRef,
  sourcePoint: Point2,
  contourHintPoint: Point2
) {
  if (segment.kind === 'line') {
    return {
      ...nearestPointOnSegment(segment, ref, contourHintPoint),
      relation: 'nearest-fallback' as const
    };
  }

  const clockwise = segment.kind === 'circle' ? ref.reversed : orientedArcClockwise(segment, ref);
  const centerToSource = {
    x: sourcePoint.x - segment.center.x,
    y: sourcePoint.y - segment.center.y
  };
  const sourceDistance = Math.hypot(centerToSource.x, centerToSource.y);

  if (sourceDistance <= segment.radius + 1e-9) {
    return {
      ...nearestPointOnSegment(segment, ref, contourHintPoint),
      relation: 'nearest-fallback' as const
    };
  }

  const baseAngle = Math.atan2(centerToSource.y, centerToSource.x);
  const tangentOffset = Math.acos(segment.radius / sourceDistance);
  const candidates = [baseAngle + tangentOffset, baseAngle - tangentOffset]
    .filter((angle) => tangentAngleIsValid(segment, ref, angle))
    .map((angle) => {
      const point = pointOnCircle(segment.center, segment.radius, angle);
      return {
        distance: distance(sourcePoint, point),
        hintDistance: distance(contourHintPoint, point),
        point,
        tangent: circleTangent(angle, clockwise),
        t: tangentParameter(segment, ref, angle),
        relation: 'tangent' as const
      };
    });

  return candidates.sort((first, second) => first.hintDistance - second.hintDistance)[0] ?? {
    ...nearestPointOnSegment(segment, ref, contourHintPoint),
    relation: 'nearest-fallback' as const
  };
}

function tangentAngleIsValid(segment: ArcPathSegment | CirclePathSegment, ref: OrientedSegmentRef, angle: number) {
  if (segment.kind === 'circle') return true;

  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);
  const startAngle = Math.atan2(start.y - segment.center.y, start.x - segment.center.x);
  const endAngle = Math.atan2(end.y - segment.center.y, end.x - segment.center.x);
  const sweep = signedSweep(startAngle, endAngle, orientedArcClockwise(segment, ref));
  return angleIsOnSweep(angle, startAngle, sweep);
}

function tangentParameter(segment: ArcPathSegment | CirclePathSegment, ref: OrientedSegmentRef, angle: number) {
  if (segment.kind === 'circle') return 0;

  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);
  const startAngle = Math.atan2(start.y - segment.center.y, start.x - segment.center.x);
  const endAngle = Math.atan2(end.y - segment.center.y, end.x - segment.center.x);
  const clockwise = orientedArcClockwise(segment, ref);
  const sweep = signedSweep(startAngle, endAngle, clockwise);

  return Math.abs(signedSweep(startAngle, angle, clockwise) / sweep);
}

function syncChainRefs(document: PathPlanningDocument, operation: PathOperation) {
  const chain = document.chains.find((candidate) => candidate.id === operation.chainId);
  if (!chain) return;

  chain.segmentRefs = operation.segmentRefs.map((ref) => ({ ...ref }));
}

function refreshPlan(document: PathPlanningDocument) {
  const clusterResult = clusterSegmentEndpoints(document.segments, document.options);
  document.endpointClusters = clusterResult.clusters;

  const segmentsById = segmentMap(document.segments);
  document.chains.forEach((chain) => refreshChainTopology(chain, segmentsById, clusterResult.endpointToCluster));

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
  refreshOperationDisplayNames(document);
  refreshPathElements(document);
}

function refreshPathElements(document: PathPlanningDocument) {
  const pathElementTree = buildPathElements(document.contours, document.chains, document.plan);
  document.pathElements = pathElementTree.pathElements;
  document.rootPathElementIds = pathElementTree.rootPathElementIds;
}

function refreshOperationDisplayNames(document: PathPlanningDocument) {
  const displayNamesByContourId = buildContourDisplayNames(document.contours);
  document.plan.operations.forEach((operation) => {
    operation.displayName = displayNamesByContourId.get(operation.contourId) ?? operation.label;
  });
}

function refreshChainTopology(
  chain: PathChain,
  segmentsById: Map<SegmentId, PathSegment>,
  endpointToCluster: Record<string, EndpointClusterId>
) {
  const startClusterId = chainEndpointClusterId(chain.segmentRefs, 'start', segmentsById, endpointToCluster);
  chain.startClusterId = startClusterId;
  chain.endClusterId = chain.closed
    ? startClusterId
    : chainEndpointClusterId(chain.segmentRefs, 'end', segmentsById, endpointToCluster);
  chain.metrics = {
    segmentCount: chain.segmentRefs.length,
    cutLength: pathCutLength(chain.segmentRefs, segmentsById),
    gapLength: pathGapLength(chain.segmentRefs, segmentsById, chain.closed)
  };
}

function chainEndpointClusterId(
  refs: OrientedSegmentRef[],
  endpoint: EndpointSide,
  segmentsById: Map<SegmentId, PathSegment>,
  endpointToCluster: Record<string, EndpointClusterId>
) {
  const ref = endpoint === 'start' ? refs[0] : refs[refs.length - 1];
  if (!ref) return null;

  const segment = requiredSegment(segmentsById, ref.segmentId);
  if (segment.kind === 'circle') return null;

  const side = orientedEndpointSide(ref, endpoint);
  return endpointToCluster[endpointKey(ref.segmentId, side)] ?? null;
}

function orientedEndpointSide(ref: OrientedSegmentRef, endpoint: EndpointSide): EndpointSide {
  if (endpoint === 'start') return ref.reversed ? 'end' : 'start';
  return ref.reversed ? 'start' : 'end';
}

function pathGapLength(
  refs: OrientedSegmentRef[],
  segmentsById: Map<SegmentId, PathSegment>,
  closed: boolean
) {
  let gapLength = 0;

  for (let index = 0; index < refs.length - 1; index++) {
    const current = requiredSegment(segmentsById, refs[index].segmentId);
    const next = requiredSegment(segmentsById, refs[index + 1].segmentId);
    gapLength += distance(orientedSegmentEnd(current, refs[index]), orientedSegmentStart(next, refs[index + 1]));
  }

  if (closed && refs.length > 1) {
    const last = requiredSegment(segmentsById, refs[refs.length - 1].segmentId);
    const first = requiredSegment(segmentsById, refs[0].segmentId);
    gapLength += distance(orientedSegmentEnd(last, refs[refs.length - 1]), orientedSegmentStart(first, refs[0]));
  }

  return gapLength;
}

function planMetrics(plan: OperationPlan) {
  return {
    operationCount: plan.operations.length,
    totalCutLength: plan.operations.reduce((total, operation) => total + operation.metrics.cutLength, 0),
    totalRapidLength: plan.operations.reduce((total, operation) => total + operation.metrics.rapidInLength, 0)
  };
}

function recordManualOrderOverrides(document: PathPlanningDocument) {
  document.plan.operations.forEach((operation) => {
    operation.overrides = {
      ...operation.overrides,
      order: {
        kind: 'manual',
        orderIndex: operation.orderIndex
      }
    };
  });
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
