import { describe, expect, it } from 'vitest';

import {
  isFooterCommand,
  isHeaderCommand,
  isMotionCommand,
  organizeGCodeStructure
} from '../gcodeStructure';

describe('gcodeStructure', () => {
  describe('command classification', () => {
    it('identifies header commands', () => {
      expect(isHeaderCommand('%')).toBe(true);
      expect(isHeaderCommand('G92 X0 Y0')).toBe(true);
      expect(isHeaderCommand('G60')).toBe(true);
      expect(isHeaderCommand('G90')).toBe(true);
      expect(isHeaderCommand('G1 X10')).toBe(false);
    });

    it('identifies motion commands', () => {
      expect(isMotionCommand('G0 X0 Y0')).toBe(true);
      expect(isMotionCommand('G1 X10')).toBe(true);
      expect(isMotionCommand('G2 I5')).toBe(true);
      expect(isMotionCommand('G3 J5')).toBe(true);
      expect(isMotionCommand('G00 X0')).toBe(true);
      expect(isMotionCommand('G01X10Y0')).toBe(true);
      expect(isMotionCommand('N20 G03X10Y0I0J0')).toBe(true);
      expect(isMotionCommand('G92')).toBe(false);
    });

    it('identifies footer commands', () => {
      expect(isFooterCommand('M02')).toBe(true);
      expect(isFooterCommand('M30')).toBe(true);
      expect(isFooterCommand('G1 X0')).toBe(false);
    });
  });

  describe('structure organization', () => {
    it('splits code into header, body, and footer', () => {
      const sections = organizeGCodeStructure([
        '%',
        'G92 X0 Y0',
        'G90',
        'G0 X10 Y10',
        'G1 X20 Y10',
        'M02'
      ]);

      expect(sections.header.lines).toHaveLength(3);
      expect(sections.header.lines[0].text).toBe('%');
      expect(sections.body.lines).toHaveLength(2);
      expect(sections.body.lines[0].text).toBe('G0 X10 Y10');
      expect(sections.footer.lines).toHaveLength(1);
      expect(sections.footer.lines[0].text).toBe('M02');
    });

    it('detects contour groups within body lines', () => {
      const sections = organizeGCodeStructure([
        'G90',
        'G0 X0 Y0',
        'G1 X10 Y0',
        'G1 X10 Y10',
        'G0 X20 Y20',
        'G1 X30 Y30',
        'M02'
      ]);

      expect(sections.header.lines).toHaveLength(1);
      expect(sections.body.lines).toHaveLength(5);
      const contours = sections.body.contours ?? [];
      expect(contours).toHaveLength(4);
      expect(contours.map((contour) => contour.type)).toEqual([
        'loose',
        'toolpath-open',
        'loose',
        'toolpath-open'
      ]);
    });

    it('splits compact machine output into header, body, and footer', () => {
      const sections = organizeGCodeStructure([
        'G92X0Y0',
        'G60',
        'G41D0',
        'G01X6500Y0',
        'G03X6500Y5477I0J0',
        'M02'
      ]);

      expect(sections.header.lines.map((line) => line.text)).toEqual([
        'G92X0Y0',
        'G60',
        'G41D0'
      ]);
      expect(sections.body.lines.map((line) => line.text)).toEqual([
        'G01X6500Y0',
        'G03X6500Y5477I0J0'
      ]);
      expect(sections.footer.lines.map((line) => line.text)).toEqual(['M02']);
    });
  });
});
