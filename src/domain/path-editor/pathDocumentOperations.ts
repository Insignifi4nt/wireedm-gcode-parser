import { analyzeContours } from '@/domain/path-intel/contours';
import { buildChains } from '@/domain/path-intel/chains';
import { clusterSegmentEndpoints } from '@/domain/path-intel/endpointClusters';
import { buildPathElements } from '@/domain/path-intel/pathElements';
import { buildContourDisplayNames } from '@/domain/path-intel/pathNaming';
import { planOperations } from '@/domain/path-intel/planOperations';
import {
  angleIsOnSweep,
  createArcSegment,
  createCircleSegment,
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
  OperationOrderStrategy,
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

export type PathMirrorAxis = 'x' | 'y';

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

export function setPathOperationOrderStrategy(
  document: PathPlanningDocument,
  strategy: OperationOrderStrategy
) {
  if (document.options.operationOrderStrategy === strategy && !hasManualOrderOverrides(document)) {
    return null;
  }

  const next = cloneDocument(document);
  const previousOperationsByContourId = new Map(
    next.plan.operations.map((operation) => [operation.contourId, operation])
  );
  next.options = {
    ...next.options,
    operationOrderStrategy: strategy
  };

  const replanned = planOperations({
    chains: next.chains,
    contours: next.contours,
    segments: next.segments,
    options: next.options
  });

  next.plan = {
    ...replanned,
    operations: replanned.operations.map((operation) =>
      restoreManualOperationState(operation, previousOperationsByContourId.get(operation.contourId))
    )
  };
  refreshPlan(next);
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

export function translatePathElement(
  document: PathPlanningDocument,
  pathElementId: PathElementId,
  delta: Point2
) {
  const pathElement = document.pathElements.find((candidate) => candidate.id === pathElementId);
  if (!pathElement) return null;

  return translatePathSegments(
    document,
    pathElement.segmentRefs.map((ref) => ref.segmentId),
    delta
  );
}

export function translatePathOperation(
  document: PathPlanningDocument,
  operationId: string,
  delta: Point2
) {
  const operation = document.plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation) return null;

  return translatePathSegments(
    document,
    operation.segmentRefs.map((ref) => ref.segmentId),
    delta
  );
}

export function translatePathDocument(document: PathPlanningDocument, delta: Point2) {
  return translatePathSegments(
    document,
    document.segments.map((segment) => segment.id),
    delta
  );
}

export function translatePathSegment(
  document: PathPlanningDocument,
  segmentId: SegmentId,
  delta: Point2
) {
  return translatePathSegments(document, [segmentId], delta);
}

export function rotatePathDocument(
  document: PathPlanningDocument,
  angleDegrees: number,
  origin: Point2
) {
  return transformPathSegments(
    document,
    document.segments.map((segment) => segment.id),
    rotationPointTransform(angleDegrees, origin),
    1
  );
}

export function rotatePathElement(
  document: PathPlanningDocument,
  pathElementId: PathElementId,
  angleDegrees: number,
  origin: Point2
) {
  const pathElement = document.pathElements.find((candidate) => candidate.id === pathElementId);
  if (!pathElement) return null;

  return transformPathSegments(
    document,
    pathElement.segmentRefs.map((ref) => ref.segmentId),
    rotationPointTransform(angleDegrees, origin),
    1
  );
}

export function rotatePathOperation(
  document: PathPlanningDocument,
  operationId: string,
  angleDegrees: number,
  origin: Point2
) {
  const operation = document.plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation) return null;

  return transformPathSegments(
    document,
    operation.segmentRefs.map((ref) => ref.segmentId),
    rotationPointTransform(angleDegrees, origin),
    1
  );
}

export function rotatePathSegment(
  document: PathPlanningDocument,
  segmentId: SegmentId,
  angleDegrees: number,
  origin: Point2
) {
  return transformPathSegments(document, [segmentId], rotationPointTransform(angleDegrees, origin), 1);
}

export function mirrorPathDocument(
  document: PathPlanningDocument,
  axis: PathMirrorAxis,
  origin: Point2
) {
  return transformPathSegments(
    document,
    document.segments.map((segment) => segment.id),
    mirrorPointTransform(axis, origin),
    -1
  );
}

export function mirrorPathElement(
  document: PathPlanningDocument,
  pathElementId: PathElementId,
  axis: PathMirrorAxis,
  origin: Point2
) {
  const pathElement = document.pathElements.find((candidate) => candidate.id === pathElementId);
  if (!pathElement) return null;

  return transformPathSegments(
    document,
    pathElement.segmentRefs.map((ref) => ref.segmentId),
    mirrorPointTransform(axis, origin),
    -1
  );
}

export function mirrorPathOperation(
  document: PathPlanningDocument,
  operationId: string,
  axis: PathMirrorAxis,
  origin: Point2
) {
  const operation = document.plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation) return null;

  return transformPathSegments(
    document,
    operation.segmentRefs.map((ref) => ref.segmentId),
    mirrorPointTransform(axis, origin),
    -1
  );
}

export function mirrorPathSegment(
  document: PathPlanningDocument,
  segmentId: SegmentId,
  axis: PathMirrorAxis,
  origin: Point2
) {
  return transformPathSegments(document, [segmentId], mirrorPointTransform(axis, origin), -1);
}

export function movePathSegmentCenterTo(
  document: PathPlanningDocument,
  segmentId: SegmentId,
  targetCenter: Point2
) {
  const segment = document.segments.find((candidate) => candidate.id === segmentId);
  if (!segment || segment.kind === 'line') return null;

  return translatePathSegment(document, segmentId, {
    x: targetCenter.x - segment.center.x,
    y: targetCenter.y - segment.center.y
  });
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

  const startSelection = manualStartSelection(next, operation, nearest);
  const split = splitOperationSegmentAtPoint(next, operation, nearest);
  const refs = split?.refs ?? operation.segmentRefs;
  const startIndex = split?.startIndex ?? nearest.segmentIndex;
  operation.segmentRefs = rotatePathRefs(refs, startIndex);
  operation.overrides = {
    ...operation.overrides,
    start: {
      kind: 'manual',
      point: { ...nearest.point },
      relation: split?.createdSegmentIds?.length ? 'new-split-point' : 'existing-point',
      sourceSegmentId: nearest.segmentId,
      sourceSegmentIndex: nearest.segmentIndex,
      ...(startSelection.pointRole ? { pointRole: startSelection.pointRole } : {}),
      createdSegmentIds: split?.createdSegmentIds ?? []
    }
  };
  syncChainRefs(next, operation);
  refreshPlan(next);
  return next;
}

export function setCircleOperationCenterPierceLeadIn(
  document: PathPlanningDocument,
  operationId: string
) {
  const next = cloneDocument(document);
  const operation = next.plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation || !operation.closed) return null;

  const leadInSource = circularOperationLeadInSource(next, operation);
  if (!leadInSource) return null;

  operation.overrides = {
    ...operation.overrides,
    leadIn: {
      kind: 'manual',
      move: 'cut',
      from: { ...leadInSource.center },
      to: { ...operation.startPoint },
      source: 'circle-center',
      sourceSegmentId: leadInSource.segmentId,
      sourceSegmentIndex: leadInSource.segmentIndex
    }
  };
  refreshPlan(next);
  return next;
}

export function canSetCircleOperationCenterPierceLeadIn(
  document: PathPlanningDocument,
  operationId: string
) {
  const operation = document.plan.operations.find((candidate) => candidate.id === operationId);
  return Boolean(operation && circularOperationLeadInSource(document, operation));
}

function manualStartSelection(
  document: PathPlanningDocument,
  operation: PathOperation,
  nearest: NearestPathPoint
) {
  const ref = operation.segmentRefs[nearest.segmentIndex];
  if (!ref) return {};

  const segment = requiredSegment(segmentMap(document.segments), ref.segmentId);
  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);
  const epsilon = document.options.coincidenceEpsilon;
  const pointRole: EndpointSide | undefined = pointsEqual(nearest.point, start, epsilon)
    ? 'start'
    : pointsEqual(nearest.point, end, epsilon)
      ? 'end'
      : undefined;

  return { pointRole };
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

export function setClosedOperationStartAtSegmentEndpoint(
  document: PathPlanningDocument,
  operationId: string,
  segmentId: SegmentId,
  pointRole: EndpointSide
) {
  const next = cloneDocument(document);
  const operation = next.plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation || !operation.closed) return null;

  const segmentIndex = operation.segmentRefs.findIndex((ref) => ref.segmentId === segmentId);
  const ref = operation.segmentRefs[segmentIndex];
  if (!ref) return null;

  const segment = requiredSegment(segmentMap(next.segments), ref.segmentId);
  const point = pointRole === 'start' ? orientedSegmentStart(segment, ref) : orientedSegmentEnd(segment, ref);
  const startIndex = pointRole === 'start' ? segmentIndex : (segmentIndex + 1) % operation.segmentRefs.length;

  operation.segmentRefs = rotatePathRefs(operation.segmentRefs, startIndex);
  operation.overrides = {
    ...operation.overrides,
    start: {
      kind: 'manual',
      point: { ...point },
      relation: 'existing-point',
      sourceSegmentId: segmentId,
      sourceSegmentIndex: segmentIndex,
      pointRole,
      createdSegmentIds: []
    }
  };
  syncChainRefs(next, operation);
  refreshPlan(next);
  return next;
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

  const splitSegments = splitSegment(segment, ref, nearest.point, document, operation.id);
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
  document: PathPlanningDocument,
  operationId: string
): PathSegment[] | null {
  const source = splitSegmentSource(segment, point, operationId, 'user split');
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

  return splitCircle(segment, ref, point, document, operationId);
}

function splitSegmentSource(
  segment: PathSegment,
  point: Point2,
  operationId: string,
  note: string
): PathSegment['source'] {
  return {
    ...segment.source,
    edit: {
      kind: 'manual-start-split',
      operationId,
      parentSegmentId: segment.id,
      point: { ...point }
    },
    note: segment.source.note ? `${segment.source.note}; ${note}` : note
  };
}

function replaceDocumentSegment(document: PathPlanningDocument, segmentId: SegmentId, replacements: PathSegment[]) {
  const index = document.segments.findIndex((segment) => segment.id === segmentId);
  if (index < 0) {
    document.segments.push(...replacements);
    return;
  }

  document.segments.splice(index, 1, ...replacements);
}

function translatePathSegments(document: PathPlanningDocument, segmentIds: SegmentId[], delta: Point2) {
  if (delta.x === 0 && delta.y === 0) return null;

  return transformPathSegments(document, segmentIds, (point) => translatePoint(point, delta), 1);
}

function transformPathSegments(
  document: PathPlanningDocument,
  segmentIds: SegmentId[],
  transformPoint: (point: Point2) => Point2,
  determinant: 1 | -1
) {
  if (!Number.isFinite(determinant)) return null;

  const transformedSegmentIds = new Set(segmentIds);
  if (transformedSegmentIds.size === 0) return null;

  const next = cloneDocument(document);
  let changed = false;
  next.segments = next.segments.map((segment) => {
    if (!transformedSegmentIds.has(segment.id)) return segment;
    changed = true;
    return transformSegmentGeometry(segment, transformPoint, determinant);
  });

  if (!changed) return null;

  refreshDocumentAfterSegmentGeometryEdit(next, transformedSegmentIds, transformPoint);
  return next;
}

function transformSegmentGeometry(
  segment: PathSegment,
  transformPoint: (point: Point2) => Point2,
  determinant: 1 | -1
): PathSegment {
  if (segment.kind === 'line') {
    return createLineSegment({
      id: segment.id,
      source: segment.source,
      start: transformPoint(segment.start),
      end: transformPoint(segment.end)
    });
  }

  if (segment.kind === 'circle') {
    return createCircleSegment({
      id: segment.id,
      source: segment.source,
      center: transformPoint(segment.center),
      preferredStart: transformPoint(segment.preferredStart),
      radius: segment.radius
    });
  }

  return createArcSegment({
    id: segment.id,
    source: segment.source,
    start: transformPoint(segment.start),
    end: transformPoint(segment.end),
    center: transformPoint(segment.center),
    radius: segment.radius,
    clockwise: determinant < 0 ? !segment.clockwise : segment.clockwise
  });
}

function refreshDocumentAfterSegmentGeometryEdit(
  document: PathPlanningDocument,
  transformedSegmentIds: Set<SegmentId>,
  transformPoint: (point: Point2) => Point2
) {
  const previousOperations = document.plan.operations.map((operation) => structuredClone(operation));
  const previousOperationsByContourId = new Map(previousOperations.map((operation) => [operation.contourId, operation]));
  const manualClassificationsByContourId = manualClassifications(document);

  const clusterResult = clusterSegmentEndpoints(document.segments, document.options);
  const chainResult = buildChains(document.segments, clusterResult, document.options);
  const contourResult = analyzeContours(chainResult.chains, document.segments, document.options);
  const contours = contourResult.contours.map((contour) => {
    const classification = manualClassificationsByContourId.get(contour.id);
    return classification ? { ...contour, classification } : contour;
  });
  const replanned = planOperations({
    chains: chainResult.chains,
    contours,
    segments: document.segments,
    options: document.options
  });
  const restoredOperationsByContourId = new Map(
    replanned.operations.map((operation) => [
      operation.contourId,
      restoreGeometryEditOperationState(
        operation,
        previousOperationsByContourId.get(operation.contourId),
        transformedSegmentIds,
        transformPoint
      )
    ])
  );
  const orderedOperations: PathOperation[] = [];

  for (const previousOperation of previousOperations) {
    const restored = restoredOperationsByContourId.get(previousOperation.contourId);
    if (!restored) continue;
    orderedOperations.push(restored);
    restoredOperationsByContourId.delete(previousOperation.contourId);
  }

  orderedOperations.push(...restoredOperationsByContourId.values());

  document.endpointClusters = clusterResult.clusters;
  document.chains = chainResult.chains;
  document.contours = contours;
  document.plan = {
    ...replanned,
    operations: orderedOperations
  };
  document.diagnostics = [
    ...clusterResult.diagnostics,
    ...chainResult.diagnostics,
    ...contourResult.diagnostics,
    ...replanned.diagnostics
  ];

  for (const operation of document.plan.operations) {
    syncChainRefs(document, operation);
  }

  refreshPlan(document);
}

function restoreGeometryEditOperationState(
  operation: PathOperation,
  previous: PathOperation | undefined,
  transformedSegmentIds: Set<SegmentId>,
  transformPoint: (point: Point2) => Point2
): PathOperation {
  if (!previous) return operation;

  const overrides = previous.overrides ? structuredClone(previous.overrides) : undefined;
  if (overrides?.start && startOverrideTouchesTransformedSegments(overrides.start, transformedSegmentIds)) {
    overrides.start = {
      ...overrides.start,
      point: transformPoint(overrides.start.point)
    };
  }
  if (overrides?.leadIn && transformedSegmentIds.has(overrides.leadIn.sourceSegmentId)) {
    overrides.leadIn = {
      ...overrides.leadIn,
      from: transformPoint(overrides.leadIn.from),
      to: transformPoint(overrides.leadIn.to)
    };
  }

  const restored: PathOperation = {
    ...operation,
    id: previous.id,
    ...(overrides ? { overrides } : {})
  };

  if (overrides?.classification) {
    restored.classification = overrides.classification.classification;
  }

  if (overrides?.direction || overrides?.start) {
    restored.segmentRefs = previous.segmentRefs.map((ref) => ({ ...ref }));
    restored.direction = previous.direction;
  }

  return restored;
}

function startOverrideTouchesTransformedSegments(
  start: NonNullable<PathOperation['overrides']>['start'],
  transformedSegmentIds: Set<SegmentId>
) {
  return Boolean(
    start &&
      (transformedSegmentIds.has(start.sourceSegmentId) ||
        start.createdSegmentIds.some((segmentId) => transformedSegmentIds.has(segmentId)))
  );
}

function splitCircle(
  segment: CirclePathSegment,
  ref: OrientedSegmentRef,
  point: Point2,
  document: PathPlanningDocument,
  operationId: string
): PathSegment[] {
  const clockwise = ref.reversed;
  const startAngle = Math.atan2(point.y - segment.center.y, point.x - segment.center.x);
  const middle = pointOnCircle(segment.center, segment.radius, startAngle + (clockwise ? -Math.PI : Math.PI));
  const source = splitSegmentSource(segment, point, operationId, 'user split circle');
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
    refreshOperationLeadIn(document, operation);
    const entryPoint = operationEntryPoint(operation);
    operation.metrics = {
      cutLength: pathCutLength(operation.segmentRefs, segmentsById) + operationLeadInCutLength(operation),
      rapidInLength: distance(current, entryPoint),
      segmentCount: operation.segmentRefs.length
    };
    current = operation.endPoint;
  });

  document.plan.metrics = planMetrics(document.plan);
  const contourResult = analyzeContours(document.chains, document.segments, document.options);
  const manualClassificationsByContourId = manualClassifications(document);
  document.contours = document.contours.map((contour) => {
    const refreshed = contourResult.contours.find((candidate) => candidate.id === contour.id);
    const nextContour = refreshed ?? contour;
    const classification = manualClassificationsByContourId.get(contour.id);
    return classification ? { ...nextContour, classification } : nextContour;
  });
  refreshOperationDisplayNames(document);
  refreshPathElements(document);
}

function refreshPathElements(document: PathPlanningDocument) {
  const pathElementTree = buildPathElements(
    document.contours,
    document.chains,
    document.plan,
    document.segments
  );
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

function operationEntryPoint(operation: PathOperation) {
  return operation.overrides?.leadIn?.from ?? operation.startPoint;
}

function operationLeadInCutLength(operation: PathOperation) {
  const leadIn = operation.overrides?.leadIn;
  return leadIn ? distance(leadIn.from, leadIn.to) : 0;
}

function refreshOperationLeadIn(document: PathPlanningDocument, operation: PathOperation) {
  const leadIn = operation.overrides?.leadIn;
  if (!leadIn) return;

  if (leadIn.source === 'circle-center') {
    const source = circularOperationLeadInSource(document, operation);
    if (source) {
      operation.overrides = {
        ...operation.overrides,
        leadIn: {
          ...leadIn,
          from: { ...source.center },
          to: { ...operation.startPoint },
          sourceSegmentId: source.segmentId,
          sourceSegmentIndex: source.segmentIndex
        }
      };
      return;
    }
  }

  operation.overrides = {
    ...operation.overrides,
    leadIn: {
      ...leadIn,
      to: { ...operation.startPoint }
    }
  };
}

function circularOperationLeadInSource(document: PathPlanningDocument, operation: PathOperation) {
  if (!operation.closed || operation.segmentRefs.length === 0) return null;

  const segmentsById = segmentMap(document.segments);
  const epsilon = document.options.coincidenceEpsilon;
  let source:
    | {
        center: Point2;
        radius: number;
        segmentId: SegmentId;
        segmentIndex: number;
      }
    | null = null;

  for (const [segmentIndex, ref] of operation.segmentRefs.entries()) {
    const segment = requiredSegment(segmentsById, ref.segmentId);
    if (segment.kind === 'line') return null;

    if (!source) {
      source = {
        center: { ...segment.center },
        radius: segment.radius,
        segmentId: ref.segmentId,
        segmentIndex
      };
      continue;
    }

    if (
      !pointsEqual(source.center, segment.center, epsilon) ||
      Math.abs(source.radius - segment.radius) > epsilon
    ) {
      return null;
    }
  }

  return source;
}

function manualClassifications(document: PathPlanningDocument) {
  return new Map(
    document.plan.operations
      .filter((operation) => operation.overrides?.classification)
      .map((operation) => [
        operation.contourId,
        operation.overrides!.classification!.classification
      ])
  );
}

function hasManualOrderOverrides(document: PathPlanningDocument) {
  return document.plan.operations.some((operation) => operation.overrides?.order);
}

function restoreManualOperationState(
  operation: PathOperation,
  previous: PathOperation | undefined
): PathOperation {
  if (!previous) return operation;

  const preservedOverrides = manualOverridesWithoutOrder(previous.overrides);
  const restored: PathOperation = {
    ...operation,
    id: previous.id,
    ...(preservedOverrides ? { overrides: preservedOverrides } : {})
  };

  if (preservedOverrides?.classification) {
    restored.classification = preservedOverrides.classification.classification;
  }

  if (preservedOverrides?.direction || preservedOverrides?.start) {
    restored.segmentRefs = previous.segmentRefs.map((ref) => ({ ...ref }));
    restored.startPoint = { ...previous.startPoint };
    restored.endPoint = { ...previous.endPoint };
    restored.direction = previous.direction;
  }

  return restored;
}

function manualOverridesWithoutOrder(overrides: PathOperation['overrides']) {
  if (!overrides) return undefined;

  const preserved = {
    ...(overrides.classification ? { classification: overrides.classification } : {}),
    ...(overrides.direction ? { direction: overrides.direction } : {}),
    ...(overrides.start ? { start: overrides.start } : {}),
    ...(overrides.leadIn ? { leadIn: overrides.leadIn } : {})
  };

  return Object.keys(preserved).length > 0 ? preserved : undefined;
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

function translatePoint(point: Point2, delta: Point2): Point2 {
  return {
    x: point.x + delta.x,
    y: point.y + delta.y
  };
}

function rotationPointTransform(angleDegrees: number, origin: Point2) {
  const normalizedAngle = ((angleDegrees % 360) + 360) % 360;
  const radians = (normalizedAngle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return (point: Point2): Point2 => {
    const localX = point.x - origin.x;
    const localY = point.y - origin.y;
    return {
      x: roundCoordinate(origin.x + localX * cos - localY * sin),
      y: roundCoordinate(origin.y + localX * sin + localY * cos)
    };
  };
}

function mirrorPointTransform(axis: PathMirrorAxis, origin: Point2) {
  return (point: Point2): Point2 =>
    axis === 'x'
      ? {
          x: roundCoordinate(point.x),
          y: roundCoordinate(origin.y - (point.y - origin.y))
        }
      : {
          x: roundCoordinate(origin.x - (point.x - origin.x)),
          y: roundCoordinate(point.y)
        };
}

function roundCoordinate(value: number) {
  const rounded = Number(value.toFixed(12));
  return Math.abs(rounded) <= 1e-12 ? 0 : rounded;
}
