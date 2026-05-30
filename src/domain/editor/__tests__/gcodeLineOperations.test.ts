import { describe, expect, it } from 'vitest';

import { organizeGCodeStructure } from '../gcodeStructure';
import {
  deleteBodyGroup,
  moveBodyGroup,
  moveSelectedLines,
  setStartAtLine
} from '../gcodeLineOperations';

describe('gcodeLineOperations', () => {
  it('moves a body group down by swapping it with the next body group', () => {
    const source = sampleGroupedProgram();
    const structure = organizeGCodeStructure(source.split('\n'));

    const result = moveBodyGroup(source, structure, 'contour-1', 1);

    expect(result).toEqual({
      text: ['G90 G21', 'G0 X0 Y0', 'G0 X20 Y0', 'G1 X10 Y0', 'G1 X30 Y0', 'M30'].join(
        '\n'
      ),
      movedLineNumbers: [4]
    });
  });

  it('moves a body group up by swapping it with the previous body group', () => {
    const source = sampleGroupedProgram();
    const structure = organizeGCodeStructure(source.split('\n'));

    const result = moveBodyGroup(source, structure, 'contour-1', -1);

    expect(result).toEqual({
      text: ['G90 G21', 'G1 X10 Y0', 'G0 X0 Y0', 'G0 X20 Y0', 'G1 X30 Y0', 'M30'].join(
        '\n'
      ),
      movedLineNumbers: [2]
    });
  });

  it('deletes a body group and returns the removed line numbers', () => {
    const source = sampleGroupedProgram();
    const structure = organizeGCodeStructure(source.split('\n'));

    const result = deleteBodyGroup(source, structure, 'contour-1');

    expect(result).toEqual({
      text: ['G90 G21', 'G0 X0 Y0', 'G0 X20 Y0', 'G1 X30 Y0', 'M30'].join('\n'),
      deletedLineNumbers: [3]
    });
  });

  it('moves selected line blocks up and down like the old drawer selection toolbar', () => {
    const source = ['A', 'B', 'C', 'D', 'E'].join('\n');

    expect(moveSelectedLines(source, [2, 3], 1)).toEqual({
      text: ['A', 'D', 'B', 'C', 'E'].join('\n'),
      movedLineNumbers: [3, 4]
    });
    expect(moveSelectedLines(source, [3, 4], -1)).toEqual({
      text: ['A', 'C', 'D', 'B', 'E'].join('\n'),
      movedLineNumbers: [2, 3]
    });
    expect(moveSelectedLines(source, [1], -1)).toBeNull();
    expect(moveSelectedLines(source, [5], 1)).toBeNull();
  });

  it('returns null for impossible group operations', () => {
    const source = sampleGroupedProgram();
    const structure = organizeGCodeStructure(source.split('\n'));

    expect(moveBodyGroup(source, structure, 'missing', 1)).toBeNull();
    expect(moveBodyGroup(source, structure, 'loose-0', -1)).toBeNull();
    expect(deleteBodyGroup(source, structure, 'missing')).toBeNull();
  });

  it('rotates compact closed contours so the selected motion line becomes the first body line', () => {
    const input = [
      'G92X0Y0',
      'G60',
      'G41D0',
      'G0X0Y0',
      'G1X10Y0',
      'G1X10Y10',
      'G1X0Y10',
      'G1X0Y0',
      'M02'
    ].join('\n');

    const result = setStartAtLine(input, 6);
    const lines = result?.text.split('\n') ?? [];

    expect(result?.newStartLine).toBe(4);
    expect(lines.slice(0, 3)).toEqual(['G92X0Y0', 'G60', 'G41D0']);
    expect(lines[3]).toBe('G1X10Y10');
    expect(lines).not.toContain('G1');
    expect(lines.at(-1)).toBe('M02');
  });

  it('updates compact arc commands in place when rotating the start line', () => {
    const input = ['G92X0Y0', 'G0X0Y0', 'G2X10Y0I5J0', 'G2X0Y0I-5J0', 'M02'].join(
      '\n'
    );

    const result = setStartAtLine(input, 4);
    const arcLines = result?.text.split('\n').filter((line) => /^G2/i.test(line)) ?? [];

    expect(arcLines[0]).toBe('G2X0Y0I-5J0');
    expect(arcLines[1]).toBe('G2X10Y0I5J0');
    expect(arcLines.every((line) => (line.match(/I/gi) || []).length === 1)).toBe(true);
    expect(arcLines.every((line) => (line.match(/J/gi) || []).length === 1)).toBe(true);
  });

  it('returns null when the chosen start line is not a body motion line', () => {
    const input = ['G90', 'G0 X0 Y0', 'G1 X1 Y0', 'M30'].join('\n');

    expect(setStartAtLine(input, 1)).toBeNull();
    expect(setStartAtLine(input, 4)).toBeNull();
  });
});

function sampleGroupedProgram() {
  return ['G90 G21', 'G0 X0 Y0', 'G1 X10 Y0', 'G0 X20 Y0', 'G1 X30 Y0', 'M30'].join(
    '\n'
  );
}
