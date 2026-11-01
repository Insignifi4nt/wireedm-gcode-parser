import { describe, expect, it } from 'vitest';
import { CadError } from '../cadError';
import { resolveCadCircularPattern, type CadCircularPatternFeature } from '../cadPatterns';

const pattern: Pick<CadCircularPatternFeature, 'count' | 'axis' | 'center' | 'angle'> = { count: 4, axis: 'z', center: [0, 0, 0], angle: 360 };

describe('circular pattern minimum angle', () => {
  it.each([3e-7, -3e-7])('spreads copies over a %s degree extent', angle => {
    const resolved = resolveCadCircularPattern({ ...pattern, angle }, {});
    expect(resolved.fullTurn).toBe(false);
    expect(resolved.angles).toEqual([0, angle / 3, 2 * angle / 3, angle]);
  });

  it.each([4e-8, -4e-8])('refuses a %s degree extent as zero', angle => {
    expect(() => resolveCadCircularPattern({ ...pattern, angle }, {})).toThrow(CadError);
    expect(() => resolveCadCircularPattern({ ...pattern, angle }, {})).toThrow(/extent must be nonzero/);
  });
});
