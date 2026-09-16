import type { Point2 } from './types';

/** Reproject an existing lead direction to an exact requested length. */
export function pointAtLeadLength(anchor: Point2, directionPoint: Point2, lengthMm: number): Point2 | null {
  if (!Number.isFinite(lengthMm) || lengthMm <= 0) return null;
  const existingLength = Math.hypot(directionPoint.x - anchor.x, directionPoint.y - anchor.y);
  if (!Number.isFinite(existingLength) || existingLength === 0) return null;
  const point = {
    x: anchor.x + (directionPoint.x - anchor.x) * lengthMm / existingLength,
    y: anchor.y + (directionPoint.y - anchor.y) * lengthMm / existingLength
  };
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

/** Locate an entry point by the distance traveled from the reviewed initial wire position. */
export function pointFromRapidDistance(initial: Point2, contourStart: Point2, distanceMm: number): Point2 | null {
  if (!Number.isFinite(distanceMm) || distanceMm < 0) return null;
  const fullDistance = Math.hypot(contourStart.x - initial.x, contourStart.y - initial.y);
  if (!Number.isFinite(fullDistance) || fullDistance === 0 || distanceMm >= fullDistance) return null;
  const point = {
    x: initial.x + (contourStart.x - initial.x) * distanceMm / fullDistance,
    y: initial.y + (contourStart.y - initial.y) * distanceMm / fullDistance
  };
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}
