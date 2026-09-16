import { describe, expect, it } from 'vitest';
import { pointAtLeadLength, pointFromRapidDistance } from '../leadDistances';

describe('lead distance geometry', () => {
  it('uses the current anchor and exact requested distance', () => {
    expect(pointAtLeadLength({ x: 5, y: 7 }, { x: 8, y: 11 }, 2.5))
      .toEqual({ x: 6.5, y: 9 });
    expect(pointAtLeadLength({ x: 5, y: 7 }, { x: 5, y: 7 }, 2)).toBeNull();
    expect(pointAtLeadLength({ x: 5, y: 7 }, { x: 8, y: 11 }, 0)).toBeNull();
    expect(pointAtLeadLength({ x: 5, y: 7 }, { x: 8, y: 11 }, Infinity)).toBeNull();
  });

  it('permits zero rapid distance but stops before the contour', () => {
    expect(pointFromRapidDistance({ x: 1, y: 2 }, { x: 4, y: 6 }, 0))
      .toEqual({ x: 1, y: 2 });
    expect(pointFromRapidDistance({ x: 1, y: 2 }, { x: 4, y: 6 }, 2.5))
      .toEqual({ x: 2.5, y: 4 });
    expect(pointFromRapidDistance({ x: 1, y: 2 }, { x: 4, y: 6 }, 5)).toBeNull();
    expect(pointFromRapidDistance({ x: 1, y: 2 }, { x: 4, y: 6 }, -1)).toBeNull();
  });
});
