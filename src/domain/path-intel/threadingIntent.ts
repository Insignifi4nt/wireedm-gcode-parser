import type { OperationThreadingTransition } from './types';

/** Canonical controller-neutral threading and wire-state constructions. */
export function threadingIntentIsCompatible(
  transition: Pick<OperationThreadingTransition, 'mode' | 'wireSeparation'>
): boolean {
  return transition.mode === 'continuous'
    ? transition.wireSeparation === 'already-separated'
    : transition.mode === 'manual'
      ? transition.wireSeparation === 'already-separated' ||
        transition.wireSeparation === 'manual-before-positioning' ||
        transition.wireSeparation === 'automatic-during-positioning'
      : transition.mode === 'automatic' && transition.wireSeparation === 'automatic-before-positioning';
}
