import { describe, expect, it } from 'vitest';
import { classifyPathSegmentIntersection } from '../intersections';
import { createArcSegment, createCircleSegment, createLineSegment } from '../segments';

const source = { sourceEntityIndex: 0, sourceEntityType: 'line', layer: 'CUT', exact: true };
describe('line-circle discriminant rounding', () => {
  it('retains one endpoint tangent when cancellation in C produces a tiny positive discriminant', () => {
    const angle = Math.PI / 6;
    const center = { x: 15 + 3 * Math.cos(angle), y: 10 + 3 * Math.sin(angle) };
    const endpoint = { x: center.x + 2 * Math.cos(angle + Math.PI / 2), y: center.y + 2 * Math.sin(angle + Math.PI / 2) };
    const line = createLineSegment({ id: 'line', source, start: endpoint, end: { x: endpoint.x - 6 * Math.cos(angle), y: endpoint.y - 6 * Math.sin(angle) } });
    const circle = createCircleSegment({ id: 'circle', source: { ...source, sourceEntityType: 'circle' }, center, radius: 2 });
    const relation = classifyPathSegmentIntersection(line, circle, 1e-5);
    expect(relation.kind).toBe('points'); expect(relation.points).toHaveLength(1);
    expect(relation.points[0].x).toBeCloseTo(endpoint.x, 12);
    expect(relation.points[0].y).toBeCloseTo(endpoint.y, 12);
  });
  it('keeps distinct near-tangent crossings even when their separation is below coincidence epsilon', () => {
    const line = createLineSegment({ id: 'line', source, start: { x: -1, y: 1 - 1e-12 }, end: { x: 1, y: 1 - 1e-12 } });
    const circle = createCircleSegment({ id: 'circle', source: { ...source, sourceEntityType: 'circle' }, center: { x: 0, y: 0 }, radius: 1 });
    const relation = classifyPathSegmentIntersection(line, circle, 1e-5);
    expect(relation.kind).toBe('points'); expect(relation.points).toHaveLength(2);
    expect(relation.points[0].x).toBeLessThan(0); expect(relation.points[1].x).toBeGreaterThan(0);
    expect(relation.points[1].x - relation.points[0].x).toBeLessThan(1e-5);
  });
  it('finds both crossings of a small circle by a long line at sketch tolerance', () => {
    // The normalized quadratic used to place these to the line's reach squared over the chord, which missed fillet-sized circles.
    for (const radius of [.05, .2, 2]) for (const reach of [100, 1000]) for (const degrees of [3, 41, 89]) for (const offset of [0, .6, .9]) {
      const angle = degrees * Math.PI / 180, center = { x: 7.3, y: -2.1 }, across = { x: -Math.sin(angle) * offset * radius, y: Math.cos(angle) * offset * radius };
      const line = createLineSegment({ id: 'line', source, start: { x: center.x + across.x - reach * Math.cos(angle), y: center.y + across.y - reach * Math.sin(angle) },
        end: { x: center.x + across.x + reach * Math.cos(angle), y: center.y + across.y + reach * Math.sin(angle) } });
      const circle = createCircleSegment({ id: 'circle', source: { ...source, sourceEntityType: 'circle' }, center, radius });
      const relation = classifyPathSegmentIntersection(line, circle, 8 * Number.EPSILON * (reach + 10));
      const label = `r=${radius} reach=${reach} ${degrees}° offset=${offset}`;
      expect(relation.points, label).toHaveLength(2);
      for (const point of relation.points) expect(Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - radius), label).toBeLessThan(1e-11);
    }
  });
  it('keeps a tangent endpoint contact that polishing would push past the line end', () => {
    // The line ends exactly on the circle along its tangent, a near-double root that Newton steps drift across.
    const line = createLineSegment({ id: 'line', source, start: { x: 8.00059992, y: 5.99919994 }, end: { x: 8, y: 6 } });
    const circle = createCircleSegment({ id: 'circle', source: { ...source, sourceEntityType: 'circle' }, center: { x: 0, y: 0 }, radius: 10 });
    const arc = createArcSegment({ id: 'arc', source: { ...source, sourceEntityType: 'arc' }, center: { x: 0, y: 0 }, start: { x: 10, y: 0 }, end: { x: 0, y: 10 }, clockwise: false });
    for (const curve of [circle, arc]) expect(classifyPathSegmentIntersection(line, curve, 1e-12).points, curve.kind).toHaveLength(1);
  });
});
