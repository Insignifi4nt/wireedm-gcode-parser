import { afterEach, expect, it, vi } from 'vitest';
import type { DxfEntity, DxfPoint } from '../../../domain/dxf/types';
import { assertCadSectionClosedEndpoints } from './cadKernelSectionEndpoints';

const tolerance = 1e-7;
const line = (start: DxfPoint, end: DxfPoint): DxfEntity => ({ type: 'line', layer: 'CAD_SECTION', start, end });
afterEach(() => vi.restoreAllMocks());

it('retains the first representative when a nontransitive endpoint is closer to a later representative', () => {
  const first = { x: 0, y: 0 }, later = { x: 1.5 * tolerance, y: 0 }, both = { x: .9 * tolerance, y: 0 };
  const far = { x: 10, y: 10 }, otherFar = { x: 20, y: 20 };
  const entities = [line(first, far), line(later, otherFar), line(both, far), line(later, otherFar)];
  const original = JSON.stringify(entities);
  // Both matches first, giving every representative degree two. Nearest-match
  // or transitive merging would make this graph open/branched instead.
  expect(() => assertCadSectionClosedEndpoints(entities, tolerance)).not.toThrow();
  expect(JSON.stringify(entities)).toBe(original);
});

it.each([0, -1e5, 1e9])('preserves exact closed endpoint degrees at coordinate origin %s', origin => {
  const a = { x: origin, y: -origin }, b = { x: origin + 10, y: -origin }, c = { x: origin + 10, y: -origin + 10 }, d = { x: origin, y: -origin + 10 };
  const entities = [line(a, b), line(b, c), line(c, d), line(d, a)];
  expect(() => assertCadSectionClosedEndpoints(entities, tolerance)).not.toThrow();
  const open = entities.slice(0, -1);
  expect(() => assertCadSectionClosedEndpoints(open, tolerance)).toThrow(expect.objectContaining({ code: 'open-section' }));
});

it('keeps inclusive radial tolerance across positive and negative cell boundaries', () => {
  for (const sign of [-1, 1]) {
    const a = { x: 0, y: 0 }, b = { x: sign * tolerance, y: 0 }, p = { x: sign * 10, y: 10 };
    expect(() => assertCadSectionClosedEndpoints([line(a, p), line(p, b)], tolerance)).not.toThrow();
    // The diagonal lies in a nearby cell, but exceeds the same radial predicate.
    const diagonal = { x: sign * tolerance, y: tolerance };
    expect(() => assertCadSectionClosedEndpoints([line(a, p), line(p, diagonal)], tolerance)).toThrow(expect.objectContaining({ code: 'open-section' }));
  }
});

it('rejects touching closed loops instead of accepting degree four as two contours', () => {
  const shared = { x: 0, y: 0 }, left = { x: -10, y: 0 }, upperLeft = { x: -10, y: 10 }, right = { x: 10, y: 0 }, lowerRight = { x: 10, y: -10 };
  const entities = [line(shared, left), line(left, upperLeft), line(upperLeft, shared), line(shared, right), line(right, lowerRight), line(lowerRight, shared)];
  expect(() => assertCadSectionClosedEndpoints(entities, tolerance)).toThrow(expect.objectContaining({ code: 'open-section' }));
});

it.each([5e8, -5e8])('uses the exact distance rather than expanded bucket bounds at far coordinate %s', origin => {
  const a = { x: origin, y: -origin }, p = { x: origin + 10, y: -origin + 10 };
  const ulp = 5.960464477539063e-8;
  const near = { x: origin + ulp, y: -origin }, outside = { x: origin + 2 * ulp, y: -origin };
  expect(() => assertCadSectionClosedEndpoints([line(a, p), line(p, near)], tolerance)).not.toThrow();
  expect(() => assertCadSectionClosedEndpoints([line(a, p), line(p, outside)], tolerance)).toThrow(expect.objectContaining({ code: 'open-section' }));
});

it('keeps full circles and complementary exact arcs closed without inventing circle endpoints', () => {
  const start = { x: 5, y: 0 }, end = { x: -5, y: 0 }, center = { x: 0, y: 0 };
  const entities: DxfEntity[] = [
    { type: 'circle', layer: 'CAD_SECTION', center: { x: 20, y: 20 }, radius: 2 },
    { type: 'arc', layer: 'CAD_SECTION', center, radius: 5, start, end, startAngle: 0, endAngle: Math.PI, sweepRadians: Math.PI, clockwise: false },
    { type: 'arc', layer: 'CAD_SECTION', center, radius: 5, start: end, end: start, startAngle: Math.PI, endAngle: 2 * Math.PI, sweepRadians: Math.PI, clockwise: false }
  ];
  expect(() => assertCadSectionClosedEndpoints(entities, tolerance)).not.toThrow();
});

it('limits distance checks to nearby candidates for a large closed section without changing its entities', () => {
  const points = Array.from({ length: 2048 }, (_, i) => ({ x: 100 * Math.cos(i * Math.PI / 1024), y: 100 * Math.sin(i * Math.PI / 1024) }));
  const entities = points.map((point, i) => line(point, points[(i + 1) % points.length]));
  const original = JSON.stringify(entities), distance = vi.spyOn(Math, 'hypot');
  expect(() => assertCadSectionClosedEndpoints(entities, tolerance)).not.toThrow();
  expect(distance.mock.calls.length).toBeLessThanOrEqual(points.length * 4);
  expect(JSON.stringify(entities)).toBe(original);
});
