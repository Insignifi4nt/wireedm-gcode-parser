import { describe, expect, it } from 'vitest';
import { parseGCodeProgram } from '../gcodeParser';
import { stripForEditing } from '../isoNormalizer';

describe('unsupported external program preview modes', () => {
  it.each(['G18', 'G19', 'G52', 'G53', 'G54', 'G54.1', 'G55', 'G56', 'G57', 'G58', 'G59', 'G59.1', 'G59.2', 'G59.3', 'G92.1', 'G92.2', 'G92.3'])(
    'reports %s even when it shares a motion block', (mode) => {
      const parsed = parseGCodeProgram(`G21 G90\nG0 X10 Y0\n${mode} G1 X5 Y0`);
      expect(parsed.warnings).toEqual(expect.arrayContaining([expect.objectContaining({
        line: 3, type: 'warning', message: expect.stringContaining('physical toolpath preview cannot be relied on')
      })]));
    }
  );

  it('does not invent a return to zero when importing offset-control subcommands under modal motion', () => {
    const cleaned = stripForEditing('G21 G90\nG1 X10 Y5\nG92.1\nG92.2\nG92.3');
    const parsed = parseGCodeProgram(cleaned);
    expect(parsed.path).toEqual([{ type: 'cut', x: 10, y: 5, line: 2 }]);
    expect(parsed.warnings.filter(({ message }) => message.includes('coordinate-frame offsets'))).toHaveLength(3);
  });

  it('warns about connections across an intermediate G92 while retaining legacy initial positioning', () => {
    const text = 'G21 G90\nG0 X10 Y0\nG92 X0 Y0\nG1 X5 Y0';
    expect(stripForEditing(text)).toBe(text);
    const parsed = parseGCodeProgram(text);
    expect(parsed.warnings).toEqual([expect.objectContaining({ line: 3, message: expect.stringContaining('Connections across this reset') })]);
    expect(parseGCodeProgram('G21 G90\nG92 X0 Y0\nG1 X5 Y0').warnings).toEqual([]);
  });

  it('keeps supported XY plane and explicit arc-center modes warning-free', () => {
    const absolute = parseGCodeProgram('G21 G17 G90 G90.1\nG0 X10 Y0\nG3 X0 Y10 I0 J0');
    const incremental = parseGCodeProgram('G21 G17 G90 G91.1\nG0 X10 Y0\nG3 X0 Y10 I-10 J0');
    expect(absolute.errors).toEqual([]);
    expect(absolute.warnings).toEqual([]);
    expect(incremental.warnings).toEqual([]);
    expect(absolute.path).toEqual(incremental.path);
  });
});
