import type { MachineProfile } from '@/domain/workbench/types';

import type { PathOperation } from './types';

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
