import { describe, expect, it } from 'vitest';

import {
  buildOutputFilename,
  composeGCodeProgram,
  composeGCodeProgramWithLineMap,
  formatProgramLineRangeForBodyRange,
  programLineForBodyLine,
  normalizeOutputExtension
} from '../gcodeTemplates';

describe('gcodeTemplates', () => {
  it('composes clean header body footer gcode without feeds', () => {
    const program = composeGCodeProgram({
      header: '%\nG90 G21 G17 G40',
      body: 'G1 X10 Y0\nG3 X0 Y10 I-10 J0',
      footer: 'M30\n%',
      lineEnding: 'lf'
    });

    expect(program).toBe('%\nG90 G21 G17 G40\nG1 X10 Y0\nG3 X0 Y10 I-10 J0\nM30\n%\n');
    expect(program).not.toMatch(/\bF\d/);
  });

  it('composes gcode with a section-aware line map', () => {
    const composition = composeGCodeProgramWithLineMap({
      header: '%\nG90 G21',
      body: 'G0 X0 Y0\nG1 X10 Y0',
      footer: 'M30\n%',
      lineEnding: 'lf'
    });

    expect(composition.text).toBe('%\nG90 G21\nG0 X0 Y0\nG1 X10 Y0\nM30\n%\n');
    expect(composition.sections.header).toEqual({
      endLineNumber: 2,
      lineCount: 2,
      lineOffset: 0,
      startLineNumber: 1
    });
    expect(composition.sections.body).toEqual({
      endLineNumber: 4,
      lineCount: 2,
      lineOffset: 2,
      startLineNumber: 3
    });
    expect(composition.sections.footer).toEqual({
      endLineNumber: 6,
      lineCount: 2,
      lineOffset: 4,
      startLineNumber: 5
    });
    expect(composition.lines).toEqual([
      { lineNumber: 1, section: 'header', sectionLineNumber: 1, text: '%' },
      { lineNumber: 2, section: 'header', sectionLineNumber: 2, text: 'G90 G21' },
      { lineNumber: 3, section: 'body', sectionLineNumber: 1, text: 'G0 X0 Y0' },
      { lineNumber: 4, section: 'body', sectionLineNumber: 2, text: 'G1 X10 Y0' },
      { lineNumber: 5, section: 'footer', sectionLineNumber: 1, text: 'M30' },
      { lineNumber: 6, section: 'footer', sectionLineNumber: 2, text: '%' }
    ]);
    expect(programLineForBodyLine(composition.sections.body, 0)).toBe(3);
    expect(programLineForBodyLine(composition.sections.body, 1)).toBe(4);
    expect(formatProgramLineRangeForBodyRange(composition.sections.body, 0, 1)).toBe('3-4');
    expect(formatProgramLineRangeForBodyRange(composition.sections.body, 1, 1)).toBe('4');
  });

  it('keeps omitted sections in the line map without adding blank program lines', () => {
    const composition = composeGCodeProgramWithLineMap({
      header: '  ',
      body: 'G1 X1 Y0',
      footer: '',
      lineEnding: 'lf'
    });

    expect(composition.text).toBe('G1 X1 Y0\n');
    expect(composition.sections.header).toEqual({
      endLineNumber: null,
      lineCount: 0,
      lineOffset: 0,
      startLineNumber: null
    });
    expect(composition.sections.body).toEqual({
      endLineNumber: 1,
      lineCount: 1,
      lineOffset: 0,
      startLineNumber: 1
    });
    expect(composition.sections.footer).toEqual({
      endLineNumber: null,
      lineCount: 0,
      lineOffset: 1,
      startLineNumber: null
    });
    expect(composition.lines).toEqual([
      { lineNumber: 1, section: 'body', sectionLineNumber: 1, text: 'G1 X1 Y0' }
    ]);
  });

  it('normalizes built-in and custom output extensions', () => {
    expect(normalizeOutputExtension('iso')).toBe('iso');
    expect(normalizeOutputExtension('custom', '.NC')).toBe('nc');
    expect(normalizeOutputExtension('custom', '')).toBe('gcode');
  });

  it('builds output filenames without changing generated text semantics', () => {
    expect(buildOutputFilename('part-one.dxf', 'nc')).toBe('part-one.nc');
    expect(buildOutputFilename('part-one.iso', 'custom', 'CUT')).toBe('part-one.cut');
  });
});
