import { describe, expect, it } from 'vitest';

import { intersectSegmentTriangle, type Triangle3 } from '../triangleIntersection';

describe('machine geometry tolerance for wire to triangle contact', () => {
  const surface: Triangle3 = [[0, 0, 0], [10, 0, 0], [0, 10, 0]];

  it('counts a wire segment hovering within the tolerance above a face as touching it', () => {
    expect(intersectSegmentTriangle({ start: [1, 1, 4e-8], end: [3, 2, 4e-8] }, surface)).toEqual({ point: [1, 1, 4e-8], fraction: 0 });
  });

  it('keeps a wire segment hovering beyond the tolerance above a face clear of it', () => {
    expect(intersectSegmentTriangle({ start: [1, 1, 3e-7], end: [3, 2, 3e-7] }, surface)).toBeNull();
  });

  it('counts a crossing within the tolerance outside a face edge as a hit', () => {
    expect(intersectSegmentTriangle({ start: [5, -4e-8, -1], end: [5, -4e-8, 1] }, surface)).toEqual({ point: [5, -4e-8, 0], fraction: 0.5 });
  });

  it('rejects a crossing beyond the tolerance outside a face edge', () => {
    expect(intersectSegmentTriangle({ start: [5, -3e-7, -1], end: [5, -3e-7, 1] }, surface)).toBeNull();
  });
});
