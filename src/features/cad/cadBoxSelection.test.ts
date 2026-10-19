import { describe, expect, it } from 'vitest';
import { cadBoxSelectedBody, cadProjectedBounds, cadScreenBox } from './cadBoxSelection';

describe('cad box selection', () => {
  it('normalizes drags in any direction', () => {
    expect(cadScreenBox({ x: 80, y: 10 }, { x: 20, y: 60 })).toEqual({ left: 20, top: 10, right: 80, bottom: 60 });
  });

  it('projects every vertex and skips points outside the clip range', () => {
    const project = (x: number, y: number, z: number) => z < 0 ? null : { x: x * 2, y: 100 - y * 2 };
    expect(cadProjectedBounds([0, 0, 0, 10, 5, 1, 50, 50, -1], project)).toEqual({ left: 0, top: 90, right: 20, bottom: 100 });
    expect(cadProjectedBounds([1, 1, -1], project)).toBeNull();
  });

  it('selects only a body that fits wholly inside the box, preferring the largest one', () => {
    const bodies = [
      { featureId: 'small', bounds: { left: 40, top: 40, right: 60, bottom: 60 } },
      { featureId: 'large', bounds: { left: 20, top: 20, right: 120, bottom: 90 } },
      { featureId: 'hidden', bounds: null }
    ];
    expect(cadBoxSelectedBody({ left: 30, top: 30, right: 70, bottom: 70 }, bodies)).toBe('small');
    expect(cadBoxSelectedBody({ left: 19, top: 19, right: 121, bottom: 91 }, bodies)).toBe('large');
    // Crossing the large body's edge leaves only the small body fully enclosed.
    expect(cadBoxSelectedBody({ left: 25, top: 25, right: 100, bottom: 100 }, bodies)).toBe('small');
    expect(cadBoxSelectedBody({ left: 0, top: 0, right: 10, bottom: 10 }, bodies)).toBeNull();
  });
});
