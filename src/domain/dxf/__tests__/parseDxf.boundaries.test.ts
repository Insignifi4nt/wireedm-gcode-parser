import { describe, expect, it } from 'vitest';

import { parseDxf } from '../parseDxf';

function entitiesDxf(entity: string[]) {
  return ['0', 'SECTION', '2', 'ENTITIES', ...entity, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}

function arcWithExtrusionX(normalX: string) {
  return entitiesDxf([
    '0', 'ARC', '8', 'CUT',
    '10', '0', '20', '0', '40', '5', '50', '0', '51', '90',
    '210', normalX, '220', '0', '230', '1'
  ]);
}

function lineWithEndZ(endZ: string) {
  return entitiesDxf([
    '0', 'LINE', '8', 'CUT',
    '10', '1', '20', '2', '30', '0',
    '11', '3', '21', '4', '31', endZ
  ]);
}

describe('DXF extrusion normal tolerance', () => {
  it('imports an ARC whose extrusion normal leans 4e-13 off the Z axis', () => {
    const result = parseDxf(arcWithExtrusionX('0.0000000000004'));

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]).toMatchObject({ type: 'arc', radius: 5 });
    expect(result.warnings).toEqual([]);
  });

  it('skips an ARC whose extrusion normal leans 3e-12 off the Z axis as tilted', () => {
    const result = parseDxf(arcWithExtrusionX('0.000000000003'));

    expect(result.entities).toEqual([]);
    expect(result.warnings).toContain(
      'Skipped DXF ARC with tilted extrusion normal; only XY-planar geometry is supported.'
    );
  });
});

describe('DXF planar Z tolerance', () => {
  it('imports a WCS LINE whose endpoint elevations differ by 4e-10 mm', () => {
    const result = parseDxf(lineWithEndZ('0.0000000004'));

    expect(result.entities).toEqual([
      { type: 'line', handle: null, layer: 'CUT', start: { x: 1, y: 2 }, end: { x: 3, y: 4 } }
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('rejects a WCS LINE whose endpoint elevations differ by 3e-9 mm', () => {
    const result = parseDxf(lineWithEndZ('0.000000003'));

    expect(result.entities).toEqual([]);
    expect(result.warnings).toContain('Rejected malformed DXF LINE geometry.');
  });
});
