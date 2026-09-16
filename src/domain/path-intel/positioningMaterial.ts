import { classifyPathSegmentIntersection } from './intersections';
import { createLineSegment, pointsEqual } from './segments';
import type { PathPlanningDocument, Point2 } from './types';

export type PositioningMaterialResult =
  | { status: 'crosses-finished-material'; materialLengthMm: number }
  | { status: 'unknown' };

/** Classify a straight travel against closed finished-part regions, including holes and islands. */
export function classifyPositioningMaterial(
  document: PathPlanningDocument,
  from: Point2,
  to: Point2
): PositioningMaterialResult {
  const epsilon = document.options.coincidenceEpsilon;
  if (document.geometryBasis !== 'finished-contour' || pointsEqual(from, to, epsilon) ||
    document.segments.length === 0) return { status: 'unknown' };
  const contours = document.contours.filter((contour) => contour.closed &&
    contour.classification !== 'ambiguous' && contour.approximatePolygon.length >= 3);
  if (contours.length === 0) return { status: 'unknown' };

  const route = createLineSegment({ id: 'positioning-material', source: document.segments[0].source, start: from, end: to });
  const parameters = [0, 1];
  for (const segment of document.segments) {
    const intersection = classifyPathSegmentIntersection(route, segment, epsilon);
    if (intersection.kind === 'overlap') return { status: 'unknown' };
    for (const point of intersection.points) {
      const parameter = ((point.x - from.x) * (to.x - from.x) +
        (point.y - from.y) * (to.y - from.y)) / (route.length * route.length);
      if (parameter > 0 && parameter < 1) parameters.push(parameter);
    }
  }
  parameters.sort((a, b) => a - b);
  let materialLengthMm = 0;
  for (let index = 1; index < parameters.length; index++) {
    const start = parameters[index - 1];
    const end = parameters[index];
    if ((end - start) * route.length <= epsilon) continue;
    const middle = pointAt(from, to, (start + end) / 2);
    const containing = contours.filter((contour) => pointInPolygon(middle, contour.approximatePolygon))
      .sort((a, b) => b.containmentDepth - a.containmentDepth);
    const deepest = containing[0];
    if (deepest && deepest.containmentDepth % 2 === 0) materialLengthMm += (end - start) * route.length;
  }
  if (materialLengthMm > epsilon) return { status: 'crosses-finished-material', materialLengthMm };
  return { status: 'unknown' };
}

function pointAt(from: Point2, to: Point2, fraction: number): Point2 {
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
}

function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index];
    const last = polygon[previous];
    if ((current.y > point.y) !== (last.y > point.y) &&
      point.x < (last.x - current.x) * (point.y - current.y) / (last.y - current.y) + current.x) {
      inside = !inside;
    }
  }
  return inside;
}
