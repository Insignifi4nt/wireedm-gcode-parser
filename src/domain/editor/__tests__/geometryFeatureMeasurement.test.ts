import { describe, expect, it } from 'vitest';
import { createArcSegment, createCircleSegment, createLineSegment, distance } from '@/domain/path-intel/segments';
import type { PathSegment } from '@/domain/path-intel/types';
import { measureFeaturePair } from '../geometryFeatureMeasurement';

const source = { sourceEntityIndex: 0, sourceEntityType: 'line', layer: null, exact: true };
const line = (x1: number, y1: number, x2: number, y2: number) => createLineSegment({
  id: 'line', source, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }
});
const circle = (x: number, y: number, radius: number) => createCircleSegment({ id: 'circle', source, center: { x, y }, radius });
const arc = (x: number, y: number, radius: number, start: number, sweep: number) => createArcSegment({
  id: 'arc', source, center: { x, y }, radius,
  start: { x: x + radius * Math.cos(start), y: y + radius * Math.sin(start) },
  end: { x: x + radius * Math.cos(start + sweep), y: y + radius * Math.sin(start + sweep) },
  clockwise: sweep < 0, sweepRadians: sweep
});

function check(first: PathSegment, second: PathSegment, expected: number) {
  const result = measureFeaturePair(first, second);
  expect(result).not.toBeNull();
  expect(result?.distance).toBeCloseTo(expected, 10);
  if (result) expect(distance(result.first, result.second)).toBeCloseTo(result.distance, 12);
  expect(measureFeaturePair(second, first)?.distance).toBeCloseTo(expected, 10);
  return result;
}

describe('minimum source feature distance', () => {
  it('handles finite crossing, overlapping, parallel, and endpoint-limited lines', () => {
    check(line(0, 0, 10, 0), line(5, -5, 5, 5), 0);
    check(line(10, 0, 0, 0), line(2, 0, 8, 0), 0);
    check(line(0, 0, 10, 0), line(2, 3, 8, 3), 3);
    check(line(0, 0, 10, 0), line(13, 4, 20, 4), 5);
  });

  it.each([
    [12, 5, 2], [10, 5, 0], [7, 5, 0], [0, 5, 0],
    [0, 2, 3], [1, 2, 2], [3, 2, 0]
  ])('measures disjoint, tangent, crossing, coincident, or nested circles at %s with radius %s', (offset, radius, expected) => {
    const result = check(circle(0, 0, 5), circle(offset, 0, radius), expected);
    expect(result?.centerDistance).toBe(offset);
  });

  it('finds line/circle intersections, tangency, interior normals, and finite endpoint gaps', () => {
    check(line(-10, 0, 10, 0), circle(0, 0, 5), 0);
    check(line(-10, 5, 10, 5), circle(0, 0, 5), 0);
    check(line(-10, 8, 10, 8), circle(0, 0, 5), 3);
    check(line(8, 6, 10, 6), circle(0, 0, 5), 5);
    check(line(-1, 0, 1, 0), circle(0, 0, 5), 4);
  });

  it('limits circular candidates to finite arc sweeps in both directions', () => {
    for (const quarter of [arc(0, 0, 5, 0, Math.PI / 2), arc(0, 0, 5, Math.PI / 2, -Math.PI / 2)]) {
      check(quarter, line(-10, -8, 10, -8), 8);
      check(quarter, circle(-10, 0, 2), Math.sqrt(125) - 2);
      check(quarter, line(8, -10, 8, 10), 3);
    }
  });

  it('finds arc/arc interior minima and endpoint minima on concentric supports', () => {
    check(arc(0, 0, 5, -Math.PI / 4, Math.PI / 2), arc(12, 0, 3, Math.PI * 0.75, Math.PI / 2), 4);
    check(arc(0, 0, 5, 0, Math.PI / 2), arc(0, 0, 3, Math.PI / 4, Math.PI / 2), 2);
    check(arc(0, 0, 5, 0, Math.PI / 4), arc(0, 0, 5, Math.PI / 2, Math.PI / 4), Math.sqrt(50 - 50 / Math.sqrt(2)));
    check(arc(0, 0, 5, 0, Math.PI), arc(0, 0, 5, Math.PI / 4, Math.PI / 4), 0);
    check(arc(0, 0, 5, 0, Math.PI), arc(6, 0, 5, 0, Math.PI), 0);
    check(arc(0, 0, 5, 0, Math.PI), arc(10, 0, 5, Math.PI, -Math.PI), 0);
  });

  it('finds oblique stationary pairs with translated centers', () => {
    const angle = Math.atan2(4, 3);
    const result = check(arc(20, -30, 2, angle - 0.2, 0.4),
      arc(26, -22, 3, angle + Math.PI - 0.2, 0.4), 5);
    expect(result?.first.x).toBeCloseTo(21.2, 10);
    expect(result?.first.y).toBeCloseTo(-28.4, 10);
    expect(result?.second.x).toBeCloseTo(24.2, 10);
    expect(result?.second.y).toBeCloseTo(-24.4, 10);
    check(line(0, 0, 6, 8), circle(-1, 7, 2), 3);
  });

  it('preserves sub-tolerance gaps and handles point-like features', () => {
    const result = check(circle(0, 0, 5), circle(10 + 1e-8, 0, 5), 1e-8);
    expect(result?.distance).toBeGreaterThan(0);
    check(line(0, 0, 0, 0), circle(0, 0, 5), 5);
    check(line(0, 0, 1e-12, 0), line(0, 2, 1e-12, 2), 2);
    check(circle(0, 0, 0), circle(4, 0, 1), 3);
    check(arc(0, 0, 5, 0, 1e-10), circle(10, 0, 2), 3);
  });

  it('rejects non-finite geometry rather than reporting a plausible partial result', () => {
    expect(measureFeaturePair(circle(0, 0, -1), line(0, 0, 1, 1))).toBeNull();
    expect(measureFeaturePair(circle(Infinity, 0, 1), line(0, 0, 1, 1))).toBeNull();
  });

  it('keeps radial candidates inside short arc endpoint gaps without machining tolerance', () => {
    const gapAngle = 5e-6;
    const first = arc(0, 0, 5, -Math.PI / 2, Math.PI / 2 - gapAngle);
    const result = check(first, circle(5, 0, 0), 10 * Math.sin(gapAngle / 2));
    expect(result?.first.x).toBeCloseTo(first.end.x, 12);
    expect(result?.first.y).toBeCloseTo(first.end.y, 12);
    expect(result?.distance).toBeGreaterThan(0);
  });
});
