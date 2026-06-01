import type {
  ContourClassification,
  OperationPlan,
  PathChain,
  PathContour,
  PathElement,
  PathElementTree
} from './types';

export function buildPathElements(
  contours: PathContour[],
  chains: PathChain[],
  plan: OperationPlan
): PathElementTree {
  const chainsById = new Map(chains.map((chain) => [chain.id, chain]));
  const operationsByContourId = new Map(plan.operations.map((operation) => [operation.contourId, operation]));
  const displayNamesByContourId = pathElementDisplayNames(contours);

  const pathElements: PathElement[] = contours.map((contour) => {
    const chain = chainsById.get(contour.chainId);
    const operation = operationsByContourId.get(contour.id) ?? null;

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
      segmentRefs: [...(operation?.segmentRefs ?? chain?.segmentRefs ?? [])],
      points: pathElementPoints(contour, operation),
      provenance: operation?.provenance ?? contour.provenance,
      diagnosticIds: [...contour.diagnosticIds, ...(chain?.diagnosticIds ?? [])].filter(uniqueText),
      orderIndex: operation?.orderIndex ?? null,
      direction: operation?.direction ?? null,
      metrics: operation?.metrics ?? null,
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

function pathElementDisplayNames(contours: PathContour[]) {
  const counts = new Map<ContourClassification, number>();
  const names = new Map<string, string>();

  for (const contour of contours) {
    const count = (counts.get(contour.classification) ?? 0) + 1;
    counts.set(contour.classification, count);
    names.set(contour.id, `${displayBaseForClassification(contour.classification)} ${count}`);
  }

  return names;
}

function displayBaseForClassification(classification: ContourClassification) {
  if (classification === 'exterior') return 'Exterior';
  if (classification === 'hole') return 'Hole';
  if (classification === 'island') return 'Island';
  if (classification === 'open-chain') return 'Open Chain';
  return 'Ambiguous';
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
