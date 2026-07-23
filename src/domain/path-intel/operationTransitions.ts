import { distance } from './segments';
import type { PathOperation, PathOperationTransitions, Point2 } from './types';

export function readOperationTransitions(
  operation: PathOperation
): PathOperationTransitions {
  return operation.transitions ? structuredClone(operation.transitions) : {};
}

export function operationEntryPoint(operation: PathOperation): Point2 {
  const entry = readOperationTransitions(operation).entry;
  return entry && entry.strategy !== 'none' ? entry.from : operation.startPoint;
}

export function operationExitPoint(operation: PathOperation): Point2 {
  const exit = readOperationTransitions(operation).exit;
  return exit && exit.strategy !== 'none' ? exit.to : operation.endPoint;
}

export function operationTransitionCutLength(operation: PathOperation) {
  const transitions = readOperationTransitions(operation);
  return transitionLength(transitions.entry) + transitionLength(transitions.exit);
}

function transitionLength(
  transition:
    | { strategy: 'none' }
    | { from: Point2; to: Point2 }
    | undefined
) {
  return transition && 'from' in transition
    ? distance(transition.from, transition.to)
    : 0;
}
