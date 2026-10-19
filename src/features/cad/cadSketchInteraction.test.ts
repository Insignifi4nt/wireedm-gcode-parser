import { describe, expect, it } from 'vitest';
import { magnetSketchPoint, magnetSketchValue } from './cadSketchInteraction';

describe('grid magnet', () => {
  it('lets drags move freely between grid nodes and catches them only nearby', () => {
    expect(magnetSketchPoint([11.3, 7.9], 5, true, 1)).toEqual([11.3, 7.9]);
    expect(magnetSketchPoint([10.4, 9.7], 5, true, 1)).toEqual([10, 10]);
    expect(magnetSketchPoint([10.4, 9.7], 5, false, 1)).toEqual([10.4, 9.7]);
    expect(magnetSketchValue(12.6, 5, true, 0.5)).toBe(12.6);
    expect(magnetSketchValue(14.6, 5, true, 0.5)).toBe(15);
    expect(() => magnetSketchValue(1, 0, true, 1)).toThrow('positive');
  });
});
