import { describe, expect, it } from 'vitest';

import { clusterSegmentEndpoints } from '../endpointClusters';
import { createLineSegment } from '../segments';
import type { Point2 } from '../types';

function segment(id: string, index: number, start: Point2, end: Point2) {
  return createLineSegment({ id, source: { sourceEntityIndex: index, sourceEntityType: 'line', layer: 'CUT', exact: true }, start, end });
}

/**
 * The end of `a` at the origin has two near starts: `b` 0.001 mm to its right and `c` 0.001 mm plus
 * `extra` to its left. `b` and `c` are too far apart to join each other.
 */
function clusterWithRivalStart(extra: number) {
  const result = clusterSegmentEndpoints([
    segment('a', 0, { x: 0, y: -1 }, { x: 0, y: 0 }),
    segment('b', 1, { x: 0.001, y: 0 }, { x: 0.001, y: 1 }),
    segment('c', 2, { x: -0.001 - extra, y: 0 }, { x: -0.5, y: 1 })
  ], { endpointTolerance: 0.0015, coincidenceEpsilon: 1e-5 });
  return result.diagnostics.map(diagnostic => diagnostic.code);
}

describe('nearest endpoint tie', () => {
  it('refuses to snap when the two nearest starts differ by 4e-13 mm', () => {
    const codes = clusterWithRivalStart(4e-13);

    expect(codes).toContain('ambiguous-endpoint-cluster');
    expect(codes).not.toContain('endpoint-cluster-snap');
  });

  it('snaps to the nearer start when the two nearest starts differ by 3e-12 mm', () => {
    expect(clusterWithRivalStart(3e-12)).toEqual(['endpoint-cluster-snap']);
  });
});
