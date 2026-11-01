import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { createPathPlanningDocumentFromDxfEntities } from '../fromDxfEntities';

function line(startX: number, startY: number, endX: number, endY: number): DxfEntity {
  return { type: 'line', layer: 'CUT', start: { x: startX, y: startY }, end: { x: endX, y: endY } };
}

/**
 * Three open lines point away from the wire start at the origin, with a coincidence of 1e-6 mm:
 * - S starts 1e-5 mm away on +X and has the shortest rapid.
 * - X starts 1.05e-5 mm away on +Y. Its rapid ties with S, and its lower X wins the tie.
 * - C starts `distance` mm away on -X, just over 1.1e-5 mm. Its rapid ties with X, and its lower X
 *   wins that tie, but it is more than the coincidence behind S.
 * The ranking only looks at C when its start lies within S's rapid plus the coincidence plus the
 * rounding margins. If it looks, the first cut moves from X to C.
 */
function firstCutStart(distance: number) {
  const document = createPathPlanningDocumentFromDxfEntities(
    [line(1e-5, 0, 1, 0), line(0, 1.05e-5, 0, 1), line(-distance, 0, -1, 0)],
    { endpointTolerance: 0, coincidenceEpsilon: 1e-6 }
  );
  expect(document.plan.operations).toHaveLength(3);
  return document.plan.operations[0].startPoint;
}

describe('absolute margin when ranking rapids', () => {
  it('ranks a start 4e-13 mm past the nearest rapid plus the coincidence, so its tie takes the first cut', () => {
    expect(firstCutStart(1.10000004e-5)).toEqual({ x: -1.10000004e-5, y: 0 });
  });

  it('skips a start 3e-12 mm past the nearest rapid plus the coincidence, so the nearer tie takes the first cut', () => {
    expect(firstCutStart(1.1000003e-5)).toEqual({ x: 0, y: 1.05e-5 });
  });
});
