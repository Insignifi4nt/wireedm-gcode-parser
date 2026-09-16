import { classifyPathSegmentIntersection } from './intersections';
import { createLineSegment, pointsEqual } from './segments';
import type { PathContour, PathPlanningDocument, PathSegment, Point2 } from './types';

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
  const incompleteSegments = new Set(document.machiningParticipation?.spans
    .filter((span) => span.participation === 'inactive-reference')
    .map((span) => span.sourceSegmentId) ?? []);
  const chainsById = new Map(document.chains.map((chain) => [chain.id, chain]));
  const contours = document.contours.filter((contour) => contour.closed &&
    contour.classification !== 'ambiguous' &&
    !(chainsById.get(contour.chainId)?.segmentRefs.some(({ segmentId }) => incompleteSegments.has(segmentId))));
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
  const chains = chainsById;
  const segments = new Map(document.segments.map((segment) => [segment.id, segment]));
  let materialLengthMm = 0;
  for (let index = 1; index < parameters.length; index++) {
    const start = parameters[index - 1];
    const end = parameters[index];
    if ((end - start) * route.length <= epsilon) continue;
    const middle = pointAt(from, to, (start + end) / 2);
    const containing = contours.filter((contour) => containsExact(contour, middle, chains, segments))
      .sort((a, b) => b.containmentDepth - a.containmentDepth);
    const deepest = containing[0];
    if (deepest && (deepest.classification === 'exterior' || deepest.classification === 'island')) {
      materialLengthMm += (end - start) * route.length;
    }
  }
  if (materialLengthMm > epsilon) return { status: 'crosses-finished-material', materialLengthMm };
  return { status: 'unknown' };
}

function pointAt(from: Point2, to: Point2, fraction: number): Point2 {
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
}

function containsExact(
  contour: PathContour, point: Point2,
  chains: Map<string, PathPlanningDocument['chains'][number]>,
  segments: Map<string, PathSegment>
): boolean {
  const chain = chains.get(contour.chainId);
  if (!chain) return false;
  let inside = false;
  for (const reference of chain.segmentRefs) {
    const segment = segments.get(reference.segmentId);
    if (!segment) return false;
    if (segment.kind === 'circle') {
      if (Math.hypot(point.x - segment.center.x, point.y - segment.center.y) < segment.radius) inside = !inside;
      continue;
    }
    if (segment.kind === 'line') {
      if (rayCrosses(point, segment.start, segment.end, () =>
        segment.start.x + (point.y - segment.start.y) *
          (segment.end.x - segment.start.x) / (segment.end.y - segment.start.y))) inside = !inside;
      continue;
    }
    const startAngle = segment.startAngleRadians;
    const endAngle = startAngle + segment.sweepRadians;
    const fractions = [0, 1];
    for (const extremum of [Math.PI / 2, 3 * Math.PI / 2]) {
      const lower = Math.floor((Math.min(startAngle, endAngle) - extremum) / (2 * Math.PI));
      const upper = Math.ceil((Math.max(startAngle, endAngle) - extremum) / (2 * Math.PI));
      for (let turn = lower; turn <= upper; turn++) {
        const fraction = (extremum + turn * 2 * Math.PI - startAngle) / segment.sweepRadians;
        if (fraction > 0 && fraction < 1) fractions.push(fraction);
      }
    }
    fractions.sort((a, b) => a - b);
    for (let index = 1; index < fractions.length; index++) {
      const firstAngle = startAngle + segment.sweepRadians * fractions[index - 1];
      const lastAngle = startAngle + segment.sweepRadians * fractions[index];
      const firstY = segment.center.y + segment.radius * Math.sin(firstAngle);
      const lastY = segment.center.y + segment.radius * Math.sin(lastAngle);
      if (!rayCrosses(point, { x: 0, y: firstY }, { x: 0, y: lastY }, () => {
        const dy = point.y - segment.center.y;
        const dx = Math.sqrt(Math.max(0, segment.radius * segment.radius - dy * dy));
        const middleAngle = (firstAngle + lastAngle) / 2;
        return segment.center.x + Math.sign(Math.cos(middleAngle)) * dx;
      })) continue;
      inside = !inside;
    }
  }
  return inside;
}

function rayCrosses(point: Point2, first: Point2, last: Point2, intersectionX: () => number) {
  return ((first.y <= point.y && point.y < last.y) ||
    (last.y <= point.y && point.y < first.y)) && intersectionX() > point.x;
}
