import { describe, expect, it } from 'vitest';
import { absolutePathSegments, placedPathData } from './cadSketchRelationGlyphDrawing';
import { CAD_SKETCH_RELATION_ICONS } from './CadSketchRelationGlyphs';

describe('relation glyph drawing', () => {
  it('reads path data into absolute segments, with relative, implied and shorthand commands written out', () => {
    // A relative chain after M continues as line-tos; H and V keep the other coordinate; Z returns to the subpath start.
    expect(absolutePathSegments('M4 19l8-7 8 7M9.5 12h5v2H9.5zm1 1 2 0')).toEqual([['M', 4, 19], ['L', 12, 12], ['L', 20, 19], ['M', 9.5, 12], ['L', 14.5, 12],
      ['L', 14.5, 14], ['L', 9.5, 14], ['Z'], ['M', 10.5, 13], ['L', 12.5, 13]]);
    // S and T reflect the last control point, or start at the current point after another command; arc flags may be written together.
    expect(absolutePathSegments('M0 0C1 2 3 2 4 0S7-2 8 0L9 0s1 1 2 0Q13 2 14 0t2 0M0 5a5 5 0 1010 0a1,1 0 0 1-2 0')).toEqual([['M', 0, 0], ['C', 1, 2, 3, 2, 4, 0],
      ['C', 5, -2, 7, -2, 8, 0], ['L', 9, 0], ['C', 9, 0, 10, 1, 11, 0], ['Q', 13, 2, 14, 0], ['Q', 15, -2, 16, 0], ['M', 0, 5], ['A', 5, 5, 0, 1, 0, 10, 5], ['A', 1, 1, 0, 0, 1, 8, 5]]);
    expect(absolutePathSegments('M.5.5L-1e1 2')).toEqual([['M', 0.5, 0.5], ['L', -10, 2]]);
    for (const broken of ['5 5', 'M0', 'M0 0Z 1 1', 'M0 0A1 1 0 2 0 1 1']) expect(() => absolutePathSegments(broken), broken).toThrow();
  });

  it('places a drawing by its centre at any size, to the hundredth', () => {
    const place = placedPathData(['M0 0L24 24', 'M12 0a12 12 0 0 1 0 24Z'], 24, 12);
    expect(place(100, 50)).toBe('M94 44L106 56M100 44A6 6 0 0 1 100 56Z');
    expect(place(1 / 3, -0.001)).toBe('M-5.67 -6L6.33 6M0.33 -6A6 6 0 0 1 0.33 6Z');
  });

  it('draws every relation icon inside its 10 px square', () => {
    for (const [kind, icon] of Object.entries(CAD_SKETCH_RELATION_ICONS)) {
      const data = placedPathData(icon.paths, 24, 10)(0, 0);
      const coordinates = [...data.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].flatMap(match => [Number(match[1]), Number(match[2])]);
      expect(coordinates.length, kind).toBeGreaterThan(0);
      expect(coordinates.every(value => Math.abs(value) <= 5), kind).toBe(true);
    }
  });
});
