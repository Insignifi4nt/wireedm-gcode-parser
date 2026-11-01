import { describe, expect, it } from 'vitest';

import type { Point2 } from '@/domain/path-intel/types';

import { polygonCrossings } from '../geometry';

/** A sliver obstacle across x 0.5..0.6 whose two short sides cross the travel line y = 0. */
function sliver(halfHeight: number): Point2[] {
  return [{ x: 0.5, y: -halfHeight }, { x: 0.6, y: -halfHeight }, { x: 0.6, y: halfHeight }, { x: 0.5, y: halfHeight }];
}

describe('degenerate area threshold for travel crossings', () => {
  // One millimetre of travel along x: each crossing's determinant is the sliver height in square millimetres.
  const start = { x: 0, y: 0 };
  const end = { x: 1, y: 0 };

  it('skips the sides of a sliver whose crossing area is below the degenerate threshold', () => {
    expect(polygonCrossings(start, end, sliver(2e-13))).toEqual([]);
  });

  it('keeps both side crossings of a sliver whose crossing area is above the degenerate threshold', () => {
    const crossings = [...polygonCrossings(start, end, sliver(1.5e-12))].sort((a, b) => a - b);
    expect(crossings).toHaveLength(2);
    expect(crossings[0]).toBeCloseTo(0.5, 12);
    expect(crossings[1]).toBeCloseTo(0.6, 12);
  });
});
