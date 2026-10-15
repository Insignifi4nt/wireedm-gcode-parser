import { describe, expect, it } from 'vitest';
import { classifyPathSegmentIntersection } from '../intersections';
import { createCircleSegment, createLineSegment } from '../segments';

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
});
