import type { MachineProfile } from '@/domain/workbench/types';

import {
  deriveActiveMachiningOperations,
  deriveSourceMachiningOperations
} from './machiningParticipation';
import type { PathOperation, PathPlanningDocument } from './types';

export type OperationTransitionOwnership =
  | 'authored'
  | 'generated-explicit-linear';

export function resolveOperationTransitionOwnership(
  operation: PathOperation,
  machine: MachineProfile
): OperationTransitionOwnership {
  return operation.compensationIntent?.mode === 'controller' &&
    machine.compensation.activation === 'linear-lead'
    ? 'generated-explicit-linear'
    : 'authored';
}

export function resolveSourceOperationTransitionOwnership(
  document: PathPlanningDocument,
  sourceOperationId: string,
  machine: MachineProfile
): OperationTransitionOwnership {
  const sourceOperation = document.plan.operations.find(
    (operation) => operation.id === sourceOperationId
  );
  if (!sourceOperation) return 'authored';

  const machining = deriveActiveMachiningOperations(document);
  const effectiveMachining = machining.status === 'ready'
    ? machining
    : deriveSourceMachiningOperations(document, sourceOperationId);
  if (!effectiveMachining || effectiveMachining.status === 'blocked') {
    return resolveOperationTransitionOwnership(sourceOperation, machine);
  }

  const effectiveOperations = effectiveMachining.operations.filter(
    (operation) =>
      (operation.machiningIntent?.sourceOperationId ?? operation.id) ===
      sourceOperationId
  );
  return effectiveOperations.length > 0 &&
    effectiveOperations.every(
      (operation) =>
        resolveOperationTransitionOwnership(operation, machine) ===
        'generated-explicit-linear'
    )
    ? 'generated-explicit-linear'
    : 'authored';
}
