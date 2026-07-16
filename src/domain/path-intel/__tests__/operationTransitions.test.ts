import { describe, expect, it } from 'vitest';

import {
  normalizeLegacyOperationTransitions,
  operationEntryPoint,
  operationExitPoint,
  operationTransitionCutLength
} from '../operationTransitions';
import type { PathOperation } from '../types';

describe('operation transitions', () => {
  it('normalizes a legacy circle-center lead without losing its strategy', () => {
    const operation = operationFixture();
    operation.overrides = {
      leadIn: {
        kind: 'manual',
        move: 'cut',
        from: { x: 0, y: 0 },
        to: { x: 5, y: 0 },
        source: 'circle-center',
        sourceSegmentId: 'segment-1',
        sourceSegmentIndex: 0
      }
    };

    expect(normalizeLegacyOperationTransitions(operation).entry).toEqual({
      strategy: 'circle-center',
      move: 'cut',
      from: { x: 0, y: 0 },
      to: { x: 5, y: 0 },
      sourceSegmentId: 'segment-1'
    });
  });

  it('routes from manual entry and to manual exit geometry', () => {
    const operation = operationFixture();
    operation.transitions = {
      entry: {
        strategy: 'manual-straight',
        move: 'cut',
        from: { x: -2, y: 0 },
        to: { x: 0, y: 0 },
        review: 'reviewed'
      },
      exit: {
        strategy: 'manual-straight',
        move: 'cut',
        from: { x: 10, y: 0 },
        to: { x: 12, y: 0 },
        review: 'reviewed'
      }
    };

    expect(operationEntryPoint(operation)).toEqual({ x: -2, y: 0 });
    expect(operationExitPoint(operation)).toEqual({ x: 12, y: 0 });
    expect(operationTransitionCutLength(operation)).toBe(4);
  });
});

function operationFixture(): PathOperation {
  return {
    id: 'operation-1',
    label: 'Operation 1',
    displayName: 'Operation 1',
    provenance: { sourceEntityIndices: [], sourceEntityTypes: [], layers: [], exact: true },
    orderIndex: 0,
    contourId: 'contour-1',
    chainId: 'chain-1',
    classification: 'open-chain',
    closed: false,
    segmentRefs: [],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 10, y: 0 },
    direction: 'forward',
    metrics: { cutLength: 10, rapidInLength: 0, segmentCount: 1 }
  };
}
