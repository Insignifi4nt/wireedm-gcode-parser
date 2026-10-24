import { inferPathPoint } from './pathPointInference';
import { findLeadIntersections } from '@/domain/path-intel/leadIntersections';
import { distance } from '@/domain/path-intel/segments';
import type { PathPlanningDocument, Point2 } from '@/domain/path-intel/types';

/** Exact source-geometry check, sharing the editor's snapping and lead-contact rules. */
export function inspectContourApproach(document: PathPlanningDocument, input: {
  operationId: string; from: Point2; hintPoint?: Point2;
}) {
  if (![input.from, input.hintPoint ?? input.from].every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 1e9 && Math.abs(point.y) <= 1e9)) return null;
  const nearest = inferPathPoint(document, { mode: 'nearest', operationId: input.operationId, hintPoint: input.hintPoint ?? input.from });
  if (!nearest) return null;
  const lengthMm = distance(input.from, nearest.point);
  const intersections = findLeadIntersections(input.from, nearest.point, nearest.point, document.segments, document.options.coincidenceEpsilon);
  const status = lengthMm <= document.options.coincidenceEpsilon ? 'zero-length' : intersections.length ? 'blocked' : 'clear';
  return { nearest, from: input.from, lengthMm, status, intersections, checkedSegmentCount: document.segments.length,
    nearestReachablePoint: status === 'clear' && !input.hintPoint ? nearest.point : null,
    searchedAlternatives: false };
}
