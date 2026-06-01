import {
  distance,
  pathCutLength,
  pathEndPoint,
  pathStartPoint,
  reversePathRefs,
  rotatePathRefs,
  segmentMap
} from './segments';
import { buildContourDisplayNames } from './pathNaming';
import type {
  ContourClassification,
  OperationPlan,
  OrientedSegmentRef,
  PathChain,
  PathContour,
  PathDiagnostic,
  PathOperation,
  PathPlanningOptions,
  PathSegment,
  Point2
} from './types';
import { resolvePathPlanningOptions } from './segments';

export interface PlanOperationsInput {
  chains: PathChain[];
  contours: PathContour[];
  segments: PathSegment[];
  options?: PathPlanningOptions;
}

interface PlanItem {
  id: string;
  chain: PathChain;
  contour: PathContour;
  prerequisites: Set<string>;
}

interface Arrangement {
  refs: OrientedSegmentRef[];
  startPoint: Point2;
  endPoint: Point2;
  direction: PathOperation['direction'];
}

export function planOperations(input: PlanOperationsInput): OperationPlan {
  const resolved = resolvePathPlanningOptions(input.options);
  const segmentsById = segmentMap(input.segments);
  const diagnostics: PathDiagnostic[] = [];
  const items = buildPlanItems(input.chains, input.contours);
  const displayNamesByContourId = buildContourDisplayNames(input.contours);
  const remaining = new Map(items.map((item) => [item.id, item]));
  const operations: PathOperation[] = [];
  let currentPosition = resolved.startPoint;

  while (remaining.size > 0) {
    let eligible = [...remaining.values()].filter((item) =>
      [...item.prerequisites].every((prerequisiteId) => !remaining.has(prerequisiteId))
    );

    if (eligible.length === 0) {
      diagnostics.push({
        id: `diag_plan_${String(diagnostics.length + 1).padStart(4, '0')}`,
        severity: 'warning',
        code: 'route-dependency-cycle',
        message:
          'Contour dependency ordering could not be resolved cleanly; falling back to nearest remaining contour.',
        relatedContourIds: [...remaining.values()].map((item) => item.contour.id)
      });
      eligible = [...remaining.values()];
    }

    const selected = chooseNextItem(eligible, currentPosition, segmentsById, resolved);
    const arrangement = arrangeItem(selected, currentPosition, segmentsById, resolved);
    const rapidInLength = distance(currentPosition, arrangement.startPoint);

    operations.push({
      id: `op_${String(operations.length + 1).padStart(4, '0')}`,
      label: selected.contour.label,
      displayName: displayNamesByContourId.get(selected.contour.id) ?? selected.contour.label,
      provenance: selected.contour.provenance,
      orderIndex: operations.length,
      contourId: selected.contour.id,
      chainId: selected.chain.id,
      classification: selected.contour.classification,
      closed: selected.chain.closed,
      segmentRefs: arrangement.refs,
      startPoint: arrangement.startPoint,
      endPoint: selected.chain.closed ? arrangement.startPoint : arrangement.endPoint,
      direction: arrangement.direction,
      metrics: {
        cutLength: pathCutLength(arrangement.refs, segmentsById),
        rapidInLength,
        segmentCount: arrangement.refs.length
      }
    });

    currentPosition = selected.chain.closed ? arrangement.startPoint : arrangement.endPoint;
    remaining.delete(selected.id);
  }

  return {
    operations,
    metrics: {
      operationCount: operations.length,
      totalCutLength: operations.reduce((total, operation) => total + operation.metrics.cutLength, 0),
      totalRapidLength: operations.reduce((total, operation) => total + operation.metrics.rapidInLength, 0)
    },
    diagnostics
  };
}

function buildPlanItems(chains: PathChain[], contours: PathContour[]) {
  const chainsById = new Map(chains.map((chain) => [chain.id, chain]));
  const items = contours
    .map((contour): PlanItem | null => {
      const chain = chainsById.get(contour.chainId);
      if (!chain) return null;

      return {
        id: contour.id,
        chain,
        contour,
        prerequisites: new Set(contour.childIds)
      };
    })
    .filter((item): item is PlanItem => item !== null);

  const itemIds = new Set(items.map((item) => item.id));
  for (const item of items) {
    item.prerequisites = new Set([...item.prerequisites].filter((id) => itemIds.has(id)));
  }

  return items;
}

function chooseNextItem(
  items: PlanItem[],
  currentPosition: Point2,
  segmentsById: Map<string, PathSegment>,
  options: ReturnType<typeof resolvePathPlanningOptions>
) {
  return items
    .map((item) => ({
      item,
      arrangement: arrangeItem(item, currentPosition, segmentsById, options)
    }))
    .sort((a, b) => {
      const rapidDelta =
        distance(currentPosition, a.arrangement.startPoint) -
        distance(currentPosition, b.arrangement.startPoint);
      if (Math.abs(rapidDelta) > options.coincidenceEpsilon) return rapidDelta;

      const priorityDelta = classificationPriority(a.item.contour.classification) -
        classificationPriority(b.item.contour.classification);
      if (priorityDelta !== 0) return priorityDelta;

      const depthDelta = b.item.contour.containmentDepth - a.item.contour.containmentDepth;
      if (depthDelta !== 0) return depthDelta;

      const pointCompare = comparePoint(a.arrangement.startPoint, b.arrangement.startPoint, options.coincidenceEpsilon);
      if (pointCompare !== 0) return pointCompare;

      return a.item.id.localeCompare(b.item.id);
    })[0].item;
}

function arrangeItem(
  item: PlanItem,
  currentPosition: Point2,
  segmentsById: Map<string, PathSegment>,
  options: ReturnType<typeof resolvePathPlanningOptions>
): Arrangement {
  if (item.chain.closed) {
    return arrangeClosedChain(item.chain.segmentRefs, currentPosition, segmentsById, options);
  }

  return arrangeOpenChain(item.chain.segmentRefs, currentPosition, segmentsById, options);
}

function arrangeOpenChain(
  refs: OrientedSegmentRef[],
  currentPosition: Point2,
  segmentsById: Map<string, PathSegment>,
  options: ReturnType<typeof resolvePathPlanningOptions>
): Arrangement {
  const candidates = [buildArrangement(refs, 'forward', false, segmentsById)];

  if (options.allowReverseOpenChains && refs.length > 0) {
    candidates.push(buildArrangement(reversePathRefs(refs), 'reverse', true, segmentsById));
  }

  return bestArrangement(candidates, currentPosition, options.coincidenceEpsilon);
}

function arrangeClosedChain(
  refs: OrientedSegmentRef[],
  currentPosition: Point2,
  segmentsById: Map<string, PathSegment>,
  options: ReturnType<typeof resolvePathPlanningOptions>
): Arrangement {
  const candidates: Arrangement[] = [];

  for (let index = 0; index < Math.max(refs.length, 1); index++) {
    candidates.push(buildArrangement(rotatePathRefs(refs, index), 'forward', false, segmentsById));
  }

  if (options.allowReverseClosedContours && refs.length > 0) {
    const reversed = reversePathRefs(refs);
    for (let index = 0; index < reversed.length; index++) {
      candidates.push(buildArrangement(rotatePathRefs(reversed, index), 'reverse', true, segmentsById));
    }
  }

  return bestArrangement(candidates, currentPosition, options.coincidenceEpsilon);
}

function buildArrangement(
  refs: OrientedSegmentRef[],
  direction: PathOperation['direction'],
  reversePenalty: boolean,
  segmentsById: Map<string, PathSegment>
): Arrangement {
  const startPoint = pathStartPoint(refs, segmentsById) ?? { x: 0, y: 0 };
  const endPoint = pathEndPoint(refs, segmentsById) ?? startPoint;

  return {
    refs,
    startPoint,
    endPoint,
    direction: reversePenalty ? 'reverse' : direction
  };
}

function bestArrangement(arrangements: Arrangement[], currentPosition: Point2, epsilon: number) {
  return arrangements
    .filter((arrangement) => arrangement.refs.length > 0)
    .sort((a, b) => {
      const rapidDelta = distance(currentPosition, a.startPoint) - distance(currentPosition, b.startPoint);
      if (Math.abs(rapidDelta) > epsilon) return rapidDelta;

      if (a.direction !== b.direction) return a.direction === 'forward' ? -1 : 1;

      const pointCompare = comparePoint(a.startPoint, b.startPoint, epsilon);
      if (pointCompare !== 0) return pointCompare;

      return (a.refs[0]?.segmentId ?? '').localeCompare(b.refs[0]?.segmentId ?? '');
    })[0] ?? {
    refs: [],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 0, y: 0 },
    direction: 'forward'
  };
}

function classificationPriority(classification: ContourClassification) {
  if (classification === 'hole') return 0;
  if (classification === 'island') return 1;
  if (classification === 'open-chain') return 2;
  if (classification === 'exterior') return 3;
  return 4;
}

function comparePoint(a: Point2, b: Point2, epsilon: number) {
  if (Math.abs(a.x - b.x) > epsilon) return a.x - b.x;
  if (Math.abs(a.y - b.y) > epsilon) return a.y - b.y;
  return 0;
}
