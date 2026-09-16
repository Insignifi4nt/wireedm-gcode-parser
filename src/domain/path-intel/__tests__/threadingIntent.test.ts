import { describe, expect, it } from 'vitest';
import type { OperationThreadingTransition } from '../types';
import { threadingIntentIsCompatible } from '../threadingIntent';

describe('threading intent combinations', () => {
  it('accepts only the five defined wire-state transitions', () => {
    const allowed = new Set([
      'continuous:already-separated',
      'manual:already-separated',
      'manual:manual-before-positioning',
      'manual:automatic-during-positioning',
      'automatic:automatic-before-positioning'
    ]);
    for (const mode of ['continuous', 'manual', 'automatic'] as const) {
      for (const wireSeparation of [
        'already-separated', 'manual-before-positioning',
        'automatic-before-positioning', 'automatic-during-positioning'
      ] as const) {
        expect(threadingIntentIsCompatible({ mode, wireSeparation } satisfies
          Pick<OperationThreadingTransition, 'mode' | 'wireSeparation'>))
          .toBe(allowed.has(`${mode}:${wireSeparation}`));
      }
    }
  });
});
