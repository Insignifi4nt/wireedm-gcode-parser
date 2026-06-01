import type {
  Bounds2,
  ManualStartOverride,
  OrientedSegmentRef,
  PathElementPointRole,
  PathDiagnostic,
  PathElement,
  PathElementId,
  PathOperation,
  PathPlanningDocument,
  PathSegment,
  Point2,
  SegmentId
} from '@/domain/path-intel/types';
import type { DxfInsertSource } from '@/domain/dxf/types';
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
  treeMetrics: {
    descendantCount: number;
    directSegmentCount: number;
    totalSegmentCount: number;
  };
}

export interface UpidProjectRail {
  contourTree: UpidProjectRailTreeNode[];
  cutSequenceElements: UpidOperationPathElement[];
  manualOrderActive: boolean;
  operationElements: UpidOperationPathElement[];
  summary: {
    contourCount: number;
    manualDecisionCount: number;
    manualDecisionCounts: Record<UpidManualDecisionKind, number>;
    operationCount: number;
    rootCount: number;
  };
}

export interface UpidPathElementTreeContext {
  lineage: UpidOperationPathElement[];
  node: UpidProjectRailTreeNode;
  siblings: UpidProjectRailTreeNode[];
}

export interface UpidPathElementSequenceNeighbor {
  element: UpidOperationPathElement;
  index: number;
}

export interface UpidPathElementSequenceContext {
  current: UpidPathElementSequenceNeighbor;
  next: UpidPathElementSequenceNeighbor | null;
  previous: UpidPathElementSequenceNeighbor | null;
}

export interface UpidPathElementSegmentNeighbor {
  index: number;
  ref: OrientedSegmentRef;
  segment: PathSegment;
}

export interface UpidPathElementSegmentSequenceContext {
  current: UpidPathElementSegmentNeighbor;
  element: UpidOperationPathElement;
  next: UpidPathElementSegmentNeighbor | null;
  previous: UpidPathElementSegmentNeighbor | null;
  wraps: boolean;
}

export interface UpidSelectedPathTravel {
  end: Point2;
  length: number;
  start: Point2;
}

export interface UpidSelectedPathSegment {
  end: Point2;
  kind: string;
  layer: string | null;
  length: number;
  reversed: boolean;
  source: {
    block: string | null;
    edit: PathSegment['source']['edit'] | null;
    entityIndex: number;
    exact: boolean;
    handle: string | null;
    insert: string | null;
    subIndex?: number;
    type: string;
  };
  start: Point2;
}

export interface UpidSelectedPathPoint {
  point: Point2;
  role: Extract<PathElementPointRole, 'start' | 'end'>;
  segmentKind: string;
}

export interface UpidManualOverrideRow {
  kind: string;
  label: string;
  value: string;
}

export interface UpidPathElementSourceSummary {
  blocks: string | null;
  entities: string;
  edits: string | null;
  exact: 'exact' | 'mixed';
  handles: string | null;
  inserts: string | null;
  layers: string;
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
  const manualDecisionCounts = summarizeUpidManualDecisionCounts(operationElements);

  return {
    contourTree,
    cutSequenceElements,
    manualOrderActive: cutSequenceElements.some((pathElement) => Boolean(pathElement.overrides?.order)),
    operationElements,
    summary: {
      contourCount: document.contours.length,
      manualDecisionCount: Object.values(manualDecisionCounts).reduce((total, count) => total + count, 0),
      manualDecisionCounts,
      operationCount: document.plan.operations.length,
      rootCount: contourTree.length
    }
  };
}

function summarizeUpidManualDecisionCounts(
  elements: UpidOperationPathElement[]
): Record<UpidManualDecisionKind, number> {
  const counts: Record<UpidManualDecisionKind, number> = {
    direction: 0,
    order: 0,
    role: 0,
    start: 0
  };

  for (const element of elements) {
    for (const decision of upidManualDecisionKinds(element)) {
      counts[decision] += 1;
    }
  }

  return counts;
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

export function readUpidSelectedPathSegment(
  document: PathPlanningDocument | null,
  pathElement: UpidOperationPathElement,
  element: UpidPathElementRef | null
): UpidSelectedPathSegment | null {
  if (!document || !element?.segmentId || element.operationId !== pathElement.operationId) return null;

  const ref = pathElement.segmentRefs.find((candidate) => candidate.segmentId === element.segmentId);
  if (!ref) return null;

  const segment = segmentMap(document.segments).get(ref.segmentId);
  if (!segment) return null;

  return {
    end: orientedSegmentEnd(segment, ref),
    kind: segment.kind,
    layer: segment.layer,
    length: segment.length,
    reversed: ref.reversed,
    source: {
      block: segment.source.dxf?.blockName ?? null,
      edit: segment.source.edit ?? null,
      entityIndex: segment.source.sourceEntityIndex,
      exact: segment.source.exact,
      handle: segment.source.sourceEntityHandle ?? null,
      insert: formatUpidSegmentInsertSource(segment.source.dxf?.insertChain[0] ?? null),
      subIndex: segment.source.sourceSubIndex,
      type: segment.source.sourceEntityType
    },
    start: orientedSegmentStart(segment, ref)
  };
}

export function readUpidSelectedPathPoint(
  document: PathPlanningDocument | null,
  pathElement: UpidOperationPathElement,
  element: UpidPathElementRef | null
): UpidSelectedPathPoint | null {
  if (
    !document ||
    !element?.segmentId ||
    !element.pointRole ||
    element.operationId !== pathElement.operationId
  ) {
    return null;
  }

  const ref = pathElement.segmentRefs.find((candidate) => candidate.segmentId === element.segmentId);
  if (!ref) return null;

  const segment = segmentMap(document.segments).get(ref.segmentId);
  if (!segment) return null;

  return {
    point: element.pointRole === 'start' ? orientedSegmentStart(segment, ref) : orientedSegmentEnd(segment, ref),
    role: element.pointRole,
    segmentKind: segment.kind
  };
}

export function readUpidManualOverrideRows(overrides: PathElement['overrides']): UpidManualOverrideRow[] {
  if (!overrides) return [];

  const rows: UpidManualOverrideRow[] = [];
  if (overrides.order) {
    rows.push({
      kind: 'order',
      label: 'Order',
      value: `Manual position ${overrides.order.orderIndex + 1}`
    });
  }
  if (overrides.classification) {
    rows.push({
      kind: 'classification',
      label: 'Role',
      value: overrides.classification.classification
    });
  }
  if (overrides.direction) {
    rows.push({
      kind: 'direction',
      label: 'Direction',
      value: overrides.direction.direction
    });
  }
  if (overrides.start) {
    rows.push({
      kind: 'start',
      label: 'Start',
      value: formatUpidStartOverride(overrides.start)
    });
  }

  return rows;
}

function formatUpidStartOverride(start: ManualStartOverride) {
  const source = `source ${start.sourceSegmentId}`;

  if (start.relation === 'new-split-point') {
    return `${formatUpidPoint(start.point)} / split ${start.createdSegmentIds.length} / ${source}`;
  }

  return `${formatUpidPoint(start.point)} / existing ${start.pointRole ?? 'point'} / ${source}`;
}

export function readUpidPathElementSourceSummary(element: PathElement): UpidPathElementSourceSummary {
  const provenance = element.provenance;
  const entityCount = provenance.sourceEntityIndices.length;
  const insertedSegmentCount = provenance.dxf?.insertedSegmentCount ?? 0;

  return {
    blocks:
      provenance.dxf && provenance.dxf.blockNames.length > 0
        ? provenance.dxf.blockNames.join(', ')
        : null,
    entities: `${entityCount} ${entityCount === 1 ? 'entity' : 'entities'}`,
    edits: formatUpidPathElementEditSummary(provenance.edit ?? null),
    exact: provenance.exact ? 'exact' : 'mixed',
    handles:
      provenance.sourceEntityHandles && provenance.sourceEntityHandles.length > 0
        ? provenance.sourceEntityHandles.join(', ')
        : null,
    inserts:
      provenance.dxf && provenance.dxf.insertBlockNames.length > 0
        ? `${provenance.dxf.insertBlockNames.join(', ')} / ${insertedSegmentCount} ${
            insertedSegmentCount === 1 ? 'segment' : 'segments'
          }`
        : null,
    layers: provenance.layers.length > 0 ? provenance.layers.map((layer) => layer ?? '-').join(', ') : '-'
  };
}

function formatUpidPathElementEditSummary(edit: PathElement['provenance']['edit'] | null) {
  if (!edit || edit.derivedSegmentIds.length === 0) return null;

  const eventLabel = edit.events.length === 1 ? 'edit' : 'edits';
  const segmentLabel = edit.derivedSegmentIds.length === 1 ? 'segment' : 'segments';
  return `${edit.events.length} ${eventLabel} / ${edit.derivedSegmentIds.length} ${segmentLabel}`;
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

export function readUpidPathElementTreeNode(
  document: PathPlanningDocument,
  elementRef: UpidPathElementRef
): UpidProjectRailTreeNode | null {
  return readUpidPathElementTreeContext(document, elementRef)?.node ?? null;
}

export function readUpidPathElementTreeContext(
  document: PathPlanningDocument,
  elementRef: UpidPathElementRef
): UpidPathElementTreeContext | null {
  const selectedElement = readPathElementForRef(document, elementRef);
  if (!selectedElement) return null;

  const rail = createUpidProjectRail(document);
  const node = findTreeNodeByPathElementId(rail.contourTree, selectedElement.id);
  if (!node) return null;

  const parentSiblings = selectedElement.parentId
    ? findTreeNodeByPathElementId(rail.contourTree, selectedElement.parentId)?.children ?? []
    : rail.contourTree;

  return {
    lineage: readUpidPathElementLineage(document, elementRef),
    node,
    siblings: parentSiblings.filter((candidate) => candidate.element.id !== selectedElement.id)
  };
}

export function readUpidPathElementSequenceContext(
  document: PathPlanningDocument,
  elementRef: UpidPathElementRef
): UpidPathElementSequenceContext | null {
  const selectedElement = readPathElementForRef(document, elementRef);
  if (!selectedElement || !isUpidOperationPathElement(selectedElement)) return null;

  const cutSequenceElements = createUpidProjectRail(document).cutSequenceElements;
  const index = cutSequenceElements.findIndex((element) => element.id === selectedElement.id);
  if (index < 0) return null;

  return {
    current: {
      element: cutSequenceElements[index],
      index
    },
    next:
      index < cutSequenceElements.length - 1
        ? {
            element: cutSequenceElements[index + 1],
            index: index + 1
          }
        : null,
    previous:
      index > 0
        ? {
            element: cutSequenceElements[index - 1],
            index: index - 1
          }
        : null
  };
}

export function readUpidPathElementSegmentSequenceContext(
  document: PathPlanningDocument,
  elementRef: UpidPathElementRef
): UpidPathElementSegmentSequenceContext | null {
  if (!elementRef.segmentId) return null;

  const selectedElement = readPathElementForRef(document, elementRef);
  if (!selectedElement || !isUpidOperationPathElement(selectedElement)) return null;

  const index = selectedElement.segmentRefs.findIndex((ref) => ref.segmentId === elementRef.segmentId);
  if (index < 0) return null;

  const segmentsById = segmentMap(document.segments);
  const wraps = selectedElement.closed && selectedElement.segmentRefs.length > 1;
  const current = segmentNeighborAt(selectedElement.segmentRefs, segmentsById, index);
  if (!current) return null;

  const previousIndex = index > 0 ? index - 1 : wraps ? selectedElement.segmentRefs.length - 1 : null;
  const nextIndex = index < selectedElement.segmentRefs.length - 1 ? index + 1 : wraps ? 0 : null;

  return {
    current,
    element: selectedElement,
    next: nextIndex !== null ? segmentNeighborAt(selectedElement.segmentRefs, segmentsById, nextIndex) : null,
    previous:
      previousIndex !== null ? segmentNeighborAt(selectedElement.segmentRefs, segmentsById, previousIndex) : null,
    wraps
  };
}

export function readUpidPathElementLineage(
  document: PathPlanningDocument,
  elementRef: UpidPathElementRef
): UpidOperationPathElement[] {
  const selectedElement = readPathElementForRef(document, elementRef);
  if (!selectedElement) return [];

  const pathElementsById = new Map(document.pathElements.map((element) => [element.id, element]));
  const lineage: UpidOperationPathElement[] = [];
  let current: PathElement | null = selectedElement;

  while (current) {
    if (isUpidOperationPathElement(current)) {
      lineage.unshift(current);
    }
    current = current.parentId ? pathElementsById.get(current.parentId) ?? null : null;
  }

  return lineage;
}

export function upidPathElementAncestorIds(
  document: PathPlanningDocument,
  elementRef: UpidPathElementRef
): PathElementId[] {
  const selectedElement = readPathElementForRef(document, elementRef);
  if (!selectedElement) return [];

  const pathElementsById = new Map(document.pathElements.map((element) => [element.id, element]));
  const ids: PathElementId[] = [];
  let current: (typeof document.pathElements)[number] | null = selectedElement;

  while (current) {
    ids.push(current.id);
    current = current.parentId ? pathElementsById.get(current.parentId) ?? null : null;
  }

  return ids;
}

function readPathElementForRef(
  document: PathPlanningDocument,
  elementRef: UpidPathElementRef
): PathElement | null {
  return (
    (elementRef.pathElementId
      ? document.pathElements.find((element) => element.id === elementRef.pathElementId)
      : null) ??
    document.pathElements.find((element) => element.operationId === elementRef.operationId) ??
    null
  );
}

function findTreeNodeByPathElementId(
  nodes: UpidProjectRailTreeNode[],
  pathElementId: PathElementId
): UpidProjectRailTreeNode | null {
  for (const node of nodes) {
    if (node.element.id === pathElementId) return node;

    const child = findTreeNodeByPathElementId(node.children, pathElementId);
    if (child) return child;
  }

  return null;
}

function segmentNeighborAt(
  refs: OrientedSegmentRef[],
  segmentsById: Map<SegmentId, PathSegment>,
  index: number
): UpidPathElementSegmentNeighbor | null {
  const ref = refs[index];
  if (!ref) return null;

  const segment = segmentsById.get(ref.segmentId);
  return segment
    ? {
        index,
        ref,
        segment
      }
    : null;
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
    const children = element.childIds
      .map((childId) => elementsById.get(childId))
      .filter((child): child is UpidOperationPathElement => Boolean(child))
      .map((child) => buildNode(child))
      .filter((child): child is UpidProjectRailTreeNode => Boolean(child));

    return {
      children,
      element,
      treeMetrics: {
        descendantCount: children.reduce((total, child) => total + 1 + child.treeMetrics.descendantCount, 0),
        directSegmentCount: element.segmentRefs.length,
        totalSegmentCount:
          element.segmentRefs.length +
          children.reduce((total, child) => total + child.treeMetrics.totalSegmentCount, 0)
      }
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

function formatUpidSegmentInsertSource(insert: DxfInsertSource | null) {
  return insert ? `${insert.blockName} / row ${insert.row} col ${insert.column}` : null;
}

function formatUpidPoint(point: Point2) {
  return `${point.x.toFixed(3)}, ${point.y.toFixed(3)}`;
}
