import { describe, expect, it } from 'vitest';

import { SpatialHash } from '../spatialIndex';
import type { Bounds2 } from '../types';

describe('SpatialHash bounds queries', () => {
  it('preserves exact hits and insertion order across growing mixed-size levels', () => {
    const index = new SpatialHash<number>({ cellSize: 1, maxCellsPerBounds: 4 });
    const bounds: Bounds2[] = [
      { minX: 0, minY: 0, maxX: 3, maxY: 0 },
      { minX: 100, minY: 0, maxX: 103, maxY: 0 },
      { minX: -103, minY: -10, maxX: -100, maxY: -10 },
      { minX: 0, minY: 20, maxX: 1_000, maxY: 1_020 },
      { minX: -1_000, minY: -1_020, maxX: 0, maxY: -20 },
      { minX: 1e110, minY: 0, maxX: 2e110, maxY: 0 },
      { minX: -2e110, minY: 0, maxX: -1e110, maxY: 0 }
    ];
    const queries: Bounds2[] = [
      ...bounds,
      // This tolerance expansion crosses the insertion cell limit.
      { minX: -0.001, minY: -0.001, maxX: 3.001, maxY: 0.001 },
      { minX: 3, minY: 0, maxX: 100, maxY: 0 },
      { minX: 4, minY: 0, maxX: 99, maxY: 0 },
      { minX: -Number.MAX_VALUE, minY: -Number.MAX_VALUE, maxX: Number.MAX_VALUE, maxY: Number.MAX_VALUE }
    ];

    bounds.forEach((entry, id) => {
      index.insertBounds(entry, id);
      for (const query of queries) {
        const expected = bounds.slice(0, id + 1).flatMap((candidate, candidateId) => (
          candidate.minX <= query.maxX && candidate.maxX >= query.minX &&
          candidate.minY <= query.maxY && candidate.maxY >= query.minY
            ? [candidateId] : []
        ));
        expect(index.queryBounds(query)).toEqual(expected);
      }
    });
  });
});
