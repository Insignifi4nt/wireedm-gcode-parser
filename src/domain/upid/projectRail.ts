import type {
  Bounds2,
  PathDiagnostic,
  PathElement,
  PathElementId,
  PathOperation,
  PathPlanningDocument,
  Point2,
  SegmentId
} from '@/domain/path-intel/types';
import {
  boundsAreFinite,
  distance,
  emptyBounds,
  mergeBounds,
  orientedSegmentEnd,
  orientedSegmentStart,
  pathBounds,
  pointsEqual,
  requiredSegment,
  segmentMap
} from '@/domain/path-intel/segments';

export type UpidManualDecisionKind = 'order' | 'role' | 'direction' | 'start';

export interface UpidPathElementRef {
  operationId: string | null;
  pathElementId?: string | null;
  pointRole?: 'start' | 'end' | null;
  segmentId: SegmentId | null;
  travelRole?: 'rapid-in' | null;
}

export type UpidOperationPathElement = PathElement & {
  direction: NonNullable<PathElement['direction']>;
  metrics: NonNullable<PathElement['metrics']>;
  operationId: string;
  orderIndex: number;
};

export interface UpidProjectRailTreeNode {
  children: UpidProjectRailTreeNode[];
  element: UpidOperationPathElement;
}

export interface UpidProjectRail {
  contourTree: UpidProjectRailTreeNode[];
  cutSequenceElements: UpidOperationPathElement[];
  manualOrderActive: boolean;
  operationElements: UpidOperationPathElement[];
  summary: {
    contourCount: number;
    operationCount: number;
    rootCount: number;
  };
}

export interface UpidSelectedPathTravel {
  end: Point2;
  length: number;
  start: Point2;
}

export interface UpidEditorPathStats {
  arcMoveCount: number;
  bounds: Bounds2;
  cuttingMoveCount: number;
  pathCount: number;
  rapidMoveCount: number;
}

export function createUpidProjectRail(document: PathPlanningDocument): UpidProjectRail {
  const operationElements = document.pathElements.filter(isUpidOperationPathElement);
  const cutSequenceElements = [...operationElements].sort((first, second) => first.orderIndex - second.orderIndex);
  const contourTree = buildUpidPathElementTree(operationElements, document.rootPathElementIds);

  return {
    contourTree,
    cutSequenceElements,
    manualOrderActive: cutSequenceElements.some((pathElement) => Boolean(pathElement.overrides?.order)),
    operationElements,
    summary: {
      contourCount: document.contours.length,
      operationCount: document.plan.operations.length,
      rootCount: contourTree.length
    }
  };
}

export function isUpidOperationPathElement(element: PathElement): element is UpidOperationPathElement {
  return (
    element.operationId !== null &&
    element.orderIndex !== null &&
    element.direction !== null &&
    element.metrics !== null
  );
}

export function readUpidOperationPathElement(
  document: PathPlanningDocument | null,
  operationId: string,
  pathElementId?: string | null
): UpidOperationPathElement | null {
  const element = pathElementId
    ? document?.pathElements.find(
        (candidate) => candidate.id === pathElementId && candidate.operationId === operationId
      )
    : document?.pathElements.find((candidate) => candidate.operationId === operationId);

  return element && isUpidOperationPathElement(element) ? element : null;
}

export function summarizeUpidPathDocumentForEditor(document: PathPlanningDocument): UpidEditorPathStats {
  const segmentsById = segmentMap(document.segments);
  let bounds = emptyBounds();
  let currentPoint: Point2 | null = null;
  let rapidMoveCount = 0;
  let cuttingMoveCount = 0;
  let arcMoveCount = 0;

  for (const operation of document.plan.operations) {
    if (operation.segmentRefs.length === 0) continue;

    const operationBounds = pathBounds(operation.segmentRefs, segmentsById);
    if (boundsAreFinite(operationBounds)) {
      bounds = mergeBounds(bounds, operationBounds);
    }

    if (!currentPoint || !pointsEqual(currentPoint, operation.startPoint, document.options.coincidenceEpsilon)) {
      rapidMoveCount += 1;
    }

    for (const ref of operation.segmentRefs) {
      const segment = requiredSegment(segmentsById, ref.segmentId);
      if (segment.kind === 'line') {
        cuttingMoveCount += 1;
      } else if (segment.kind === 'circle') {
        arcMoveCount += 2;
      } else {
        arcMoveCount += 1;
      }
    }

    currentPoint = operation.endPoint;
  }

  if (!boundsAreFinite(bounds)) {
    bounds = emptyDisplayBounds();
  }

  return {
    arcMoveCount,
    bounds,
    cuttingMoveCount,
    pathCount: rapidMoveCount + cuttingMoveCount + arcMoveCount,
    rapidMoveCount
  };
}

export function normalizeUpidPathElementSelection(
  document: PathPlanningDocument,
  operationId: string | null,
  element: UpidPathElementRef | null
): UpidPathElementRef | null {
  const fallbackOperation = document.plan.operations[0] ?? null;
  const operation =
    document.plan.operations.find((candidate) => candidate.id === operationId) ?? fallbackOperation;
  if (!operation) return null;

  const pathElementId = upidPathElementIdForOperation(document, operation.id);
  if (
    element?.operationId === operation.id &&
    (element.travelRole === 'rapid-in' ||
      !element.segmentId ||
      operation.segmentRefs.some((candidate) => candidate.segmentId === element.segmentId))
  ) {
    return {
      ...element,
      pathElementId: element.pathElementId ?? pathElementId
    };
  }

  return {
    operationId: operation.id,
    pathElementId,
    segmentId: null
  };
}

export function readUpidPathElementPoint(
  document: PathPlanningDocument,
  element: UpidPathElementRef
): Point2 | null {
  if (!element.operationId || !element.segmentId || !element.pointRole) return null;

  const operation = document.plan.operations.find((candidate) => candidate.id === element.operationId);
  const ref = operation?.segmentRefs.find((candidate) => candidate.segmentId === element.segmentId);
  if (!ref) return null;

  const segment = requiredSegment(segmentMap(document.segments), ref.segmentId);
  return element.pointRole === 'start' ? orientedSegmentStart(segment, ref) : orientedSegmentEnd(segment, ref);
}

export function readUpidPathElementPointByRole(
  element: PathElement,
  role: 'start' | 'end'
) {
  return element.points.find((point) => point.role === role) ?? null;
}

export function upidStartPreviewPointRole(
  document: PathPlanningDocument,
  preview: {
    operationId: string;
    point: Point2;
    segmentId: SegmentId;
  }
): 'start' | 'end' | null {
  const operation = document.plan.operations.find((candidate) => candidate.id === preview.operationId);
  const ref = operation?.segmentRefs.find((candidate) => candidate.segmentId === preview.segmentId);
  if (!ref) return null;

  const segment = requiredSegment(segmentMap(document.segments), ref.segmentId);
  if (pointsEqual(preview.point, orientedSegmentStart(segment, ref), document.options.coincidenceEpsilon)) {
    return 'start';
  }
  if (pointsEqual(preview.point, orientedSegmentEnd(segment, ref), document.options.coincidenceEpsilon)) {
    return 'end';
  }
  return null;
}

export function readUpidSelectedPathTravel(
  document: PathPlanningDocument | null,
  operationIndex: number,
  element: UpidPathElementRef | null
): UpidSelectedPathTravel | null {
  if (!document || element?.travelRole !== 'rapid-in' || operationIndex < 0) return null;

  const operation = document.plan.operations[operationIndex];
  if (!operation || element.operationId !== operation.id) return null;

  const previousOperation = operationIndex > 0 ? document.plan.operations[operationIndex - 1] : null;
  const start = previousOperation?.endPoint ?? document.options.startPoint;
  const end = operation.startPoint;

  return {
    end,
    length: distance(start, end),
    start
  };
}

export function upidPathElementRefForDiagnostic(
  document: PathPlanningDocument,
  diagnostic: PathDiagnostic
): UpidPathElementRef | null {
  const bySegment = refForFirstRelatedSegment(document, diagnostic.relatedSegmentIds ?? []);
  if (bySegment) return bySegment;

  const byContour = refForFirstRelatedOperation(
    document,
    diagnostic.relatedContourIds ?? [],
    (operation, id) => operation.contourId === id
  );
  if (byContour) return byContour;

  return refForFirstRelatedOperation(
    document,
    diagnostic.relatedChainIds ?? [],
    (operation, id) => operation.chainId === id
  );
}

export function upidPathElementRefsMatch(
  expected: UpidPathElementRef | null,
  actual: UpidPathElementRef | null
) {
  if (!expected?.operationId || expected.operationId !== actual?.operationId) return false;
  if (expected.pathElementId && expected.pathElementId !== actual.pathElementId) return false;
  if (expected.segmentId !== undefined && expected.segmentId !== actual.segmentId) return false;
  if (expected.pointRole !== undefined && expected.pointRole !== actual.pointRole) return false;
  if (expected.travelRole !== undefined && expected.travelRole !== actual.travelRole) return false;
  return true;
}

export function upidManualDecisionKinds(element: Pick<PathElement, 'overrides'>): UpidManualDecisionKind[] {
  const overrides = element.overrides;
  if (!overrides) return [];

  const decisions: UpidManualDecisionKind[] = [];
  if (overrides.order) decisions.push('order');
  if (overrides.classification) decisions.push('role');
  if (overrides.direction) decisions.push('direction');
  if (overrides.start) decisions.push('start');
  return decisions;
}

export function upidPathElementSourceEntityCount(element: PathElement) {
  return element.provenance.sourceEntityIndices.length;
}

export function upidPathElementNestLabel(element: PathElement) {
  return `depth ${element.containmentDepth} / children ${element.childIds.length}`;
}

export function upidPathElementIdForOperation(
  document: PathPlanningDocument,
  operationId: string
): PathElementId | null {
  return document.pathElements.find((element) => element.operationId === operationId)?.id ?? null;
}

function buildUpidPathElementTree(
  pathElements: UpidOperationPathElement[],
  rootPathElementIds: PathElementId[]
): UpidProjectRailTreeNode[] {
  const elementsById = new Map(pathElements.map((element) => [element.id, element]));
  const visited = new Set<PathElementId>();

  function buildNode(element: UpidOperationPathElement): UpidProjectRailTreeNode | null {
    if (visited.has(element.id)) return null;

    visited.add(element.id);
    return {
      children: element.childIds
        .map((childId) => elementsById.get(childId))
        .filter((child): child is UpidOperationPathElement => Boolean(child))
        .map((child) => buildNode(child))
        .filter((child): child is UpidProjectRailTreeNode => Boolean(child)),
      element
    };
  }

  const roots = rootPathElementIds
    .map((id) => elementsById.get(id))
    .filter((element): element is UpidOperationPathElement => Boolean(element));
  const rootNodes = roots
    .map((element) => buildNode(element))
    .filter((node): node is UpidProjectRailTreeNode => Boolean(node));

  const orphanNodes = pathElements
    .filter((element) => !visited.has(element.id))
    .map((element) => buildNode(element))
    .filter((node): node is UpidProjectRailTreeNode => Boolean(node));

  return [...rootNodes, ...orphanNodes];
}

function refForFirstRelatedSegment(
  document: PathPlanningDocument,
  segmentIds: SegmentId[]
): UpidPathElementRef | null {
  for (const segmentId of segmentIds) {
    const operation = document.plan.operations.find((candidate) =>
      candidate.segmentRefs.some((ref) => ref.segmentId === segmentId)
    );
    if (operation) {
      return operationRef(document, operation, segmentId);
    }
  }

  return null;
}

function refForFirstRelatedOperation(
  document: PathPlanningDocument,
  ids: string[],
  matches: (operation: PathOperation, id: string) => boolean
): UpidPathElementRef | null {
  for (const id of ids) {
    const operation = document.plan.operations.find((candidate) => matches(candidate, id));
    if (operation) return operationRef(document, operation, null);
  }

  return null;
}

function operationRef(
  document: PathPlanningDocument,
  operation: PathOperation,
  segmentId: SegmentId | null
): UpidPathElementRef {
  return {
    operationId: operation.id,
    pathElementId: upidPathElementIdForOperation(document, operation.id),
    segmentId
  };
}

function emptyDisplayBounds(): Bounds2 {
  return {
    minX: Number.NaN,
    minY: Number.NaN,
    maxX: Number.NaN,
    maxY: Number.NaN
  };
}
