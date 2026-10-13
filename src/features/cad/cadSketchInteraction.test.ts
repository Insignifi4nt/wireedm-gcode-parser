import { describe, expect, it } from 'vitest';
import { snapSketchPathPoint } from './cadSketchInteraction';

describe('path anchor snapping', () => {
  it.each([0.1, 1, 10])('uses six screen pixels before grid snapping at scale %s', scale => {
    const anchor = [2.1, 3.2] as const;
    expect(snapSketchPathPoint([anchor[0] + 5.9 * scale, anchor[1]], anchor, scale, 5, true)).toBe(anchor);
    const outside = [anchor[0] + 6.1 * scale, anchor[1]] as const;
    expect(snapSketchPathPoint(outside, anchor, scale, 5, false)).toBe(outside);
  });

  it('still snaps ordinary points to the grid and retains off-grid anchors when grid snapping is disabled', () => {
    expect(snapSketchPathPoint([12, 8], [2.1, 3.2], 0.1, 5, true)).toEqual([10, 10]);
    expect(snapSketchPathPoint([2.3, 3.3], [2.1, 3.2], 0.1, 5, false)).toEqual([2.1, 3.2]);
    expect(snapSketchPathPoint([2, 3], null, 1, 5, true)).toEqual([0, 5]);
  });
});
