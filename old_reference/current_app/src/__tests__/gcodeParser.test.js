import { describe, expect, it } from 'vitest';
import { GCodeParser } from '../core/GCodeParser.js';
import { createDisplayedLineMapping } from '../utils/GCodeStats.js';
import { stripForEditing } from '../utils/IsoNormalizer.js';

describe('GCodeParser', () => {
  it('does not parse setup modal commands as motion', () => {
    const parser = new GCodeParser();

    const result = parser.parse([
      'G21',
      'G17',
      'G90',
      'G0 X1 Y2'
    ].join('\n'));

    expect(result.path).toEqual([
      {
        type: 'rapid',
        x: 1,
        y: 2,
        line: 4
      }
    ]);
    expect(result.stats.linearMoves).toBe(1);
    expect(result.stats.arcMoves).toBe(0);
  });

  it('keeps exported ISO headers out of the motion path', () => {
    const parser = new GCodeParser();

    const result = parser.parse([
      '%',
      'N10 G92',
      'N20 G60',
      'N30 G38',
      'N40 G42 D0',
      'N50 G90',
      'N60 G0 X0.000 Y0.000',
      'N70 G1 X1.000 Y0.000 F1000',
      'N80 M02'
    ].join('\n'));

    expect(result.path.map(point => point.type)).toEqual(['position', 'rapid', 'cut']);
    expect(result.path.at(-1)).toMatchObject({
      type: 'cut',
      x: 1,
      y: 0,
      line: 8
    });
    expect(result.stats.arcMoves).toBe(0);
  });

  it('includes full-circle arc extents in bounds', () => {
    const parser = new GCodeParser();

    const result = parser.parse([
      'G0 X1 Y0',
      'G2 X1 Y0 I-1 J0'
    ].join('\n'));

    expect(result.bounds.minX).toBeCloseTo(-1);
    expect(result.bounds.maxX).toBeCloseTo(1);
    expect(result.bounds.minY).toBeCloseTo(-1);
    expect(result.bounds.maxY).toBeCloseTo(1);
  });

  it('parses signed, spaced, leading-decimal, and scientific coordinate values', () => {
    const parser = new GCodeParser();

    const result = parser.parse([
      'G0 X +.5 Y -1.25',
      'G2 X1e0 Y0 I +.25 J1.25e0'
    ].join('\n'));

    expect(result.path[0]).toMatchObject({
      type: 'rapid',
      x: 0.5,
      y: -1.25
    });
    expect(result.path[1]).toMatchObject({
      type: 'arc',
      endX: 1,
      endY: 0,
      centerX: 0.75,
      centerY: 0
    });
  });

  it('uses modal motion for coordinate-only continuation lines', () => {
    const parser = new GCodeParser();

    const result = parser.parse([
      'G0 X0 Y0',
      'G1 X1 Y0',
      'X2 Y0',
      'G3 X2 Y1 I1 J0',
      'M01',
      'X1 Y1 I1 J1'
    ].join('\n'));

    expect(result.path.map(point => point.type)).toEqual([
      'rapid',
      'cut',
      'cut',
      'arc',
      'arc'
    ]);
    expect(result.path[2]).toMatchObject({
      type: 'cut',
      x: 2,
      y: 0,
      line: 3
    });
    expect(result.path[4]).toMatchObject({
      type: 'arc',
      startX: 2,
      startY: 1,
      endX: 1,
      endY: 1,
      centerX: 3,
      centerY: 2,
      clockwise: false,
      line: 6
    });
    expect(result.warnings).toEqual([]);
  });

  it('ignores non-motion M-code control commands without warnings', () => {
    const parser = new GCodeParser();

    const result = parser.parse([
      'M28',
      'G0 X0 Y0',
      'M01',
      'G1 X1 Y0',
      'M02'
    ].join('\n'));

    expect(result.path.map(point => point.type)).toEqual(['rapid', 'cut']);
    expect(result.warnings).toEqual([]);
  });

  it('parses compact machine output without spaces between commands and parameters', () => {
    const parser = new GCodeParser();

    const result = parser.parse([
      'N10 (program name)',
      'G92X0Y0',
      'G60',
      'G41D0',
      'G01X6500Y0',
      'G03X6500Y5477I0J0'
    ].join('\n'));

    expect(result.path.map(point => point.type)).toEqual(['position', 'cut', 'arc']);
    expect(result.path[0]).toMatchObject({
      type: 'position',
      x: 0,
      y: 0,
      line: 2
    });
    expect(result.path[1]).toMatchObject({
      type: 'cut',
      x: 6500,
      y: 0,
      line: 5
    });
    expect(result.path[2]).toMatchObject({
      type: 'arc',
      startX: 6500,
      startY: 0,
      endX: 6500,
      endY: 5477,
      centerX: 0,
      centerY: 0,
      clockwise: false,
      line: 6
    });
    expect(result.warnings).toEqual([]);
  });
});

describe('G-code display mapping', () => {
  it('maps stripped drawer lines back to path indexes by displayed line number', () => {
    const parser = new GCodeParser();
    const raw = [
      '%',
      'N10 G92 X0 Y0',
      'N20 G0 X0 Y0',
      'N30 G1 X10 Y0',
      'N40 M02'
    ].join('\n');
    const result = parser.parse(raw);
    const displayedText = stripForEditing(raw);

    const mapping = createDisplayedLineMapping(displayedText, result.path, parser);

    expect(mapping.map(({ index, line }) => ({ index, line }))).toEqual([
      { index: 0, line: 1 },
      { index: 1, line: 2 },
      { index: 2, line: 3 }
    ]);
  });
});
