import { describe, expect, it } from 'vitest';

import { canonicalizeMotionCodes, normalizeToISO, stripForEditing } from '../isoNormalizer';

describe('isoNormalizer', () => {
  it.each(['G1 X10 Y5 M02', 'G1X10Y5M02'])('retains motion when normalizing a shared end block: %s', (line) => {
    const result = normalizeToISO(`G0 X0 Y0\n${line}`, { crlf: false });

    expect(result).toContain(line.replace('M02', '').trim());
    expect(result.match(/M02/g)).toHaveLength(1);
    expect(result.endsWith('M02\n')).toBe(true);
  });

  it('does not treat a preserved comment as an end command', () => {
    const result = normalizeToISO('G1 X10 Y5 (M02 later)', { crlf: false, stripSemicolon: false });

    expect(result).toBe('%\nN10 G1 X10 Y5 (M02 later)\nN20 M02\n');
  });

  it('retains commands after comments containing nested parentheses and semicolons', () => {
    const result = normalizeToISO('G1 (cut (M02 later); continue) X10 Y5', { crlf: false });

    expect(result).toBe('%\nN10 G1 X10 Y5\nN20 M02\n');
  });

  it.each(['M20', 'M02.1', 'M2e3'])('preserves distinct controller commands containing an M2 prefix: %s', (command) => {
    const line = `G1 X10 Y5 ${command}`;
    expect(stripForEditing(line)).toBe(line);
    expect(normalizeToISO(line, { crlf: false })).toBe(`%\nN10 ${line}\nN20 M02\n`);
  });

  it('strips a standalone terminal end block with a comment', () => {
    expect(stripForEditing('G1 X10 Y5\nM02 (end)\n')).toBe('G1 X10 Y5\n');
  });

  it.each(['G1 X#<diam2> Y5', 'G1 X[2*#<diam2>] Y5', 'O<subm2> CALL'])(
    'preserves named identifiers containing end-command text: %s', (line) => {
      expect(stripForEditing(line)).toBe(line);
      expect(stripForEditing(`${line} M02`)).toBe(line);
      expect(normalizeToISO(`${line} M02`, { crlf: false })).toBe(`%\nN10 ${line}\nN20 M02\n`);
    }
  );

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

  it('preserves decimal G92 offset-control commands without inserting axis words', () => {
    expect(stripForEditing('N10G92.1\nN20G92.2\nN30G92.3')).toBe('G92.1\nG92.2\nG92.3');
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
