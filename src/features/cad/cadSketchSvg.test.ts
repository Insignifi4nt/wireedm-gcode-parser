// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { DxfArcEntity } from '@/domain/dxf/types';
import { cadArcSvgPath, cadClosedBoundarySvgPath } from './cadSketchSvg';

const arc: DxfArcEntity = { type: 'arc', layer: 'CAD', center: { x: 0, y: 0 }, radius: 10, startAngle: 0, endAngle: Math.PI / 2, clockwise: false,
  sweepRadians: Math.PI / 2, start: { x: 10, y: 0 }, end: { x: 0, y: 10 } };

describe('analytic CAD sketch SVG arcs', () => {
  it('joins a closed boundary without resampling its lines or concave arcs', () => {
    expect(cadClosedBoundarySvgPath([
      { ...arc, clockwise: true, sweepRadians: -Math.PI * 1.5 },
      { type: 'line', layer: 'CAD', start: arc.end, end: arc.start },
    ])).toBe('M 10 0 A 10 10 0 1 0 0 10 L 10 0 Z');
  });
  it('preserves clockwise concave arcs and the large-arc choice rather than sampling them into lines', () => {
    expect(cadArcSvgPath(arc)).toBe('M 10 0 A 10 10 0 0 1 0 10');
    expect(cadArcSvgPath({ ...arc, clockwise: true, sweepRadians: -Math.PI * 1.5 })).toBe('M 10 0 A 10 10 0 1 0 0 10');
  });
  it('draws full turns as two analytic arcs and keeps wrapped angle sweeps short', () => {
    expect(cadArcSvgPath({ ...arc, sweepRadians: Math.PI * 2, end: arc.start })).toBe('M 10 0 A 10 10 0 0 1 -10 0 A 10 10 0 0 1 10 0');
    expect(cadArcSvgPath({ ...arc, startAngle: 350 * Math.PI / 180, endAngle: 10 * Math.PI / 180, sweepRadians: undefined })).toContain(' A 10 10 0 0 1 ');
  });
  it('subtracts a far display origin before serializing full, concave and joined analytic arcs', () => {
    const translated = { ...arc, center: { x: 100000000, y: -100000000 }, start: { x: 100000010, y: -100000000 }, end: { x: 100000000, y: -99999990 } };
    const origin = [100000000, -100000000] as const;
    expect(cadArcSvgPath(translated, origin)).toBe('M 10 0 A 10 10 0 0 1 0 10');
    expect(cadArcSvgPath({ ...translated, clockwise: true, sweepRadians: -Math.PI * 1.5 }, origin)).toBe('M 10 0 A 10 10 0 1 0 0 10');
    expect(cadArcSvgPath({ ...translated, sweepRadians: 2 * Math.PI, end: translated.start }, origin)).toBe('M 10 0 A 10 10 0 0 1 -10 0 A 10 10 0 0 1 10 0');
    expect(cadClosedBoundarySvgPath([translated, { type: 'line', layer: 'CAD', start: translated.end, end: translated.start }], origin)).toBe('M 10 0 A 10 10 0 0 1 0 10 L 10 0 Z');
  });
});
