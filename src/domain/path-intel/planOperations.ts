import {
  boundsAreFinite,
  distance,
  pathCutLength,
  pathEndPoint,
  pathStartPoint,
  reversePathRefs,
  rotatePathRefs,
  segmentMap
} from './segments';
import { buildContourDisplayNames } from './pathNaming';
import { SpatialHash } from './spatialIndex';
import type {
  Bounds2,
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
  /** Position in contour order; also the scan order when ranking items. */
  index: number;
  chain: PathChain;
  contour: PathContour;
  contourOrder: number;
  prerequisites: Set<string>;
  sourceOrder: number;
  /** Every start the item may be cut from, in tie order; empty for an empty chain. */
  starts: StartCandidate[];
  /** Box around every candidate start point, used to skip items that cannot be nearest. */
  startBounds: Bounds2;
}

interface StartCandidate {
  refs: OrientedSegmentRef[];
  startIndex: number;
  startPoint: Point2;
  direction: PathOperation['direction'];
}

interface RankedItem {
  item: PlanItem;
  start: StartCandidate | null;
  startPoint: Point2;
  rapidLength: number;
}

interface Arrangement {
  refs: OrientedSegmentRef[];
  startPoint: Point2;
  endPoint: Point2;
  direction: PathOperation['direction'];
}

interface Selection {
  item: PlanItem;
  arrangement: Arrangement;
}

type ResolvedPlanningOptions = ReturnType<typeof resolvePathPlanningOptions>;

const EMPTY_START_POINT: Point2 = { x: 0, y: 0 };

export function planOperations(input: PlanOperationsInput): OperationPlan {
  const resolved = resolvePathPlanningOptions(input.options);
  const segmentsById = segmentMap(input.segments);
  const diagnostics: PathDiagnostic[] = [];
  const items = buildPlanItems(input.chains, input.contours, segmentsById, resolved);
  const displayNamesByContourId = buildContourDisplayNames(input.contours);
  const queue = createPlanQueue(items, segmentsById, resolved);
  const operations: PathOperation[] = [];
  let currentPosition = resolved.startPoint;

  while (queue.remainingCount() > 0) {
    let selection = queue.chooseEligible(currentPosition);

    if (!selection) {
      const remaining = queue.remaining();
      diagnostics.push({
        id: `diag_plan_${String(diagnostics.length + 1).padStart(4, '0')}`,
        severity: 'warning',
        code: 'route-dependency-cycle',
        message:
          'Contour dependency ordering could not be resolved cleanly; falling back to nearest remaining contour.',
        relatedContourIds: remaining.map((item) => item.contour.id)
      });
      selection = chooseFrom(remaining, currentPosition, segmentsById, resolved);
    }

    const { item: selected, arrangement } = selection;
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
    queue.complete(selected);
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

function buildPlanItems(
  chains: PathChain[],
  contours: PathContour[],
  segmentsById: Map<string, PathSegment>,
  options: ResolvedPlanningOptions
) {
  const chainsById = new Map(chains.map((chain) => [chain.id, chain]));
  // A repeated contour id keeps its first position but plans the last contour with that id.
  const itemsById = new Map<string, PlanItem>();
  contours.forEach((contour, contourOrder) => {
    const chain = chainsById.get(contour.chainId);
    if (!chain) return;

    const starts = startCandidates(chain, segmentsById, options);
    itemsById.set(contour.id, {
      id: contour.id,
      index: 0,
      chain,
      contourOrder,
      contour,
      prerequisites: new Set(contour.childIds),
      sourceOrder: sourceOrderForContour(contour),
      starts,
      startBounds: boundsOfStarts(starts)
    });
  });

  const items = [...itemsById.values()];
  items.forEach((item, index) => { item.index = index; });
  const itemIds = new Set(itemsById.keys());
  for (const item of items) {
    item.prerequisites = new Set([...item.prerequisites].filter((id) => itemIds.has(id)));
  }

  return items;
}

/**
 * Lists the starts an item may be cut from: any segment of a closed contour, either end of an
 * open chain, each in the allowed directions. Forward starts come first, which is the tie order.
 */
function startCandidates(
  chain: PathChain,
  segmentsById: Map<string, PathSegment>,
  options: ResolvedPlanningOptions
): StartCandidate[] {
  const refs = chain.segmentRefs;
  if (refs.length === 0) return [];

  const candidates: StartCandidate[] = [];
  const startCount = chain.closed ? refs.length : 1;
  const addStarts = (oriented: OrientedSegmentRef[], direction: PathOperation['direction']) => {
    for (let startIndex = 0; startIndex < startCount; startIndex++) {
      candidates.push({
        refs: oriented,
        startIndex,
        startPoint: pathStartPoint([oriented[startIndex]], segmentsById)!,
        direction
      });
    }
  };

  addStarts(refs, 'forward');
  if (chain.closed ? options.allowReverseClosedContours : options.allowReverseOpenChains) {
    addStarts(reversePathRefs(refs), 'reverse');
  }
  return candidates;
}

function boundsOfStarts(starts: StartCandidate[]): Bounds2 {
  const bounds = starts.length === 0
    ? { minX: EMPTY_START_POINT.x, minY: EMPTY_START_POINT.y, maxX: EMPTY_START_POINT.x, maxY: EMPTY_START_POINT.y }
    : { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const { startPoint } of starts) {
    bounds.minX = Math.min(bounds.minX, startPoint.x);
    bounds.minY = Math.min(bounds.minY, startPoint.y);
    bounds.maxX = Math.max(bounds.maxX, startPoint.x);
    bounds.maxY = Math.max(bounds.maxY, startPoint.y);
  }
  return bounds;
}

/**
 * Tracks which items are cut, blocked by uncut prerequisites, or eligible, and picks the next
 * eligible item without rescanning every item: source order keeps eligible items in a heap, and
 * the nearest strategies look up starts in a spatial index around the current position.
 */
function createPlanQueue(items: PlanItem[], segmentsById: Map<string, PathSegment>, options: ResolvedPlanningOptions) {
  const indexById = new Map(items.map((item) => [item.id, item.index]));
  const pending = items.map((item) => item.prerequisites.size);
  const dependents = items.map((): PlanItem[] => []);
  for (const item of items) {
    for (const prerequisiteId of item.prerequisites) dependents[indexById.get(prerequisiteId)!].push(item);
  }

  const done = new Uint8Array(items.length);
  const eligible = new Uint8Array(items.length);
  let remainingCount = items.length;
  let eligibleCount = 0;
  const sourceQueue = options.operationOrderStrategy === 'source-order'
    ? new MinHeap<PlanItem>(comparePlanSourceOrder)
    : null;
  const starts = sourceQueue ? null : createStartIndex(items);

  const markEligible = (item: PlanItem) => {
    eligible[item.index] = 1;
    eligibleCount += 1;
    sourceQueue?.push(item);
  };
  for (const item of items) {
    if (pending[item.index] === 0) markEligible(item);
  }

  return {
    remainingCount: () => remainingCount,

    remaining: () => items.filter((item) => !done[item.index]),

    chooseEligible(position: Point2): Selection | null {
      if (eligibleCount === 0) return null;
      if (sourceQueue) {
        const item = sourceQueue.peek()!;
        return { item, arrangement: arrangeItem(rankItem(item, position, options.coincidenceEpsilon), segmentsById) };
      }
      const candidates = starts?.nearestCandidates(position, (item) => eligible[item.index] === 1, options.coincidenceEpsilon) ??
        items.filter((item) => eligible[item.index] === 1);
      return chooseFrom(candidates, position, segmentsById, options);
    },

    complete(item: PlanItem) {
      done[item.index] = 1;
      remainingCount -= 1;
      if (eligible[item.index]) {
        eligible[item.index] = 0;
        eligibleCount -= 1;
        // Source order always cuts the heap's first item while any item is eligible.
        sourceQueue?.pop();
      }
      for (const dependent of dependents[item.index]) {
        pending[dependent.index] -= 1;
        if (pending[dependent.index] === 0 && !done[dependent.index] && !eligible[dependent.index]) {
          markEligible(dependent);
        }
      }
    }
  };
}

/**
 * Spatial index of item start boxes. `nearestCandidates` returns, in item order, the accepted
 * items whose start box lies within the cutoff of the nearest accepted start, which always
 * includes the item the ranking prefers. Returns null when the geometry cannot be indexed.
 */
function createStartIndex(items: PlanItem[]) {
  if (items.length === 0 || !items.every((item) => boundsAreFinite(item.startBounds))) return null;

  const extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const spans: number[] = [];
  for (const { startBounds } of items) {
    extent.minX = Math.min(extent.minX, startBounds.minX);
    extent.minY = Math.min(extent.minY, startBounds.minY);
    extent.maxX = Math.max(extent.maxX, startBounds.maxX);
    extent.maxY = Math.max(extent.maxY, startBounds.maxY);
    const span = Math.max(startBounds.maxX - startBounds.minX, startBounds.maxY - startBounds.minY);
    if (Number.isFinite(span) && span > 0) spans.push(span);
  }
  spans.sort((left, right) => left - right);
  const spacing = Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY) / Math.sqrt(items.length);
  const cellSize = [Math.max(spans[Math.floor(spans.length / 2)] ?? 0, spacing), 1]
    .find((size) => Number.isFinite(size) && size > 0)!;

  const index = new SpatialHash<PlanItem>({ cellSize, maxCellsPerBounds: 64 });
  for (const item of items) index.insertBounds(item.startBounds, item);

  const accepted = (position: Point2, radius: number, accept: (item: PlanItem) => boolean) =>
    index.queryBounds(squareAround(position, radius)).filter(accept);

  return {
    nearestCandidates(position: Point2, accept: (item: PlanItem) => boolean, epsilon: number): PlanItem[] | null {
      if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;

      // Grow a search square until it holds an accepted item; once it covers every start, stop.
      let radius = cellSize;
      let found = accepted(position, radius, accept);
      while (found.length === 0 && !squareCovers(position, radius, extent)) {
        radius *= 2;
        found = accepted(position, radius, accept);
      }

      let nearest = Infinity;
      for (const item of found) nearest = Math.min(nearest, rankItem(item, position, epsilon).rapidLength);
      if (!Number.isFinite(nearest)) return null;

      const cutoff = rapidCutoff(nearest, epsilon);
      // Pad for rounding between the square and the exact box distance; extra items only cost a check.
      const padding = cutoff * 1e-9 + (1 + Math.abs(position.x) + Math.abs(position.y)) * 1e-12;
      // Queries list entries in insertion order, which is item order.
      return accepted(position, cutoff + padding, accept)
        .filter((item) => distanceToBounds(position, item.startBounds) <= cutoff);
    }
  };
}

function squareAround(point: Point2, radius: number): Bounds2 {
  return {
    minX: Math.max(point.x - radius, -Number.MAX_VALUE),
    minY: Math.max(point.y - radius, -Number.MAX_VALUE),
    maxX: Math.min(point.x + radius, Number.MAX_VALUE),
    maxY: Math.min(point.y + radius, Number.MAX_VALUE)
  };
}

function squareCovers(point: Point2, radius: number, bounds: Bounds2) {
  const square = squareAround(point, radius);
  return square.minX <= bounds.minX && square.minY <= bounds.minY &&
    square.maxX >= bounds.maxX && square.maxY >= bounds.maxY;
}

/**
 * Picks the next item from `items`, given in item order. Source order ranks items without
 * geometry. The nearest strategies rank each item by its best start, but skip an item when even
 * the nearest point of its start box is more than the coincidence epsilon beyond the best rapid
 * so far: the ranking could never prefer it.
 */
function chooseFrom(
  items: PlanItem[],
  currentPosition: Point2,
  segmentsById: Map<string, PathSegment>,
  options: ResolvedPlanningOptions
): Selection {
  if (options.operationOrderStrategy === 'source-order') {
    let selected = items[0];
    for (let index = 1; index < items.length; index++) {
      if (comparePlanSourceOrder(items[index], selected) < 0) selected = items[index];
    }
    const ranked = rankItem(selected, currentPosition, options.coincidenceEpsilon);
    return { item: selected, arrangement: arrangeItem(ranked, segmentsById) };
  }

  // Rank the item with the nearest start box first so its rapid can rule out distant items.
  const lowerBounds = new Float64Array(items.length);
  let seedIndex = 0;
  for (let index = 0; index < items.length; index++) {
    lowerBounds[index] = distanceToBounds(currentPosition, items[index].startBounds);
    if (lowerBounds[index] < lowerBounds[seedIndex]) seedIndex = index;
  }

  const seed = rankItem(items[seedIndex], currentPosition, options.coincidenceEpsilon);
  let cutoff = rapidCutoff(seed.rapidLength, options.coincidenceEpsilon);
  let best: RankedItem | null = null;
  for (let index = 0; index < items.length; index++) {
    if (lowerBounds[index] > cutoff) continue;

    const ranked = index === seedIndex ? seed : rankItem(items[index], currentPosition, options.coincidenceEpsilon);
    if (best === null || compareRankedItems(ranked, best, options) < 0) {
      best = ranked;
      cutoff = Math.min(cutoff, rapidCutoff(best.rapidLength, options.coincidenceEpsilon));
    }
  }

  const selected = best ?? seed;
  return { item: selected.item, arrangement: arrangeItem(selected, segmentsById) };
}

/** Longest rapid that can still rank level with or ahead of `rapidLength`. */
function rapidCutoff(rapidLength: number, epsilon: number) {
  // The relative margin absorbs rounding between the box distance and the exact start distance.
  return (rapidLength + epsilon) * (1 + 1e-9) + 1e-12;
}

function distanceToBounds(point: Point2, bounds: Bounds2) {
  const dx = Math.max(bounds.minX - point.x, 0, point.x - bounds.maxX);
  const dy = Math.max(bounds.minY - point.y, 0, point.y - bounds.maxY);
  return Math.hypot(dx, dy);
}

function compareRankedItems(a: RankedItem, b: RankedItem, options: ResolvedPlanningOptions) {
  const rapidDelta = a.rapidLength - b.rapidLength;
  if (Math.abs(rapidDelta) > options.coincidenceEpsilon) return rapidDelta;

  if (options.operationOrderStrategy === 'inside-out-nearest') {
    const priorityDelta =
      classificationPriority(a.item.contour.classification) -
      classificationPriority(b.item.contour.classification);
    if (priorityDelta !== 0) return priorityDelta;

    const depthDelta = b.item.contour.containmentDepth - a.item.contour.containmentDepth;
    if (depthDelta !== 0) return depthDelta;
  }

  const pointCompare = comparePoint(a.startPoint, b.startPoint, options.coincidenceEpsilon);
  if (pointCompare !== 0) return pointCompare;

  return a.item.id.localeCompare(b.item.id);
}

/** Finds the item's best start from the current position: shortest rapid, then forward, then lowest point. */
function rankItem(item: PlanItem, currentPosition: Point2, epsilon: number): RankedItem {
  let best: StartCandidate | null = null;
  let bestRapid = 0;

  for (const start of item.starts) {
    const rapid = distance(currentPosition, start.startPoint);
    if (best === null || compareStarts(start, rapid, best, bestRapid, epsilon) < 0) {
      best = start;
      bestRapid = rapid;
    }
  }

  if (best === null) {
    return { item, start: null, startPoint: EMPTY_START_POINT, rapidLength: distance(currentPosition, EMPTY_START_POINT) };
  }
  return { item, start: best, startPoint: best.startPoint, rapidLength: bestRapid };
}

function compareStarts(a: StartCandidate, aRapid: number, b: StartCandidate, bRapid: number, epsilon: number) {
  const rapidDelta = aRapid - bRapid;
  if (Math.abs(rapidDelta) > epsilon) return rapidDelta;
  if (a.direction !== b.direction) return a.direction === 'forward' ? -1 : 1;
  return comparePoint(a.startPoint, b.startPoint, epsilon) ||
    a.refs[a.startIndex].segmentId.localeCompare(b.refs[b.startIndex].segmentId);
}

function arrangeItem({ item, start }: RankedItem, segmentsById: Map<string, PathSegment>): Arrangement {
  if (start === null) {
    return { refs: [], startPoint: { ...EMPTY_START_POINT }, endPoint: { ...EMPTY_START_POINT }, direction: 'forward' };
  }

  const refs = item.chain.closed ? rotatePathRefs(start.refs, start.startIndex) : start.refs;
  const startPoint = pathStartPoint(refs, segmentsById) ?? { ...EMPTY_START_POINT };
  return {
    refs,
    startPoint,
    endPoint: pathEndPoint(refs, segmentsById) ?? startPoint,
    direction: start.direction
  };
}

/** Binary min-heap for a strict total order. */
class MinHeap<T> {
  private readonly values: T[] = [];

  constructor(private readonly compare: (left: T, right: T) => number) {}

  peek(): T | undefined {
    return this.values[0];
  }

  push(value: T) {
    const values = this.values;
    values.push(value);
    let index = values.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(values[index], values[parent]) >= 0) break;
      [values[index], values[parent]] = [values[parent], values[index]];
      index = parent;
    }
  }

  pop() {
    const values = this.values;
    const last = values.pop();
    if (values.length === 0 || last === undefined) return;
    values[0] = last;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < values.length && this.compare(values[left], values[smallest]) < 0) smallest = left;
      if (right < values.length && this.compare(values[right], values[smallest]) < 0) smallest = right;
      if (smallest === index) return;
      [values[index], values[smallest]] = [values[smallest], values[index]];
      index = smallest;
    }
  }
}

function classificationPriority(classification: ContourClassification) {
  if (classification === 'hole') return 0;
  if (classification === 'island') return 1;
  if (classification === 'open-chain') return 2;
  if (classification === 'exterior') return 3;
  return 4;
}

function sourceOrderForContour(contour: PathContour) {
  let minimum = Number.POSITIVE_INFINITY;
  for (const index of contour.provenance.sourceEntityIndices) minimum = Math.min(minimum, index);
  return minimum;
}

function comparePlanSourceOrder(a: PlanItem, b: PlanItem) {
  if (a.sourceOrder !== b.sourceOrder) {
    if (!Number.isFinite(a.sourceOrder)) return 1;
    if (!Number.isFinite(b.sourceOrder)) return -1;
    return a.sourceOrder - b.sourceOrder;
  }

  const contourOrderDelta = a.contourOrder - b.contourOrder;
  if (contourOrderDelta !== 0) return contourOrderDelta;

  return a.id.localeCompare(b.id);
}

function comparePoint(a: Point2, b: Point2, epsilon: number) {
  if (Math.abs(a.x - b.x) > epsilon) return a.x - b.x;
  if (Math.abs(a.y - b.y) > epsilon) return a.y - b.y;
  return 0;
}
