import { describe, expect, it } from 'vitest';
import { cadSketchDimensionAnnotation } from './cadSketchDimensionAnnotations';

const project = ([x, y]: readonly [number, number]) => ({ x: 200 + x * 10, y: 200 - y * 10 });
describe('analytic sketch dimension annotations', () => {
  it('places width below and height beside the actual rectangle sides', () => {
    const geometry = { kind: 'rectangle' as const, x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 };
    const width = cadSketchDimensionAnnotation(geometry, {}, 'width', project);
    const height = cadSketchDimensionAnnotation(geometry, {}, 'height', project);
    expect(width?.measured).toEqual([{ x: 200, y: 200 }, { x: 400, y: 200 }]);
    expect(width?.label.x).toBe(300); expect(width?.label.y).toBeGreaterThan(200);
    expect(height?.measured).toEqual([{ x: 400, y: 200 }, { x: 400, y: 100 }]);
    expect(height?.label.x).toBeGreaterThan(400); expect(height?.label.y).toBe(150);
  });
  it('uses a true diameter through the circle and a radial leader from its center', () => {
    const geometry = { kind: 'circle' as const, x: 0, y: 0, radius: 5 };
    const diameter = cadSketchDimensionAnnotation(geometry, {}, 'diameter', project);
    const radius = cadSketchDimensionAnnotation(geometry, {}, 'radius', project);
    if (!diameter || !radius) throw new Error('Missing circular annotation');
    expect(Math.hypot(diameter.measured[1].x - diameter.measured[0].x, diameter.measured[1].y - diameter.measured[0].y)).toBeCloseTo(100, 10);
    expect((diameter.measured[1].x + diameter.measured[0].x) / 2).toBe(200);
    expect((diameter.measured[1].y + diameter.measured[0].y) / 2).toBe(200);
    expect(radius.measured[0]).toEqual({ x: 200, y: 200 });
    expect(Math.hypot(radius.measured[1].x - 200, radius.measured[1].y - 200)).toBeCloseTo(50, 10);
  });
  it('measures rotated slot length along its axis instead of its bounding box', () => {
    const length = cadSketchDimensionAnnotation({ kind: 'slot', x: 0, y: 0, length: 20, width: 8, angle: 90 }, {}, 'length', project);
    if (!length) throw new Error('Missing slot annotation');
    expect(length.measured[0].x).toBeCloseTo(200); expect(length.measured[1].x).toBeCloseTo(200);
    expect(length.measured[0].y).toBeCloseTo(300); expect(length.measured[1].y).toBeCloseTo(100);
    expect(length.label.x).toBeGreaterThan(200);
  });
});
