// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { slotSketchProfile, slotSketchWidth, twoPointSketchProfile } from './cadSketchInteraction';

describe('smallest pointer-drawn sketch size', () => {
  it('refuses a circle dragged to a 0.0004 mm radius, and draws one dragged to 0.003 mm', () => {
    expect(() => twoPointSketchProfile('circle', [2, 3], [2.0004, 3])).toThrow('Click a different point to define a circle radius.');
    expect(twoPointSketchProfile('circle', [0, 0], [0, 0.003])).toEqual({ kind: 'circle', x: 0, y: 0, radius: 0.003 });
  });

  it('refuses a rectangle 0.0004 mm wide or high, and draws one 0.003 mm wide and high', () => {
    expect(() => twoPointSketchProfile('rectangle', [0, 0], [0.0004, 5])).toThrow('Choose a second corner with nonzero width and height.');
    expect(() => twoPointSketchProfile('rectangle', [0, 0], [5, -0.0004])).toThrow('Choose a second corner with nonzero width and height.');
    expect(twoPointSketchProfile('rectangle', [0, 0], [0.003, -0.003])).toEqual({ kind: 'rectangle', x: 0, y: -0.003, width: 0.003, height: 0.003, cornerRadius: 0 });
  });

  it('refuses slot centres 0.0004 mm apart, and accepts ones 0.003 mm apart', () => {
    expect(() => slotSketchWidth([0, 0], [0.0004, 0], [0, 1])).toThrow('Click a different point for the second arc center.');
    expect(() => slotSketchProfile([0, 0], [0, 0.0004], 1)).toThrow('Click a different point for the second arc center.');
    expect(slotSketchWidth([0, 0], [0.003, 0], [0, 0.5])).toBe(1);
    expect(slotSketchProfile([0, 0], [0, 0.003], 1)).toMatchObject({ kind: 'slot', length: 1.003, width: 1 });
  });

  it('refuses a slot 0.0004 mm wide, and draws one 0.003 mm wide', () => {
    expect(() => slotSketchProfile([0, 0], [10, 0], 0.0004)).toThrow('Move away from the line between the arc centers to set the slot width.');
    expect(slotSketchProfile([0, 0], [10, 0], 0.003)).toEqual({ kind: 'slot', x: 5, y: 0, length: 10.003, width: 0.003, angle: 0 });
  });
});
