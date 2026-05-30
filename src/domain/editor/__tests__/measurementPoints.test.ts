import { describe, expect, it } from 'vitest';

import {
  exportMeasurementPointsAsCsv,
  exportMeasurementPointsAsGCode,
  exportMeasurementPointsAsISO,
  insertMeasurementPointsIntoText
} from '../measurementPoints';

describe('measurementPoints', () => {
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

  it('exports points as CSV and G-code using legacy precision', () => {
    expect(exportMeasurementPointsAsCsv(points)).toBe(
      ['Point,X,Y', 'P1,1.000,2.000', 'P2,-3.457,4.200'].join('\n')
    );

    expect(exportMeasurementPointsAsGCode(points, { includeHeader: true })).toContain(
      '; Total points: 2'
    );
    expect(exportMeasurementPointsAsGCode(points, { includeHeader: false })).toBe(
      ['; Point 1', 'G0 X1.000 Y2.000', '; Point 2', 'G0 X-3.457 Y4.200', ''].join(
        '\n'
      )
    );
  });

  it('exports points as an ISO point program using the old point-export structure', () => {
    const program = exportMeasurementPointsAsISO(points);

    expect(program).toContain('%\r\nN10 G92\r\nN20 G60\r\nN30 G38\r\n');
    expect(program).toContain('N60 G0 X1.000 Y2.000');
    expect(program).toContain('N70 G1 X-3.457 Y4.200');
    expect(program).not.toContain('F1000');
    expect(program.endsWith('N80 M02\r\n')).toBe(true);
  });

  it('only adds an ISO feed word for point exports when explicitly requested', () => {
    expect(exportMeasurementPointsAsISO(points, { feed: 850 })).toContain(
      'N70 G1 X-3.457 Y4.200 F850'
    );
  });
});
