import { describe, expect, it } from 'vitest';

import {
  buildOutputFilename,
  composeGCodeProgram,
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
