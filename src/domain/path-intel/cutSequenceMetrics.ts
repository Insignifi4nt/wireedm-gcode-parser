import { resolveInitialWirePosition } from './initialWirePosition';
import { deriveActiveMachiningOperations } from './machiningParticipation';
import { operationEntryPoint, operationExitPoint, operationTransitionCutLength } from './operationTransitions';
import { distance, pathCutLength, segmentMap } from './segments';
import type { PathPlanningDocument } from './types';

export type CutSequenceMetrics =
  | { status: 'active'; cutLength: number; rapidInLength: number | null }
  | { status: 'inactive' }
  | { status: 'unavailable'; reason: string };

export function deriveCutSequenceMetrics(document: PathPlanningDocument): Map<string, CutSequenceMetrics> {
  const active = deriveActiveMachiningOperations(document);
  const result = new Map<string, CutSequenceMetrics>();
  if (active.status === 'blocked') {
    const reasons = {
      'invalid-span': 'Correct the invalid machining range.',
      'missing-source-segment': 'Repair the missing machining source segment.',
      'overlapping-spans': 'Resolve overlapping machining ranges.',
      'multiple-active-groups-require-explicit-semantics': 'Resolve separated active cutting ranges in Machining Participation.'
    };
    for (const operation of document.plan.operations) result.set(operation.id, { status: 'unavailable', reason: reasons[active.reason] });
    return result;
  }
  for (const operation of document.plan.operations) result.set(operation.id, { status: 'inactive' });
  const initial = resolveInitialWirePosition(document);
  let current = initial.status === 'ready' ? initial.point : null;
  const segments = segmentMap(active.segments);
  for (const operation of active.operations) {
    result.set(operation.machiningIntent?.sourceOperationId ?? operation.id, {
      status: 'active',
      cutLength: pathCutLength(operation.segmentRefs, segments) + operationTransitionCutLength(operation),
      rapidInLength: current ? distance(current, operationEntryPoint(operation)) : null
    });
    current = operationExitPoint(operation);
  }
  return result;
}
