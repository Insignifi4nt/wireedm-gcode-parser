import type { Vec3 } from './model';

export type Triangle3 = readonly [Vec3, Vec3, Vec3];
export interface Segment3 { readonly start: Vec3; readonly end: Vec3 }
export interface SegmentTriangleIntersection { readonly point: Vec3; readonly fraction: number }
export const GEOMETRY_TOLERANCE_MM = 1e-7;

export const subtract3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const magnitude = (a: Vec3) => Math.hypot(...a);
const pointAlong = (start: Vec3, delta: Vec3, fraction: number): Vec3 => [start[0] + delta[0] * fraction, start[1] + delta[1] * fraction, start[2] + delta[2] * fraction];
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function insideTriangle(point: Vec3, triangle: Triangle3, normal: Vec3, tolerance: number): boolean {
  return triangle.every((vertex, index) => {
    const edge = subtract3(triangle[(index + 1) % 3], vertex);
    return dot3(cross3(edge, subtract3(point, vertex)), normal) >= -tolerance * magnitude(edge);
  });
}

function intersectCoplanarSegments(a: Segment3, b: Segment3, tolerance: number): number | null {
  const u = subtract3(a.end, a.start);
  const v = subtract3(b.end, b.start);
  const delta = subtract3(b.start, a.start);
  const cross = cross3(u, v);
  const denominator = dot3(cross, cross);
  const uSquared = dot3(u, u);
  const vSquared = dot3(v, v);
  if (denominator > Number.EPSILON * uSquared * vSquared) {
    const t = dot3(cross3(delta, v), cross) / denominator;
    const s = dot3(cross3(delta, u), cross) / denominator;
    const slackT = tolerance / Math.max(Math.sqrt(uSquared), tolerance);
    const slackS = tolerance / Math.max(Math.sqrt(vSquared), tolerance);
    if (t >= -slackT && t <= 1 + slackT && s >= -slackS && s <= 1 + slackS
      && magnitude(subtract3(pointAlong(a.start, u, clamp(t)), pointAlong(b.start, v, clamp(s)))) <= tolerance) return clamp(t);
  }
  // Parallel overlap and degenerate segments: the closest contact is an endpoint.
  const candidates: number[] = [];
  for (const point of [b.start, b.end]) {
    const t = uSquared === 0 ? 0 : clamp(dot3(subtract3(point, a.start), u) / uSquared);
    if (magnitude(subtract3(point, pointAlong(a.start, u, t))) <= tolerance) candidates.push(t);
  }
  for (const [point, fraction] of [[a.start, 0], [a.end, 1]] as const) {
    const s = vSquared === 0 ? 0 : clamp(dot3(subtract3(point, b.start), v) / vSquared);
    if (magnitude(subtract3(point, pointAlong(b.start, v, s))) <= tolerance) candidates.push(fraction);
  }
  return candidates.length ? Math.min(...candidates) : null;
}

/** Two-sided surface intersection, including grazing and coplanar contact. */
export function intersectSegmentTriangle(segment: Segment3, triangle: Triangle3, tolerance = GEOMETRY_TOLERANCE_MM): SegmentTriangleIntersection | null {
  if (!Number.isFinite(tolerance) || tolerance < 0 || ![segment.start, segment.end, ...triangle].every((point) => point.length === 3 && point.every(Number.isFinite))) return null;
  const cross = cross3(subtract3(triangle[1], triangle[0]), subtract3(triangle[2], triangle[0]));
  const areaTwice = magnitude(cross);
  if (areaTwice <= tolerance * tolerance || areaTwice === 0) return null;
  const normal: Vec3 = [cross[0] / areaTwice, cross[1] / areaTwice, cross[2] / areaTwice];
  const startDistance = dot3(subtract3(segment.start, triangle[0]), normal);
  const endDistance = dot3(subtract3(segment.end, triangle[0]), normal);
  const delta = subtract3(segment.end, segment.start);
  if (Math.abs(startDistance) <= tolerance && insideTriangle(segment.start, triangle, normal, tolerance)) return { point: segment.start, fraction: 0 };
  if (Math.abs(startDistance) <= tolerance && Math.abs(endDistance) <= tolerance) {
    const fractions = triangle.map((point, index) => intersectCoplanarSegments(segment, { start: point, end: triangle[(index + 1) % 3] }, tolerance))
      .filter((fraction): fraction is number => fraction !== null);
    if (!fractions.length) return null;
    const fraction = Math.min(...fractions);
    return { point: pointAlong(segment.start, delta, fraction), fraction };
  }
  if ((startDistance > tolerance && endDistance > tolerance) || (startDistance < -tolerance && endDistance < -tolerance)) return null;
  const denominator = startDistance - endDistance;
  if (denominator === 0) return null;
  const fraction = clamp(startDistance / denominator);
  const point = pointAlong(segment.start, delta, fraction);
  return insideTriangle(point, triangle, normal, tolerance) ? { point, fraction } : null;
}

export function intersectTriangles(a: Triangle3, b: Triangle3): Vec3 | null {
  for (const [source, target] of [[a, b], [b, a]] as const) {
    for (let index = 0; index < 3; index++) {
      const hit = intersectSegmentTriangle({ start: source[index], end: source[(index + 1) % 3] }, target);
      if (hit) return hit.point;
    }
  }
  return null;
}
