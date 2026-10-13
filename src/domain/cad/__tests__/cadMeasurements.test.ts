import { describe, expect, it } from 'vitest';
import type { CadSketchFeature, CadSketchProfile } from '../cadDocument';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { measureCadSketch } from '../cadMeasurements';

function measured(profiles: readonly CadSketchProfile[], parameters: Readonly<Record<string, number>> = {}, plane: CadSketchFeature['plane'] = 'XY') {
  return measureCadSketch(parseCadDocument({ ...createCadDocument('Part', 'cad_measure'), parameters,
    features: [{ id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, offset: 20, plane, profiles }]
  }), 'sketch');
}
const profile = (id: string, geometry: CadSketchProfile['geometry'], role: CadSketchProfile['role'] = 'outer', construction = false): CadSketchProfile => ({ id, name: id, role, construction, geometry });

describe('analytic CAD sketch measurements', () => {
  it('measures a parameterized rounded rectangle without tessellation', () => {
    const result = measured([profile('rounded', { kind: 'rectangle', x: 2, y: 3, width: 'w', height: 'h', cornerRadius: 2 })], { w: 20, h: 10 });
    expect(result.materialAreaMm2).toBeCloseTo(200 - (4 - Math.PI) * 4, 12);
    expect(result.boundaryLengthMm).toBeCloseTo(60 - 16 + 4 * Math.PI, 12);
    expect(result.boundsMm).toEqual({ minX: 2, minY: 3, maxX: 22, maxY: 13 });
    expect(result.profiles[0].kind).toBe('rectangle'); expect(result.cutContourCount).toBe(1);
  });
  it('measures rotated slots with exact circular support bounds and perimeter', () => {
    const result = measured([profile('slot', { kind: 'slot', x: 10, y: 20, length: 20, width: 6, angle: 30 })]);
    const extentX = 7 * Math.cos(Math.PI / 6) + 3; const extentY = 6.5;
    expect(result.materialAreaMm2).toBeCloseTo(84 + 9 * Math.PI, 12);
    expect(result.boundaryLengthMm).toBeCloseTo(28 + 6 * Math.PI, 12);
    expect(result.boundsMm?.minX).toBeCloseTo(10 - extentX, 12); expect(result.boundsMm?.maxY).toBeCloseTo(20 + extentY, 12);
  });
  it('accounts for nested holes and islands and excludes construction from all cut totals', () => {
    const result = measured([
      profile('outer', { kind: 'circle', x: 0, y: 0, radius: 20 }),
      profile('hole', { kind: 'circle', x: 0, y: 0, radius: 10 }, 'hole'),
      profile('island', { kind: 'circle', x: 0, y: 0, radius: 2 }),
      profile('reference', { kind: 'circle', x: 0, y: 0, radius: 30 }, 'outer', true)
    ], {}, 'YZ');
    expect(result.materialAreaMm2).toBeCloseTo(304 * Math.PI, 12);
    expect(result.boundaryLengthMm).toBeCloseTo(64 * Math.PI, 12);
    expect(result.cutContourCount).toBe(3); expect(result.profiles).toHaveLength(4);
    expect(result.boundsMm).toEqual({ minX: -20, minY: -20, maxX: 20, maxY: 20 });
    expect(result).toMatchObject({ coordinateSystem: 'sketch-local', offsetMm: 20, plane: 'YZ' });
  });
  it('measures either polygon orientation at a large coordinate offset without cancellation', () => {
    const points: readonly (readonly [number, number])[] = [[999999900, 999999900], [999999903, 999999900], [999999903, 999999904]];
    for (const ordered of [points, [...points].reverse()]) {
      const result = measured([profile('triangle', { kind: 'polygon', points: ordered })]);
      expect(result.materialAreaMm2).toBe(6); expect(result.boundaryLengthMm).toBe(12);
      expect(result.boundsMm).toEqual({ minX: 999999900, minY: 999999900, maxX: 999999903, maxY: 999999904 });
    }
  });
  it('returns null cut bounds for empty or construction-only sketches and rejects missing references', () => {
    expect(measured([])).toMatchObject({ materialAreaMm2: 0, boundaryLengthMm: 0, cutContourCount: 0, boundsMm: null });
    expect(measured([profile('reference', { kind: 'circle', x: 0, y: 0, radius: 1 }, 'outer', true)])).toMatchObject({ materialAreaMm2: 0, boundaryLengthMm: 0, boundsMm: null });
    expect(() => measureCadSketch(createCadDocument(), 'missing')).toThrow('existing sketch');
  });
});
