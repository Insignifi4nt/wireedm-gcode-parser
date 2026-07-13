import { buildContourDisplayNames } from './pathNaming';
import type {
  OperationPlan,
  OrientedSegmentRef,
  PathChain,
  PathContour,
  PathElement,
  PathElementEditEvent,
  PathElementProvenance,
  PathElementTree,
  PathSegment
} from './types';

export function buildPathElements(
  contours: PathContour[],
  chains: PathChain[],
  plan: OperationPlan,
  segments: PathSegment[] = []
): PathElementTree {
  const chainsById = new Map(chains.map((chain) => [chain.id, chain]));
  const operationsByContourId = new Map(plan.operations.map((operation) => [operation.contourId, operation]));
  const displayNamesByContourId = buildContourDisplayNames(contours);
  const segmentsById = new Map(segments.map((segment) => [segment.id, segment]));

  const pathElements: PathElement[] = contours.map((contour) => {
    const chain = chainsById.get(contour.chainId);
    const operation = operationsByContourId.get(contour.id) ?? null;
    const segmentRefs = [...(operation?.segmentRefs ?? chain?.segmentRefs ?? [])];

    return {
      id: contour.id,
      kind: contour.closed ? 'contour' : 'open-chain',
      contourId: contour.id,
      chainId: contour.chainId,
      operationId: operation?.id ?? null,
      label: operation?.label ?? contour.label,
      displayName: displayNamesByContourId.get(contour.id) ?? contour.label,
      classification: operation?.classification ?? contour.classification,
      closed: contour.closed,
      parentId: contour.parentId,
      childIds: [...contour.childIds],
      containmentDepth: contour.containmentDepth,
      segmentRefs,
      points: pathElementPoints(contour, operation),
      provenance: pathElementProvenanceWithEdits(
        operation?.provenance ?? contour.provenance,
        segmentRefs,
        segmentsById
      ),
      diagnosticIds: [...contour.diagnosticIds, ...(chain?.diagnosticIds ?? [])].filter(uniqueText),
      orderIndex: operation?.orderIndex ?? null,
      direction: operation?.direction ?? null,
      metrics: operation?.metrics ?? null,
      compensationIntent: operation?.compensationIntent,
      overrides: operation?.overrides,
      bounds: contour.bounds,
      confidence: contour.confidence
    };
  });

  return {
    pathElements,
    rootPathElementIds: pathElements
      .filter((element) => element.parentId === null)
      .map((element) => element.id)
  };
}

function pathElementProvenanceWithEdits(
  provenance: PathElementProvenance,
  segmentRefs: OrientedSegmentRef[],
  segmentsById: Map<string, PathSegment>
): PathElementProvenance {
  const eventsByKey = new Map<string, PathElementEditEvent>();
  const derivedSegmentIds: string[] = [];
  const parentSegmentIds: string[] = [];

  for (const ref of segmentRefs) {
    const segment = segmentsById.get(ref.segmentId);
    const edit = segment?.source.edit;
    if (!segment || !edit) continue;

    derivedSegmentIds.push(segment.id);
    if (!parentSegmentIds.includes(edit.parentSegmentId)) parentSegmentIds.push(edit.parentSegmentId);

    const key = [
      edit.kind,
      edit.operationId,
      edit.parentSegmentId,
      edit.point.x,
      edit.point.y
    ].join('|');
    const event = eventsByKey.get(key);
    if (event) {
      event.derivedSegmentIds.push(segment.id);
    } else {
      eventsByKey.set(key, {
        derivedSegmentIds: [segment.id],
        kind: edit.kind,
        operationId: edit.operationId,
        parentSegmentId: edit.parentSegmentId,
        point: { ...edit.point }
      });
    }
  }

  if (derivedSegmentIds.length === 0) return provenance;

  const events = [...eventsByKey.values()]
    .map((event) => ({
      ...event,
      derivedSegmentIds: [...event.derivedSegmentIds].sort(compareText)
    }))
    .sort((first, second) => first.parentSegmentId.localeCompare(second.parentSegmentId));

  return {
    ...provenance,
    edit: {
      derivedSegmentIds: [...derivedSegmentIds].sort(compareText),
      events,
      parentSegmentIds: [...parentSegmentIds].sort(compareText)
    }
  };
}

function compareText(first: string, second: string) {
  return first.localeCompare(second);
}

function pathElementPoints(
  contour: PathContour,
  operation: OperationPlan['operations'][number] | null
): PathElement['points'] {
  const points: PathElement['points'] = [];

  if (operation) {
    points.push({
      role: 'start',
      point: operation.startPoint,
      source: 'operation'
    });
    points.push({
      role: 'end',
      point: operation.endPoint,
      source: 'operation'
    });
  }

  if (contour.representativePoint) {
    points.push({
      role: 'representative',
      point: contour.representativePoint,
      source: 'contour'
    });
  }

  return points;
}

function uniqueText(value: string, index: number, values: string[]) {
  return values.indexOf(value) === index;
}
