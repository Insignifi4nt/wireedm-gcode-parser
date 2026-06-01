import type {
  ManualClassificationOverride,
  ManualDirectionOverride,
  ManualOrderOverride,
  ManualStartOverride,
  PathElement,
  PathOperation
} from '@/domain/path-intel/types';

export type UpidManualDecisionKind = 'order' | 'role' | 'direction' | 'start';

export type UpidManualDecisionCounts = Record<UpidManualDecisionKind, number>;

export interface UpidManualOrderDecision {
  orderIndex: ManualOrderOverride['orderIndex'];
}

export interface UpidManualClassificationDecision {
  classification: ManualClassificationOverride['classification'];
}

export interface UpidManualDirectionDecision {
  direction: ManualDirectionOverride['direction'];
}

export interface UpidManualStartDecision {
  createdSegmentIds: string[];
  point: ManualStartOverride['point'];
  pointRole: ManualStartOverride['pointRole'] | null;
  relation: ManualStartOverride['relation'];
  sourceSegmentId: string;
  sourceSegmentIndex: number;
}

export interface UpidManualDecisionDetails {
  classification: UpidManualClassificationDecision | null;
  direction: UpidManualDirectionDecision | null;
  order: UpidManualOrderDecision | null;
  start: UpidManualStartDecision | null;
}

export interface UpidManualDecisionSummary {
  count: number;
  counts: UpidManualDecisionCounts;
}

type UpidManualDecisionSource = Pick<PathElement | PathOperation, 'overrides'> | null | undefined;

export function upidManualDecisionKinds(source: UpidManualDecisionSource): UpidManualDecisionKind[] {
  const overrides = source?.overrides;
  if (!overrides) return [];

  const decisions: UpidManualDecisionKind[] = [];
  if (overrides.order) decisions.push('order');
  if (overrides.classification) decisions.push('role');
  if (overrides.direction) decisions.push('direction');
  if (overrides.start) decisions.push('start');
  return decisions;
}

export function summarizeUpidManualDecisions(
  sources: Iterable<UpidManualDecisionSource>
): UpidManualDecisionSummary {
  const counts = createEmptyUpidManualDecisionCounts();

  for (const source of sources) {
    for (const decision of upidManualDecisionKinds(source)) {
      counts[decision] += 1;
    }
  }

  return {
    count: Object.values(counts).reduce((total, count) => total + count, 0),
    counts
  };
}

export function readUpidManualDecisionDetails(
  source: UpidManualDecisionSource
): UpidManualDecisionDetails {
  const overrides = source?.overrides;

  return {
    classification: readUpidManualClassificationDecision(overrides?.classification),
    direction: readUpidManualDirectionDecision(overrides?.direction),
    order: readUpidManualOrderDecision(overrides?.order),
    start: readUpidManualStartDecision(overrides?.start)
  };
}

function createEmptyUpidManualDecisionCounts(): UpidManualDecisionCounts {
  return {
    direction: 0,
    order: 0,
    role: 0,
    start: 0
  };
}

function readUpidManualOrderDecision(
  order: ManualOrderOverride | undefined
): UpidManualOrderDecision | null {
  return order ? { orderIndex: order.orderIndex } : null;
}

function readUpidManualClassificationDecision(
  classification: ManualClassificationOverride | undefined
): UpidManualClassificationDecision | null {
  return classification ? { classification: classification.classification } : null;
}

function readUpidManualDirectionDecision(
  direction: ManualDirectionOverride | undefined
): UpidManualDirectionDecision | null {
  return direction ? { direction: direction.direction } : null;
}

function readUpidManualStartDecision(
  start: ManualStartOverride | undefined
): UpidManualStartDecision | null {
  if (!start) return null;

  return {
    createdSegmentIds: [...start.createdSegmentIds],
    point: { ...start.point },
    pointRole: start.pointRole ?? null,
    relation: start.relation,
    sourceSegmentId: start.sourceSegmentId,
    sourceSegmentIndex: start.sourceSegmentIndex
  };
}
