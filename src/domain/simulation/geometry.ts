import type { WireEdmExecutionEvent } from '@/domain/execution-plan/executionPlan';
import { circularRadialDistance, rotateCircularPoint, signedRadialAngle } from '@/domain/path-intel/circularGeometry';
import type { Point2 } from '@/domain/path-intel/types';
import { CAD_PRECISION } from '@/domain/precision/cadPrecision';

export type SimulationMotion = Extract<WireEdmExecutionEvent, { kind: 'motion' }>;
const TURN = Math.PI * 2;

export function distance(a: Point2, b: Point2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function arcSweep(motion: SimulationMotion): number {
  if (motion.motion !== 'circular' || !motion.center) return 0;
  if (motion.fullCircle) return motion.clockwise ? -TURN : TURN;
  const angle = signedRadialAngle(motion.start, motion.end, motion.center);
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
  return rotateCircularPoint(motion.start, motion.start.x - motion.center.x,
    motion.start.y - motion.center.y, arcSweep(motion) * fraction);
}

export function motionPolyline(motion: SimulationMotion): Point2[] {
  if (motion.motion !== 'circular' || !motion.center) return [{ ...motion.start }, { ...motion.end }];
  const sweep = arcSweep(motion);
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 90)));
  const radialX = motion.start.x - motion.center.x;
  const radialY = motion.start.y - motion.center.y;
  return Array.from({ length: count + 1 }, (_, index) => {
    if (index === 0) return { ...motion.start };
    if (index === count) return { ...motion.end };
    return rotateCircularPoint(motion.start, radialX, radialY, sweep * (index / count));
  });
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

/** Points this close to an edge count as inside. */
export const POINT_IN_POLYGON_BOUNDARY_TOLERANCE = CAD_PRECISION.simulationContactMm;

/** Boundary is included; collision consumers apply their own kerf clearance. */
export function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside || distanceToPolygon(point, polygon) < POINT_IN_POLYGON_BOUNDARY_TOLERANCE;
}

export function distanceToMotion(point: Point2, motion: SimulationMotion): number {
  if (motion.motion !== 'circular' || !motion.center) return distanceToLine(point, motion.start, motion.end);
  const center = motion.center;
  const radius = distance(motion.start, center);
  if (motion.fullCircle) return circularRadialDistance(point, motion.start, center, radius);
  const angle = signedRadialAngle(motion.start, point, center);
  const sweep = arcSweep(motion);
  const directed = motion.clockwise ? -angle : angle;
  const travel = directed < 0 ? directed + TURN : directed;
  return travel <= Math.abs(sweep)
    ? circularRadialDistance(point, motion.start, center, radius)
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
    if (Math.abs(determinant) < CAD_PRECISION.simulationDegenerateAreaMm2) continue;
    const ax = a.x - start.x;
    const ay = a.y - start.y;
    const t = (ax * ey - ay * ex) / determinant;
    const u = (ax * dy - ay * dx) / determinant;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) crossings.push(t);
  }
  return crossings;
}
