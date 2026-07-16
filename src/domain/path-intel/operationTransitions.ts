import { distance } from './segments';
import type { PathOperation, PathOperationTransitions, Point2 } from './types';

export function normalizeLegacyOperationTransitions(
  operation: PathOperation
): PathOperationTransitions {
  if (operation.transitions) return structuredClone(operation.transitions);
  const leadIn = operation.overrides?.leadIn;
  if (!leadIn) return {};
  return {
    entry:
      leadIn.source === 'circle-center'
        ? {
            strategy: 'circle-center',
            move: 'cut',
            from: { ...leadIn.from },
            to: { ...leadIn.to },
            sourceSegmentId: leadIn.sourceSegmentId
          }
        : {
            strategy: 'manual-straight',
            move: 'cut',
            from: { ...leadIn.from },
            to: { ...leadIn.to },
            review: 'reviewed'
          }
  };
}

export function operationEntryPoint(operation: PathOperation): Point2 {
  return normalizeLegacyOperationTransitions(operation).entry?.from ?? operation.startPoint;
}

export function operationExitPoint(operation: PathOperation): Point2 {
  return normalizeLegacyOperationTransitions(operation).exit?.to ?? operation.endPoint;
}

export function operationTransitionCutLength(operation: PathOperation) {
  const transitions = normalizeLegacyOperationTransitions(operation);
  return transitionLength(transitions.entry) + transitionLength(transitions.exit);
}

function transitionLength(
  transition: { from: Point2; to: Point2 } | undefined
) {
  return transition ? distance(transition.from, transition.to) : 0;
}
