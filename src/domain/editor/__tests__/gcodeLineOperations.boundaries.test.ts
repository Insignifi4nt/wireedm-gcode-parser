import { describe, expect, it } from 'vitest';

import { setStartAtLine } from '../gcodeLineOperations';

// The chosen start is the short final move; after rotation the contour ends at X0 Y0, `offsetY` from it.
function squareWithShortFinalMove(offsetY: string) {
  return ['G90', 'G0 X0 Y0', 'G1 X1 Y0', 'G1 X1 Y1', 'G1 X0 Y1', 'G1 X0 Y0', `G1 X0 Y${offsetY}`, 'M30'].join('\n');
}

describe('G-code line operation endpoint match tolerance', () => {
  it('adds no closing move when the rotated contour ends 4e-7 mm from the chosen endpoint', () => {
    const result = setStartAtLine(squareWithShortFinalMove('0.0000004'), 7);

    expect(result?.text.split('\n')).toEqual([
      'G90', 'G0 X0 Y0', 'G1 X0 Y0.0000004', 'G1 X1 Y0', 'G1 X1 Y1', 'G1 X0 Y1', 'G1 X0 Y0', 'M30'
    ]);
    expect(result?.newStartLine).toBe(3);
  });

  it('closes the rotated contour back to a chosen endpoint 3e-6 mm away', () => {
    const result = setStartAtLine(squareWithShortFinalMove('0.000003'), 7);

    expect(result?.text.split('\n')).toEqual([
      'G90', 'G0 X0 Y0', 'G1 X0 Y0.000003', 'G1 X1 Y0', 'G1 X1 Y1', 'G1 X0 Y1', 'G1 X0 Y0', 'G1 X0 Y0.000003', 'M30'
    ]);
    expect(result?.newStartLine).toBe(3);
  });
});
