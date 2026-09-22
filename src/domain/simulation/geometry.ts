import type { WireEdmExecutionEvent } from '@/domain/execution-plan/executionPlan';
import type { Point2 } from '@/domain/path-intel/types';

export type SimulationMotion = Extract<WireEdmExecutionEvent, { kind: 'motion' }>;
const TURN = Math.PI * 2;

export function distance(a: Point2, b: Point2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function arcSweep(motion: SimulationMotion): number {
  if (motion.motion !== 'circular' || !motion.center) return 0;
  if (motion.fullCircle) return motion.clockwise ? -TURN : TURN;
  const startX = motion.start.x - motion.center.x;
  const startY = motion.start.y - motion.center.y;
  const endX = motion.end.x - motion.center.x;
  const endY = motion.end.y - motion.center.y;
  const angle = Math.atan2(startX * endY - startY * endX, startX * endX + startY * endY);
  const positive = (value: number) => value < 0 ? value + TURN : value;
  return motion.clockwise ? -positive(-angle) : positive(angle);
}

export function motionLength(motion: SimulationMotion): number {
  return motion.motion === 'circular' && motion.center
    ? distance(motion.start, motion.center) * Math.abs(arcSweep(motion))
    : distance(motion.start, motion.end);
}

export function interpolateLine(start: Point2, end: Point2, fraction: number): Point2 {
  return { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction };
}

export function interpolateMotion(motion: SimulationMotion, fraction: number): Point2 {
  if (fraction <= 0) return { ...motion.start };
  if (fraction >= 1) return { ...motion.end };
  if (motion.motion !== 'circular' || !motion.center) return interpolateLine(motion.start, motion.end, fraction);
  const radius = distance(motion.start, motion.center);
  const angle = Math.atan2(motion.start.y - motion.center.y, motion.start.x - motion.center.x)
    + arcSweep(motion) * fraction;
  return { x: motion.center.x + radius * Math.cos(angle), y: motion.center.y + radius * Math.sin(angle) };
}

export function motionPolyline(motion: SimulationMotion): Point2[] {
  const count = motion.motion === 'circular' ? Math.max(1, Math.ceil(Math.abs(arcSweep(motion)) / (Math.PI / 90))) : 1;
  return Array.from({ length: count + 1 }, (_, index) => interpolateMotion(motion, index / count));
}

export function polygonArea(polygon: readonly Point2[]): number {
  if (polygon.length < 3) return 0;
  let area = 0;
  const origin = polygon[0];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    area += (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y);
  }
  return Math.abs(area) / 2;
}

export function distanceToLine(point: Point2, start: Point2, end: Point2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return distance(point, interpolateLine(start, end, t));
}

export function distanceToPolygon(point: Point2, polygon: readonly Point2[]): number {
  let minimum = Infinity;
  for (let i = 0; i < polygon.length; i++) minimum = Math.min(minimum,
    distanceToLine(point, polygon[i], polygon[(i + 1) % polygon.length]));
  return minimum;
}

/** Boundary is included; collision consumers apply their own kerf clearance. */
export function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  if (distanceToPolygon(point, polygon) < 1e-8) return true;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function distanceToMotion(point: Point2, motion: SimulationMotion): number {
  if (motion.motion !== 'circular' || !motion.center) return distanceToLine(point, motion.start, motion.end);
  const center = motion.center;
  const radius = distance(motion.start, center);
  if (motion.fullCircle) return Math.abs(distance(point, center) - radius);
  const start = Math.atan2(motion.start.y - center.y, motion.start.x - center.x);
  const angle = Math.atan2(point.y - center.y, point.x - center.x);
  const sweep = arcSweep(motion);
  const travel = sweep < 0 ? ((start - angle) % TURN + TURN) % TURN : ((angle - start) % TURN + TURN) % TURN;
  return travel <= Math.abs(sweep)
    ? Math.abs(distance(point, center) - radius)
    : Math.min(distance(point, motion.start), distance(point, motion.end));
}

/** Parameters of a line crossing polygon edges, used to avoid skipping thin obstacles. */
export function polygonCrossings(start: Point2, end: Point2, polygon: readonly Point2[]): number[] {
  const crossings: number[] = [];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const determinant = dx * ey - dy * ex;
    if (Math.abs(determinant) < 1e-12) continue;
    const ax = a.x - start.x;
    const ay = a.y - start.y;
    const t = (ax * ey - ay * ex) / determinant;
    const u = (ax * dy - ay * dx) / determinant;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) crossings.push(t);
  }
  return crossings;
}
