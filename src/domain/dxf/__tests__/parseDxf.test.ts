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
});
