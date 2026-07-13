import { describe, expect, it } from 'vitest';

import { parseDxf } from '../parseDxf';
import type { DxfEntity, DxfPoint } from '../types';

describe('parseDxf', () => {
  it('parses LINE, ARC, and CIRCLE entities from the ENTITIES section', () => {
    const result = parseDxf(`
0
SECTION
2
ENTITIES
0
LINE
8
CUT
10
1
20
2
11
3
21
4
0
ARC
8
CUT
10
0
20
0
40
5
50
0
51
90
0
CIRCLE
8
HOLES
10
10
20
20
40
2.5
0
ENDSEC
0
EOF
`);

    expect(result.entities).toHaveLength(3);
    expect(result.entities[0]).toMatchObject({
      type: 'line',
      layer: 'CUT',
      start: { x: 1, y: 2 },
      end: { x: 3, y: 4 }
    });
    expect(result.entities[1]).toMatchObject({
      type: 'arc',
      layer: 'CUT',
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0,
      endAngle: 90,
      sweepRadians: Math.PI / 2,
      clockwise: false,
      start: { x: 5, y: 0 },
      end: { x: 0, y: 5 }
    });
    expect(result.entities[2]).toMatchObject({
      type: 'circle',
      layer: 'HOLES',
      center: { x: 10, y: 20 },
      radius: 2.5
    });
    expect(result.warnings).toEqual([]);
  });

  it.each([
    { startAngle: 45, endAngle: 45.00000000000001 },
    { startAngle: 90, endAngle: 90.00000000000001 },
    { startAngle: 180, endAngle: 180.00000000000003 }
  ])(
    'retains the raw directed native ARC sweep from $startAngle to $endAngle degrees',
    ({ startAngle, endAngle }) => {
      const result = parseDxf(nativeArcDxf(startAngle, endAngle));
      const arc = result.entities[0];
      expect(arc?.type).toBe('arc');
      if (!arc || arc.type !== 'arc') return;

      expect(arc.sweepRadians).toBe(((endAngle - startAngle) * Math.PI) / 180);
      expect(arc.clockwise).toBe(false);
    }
  );

  it('records equal native ARC angles as one full counterclockwise turn', () => {
    const result = parseDxf(nativeArcDxf(45, 45));
    const arc = result.entities[0];
    expect(arc?.type).toBe('arc');
    if (!arc || arc.type !== 'arc') return;

    expect(arc.sweepRadians).toBe(2 * Math.PI);
    expect(arc.clockwise).toBe(false);
  });

  it('expands LWPOLYLINE vertices with bulges and closed flags', () => {
    const result = parseDxf(`
0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
PROFILE
70
1
10
0
20
0
42
0
10
10
20
0
42
0.41421356237309503
10
10
20
10
0
ENDSEC
0
EOF
`);

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]).toMatchObject({
      type: 'lwpolyline',
      layer: 'PROFILE',
      closed: true,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 0.41421356237309503 },
        { x: 10, y: 10, bulge: 0 }
      ]
    });
  });

  it('records unsupported entity names as warnings instead of failing the whole import', () => {
    const result = parseDxf(`
0
SECTION
2
ENTITIES
0
SPLINE
8
CURVE
0
ENDSEC
0
EOF
`);

    expect(result.entities).toEqual([]);
    expect(result.unsupportedEntities).toEqual(['SPLINE']);
    expect(result.warnings).toEqual(['Unsupported DXF entity: SPLINE']);
  });

  it('ignores layout VIEWPORT metadata instead of warning about unsupported cut geometry', () => {
    const result = parseDxf(`
0
SECTION
2
ENTITIES
0
VIEWPORT
8
0
10
0
20
0
40
1000
0
LINE
8
CUT
10
0
20
0
11
10
21
0
0
ENDSEC
0
EOF
`);

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]).toMatchObject({ type: 'line' });
    expect(result.unsupportedEntities).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('preserves DXF entity handles on supported geometry', () => {
    const result = parseDxf(`
0
SECTION
2
ENTITIES
0
LINE
5
A1
8
CUT
10
0
20
0
11
10
21
0
0
LWPOLYLINE
5
B2
8
PROFILE
70
0
10
0
20
0
10
4
20
0
0
ENDSEC
0
EOF
`);

    expect(result.entities[0]).toMatchObject({
      type: 'line',
      handle: 'A1'
    });
    expect(result.entities[1]).toMatchObject({
      type: 'lwpolyline',
      handle: 'B2'
    });
  });

  it('preserves DXF INSUNITS drawing metadata without scaling geometry', () => {
    const result = parseDxf(`
0
SECTION
2
HEADER
9
$INSUNITS
70
4
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
10
0
20
0
11
10
21
0
0
ENDSEC
0
EOF
`);

    expect(result.units).toEqual({
      code: 4,
      label: 'millimeters',
      scaleToMillimeters: 1,
      source: 'dxf-insunits'
    });
    expect(result.entities[0]).toMatchObject({
      type: 'line',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 }
    });
  });

  it.each([
    {
      label: 'millimeters',
      declaration: '70\n4',
      expected: {
        status: 'recognized',
        units: {
          code: 4,
          label: 'millimeters',
          scaleToMillimeters: 1,
          source: 'dxf-insunits'
        }
      }
    },
    {
      label: 'inches',
      declaration: '70\n1',
      expected: {
        status: 'recognized',
        units: {
          code: 1,
          label: 'inches',
          scaleToMillimeters: 25.4,
          source: 'dxf-insunits'
        }
      }
    },
    {
      label: 'unitless',
      declaration: '70\n0',
      expected: {
        status: 'unitless',
        units: {
          code: 0,
          label: 'unitless',
          scaleToMillimeters: null,
          source: 'dxf-insunits'
        }
      }
    },
    {
      label: 'unknown positive code',
      declaration: '70\n99',
      expected: {
        status: 'unknown',
        units: {
          code: 99,
          label: 'unknown-99',
          scaleToMillimeters: null,
          source: 'dxf-insunits'
        }
      }
    }
  ])('retains $label INSUNITS declaration status', ({ declaration, expected }) => {
    expect(parseDxf(dxfWithInsunitsDeclaration(declaration)).unitDeclaration).toEqual(expected);
  });

  it('distinguishes a missing INSUNITS declaration from malformed declarations', () => {
    expect(parseDxf(dxfWithInsunitsDeclaration(null)).unitDeclaration).toEqual({
      status: 'missing'
    });
    expect(parseDxf(dxfWithInsunitsDeclaration('280\n1')).unitDeclaration).toEqual({
      status: 'malformed',
      rawValue: null
    });
  });

  it.each([
    ['nonnumeric', 'not-a-code'],
    ['noninteger', '4.5'],
    ['negative', '-1'],
    ['unsafe integer', '9007199254740992'],
    ['blank', '']
  ])('retains the raw group-70 value for a malformed $label INSUNITS declaration', (
    _label,
    rawValue
  ) => {
    expect(parseDxf(dxfWithInsunitsDeclaration(`70\n${rawValue}`)).unitDeclaration).toEqual({
      status: 'malformed',
      rawValue
    });
  });

  it('preserves DXF base point and drawing extents metadata without moving geometry', () => {
    const result = parseDxf(`
0
SECTION
2
HEADER
9
$INSBASE
10
1
20
2
30
0
9
$EXTMIN
10
-5
20
-6
30
0
9
$EXTMAX
10
15
20
16
30
0
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
10
3
20
4
11
13
21
4
0
ENDSEC
0
EOF
`);

    expect(result.drawing).toEqual({
      basePoint: { x: 1, y: 2 },
      extents: {
        min: { x: -5, y: -6 },
        max: { x: 15, y: 16 }
      }
    });
    expect(result.entities[0]).toMatchObject({
      type: 'line',
      start: { x: 3, y: 4 },
      end: { x: 13, y: 4 }
    });
  });

  it('expands geometry from BLOCK definitions referenced by INSERT entities', () => {
    const result = parseDxf(`
0
SECTION
2
BLOCKS
0
BLOCK
2
PROFILE
0
LINE
8
CUT
10
0
20
0
11
10
21
0
0
CIRCLE
8
HOLES
10
2
20
3
40
1
0
ENDBLK
0
ENDSEC
0
SECTION
2
ENTITIES
0
INSERT
8
CUT
2
PROFILE
10
100
20
200
41
2
42
2
50
90
0
ENDSEC
0
EOF
`);

    expect(result.entities).toHaveLength(2);
    expect(result.entities[0]).toMatchObject({
      type: 'line',
      layer: 'CUT',
      start: { x: 100, y: 200 },
      end: { x: 100, y: 220 }
    });
    expect(result.entities[1]).toMatchObject({
      type: 'circle',
      layer: 'HOLES',
      center: { x: 94, y: 204 },
      radius: 2
    });
    expect(result.unsupportedEntities).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('does not report unsupported geometry from unreferenced BLOCK definitions', () => {
    const result = parseDxf(`
0
SECTION
2
BLOCKS
0
BLOCK
2
UNUSED
0
SPLINE
8
CURVE
0
ENDBLK
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
10
0
20
0
11
5
21
0
0
ENDSEC
0
EOF
`);

    expect(result.entities).toHaveLength(1);
    expect(result.unsupportedEntities).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('preserves an explicit blank layer value without shifting later group-code pairs', () => {
    const result = parseDxf(blankLayerDxf());

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]).toMatchObject({
      type: 'line',
      layer: '',
      start: { x: 1, y: 2 },
      end: { x: 3, y: 4 }
    });
    expect(result.warnings).toEqual([]);
  });

  it('rejects a malformed LWPOLYLINE as a whole without emitting non-finite or partial geometry', () => {
    const result = parseDxf(malformedPolylineDxf());

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]).toMatchObject({
      type: 'line',
      start: { x: 20, y: 0 },
      end: { x: 25, y: 0 }
    });
    expect(
      result.entities
        .flatMap(entityPoints)
        .every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    ).toBe(true);
    expect(result.warnings).toContain('Rejected malformed DXF LWPOLYLINE geometry.');
  });

  it('subtracts a BLOCK base point before applying an INSERT transform and records it in provenance', () => {
    const result = parseDxf(blockBasePointDxf());
    const insertedLine = result.entities[0];

    expect(insertedLine).toMatchObject({
      type: 'line',
      start: { x: 100, y: 200 },
      end: { x: 105, y: 200 }
    });
    expect(insertedLine?.source?.insertChain[0].transform.blockBasePoint).toEqual({ x: 10, y: 20 });
  });

  it('rotates INSERT array spacing without scaling that spacing', () => {
    const result = parseDxf(rotatedScaledInsertArrayDxf());

    expect(result.entities).toHaveLength(2);
    expect(result.entities[0]).toMatchObject({
      type: 'line',
      start: { x: 100, y: 200 },
      end: { x: 100, y: 210 }
    });
    expect(result.entities[1]).toMatchObject({
      type: 'line',
      start: { x: 100, y: 210 },
      end: { x: 100, y: 220 }
    });
  });

  it('rotates an axis-aligned INSERT by 90 degrees without trigonometric residue', () => {
    const result = parseDxf(rotatedLineInsertDxf(90));
    const line = result.entities[0];

    expect(line).toMatchObject({
      type: 'line',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 }
    });
    expect(line?.type === 'line' && Object.is(line.end.x, -0)).toBe(false);
  });

  it.each([
    {
      label: 'huge positive',
      rotationDegrees: 1e20,
      expectedEnd: { x: 0.17364817766692997, y: -0.9848077530122081 },
      exact: false
    },
    {
      label: 'huge negative',
      rotationDegrees: -1e20,
      expectedEnd: { x: 0.17364817766693041, y: 0.984807753012208 },
      exact: false
    },
    {
      label: 'large positive quadrant multiple',
      rotationDegrees: 360_000_000_090,
      expectedEnd: { x: 0, y: 1 },
      exact: true
    },
    {
      label: 'large negative quadrant multiple',
      rotationDegrees: -360_000_000_090,
      expectedEnd: { x: 0, y: -1 },
      exact: true
    }
  ])(
    'reduces INSERT rotation for $label before trigonometry',
    ({ rotationDegrees, expectedEnd, exact }) => {
      const result = parseDxf(rotatedLineInsertDxf(rotationDegrees));
      const line = result.entities[0];

      expect(line?.type).toBe('line');
      if (!line || line.type !== 'line') return;

      if (exact) {
        expect(line.end).toEqual(expectedEnd);
      } else {
        expect(line.end.x).toBeCloseTo(expectedEnd.x, 14);
        expect(line.end.y).toBeCloseTo(expectedEnd.y, 14);
      }
    }
  );

  it.each([
    { label: 'positive', rotationDegrees: 1e-14, expectedY: 17453.292519943298 },
    { label: 'negative', rotationDegrees: -1e-14, expectedY: -17453.292519943298 }
  ])(
    'preserves a tiny $label INSERT rotation remainder on huge coordinates',
    ({ rotationDegrees, expectedY }) => {
      const result = parseDxf(rotatedLineInsertDxf(rotationDegrees, 1e20));
      const line = result.entities[0];

      expect(line?.type).toBe('line');
      if (!line || line.type !== 'line') return;

      expect(line.end.x).toBe(1e20);
      expect(line.end.y).toBeCloseTo(expectedY, 8);
    }
  );

  it.each([8, 16, 64])('rejects non-2D classic POLYLINE flag %i', (flag) => {
    const result = parseDxf(classicPolylineWithFlagDxf(flag));

    expect(result.entities).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes('POLYLINE') && warning.includes('non-2D'))).toBe(
      true
    );
  });

  it('rejects geometry on a tilted extrusion plane with an explicit warning', () => {
    const result = parseDxf(tiltedExtrusionArcDxf());

    expect(result.entities).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes('ARC') && warning.includes('tilted extrusion'))).toBe(
      true
    );
  });

  it('rejects a small-magnitude extrusion normal whose normalized direction is tilted', () => {
    const result = parseDxf(
      arcWithExtrusionNormalDxf({ x: 5e-13, y: 0, z: 2e-12 })
    );

    expect(result.entities).toEqual([]);
    expect(
      result.warnings.some(
        (warning) => warning.includes('ARC') && warning.includes('tilted extrusion')
      )
    ).toBe(true);
  });

  it.each([
    { label: 'positive Z', unitZ: 1, scaledZ: 1e-300 },
    { label: 'negative Z', unitZ: -1, scaledZ: -1e-300 }
  ])('treats a scaled $label extrusion normal like its unit direction', ({ unitZ, scaledZ }) => {
    const unit = parseDxf(arcWithExtrusionNormalDxf({ x: 0, y: 0, z: unitZ }));
    const scaled = parseDxf(
      arcWithExtrusionNormalDxf({ x: 0, y: 0, z: scaledZ })
    );

    expect(scaled).toEqual(unit);
  });

  it('rejects a degenerate zero-length extrusion normal', () => {
    const result = parseDxf(arcWithExtrusionNormalDxf({ x: 0, y: 0, z: 0 }));

    expect(result.entities).toEqual([]);
    expect(
      result.warnings.some(
        (warning) => warning.includes('ARC') && warning.includes('extrusion normal')
      )
    ).toBe(true);
  });

  it('normalizes negative-Z planar OCS coordinates and bulge handedness deterministically', () => {
    const result = parseDxf(negativeZPolylineDxf());

    expect(result.entities).toEqual([
      {
        type: 'lwpolyline',
        handle: null,
        layer: 'CUT',
        closed: false,
        vertices: [
          { x: -1, y: 2, bulge: -0.5 },
          { x: -3, y: 4, bulge: 0 }
        ]
      }
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('rejects an ARC when finite source values overflow its computed endpoints', () => {
    const result = parseDxf(overflowingArcDxf());

    expect(result.entities).toEqual([]);
    expect(
      result.warnings.some(
        (warning) => warning.includes('ARC') && warning.includes('malformed')
      )
    ).toBe(true);
  });

  it('skips INSERT geometry when point and radius scaling overflow', () => {
    const result = parseDxf(overflowingInsertDxf());

    expect(result.entities).toEqual([]);
    expect(
      result.warnings.some(
        (warning) => warning.includes('LINE') && warning.includes('non-finite')
      )
    ).toBe(true);
    expect(
      result.warnings.some(
        (warning) => warning.includes('CIRCLE') && warning.includes('non-finite')
      )
    ).toBe(true);
  });

  it.each([
    ['different', 1],
    ['non-finite', Number.POSITIVE_INFINITY]
  ])('rejects a WCS LINE with %s endpoint Z geometry', (_label, endZ) => {
    const result = parseDxf(wcsLineDxf({ startZ: 0, endZ }));

    expect(result.entities).toEqual([]);
    expect(result.warnings).toContain('Rejected malformed DXF LINE geometry.');
  });

  it('keeps WCS LINE XY coordinates unchanged for a constant plane and negative extrusion', () => {
    const result = parseDxf(
      wcsLineDxf({ startZ: 5, endZ: 5, normal: { x: 0, y: 0, z: -1 } })
    );

    expect(result.entities).toEqual([
      {
        type: 'line',
        handle: null,
        layer: 'CUT',
        start: { x: 1, y: 2 },
        end: { x: 3, y: 4 }
      }
    ]);
  });

  it('requires the DXF planar flag for WCS SPLINE geometry', () => {
    const result = parseDxf(wcsSplineDxf({ flags: 0 }));

    expect(result.entities).toEqual([]);
    expect(result.unsupportedEntities).toEqual(['SPLINE']);
  });

  it.each([
    ['different', [0, 1, 0] as [number, number, number]],
    ['non-finite', [0, Number.POSITIVE_INFINITY, 0] as [number, number, number]]
  ])('rejects WCS SPLINE control points with %s Z geometry', (_label, controlPointZ) => {
    const result = parseDxf(wcsSplineDxf({ controlPointZ }));

    expect(result.entities).toEqual([]);
    expect(result.unsupportedEntities).toEqual(['SPLINE']);
  });

  it('rejects a WCS SPLINE with a tilted planar normal', () => {
    const result = parseDxf(
      wcsSplineDxf({ normal: { x: 0.5, y: 0, z: 0.866025403784 } })
    );

    expect(result.entities).toEqual([]);
    expect(
      result.warnings.some(
        (warning) => warning.includes('SPLINE') && warning.includes('tilted extrusion')
      )
    ).toBe(true);
  });

  it('keeps WCS SPLINE XY coordinates unchanged for a negative planar normal', () => {
    const result = parseDxf(wcsSplineDxf({ normal: { x: 0, y: 0, z: -1 } }));

    expect(result.entities.length).toBeGreaterThan(1);
    expect(result.entities[0]).toMatchObject({ start: { x: 1, y: 0 } });
    expect(result.entities.at(-1)).toMatchObject({ end: { x: 3, y: 0 } });
  });

  it('continues to reflect negative-Z OCS ARC coordinates and handedness', () => {
    const result = parseDxf(negativeZArcDxf());

    expect(result.entities).toEqual([
      {
        type: 'arc',
        handle: null,
        layer: 'CUT',
        center: { x: -2, y: 3 },
        radius: 1,
        startAngle: 180,
        endAngle: 90,
        sweepRadians: -Math.PI / 2,
        clockwise: true,
        start: { x: -3, y: 3 },
        end: { x: -2, y: 4 }
      }
    ]);
  });

  it.each([
    { label: 'ordinary', scaleX: 1, expectedSign: 1 },
    { label: 'reflected', scaleX: -1, expectedSign: -1 }
  ])(
    'preserves a tiny native ARC sweep through a $label uniform INSERT',
    ({ scaleX, expectedSign }) => {
      const startAngle = 45;
      const endAngle = 45.00000000000001;
      const result = parseDxf(insertedNativeArcDxf(startAngle, endAngle, scaleX));
      const arc = result.entities[0];
      expect(arc?.type).toBe('arc');
      if (!arc || arc.type !== 'arc') return;

      expect(arc.sweepRadians).toBe(
        expectedSign * (((endAngle - startAngle) * Math.PI) / 180)
      );
      expect(arc.clockwise).toBe(expectedSign < 0);
    }
  );

  it.each([
    { label: 'tiny unequal', scaleX: 1e-10, scaleY: 9e-10, uniform: false },
    { label: 'huge unequal', scaleX: 1e10, scaleY: 9e10, uniform: false },
    { label: 'reflected equal', scaleX: -2, scaleY: 2, uniform: true },
    { label: 'ordinary equal', scaleX: 2, scaleY: 2, uniform: true }
  ])(
    'classifies $label INSERT scales exactly for circle and bulge geometry',
    ({ scaleX, scaleY, uniform }) => {
      const result = parseDxf(scaledCircleAndBulgeDxf(scaleX, scaleY));

      if (!uniform) {
        expect(result.entities).toEqual([]);
        expect(
          result.warnings.some(
            (warning) => warning.includes('CIRCLE') && warning.includes('non-uniform')
          )
        ).toBe(true);
        expect(
          result.warnings.some(
            (warning) => warning.includes('LWPOLYLINE') && warning.includes('non-uniform')
          )
        ).toBe(true);
        return;
      }

      expect(result.entities).toHaveLength(2);
      expect(result.entities[0]).toMatchObject({
        type: 'circle',
        radius: 1e11 * Math.abs(scaleX)
      });
      expect(result.entities[1]).toMatchObject({
        type: 'lwpolyline',
        vertices: [
          { x: 0, y: 0, bulge: scaleX * scaleY < 0 ? -1 : 1 },
          { x: scaleX, y: 0, bulge: 0 }
        ]
      });
    }
  );

  it.each(['LWPOLYLINE', 'POLYLINE'] as const)(
    'rejects every nonzero bulge on a non-uniform INSERT for %s',
    (entityType) => {
      const result = parseDxf(nonUniformTinyBulgeInsertDxf(entityType));

      expect(result.entities).toEqual([]);
      expect(
        result.warnings.some(
          (warning) => warning.includes(entityType) && warning.includes('non-uniform')
        )
      ).toBe(true);
    }
  );
});

function dxfWithInsunitsDeclaration(declaration: string | null) {
  return `
0
SECTION
2
HEADER
${declaration === null ? '' : `9\n$INSUNITS\n${declaration}`}
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
10
0
20
0
11
10
21
0
0
ENDSEC
0
EOF
`;
}

function blankLayerDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'LINE',
    '8',
    '',
    '10',
    '1',
    '20',
    '2',
    '11',
    '3',
    '21',
    '4',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function malformedPolylineDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'LWPOLYLINE',
    '8',
    'CUT',
    '10',
    '0',
    '20',
    '0',
    '10',
    'not-a-number',
    '20',
    '10',
    '10',
    '10',
    '20',
    '10',
    '0',
    'LINE',
    '8',
    'CUT',
    '10',
    '20',
    '20',
    '0',
    '11',
    '25',
    '21',
    '0',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function blockBasePointDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'BLOCKS',
    '0',
    'BLOCK',
    '2',
    'PROFILE',
    '10',
    '10',
    '20',
    '20',
    '0',
    'LINE',
    '8',
    'CUT',
    '10',
    '10',
    '20',
    '20',
    '11',
    '15',
    '21',
    '20',
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
    '2',
    'PROFILE',
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

function rotatedScaledInsertArrayDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'BLOCKS',
    '0',
    'BLOCK',
    '2',
    'ARRAY_ITEM',
    '10',
    '10',
    '20',
    '20',
    '0',
    'LINE',
    '10',
    '10',
    '20',
    '20',
    '11',
    '15',
    '21',
    '20',
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
    '2',
    'ARRAY_ITEM',
    '10',
    '100',
    '20',
    '200',
    '41',
    '2',
    '42',
    '2',
    '50',
    '90',
    '70',
    '2',
    '44',
    '10',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function rotatedLineInsertDxf(rotationDegrees: number, lineLength = 1) {
  return [
    '0',
    'SECTION',
    '2',
    'BLOCKS',
    '0',
    'BLOCK',
    '2',
    'AXIS_LINE',
    '10',
    '0',
    '20',
    '0',
    '0',
    'LINE',
    '10',
    '0',
    '20',
    '0',
    '11',
    String(lineLength),
    '21',
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
    '2',
    'AXIS_LINE',
    '10',
    '0',
    '20',
    '0',
    '50',
    String(rotationDegrees),
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function classicPolylineWithFlagDxf(flag: number) {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'POLYLINE',
    '8',
    'CUT',
    '70',
    String(flag),
    '0',
    'VERTEX',
    '10',
    '0',
    '20',
    '0',
    '0',
    'VERTEX',
    '10',
    '1',
    '20',
    '0',
    '0',
    'SEQEND',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function tiltedExtrusionArcDxf() {
  return arcWithExtrusionNormalDxf({ x: 0.5, y: 0, z: 0.866025403784 });
}

function arcWithExtrusionNormalDxf(normal: { x: number; y: number; z: number }) {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'ARC',
    '8',
    'CUT',
    '10',
    '0',
    '20',
    '0',
    '40',
    '5',
    '50',
    '0',
    '51',
    '90',
    '210',
    String(normal.x),
    '220',
    String(normal.y),
    '230',
    String(normal.z),
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function negativeZPolylineDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'LWPOLYLINE',
    '8',
    'CUT',
    '10',
    '1',
    '20',
    '2',
    '42',
    '0.5',
    '10',
    '3',
    '20',
    '4',
    '210',
    '0',
    '220',
    '0',
    '230',
    '-1',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function overflowingArcDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'ARC',
    '8',
    'CUT',
    '10',
    '1e308',
    '20',
    '0',
    '40',
    '1e308',
    '50',
    '0',
    '51',
    '90',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function overflowingInsertDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'BLOCKS',
    '0',
    'BLOCK',
    '2',
    'OVERFLOW',
    '10',
    '0',
    '20',
    '0',
    '0',
    'LINE',
    '8',
    'CUT',
    '10',
    '0',
    '20',
    '0',
    '11',
    '9e307',
    '21',
    '0',
    '0',
    'CIRCLE',
    '8',
    'CUT',
    '10',
    '0',
    '20',
    '0',
    '40',
    '1e308',
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
    '2',
    'OVERFLOW',
    '10',
    '0',
    '20',
    '0',
    '41',
    '2',
    '42',
    '2',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function wcsLineDxf(options: {
  startZ: number;
  endZ: number;
  normal?: { x: number; y: number; z: number };
}) {
  const normal = options.normal ?? { x: 0, y: 0, z: 1 };
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
    '1',
    '20',
    '2',
    '30',
    String(options.startZ),
    '11',
    '3',
    '21',
    '4',
    '31',
    String(options.endZ),
    '210',
    String(normal.x),
    '220',
    String(normal.y),
    '230',
    String(normal.z),
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function wcsSplineDxf(options: {
  flags?: number;
  controlPointZ?: [number, number, number];
  normal?: { x: number; y: number; z: number };
} = {}) {
  const normal = options.normal ?? { x: 0, y: 0, z: 1 };
  const controlPointZ = options.controlPointZ ?? [0, 0, 0];
  const controlPoints = [
    [1, 0, controlPointZ[0]],
    [2, 1, controlPointZ[1]],
    [3, 0, controlPointZ[2]]
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
    '70',
    String(options.flags ?? 8),
    '71',
    '2',
    '72',
    '6',
    '73',
    '3',
    '74',
    '0',
    ...[0, 0, 0, 1, 1, 1].flatMap((knot) => ['40', String(knot)]),
    ...controlPoints.flatMap(([x, y, z]) => [
      '10',
      String(x),
      '20',
      String(y),
      '30',
      String(z)
    ]),
    '210',
    String(normal.x),
    '220',
    String(normal.y),
    '230',
    String(normal.z),
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function nativeArcDxf(startAngle: number, endAngle: number, radius = 1e20) {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'ARC',
    '8',
    'CUT',
    '10',
    '0',
    '20',
    '0',
    '40',
    String(radius),
    '50',
    String(startAngle),
    '51',
    String(endAngle),
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function insertedNativeArcDxf(startAngle: number, endAngle: number, scaleX: number) {
  return [
    '0',
    'SECTION',
    '2',
    'BLOCKS',
    '0',
    'BLOCK',
    '2',
    'ARC_BLOCK',
    '10',
    '0',
    '20',
    '0',
    '0',
    'ARC',
    '8',
    'CUT',
    '10',
    '0',
    '20',
    '0',
    '40',
    '1e20',
    '50',
    String(startAngle),
    '51',
    String(endAngle),
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
    '2',
    'ARC_BLOCK',
    '10',
    '0',
    '20',
    '0',
    '41',
    String(scaleX),
    '42',
    '1',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function negativeZArcDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'ARC',
    '8',
    'CUT',
    '10',
    '2',
    '20',
    '3',
    '40',
    '1',
    '50',
    '0',
    '51',
    '90',
    '210',
    '0',
    '220',
    '0',
    '230',
    '-1',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function scaledCircleAndBulgeDxf(scaleX: number, scaleY: number) {
  return [
    '0',
    'SECTION',
    '2',
    'BLOCKS',
    '0',
    'BLOCK',
    '2',
    'SCALED',
    '10',
    '0',
    '20',
    '0',
    '0',
    'CIRCLE',
    '8',
    'CUT',
    '10',
    '0',
    '20',
    '0',
    '40',
    '1e11',
    '0',
    'LWPOLYLINE',
    '8',
    'CUT',
    '70',
    '0',
    '10',
    '0',
    '20',
    '0',
    '42',
    '1',
    '10',
    '1',
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
    '2',
    'SCALED',
    '10',
    '0',
    '20',
    '0',
    '41',
    String(scaleX),
    '42',
    String(scaleY),
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function nonUniformTinyBulgeInsertDxf(entityType: 'LWPOLYLINE' | 'POLYLINE') {
  const polylinePairs =
    entityType === 'LWPOLYLINE'
      ? [
          '0',
          'LWPOLYLINE',
          '8',
          'CUT',
          '70',
          '0',
          '10',
          '0',
          '20',
          '0',
          '42',
          '1e-13',
          '10',
          '5e15',
          '20',
          '0'
        ]
      : [
          '0',
          'POLYLINE',
          '8',
          'CUT',
          '66',
          '1',
          '70',
          '0',
          '0',
          'VERTEX',
          '8',
          'CUT',
          '10',
          '0',
          '20',
          '0',
          '42',
          '1e-13',
          '0',
          'VERTEX',
          '8',
          'CUT',
          '10',
          '5e15',
          '20',
          '0',
          '0',
          'SEQEND'
        ];

  return [
    '0',
    'SECTION',
    '2',
    'BLOCKS',
    '0',
    'BLOCK',
    '2',
    'TINY_BULGE',
    '10',
    '0',
    '20',
    '0',
    ...polylinePairs,
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
    '2',
    'TINY_BULGE',
    '10',
    '0',
    '20',
    '0',
    '41',
    '2',
    '42',
    '3',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function entityPoints(entity: DxfEntity): DxfPoint[] {
  if (entity.type === 'line') return [entity.start, entity.end];
  if (entity.type === 'arc') return [entity.center, entity.start, entity.end];
  if (entity.type === 'circle') return [entity.center];
  return entity.vertices;
}
