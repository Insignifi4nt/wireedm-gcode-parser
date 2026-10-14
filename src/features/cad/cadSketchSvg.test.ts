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
});
