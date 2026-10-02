import type { OrientedSegmentRef, PathSegment, Point2 } from './types';

/** Exact ray parity for a closed path; the point must not lie on its boundary. */
export function closedPathContainsPoint(
  refs: OrientedSegmentRef[], point: Point2,
  segments: Map<string, PathSegment>
): boolean {
  let inside = false;
  for (const reference of refs) {
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
