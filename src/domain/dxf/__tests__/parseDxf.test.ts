import { describe, expect, it } from 'vitest';

import { parseDxf } from '../parseDxf';

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
});
