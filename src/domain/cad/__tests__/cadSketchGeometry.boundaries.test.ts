import { describe, expect, it } from 'vitest';
import { cadBoundariesIntersect, type CadAnalyticBoundary } from '../cadSketchGeometry';

const line = (start: readonly [number, number], end: readonly [number, number]): CadAnalyticBoundary =>
  ({ type: 'line', layer: null, start: { x: start[0], y: start[1] }, end: { x: end[0], y: end[1] } });

/** A unit segment along X, and a unit segment 5e-8 mm above it whose far end rises by `rise` mm more: their direction cross product is `rise` mm². */
function besideUnitSegment(rise: number) {
  return [line([0, 0], [1, 0]), line([0, 5e-8], [1, 5e-8 + rise])] as const;
}

describe('legacy parallel cross floor', () => {
  it('treats segments whose directions cross by 4e-15 mm² as parallel, so their overlap within confusion touches', () => {
    const [first, second] = besideUnitSegment(4e-15);
    expect(cadBoundariesIntersect(first, second)).toBe(true);
    expect(cadBoundariesIntersect(second, first)).toBe(true);
  });

  it('intersects segments whose directions cross by 3e-14 mm² as lines, whose crossing lies far outside both', () => {
    const [first, second] = besideUnitSegment(3e-14);
    expect(cadBoundariesIntersect(first, second)).toBe(false);
    expect(cadBoundariesIntersect(second, first)).toBe(false);
  });
});
