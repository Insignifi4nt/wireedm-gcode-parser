import { describe, expect, it } from 'vitest';
import { createArcSegment, createCircleSegment, createLineSegment } from '@/domain/path-intel/segments';
import { measurePointPair, measureProfile, measureSegment, pickMeasurementPoint } from '../geometryMeasurement';

const source = { sourceEntityIndex: 0, sourceEntityType: 'line', layer: null, exact: true };
const line = createLineSegment({ id: 'line', source, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
const arc = createArcSegment({ id: 'arc', source, start: { x: 10, y: 0 }, end: { x: 0, y: 10 }, center: { x: 0, y: 0 }, clockwise: false });
const circle = createCircleSegment({ id: 'circle', source, center: { x: 20, y: 20 }, radius: 5 });

describe('magnetic measurement picks', () => {
  it('prefers a nearby endpoint over a closer projection onto the edge', () => {
    expect(pickMeasurementPoint({ segments: [line], cursor: { x: 0.05, y: 0.01 }, worldUnitsPerPixel: 0.01 })).toEqual({
      kind: 'geometry', segmentId: 'line', snap: 'endpoint', point: { x: 0, y: 0 }
    });
  });

  it('uses screen-space tolerance at different zoom levels and permits free picks', () => {
    const input = { segments: [line], cursor: { x: 2, y: 0.2 } };
    expect(pickMeasurementPoint({ ...input, worldUnitsPerPixel: 0.01 })).toEqual({ kind: 'free', point: input.cursor });
    expect(pickMeasurementPoint({ ...input, worldUnitsPerPixel: 0.03 })).toMatchObject({ kind: 'geometry', snap: 'nearest', point: { x: 2, y: 0 } });
    expect(pickMeasurementPoint({ ...input, worldUnitsPerPixel: 1, snapEnabled: false })).toEqual({ kind: 'free', point: input.cursor });
  });

  it('selects line and exact arc midpoints without approximating an arc as a chord', () => {
    expect(pickMeasurementPoint({ segments: [line], cursor: { x: 5.02, y: 0 }, worldUnitsPerPixel: 0.01 })).toMatchObject({ snap: 'midpoint', point: { x: 5, y: 0 } });
    const result = pickMeasurementPoint({ segments: [arc], cursor: { x: 7.07, y: 7.08 }, worldUnitsPerPixel: 0.01 });
    expect(result).toMatchObject({ kind: 'geometry', snap: 'midpoint' });
    expect(result?.point.x).toBeCloseTo(Math.sqrt(50), 10);
    expect(result?.point.y).toBeCloseTo(Math.sqrt(50), 10);
  });

  it('snaps circle centers and quadrants without inventing circle endpoints', () => {
    expect(pickMeasurementPoint({ segments: [circle], cursor: { x: 20.01, y: 20 }, worldUnitsPerPixel: 0.01 })).toMatchObject({ snap: 'center', point: circle.center });
    expect(pickMeasurementPoint({ segments: [circle], cursor: { x: 25, y: 20.02 }, worldUnitsPerPixel: 0.01 })).toMatchObject({ snap: 'quadrant', point: { x: 25, y: 20 } });
  });

  it('limits nearest arc picks to the actual sweep', () => {
    expect(pickMeasurementPoint({ segments: [arc], cursor: { x: -10, y: 0 }, worldUnitsPerPixel: 0.01 })).toEqual({ kind: 'free', point: { x: -10, y: 0 } });
  });

  it('rejects invalid coordinates and does not let invalid viewport scales capture distant geometry', () => {
    expect(pickMeasurementPoint({ segments: [line], cursor: { x: NaN, y: 0 }, worldUnitsPerPixel: 1 })).toBeNull();
    expect(pickMeasurementPoint({ segments: [line], cursor: { x: 50, y: 50 }, worldUnitsPerPixel: Infinity })).toEqual({ kind: 'free', point: { x: 50, y: 50 } });
  });
});

describe('measurement results', () => {
  it('integrates curved boundary area and preserves it when the boundary is reversed', () => {
    const halfCircle = createArcSegment({ id: 'half', source, start: { x: 10, y: 0 }, end: { x: -10, y: 0 }, center: { x: 0, y: 0 }, clockwise: false });
    const diameter = createLineSegment({ id: 'diameter', source, start: { x: -10, y: 0 }, end: { x: 10, y: 0 } });
    const refs = [{ segmentId: 'half', reversed: false }, { segmentId: 'diameter', reversed: false }];
    const measured = measureProfile(refs, [halfCircle, diameter]);
    expect(measured?.width).toBeCloseTo(20, 10);
    expect(measured?.height).toBeCloseTo(10, 10);
    expect(measured?.length).toBeCloseTo(10 * Math.PI + 20, 10);
    expect(measured?.signedArea).toBeCloseTo(50 * Math.PI, 10);
    expect(measureProfile([...refs].reverse().map((ref) => ({ ...ref, reversed: true })), [halfCircle, diameter])?.signedArea).toBeCloseTo(-50 * Math.PI, 10);
  });

  it('measures open boundaries without inventing an enclosed area and rejects missing geometry', () => {
    expect(measureProfile([{ segmentId: line.id, reversed: false }], [line])).toEqual({ length: 10, width: 10, height: 0, signedArea: null });
    expect(measureProfile([{ segmentId: 'missing', reversed: false }], [line])).toBeNull();
    expect(measureProfile([], [])).toBeNull();
    expect(measureProfile([{ segmentId: circle.id, reversed: false }], [circle])?.signedArea).toBeCloseTo(25 * Math.PI, 10);
  });
  it('reports signed deltas, Euclidean distance and direction without rounding geometry', () => {
    expect(measurePointPair({ x: 10, y: 10 }, { x: 7, y: 14 })).toEqual({ distance: 5, dx: -3, dy: 4, angleDegrees: Math.atan2(4, -3) * 180 / Math.PI });
    expect(measurePointPair({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ distance: 0, dx: 0, dy: 0, angleDegrees: null });
    expect(measurePointPair({ x: Infinity, y: 0 }, { x: 0, y: 0 })).toBeNull();
  });

  it('reports actual arc and circle dimensions', () => {
    expect(measureSegment(line)).toEqual({ kind: 'line', length: 10 });
    expect(measureSegment(arc)).toEqual({ kind: 'arc', length: Math.PI * 5, radius: 10, diameter: 20, sweepDegrees: 90 });
    expect(measureSegment(circle)).toEqual({ kind: 'circle', length: Math.PI * 10, radius: 5, diameter: 10, area: Math.PI * 25 });
  });
});
