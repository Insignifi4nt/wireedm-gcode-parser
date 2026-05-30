import { describe, expect, it } from 'vitest';

import { canonicalizeMotionCodes, normalizeToISO, stripForEditing } from '../isoNormalizer';

describe('isoNormalizer', () => {
  it('renumbers existing block-numbered lines into a clean monotonic sequence', () => {
    const result = normalizeToISO(
      ['%', 'N100 G0 X0 Y0', 'N250 G1 X1 Y0', 'N900 M02'].join('\n'),
      {
        crlf: false
      }
    );

    expect(result).toBe(['%', 'N10 G0 X0 Y0', 'N20 G1 X1 Y0', 'N30 M02', ''].join('\n'));
  });

  it('strips compact block numbers and expands compact bare G92 for editing', () => {
    const result = stripForEditing(['%', 'N10G92', 'N20G01X1Y2', 'N30M02'].join('\n'));

    expect(result).toBe(['G92 X0.000 Y0.000', 'G1X1Y2'].join('\n'));
  });

  it('does not append duplicate coordinates to compact G92 lines that already have XY', () => {
    const result = stripForEditing('N10G92X0Y0');

    expect(result).toBe('G92X0Y0');
  });

  it('canonicalizes motion codes without touching unrelated G-codes', () => {
    expect(canonicalizeMotionCodes('G00 X10')).toBe('G0 X10');
    expect(canonicalizeMotionCodes('G01 Y20')).toBe('G1 Y20');
    expect(canonicalizeMotionCodes('G02 I5')).toBe('G2 I5');
    expect(canonicalizeMotionCodes('G03 J5')).toBe('G3 J5');
    expect(canonicalizeMotionCodes('G92 X0 Y0')).toBe('G92 X0 Y0');
  });

  it('strips parenthesized comments and percent comment lines from normalized ISO', () => {
    const result = normalizeToISO(
      ['% (MEM:F17A15.ISO)', 'G0 X0 Y0 (rapid to start)', 'G1 X1 Y0 ; cut comment', 'M02'].join(
        '\n'
      ),
      {
        crlf: false
      }
    );

    expect(result).toBe(['%', 'N10 G0 X0 Y0', 'N20 G1 X1 Y0', 'N30 M02', ''].join('\n'));
  });
});
