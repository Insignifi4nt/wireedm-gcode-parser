import type {
  ManualClassificationOverride,
  ManualDirectionOverride,
  ManualLeadInOverride,
  ManualOrderOverride,
  ManualStartOverride,
  ClosedContourCompensationIntent,
  PathElement,
  PathOperation
} from '@/domain/path-intel/types';

export type UpidManualDecisionKind =
  | 'compensation'
  | 'order'
  | 'role'
  | 'direction'
  | 'start'
  | 'lead-in';

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

export interface UpidManualLeadInDecision {
  from: ManualLeadInOverride['from'];
  move: ManualLeadInOverride['move'];
  source: ManualLeadInOverride['source'];
  sourceSegmentId: string;
  sourceSegmentIndex: number;
  to: ManualLeadInOverride['to'];
}

export type UpidManualCompensationDecision =
  | { mode: 'controller'; keptMaterial: 'inside' | 'outside'; source: 'manual' }
  | { mode: 'centerline'; source: 'manual' };

export interface UpidManualDecisionDetails {
  compensation: UpidManualCompensationDecision | null;
  classification: UpidManualClassificationDecision | null;
  direction: UpidManualDirectionDecision | null;
  leadIn: UpidManualLeadInDecision | null;
  order: UpidManualOrderDecision | null;
  start: UpidManualStartDecision | null;
}

export interface UpidManualDecisionSummary {
  count: number;
  counts: UpidManualDecisionCounts;
}

type UpidManualDecisionSource =
  | Pick<PathElement | PathOperation, 'compensationIntent' | 'overrides'>
  | null
  | undefined;

export function upidManualDecisionKinds(source: UpidManualDecisionSource): UpidManualDecisionKind[] {
  const overrides = source?.overrides;

  const decisions: UpidManualDecisionKind[] = [];
  if (source?.compensationIntent?.source === 'manual') decisions.push('compensation');
  if (overrides?.order) decisions.push('order');
  if (overrides?.classification) decisions.push('role');
  if (overrides?.direction) decisions.push('direction');
  if (overrides?.start) decisions.push('start');
  if (overrides?.leadIn) decisions.push('lead-in');
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
    compensation: readUpidManualCompensationDecision(source?.compensationIntent),
    classification: readUpidManualClassificationDecision(overrides?.classification),
    direction: readUpidManualDirectionDecision(overrides?.direction),
    leadIn: readUpidManualLeadInDecision(overrides?.leadIn),
    order: readUpidManualOrderDecision(overrides?.order),
    start: readUpidManualStartDecision(overrides?.start)
  };
}

function readUpidManualCompensationDecision(
  intent: ClosedContourCompensationIntent | undefined
): UpidManualCompensationDecision | null {
  if (intent?.source !== 'manual') return null;
  return intent.mode === 'controller'
    ? { mode: 'controller', keptMaterial: intent.keptMaterial, source: 'manual' }
    : { mode: 'centerline', source: 'manual' };
}

function createEmptyUpidManualDecisionCounts(): UpidManualDecisionCounts {
  return {
    compensation: 0,
    direction: 0,
    'lead-in': 0,
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

function readUpidManualLeadInDecision(
  leadIn: ManualLeadInOverride | undefined
): UpidManualLeadInDecision | null {
  if (!leadIn) return null;

  return {
    from: { ...leadIn.from },
    move: leadIn.move,
    source: leadIn.source,
    sourceSegmentId: leadIn.sourceSegmentId,
    sourceSegmentIndex: leadIn.sourceSegmentIndex,
    to: { ...leadIn.to }
  };
}
