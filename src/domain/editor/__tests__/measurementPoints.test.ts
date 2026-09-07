import { describe, expect, it } from 'vitest';
import { parseGCodeProgram } from '../gcodeParser';

import {
  createMeasurementPointPathSnapFromMagnetized,
  exportMeasurementPointsAsCsv,
  insertMeasurementPointsIntoText
} from '../measurementPoints';

describe('measurementPoints', () => {
  it('preserves implicit cutting after inserted rapid moves, including numbered blocks', () => {
    const result = insertMeasurementPointsIntoText('G21 G90\nG1 X1 Y0\n(comment)\nN30 X4 Y0\nX5\nM30',
      [{ id: 'a', x: 2, y: 0 }], { insertAfterLine: 2 });
    expect(result.text).toContain('N30 G1 X4 Y0');
    expect(parseGCodeProgram(result.text).path).toMatchObject([
      { type: 'cut', x: 1 }, { type: 'rapid', x: 2 }, { type: 'cut', x: 4 }, { type: 'cut', x: 5 }
    ]);
    expect(result.insertedLineNumbers.map((line) => result.text.split('\n')[line - 1]))
      .toEqual(['; inserted G0 P1', 'G0 X2.000 Y0.000']);
  });

  it('does not accumulate rounding drift across incremental construction points', () => {
    const points = Array.from({ length: 100 }, (_, index) => ({ id: String(index), x: (index + 1) * 0.0006, y: 0 }));
    const result = insertMeasurementPointsIntoText('G21 G91\nM30', points, { insertAfterLine: 1 });
    const parsed = parseGCodeProgram(result.text);
    expect(parsed.errors).toEqual([]);
    parsed.path.forEach((point, index) => {
      if (point.type === 'arc') throw new Error('Expected linear point');
      expect(Math.abs(point.x - points[index].x)).toBeLessThanOrEqual(0.000501);
    });
  });

  it('restores an implicit arc but leaves an explicit following motion untouched', () => {
    const point = [{ id: 'a', x: 1, y: 0 }];
    const arc = insertMeasurementPointsIntoText('G21 G0 X1 Y0\nG3 X0 Y1 I-1 J0\nX-1 Y0 I0 J-1',
      [{ id: 'a', x: 0, y: 1 }], { insertAfterLine: 2 });
    expect(parseGCodeProgram(arc.text).path.at(-1)).toMatchObject({
      type: 'arc', endX: -1, endY: 0, centerX: 0, centerY: 0, clockwise: false
    });
    const explicit = insertMeasurementPointsIntoText('G21 G1 X0 Y0\nN40 G1 X2 Y0', point, { insertAfterLine: 1 });
    expect(explicit.text.split('\n').at(-1)).toBe('N40 G1 X2 Y0');
  });

  it('retains sub-micron rounding precision when writing millimetre points as inches', () => {
    const result = insertMeasurementPointsIntoText('G20\nM30', [{ id: 'a', x: 1.234, y: -5.678 }], { insertAfterLine: 1 });
    const end = parseGCodeProgram(result.text).path.at(-1)!;
    if (end.type === 'arc') throw new Error('Expected linear point');
    expect(Math.abs(end.x - 1.234)).toBeLessThan(0.0005);
    expect(Math.abs(end.y + 5.678)).toBeLessThan(0.0005);
  });
  it.each(['G90', 'G91'])('inserts millimetre preview points using active inch mode and %s', (mode) => {
    const result = insertMeasurementPointsIntoText(`G20\nG0 X1 Y1\n${mode}\nM30`, [
      { id: 'a', x: 50.8, y: 25.4 }, { id: 'b', x: 76.2, y: 50.8 }
    ], { insertAfterLine: 3 });
    const path = parseGCodeProgram(result.text).path;
    expect(path.at(-2)).toMatchObject({ x: 50.8, y: 25.4 });
    const end = path.at(-1)!;
    if (end.type === 'arc') throw new Error('Expected linear point');
    expect(end.x).toBeCloseTo(76.2);
    expect(end.y).toBeCloseTo(50.8);
  });

  const points = [
    { id: 'a', x: 1, y: 2 },
    { id: 'b', x: -3.4567, y: 4.2 }
  ];

  it('inserts measurement points after the requested line using old drawer formatting', () => {
    const result = insertMeasurementPointsIntoText(['G90', 'G0 X0 Y0', 'M30'].join('\n'), points, {
      insertAfterLine: 2
    });

    expect(result).toEqual({
      text: ['G90', 'G0 X0 Y0', '; inserted G0 P1', 'G0 X1.000 Y2.000', '; inserted G0 P2', 'G0 X-3.457 Y4.200', 'M30'].join('\n'),
      insertedLineNumbers: [3, 4, 5, 6]
    });
  });

  it('falls back to the first line when no insertion line is available', () => {
    const result = insertMeasurementPointsIntoText('G90\nM30', [points[0]], {});

    expect(result.text).toBe(['G90', '; inserted G0 P1', 'G0 X1.000 Y2.000', 'M30'].join('\n'));
    expect(result.insertedLineNumbers).toEqual([2, 3]);
  });

  it('exports controller-neutral point coordinates as CSV', () => {
    expect(exportMeasurementPointsAsCsv(points)).toBe(
      ['Point,X,Y', 'P1,1.000,2.000', 'P2,-3.457,4.200'].join('\n')
    );
  });

  it('creates persisted path snaps from magnetized UPID construction points', () => {
    const snap = createMeasurementPointPathSnapFromMagnetized({
      distance: 4,
      endpointRole: null,
      mode: 'perpendicular',
      operationId: 'op_0001',
      pathElementId: 'contour_0001',
      point: { x: 10, y: 5 },
      relation: 'perpendicular',
      segmentId: 'seg_0002',
      segmentIndex: 1,
      sourcePoint: { x: 10, y: 0 },
      tangent: { x: 1, y: 0 },
      t: 0.5
    });

    expect(snap).toEqual({
      kind: 'path-construction',
      mode: 'perpendicular',
      operationId: 'op_0001',
      pathElementId: 'contour_0001',
      relation: 'perpendicular',
      segmentId: 'seg_0002',
      sourcePoint: { x: 10, y: 0 },
      tangent: { x: 1, y: 0 }
    });
    const movedSnap = createMeasurementPointPathSnapFromMagnetized(
      {
        distance: 2,
        endpointRole: null,
        mode: 'tangent',
        operationId: 'op_0001',
        pathElementId: 'contour_0001',
        point: { x: 12, y: 7 },
        relation: 'tangent',
        segmentId: 'seg_0003',
        segmentIndex: 2,
        sourcePoint: { x: 12, y: 2 },
        tangent: { x: 0, y: 1 },
        t: 0.25
      },
      { sourcePoint: snap.sourcePoint }
    );

    expect(movedSnap).toMatchObject({
      mode: 'tangent',
      segmentId: 'seg_0003',
      sourcePoint: { x: 10, y: 0 }
    });
  });
});
