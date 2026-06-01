import { describe, expect, it } from 'vitest';

import { parseDxf } from '../parseDxf';

describe('parseDxf spline fallback', () => {
  it('flattens spline-only DXF geometry into line entities instead of rejecting the file', () => {
    const result = parseDxf(splineOnlyDxf());

    expect(result.entities.length).toBeGreaterThan(12);
    expect(result.entities.every((entity) => entity.type === 'line')).toBe(true);
    expect(result.warnings).toContain('Flattened DXF SPLINE geometry into line segments.');
    expect(result.unsupportedEntities).toEqual(['SPLINE']);
  });

  it('keeps exact supported entities and also flattens unsupported curves in mixed DXFs', () => {
    const result = parseDxf(mixedLineAndSplineDxf());

    expect(result.entities[0]).toMatchObject({
      type: 'line',
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 }
    });
    expect(result.entities.length).toBeGreaterThan(12);
    expect(result.entities.every((entity) => entity.type === 'line')).toBe(true);
    expect(result.warnings).toContain('Unsupported DXF entity: SPLINE');
    expect(result.warnings).toContain('Flattened DXF SPLINE geometry into line segments.');
    expect(result.unsupportedEntities).toEqual(['SPLINE']);
  });

  it('parses classic POLYLINE geometry exactly without reporting child VERTEX records as unsupported', () => {
    const result = parseDxf(classicPolylineDxf());

    expect(result.entities).toEqual([
      {
        type: 'polyline',
        layer: 'CUT',
        handle: null,
        closed: true,
        vertices: [
          { x: 0, y: 0, bulge: 0.41421356237309503 },
          { x: 10, y: 0, bulge: 0 },
          { x: 10, y: 5, bulge: 0 }
        ]
      }
    ]);
    expect(result.unsupportedEntities).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

function splineOnlyDxf() {
  const knots = [
    0, 0, 0, 0,
    0.3333333333, 0.3333333333,
    0.6666666667, 0.6666666667,
    1, 1, 1, 1
  ];
  const points = [
    [0, 0],
    [2, 0],
    [3, 1],
    [3, 3],
    [1, 4],
    [-1, 3],
    [-1, 1],
    [0, 0]
  ];

  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'SPLINE',
    '8',
    'CUT',
    '100',
    'AcDbSpline',
    '70',
    '11',
    '71',
    '3',
    '72',
    String(knots.length),
    '73',
    String(points.length),
    '74',
    '0',
    '42',
    '0.000000001',
    '43',
    '0.0000000001',
    ...knots.flatMap((knot) => ['40', String(knot)]),
    ...points.flatMap(([x, y]) => ['10', String(x), '20', String(y), '30', '0']),
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function mixedLineAndSplineDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'LINE',
    '8',
    'CUT',
    '10',
    '0',
    '20',
    '0',
    '11',
    '1',
    '21',
    '0',
    ...splineEntityPairs(),
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function splineEntityPairs() {
  const knots = [0, 0, 0, 1, 1, 1];
  const points = [
    [1, 0],
    [2, 1],
    [3, 0]
  ];

  return [
    '0',
    'SPLINE',
    '8',
    'CURVE',
    '100',
    'AcDbSpline',
    '70',
    '8',
    '71',
    '2',
    '72',
    String(knots.length),
    '73',
    String(points.length),
    '74',
    '0',
    ...knots.flatMap((knot) => ['40', String(knot)]),
    ...points.flatMap(([x, y]) => ['10', String(x), '20', String(y), '30', '0'])
  ];
}

function classicPolylineDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'POLYLINE',
    '8',
    'CUT',
    '66',
    '1',
    '70',
    '1',
    '0',
    'VERTEX',
    '8',
    'CUT',
    '10',
    '0',
    '20',
    '0',
    '30',
    '0',
    '42',
    '0.41421356237309503',
    '0',
    'VERTEX',
    '8',
    'CUT',
    '10',
    '10',
    '20',
    '0',
    '30',
    '0',
    '0',
    'VERTEX',
    '8',
    'CUT',
    '10',
    '10',
    '20',
    '5',
    '30',
    '0',
    '0',
    'SEQEND',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}
