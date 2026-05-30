import { describe, it, expect } from 'vitest';
import { reorderAndRotateContours } from '../utils/GCodeRewriter.js';

describe('GCodeRewriter', () => {
  it('rotates compact closed contours without adding coordinate-less close moves', () => {
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

    const result = reorderAndRotateContours(input, 6);
    const lines = result.text.split('\n');

    expect(result.newStartLine).toBe(4);
    expect(lines.slice(0, 3)).toEqual(['G92X0Y0', 'G60', 'G41D0']);
    expect(lines[3]).toBe('G1X10Y10');
    expect(lines).not.toContain('G1');
    expect(lines.at(-1)).toBe('M02');
  });

  it('updates compact arc commands in place instead of appending duplicate I/J words', () => {
    const input = [
      'G92X0Y0',
      'G0X0Y0',
      'G2X10Y0I5J0',
      'G2X0Y0I-5J0',
      'M02'
    ].join('\n');

    const result = reorderAndRotateContours(input, 4);
    const arcLines = result.text.split('\n').filter(line => /^G2/i.test(line));

    expect(arcLines[0]).toBe('G2X0Y0I-5J0');
    expect(arcLines[1]).toBe('G2X10Y0I5J0');
    expect(arcLines.every(line => (line.match(/I/gi) || []).length === 1)).toBe(true);
    expect(arcLines.every(line => (line.match(/J/gi) || []).length === 1)).toBe(true);
  });
});
