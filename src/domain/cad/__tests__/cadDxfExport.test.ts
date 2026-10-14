import { describe, expect, it } from 'vitest';
import { parseDxf } from '@/domain/dxf/parseDxf';
import type { DxfEntity } from '@/domain/dxf/types';
import { cadEntitiesToDxf } from '../cadDxfExport';

describe('exact analytic CAD DXF serialization', () => {
  it('preserves millimetres, lines, circles and clockwise circular arc support independently of a CAM document', () => {
    const entities: DxfEntity[] = [
      { type: 'line', layer: 'CAD', start: { x: -2.125, y: 4 }, end: { x: 9, y: 3.125 } },
      { type: 'circle', layer: 'CAD', center: { x: 1, y: 2 }, radius: 3.75 },
      { type: 'arc', layer: 'CAD', center: { x: 0, y: 0 }, radius: 5, startAngle: Math.PI, endAngle: Math.PI / 2,
        start: { x: -5, y: 0 }, end: { x: 0, y: 5 }, clockwise: true, sweepRadians: -Math.PI / 2 }
    ];
    const before = JSON.stringify(entities), parsed = parseDxf(cadEntitiesToDxf(entities, ['Approximate generated flank\nretains its declared tolerance.']));
    expect(parsed.units?.code).toBe(4);
    expect(parsed.entities).toHaveLength(3);
    expect(parsed.entities[0]).toMatchObject(entities[0]);
    expect(parsed.entities[1]).toMatchObject(entities[1]);
    expect(parsed.entities[2]).toMatchObject({ type: 'arc', center: { x: 0, y: 0 }, radius: 5, startAngle: 90, endAngle: 180 });
    expect(JSON.stringify(entities)).toBe(before);
  });
  it('rejects non-finite and unsupported data rather than dropping or approximating it', () => {
    expect(() => cadEntitiesToDxf([])).toThrow(/at least one/);
    expect(() => cadEntitiesToDxf([{ type: 'circle', layer: 'CAD', center: { x: Infinity, y: 0 }, radius: 1 }])).toThrow(/finite/);
    expect(() => cadEntitiesToDxf([{ type: 'circle', layer: 'CAD', center: { x: 0, y: 0 }, radius: 0 }])).toThrow(/positive/);
    expect(() => cadEntitiesToDxf([{ type: 'lwpolyline', layer: 'CAD', closed: true, vertices: [] }])).toThrow(/analytic/);
  });
});
