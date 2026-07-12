import { describe, expect, it } from 'vitest';

import { dxfEntitiesToUpidDocument } from '../dxfToUpid';
import { parseDxf } from '../parseDxf';

describe('parseDxf spline fallback', () => {
  it('flattens spline-only DXF geometry into line entities instead of rejecting the file', () => {
    const result = parseDxf(splineOnlyDxf());

    expect(result.entities.length).toBeGreaterThan(12);
    expect(result.entities.every((entity) => entity.type === 'line')).toBe(true);
    expect(result.entities.every((entity) => entity.layer === 'CUT')).toBe(true);
    expect(result.entities.every((entity) => entity.handle === 'S1')).toBe(true);
    expect(
      result.entities.every(
        (entity) =>
          entity.type === 'line' &&
          entity.approximation?.sourceEntityType === 'SPLINE' &&
          entity.approximation.maxChordError === 0.001
      )
    ).toBe(true);
    expect(result.warnings).toContain('Flattened DXF SPLINE geometry into line segments.');
    expect(result.unsupportedEntities).toEqual([]);
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
    expect(result.entities.slice(1).every((entity) => entity.layer === 'CURVE')).toBe(true);
    expect(result.warnings).not.toContain('Unsupported DXF entity: SPLINE');
    expect(result.warnings).toContain('Flattened DXF SPLINE geometry into line segments.');
    expect(result.unsupportedEntities).toEqual([]);
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

  it('subdivides SPLINE knot spans adaptively to the requested source-unit chord error', () => {
    const loose = parseDxf(quadraticSplineDxf(), { curveChordError: 0.25 });
    const tight = parseDxf(quadraticSplineDxf(), { curveChordError: 0.01 });

    expect(loose.entities.length).toBeGreaterThan(1);
    expect(tight.entities.length).toBeGreaterThan(loose.entities.length);
    expect(
      loose.entities.every(
        (entity) => entity.type === 'line' && entity.approximation?.maxChordError === 0.25
      )
    ).toBe(true);
    expect(
      tight.entities.every(
        (entity) => entity.type === 'line' && entity.approximation?.maxChordError === 0.01
      )
    ).toBe(true);
  });

  it('evaluates optional rational SPLINE weights instead of treating the curve as non-rational', () => {
    const result = parseDxf(weightedSplineDxf(), { curveChordError: 0.01 });
    const points = result.entities.flatMap((entity) =>
      entity.type === 'line' ? [entity.start, entity.end] : []
    );

    expect(result.entities.length).toBeGreaterThan(1);
    expect(Math.max(...points.map((point) => point.y))).toBeGreaterThan(1.7);
    expect(result.unsupportedEntities).toEqual([]);
  });

  it('approximates a nested BLOCK SPLINE before INSERT expansion and retains full lineage', () => {
    const result = parseDxf(nestedBlockSplineDxf(), { curveChordError: 0.05 });

    expect(result.entities.length).toBeGreaterThan(1);
    expect(result.entities.every((entity) => entity.layer === 'CUT')).toBe(true);
    expect(
      result.entities.every(
        (entity) => entity.type === 'line' && entity.approximation?.sourceEntityType === 'SPLINE'
      )
    ).toBe(true);
    expect(result.entities[0]).toMatchObject({ start: { x: 100, y: 200 } });
    expect(result.entities.at(-1)).toMatchObject({ end: { x: 105, y: 200 } });
    expect(
      result.entities.every(
        (entity) =>
          entity.source?.blockName === 'CURVE' &&
          entity.source.insertChain.map((insert) => insert.blockName).join('/') === 'OUTER/CURVE'
      )
    ).toBe(true);
    expect(result.entities[0]?.source?.insertChain[1].transform.blockBasePoint).toEqual({ x: 10, y: 20 });

    const document = dxfEntitiesToUpidDocument(result.entities);
    expect(document.segments).toHaveLength(result.entities.length);
    expect(document.segments.every((segment) => segment.source.exact === false)).toBe(true);
    expect(document.segments.every((segment) => segment.source.sourceEntityType === 'SPLINE')).toBe(true);
    expect(
      document.segments.every(
        (segment) => segment.source.dxf?.insertChain.map((insert) => insert.blockName).join('/') === 'OUTER/CURVE'
      )
    ).toBe(true);
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
    '5',
    'S1',
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

function quadraticSplineDxf() {
  return splineDocument([
    '0',
    'SPLINE',
    '8',
    'CUT',
    '70',
    '8',
    '71',
    '2',
    '72',
    '6',
    '73',
    '3',
    '74',
    '0',
    '40',
    '0',
    '40',
    '0',
    '40',
    '0',
    '40',
    '1',
    '40',
    '1',
    '40',
    '1',
    '10',
    '0',
    '20',
    '0',
    '10',
    '1',
    '20',
    '2',
    '10',
    '2',
    '20',
    '0'
  ]);
}

function weightedSplineDxf() {
  return splineDocument([
    '0',
    'SPLINE',
    '8',
    'CUT',
    '70',
    '12',
    '71',
    '2',
    '72',
    '6',
    '73',
    '3',
    '74',
    '0',
    '40',
    '0',
    '40',
    '0',
    '40',
    '0',
    '40',
    '1',
    '40',
    '1',
    '40',
    '1',
    '41',
    '1',
    '41',
    '10',
    '41',
    '1',
    '10',
    '0',
    '20',
    '0',
    '10',
    '1',
    '20',
    '2',
    '10',
    '2',
    '20',
    '0'
  ]);
}

function splineDocument(entityPairs: string[]) {
  return ['0', 'SECTION', '2', 'ENTITIES', ...entityPairs, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}

function nestedBlockSplineDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'BLOCKS',
    '0',
    'BLOCK',
    '2',
    'CURVE',
    '10',
    '10',
    '20',
    '20',
    '0',
    'SPLINE',
    '5',
    'C1',
    '8',
    '0',
    '70',
    '8',
    '71',
    '2',
    '72',
    '6',
    '73',
    '3',
    '74',
    '0',
    '40',
    '0',
    '40',
    '0',
    '40',
    '0',
    '40',
    '1',
    '40',
    '1',
    '40',
    '1',
    '10',
    '10',
    '20',
    '20',
    '10',
    '12.5',
    '20',
    '25',
    '10',
    '15',
    '20',
    '20',
    '0',
    'ENDBLK',
    '0',
    'BLOCK',
    '2',
    'OUTER',
    '10',
    '0',
    '20',
    '0',
    '0',
    'INSERT',
    '8',
    '0',
    '2',
    'CURVE',
    '10',
    '0',
    '20',
    '0',
    '0',
    'ENDBLK',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'INSERT',
    '8',
    'CUT',
    '2',
    'OUTER',
    '10',
    '100',
    '20',
    '200',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}
