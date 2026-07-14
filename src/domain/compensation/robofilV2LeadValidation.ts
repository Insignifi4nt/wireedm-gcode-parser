import { classifyPathSegmentIntersection } from '@/domain/path-intel/intersections';
import { formatGcodePointWords } from '@/domain/path-intel/postGcode';
import { createLineSegment, distance, segmentMap } from '@/domain/path-intel/segments';
import type { PathOperation, PathPlanningDocument, Point2 } from '@/domain/path-intel/types';

export type RobofilV2LeadValidation =
  | { valid: true }
  | { valid: false; message: string };

const generatedLeadSource = {
  sourceEntityIndex: -1,
  sourceEntityType: 'generated-lead-validation',
  layer: null,
  exact: true
};

export function validateRobofilV2OperationLead(
  document: PathPlanningDocument,
  operation: PathOperation,
  coordinatePrecision: number
): RobofilV2LeadValidation {
  const lead = operation.overrides?.leadIn;
  if (!lead) return invalid('Robofil v2 requires an explicit linear lead-in for every operation.');
  if (![lead.from, lead.to, operation.startPoint].every(finitePoint)) {
    return invalid('Robofil v2 lead-in coordinates must be finite.');
  }

  const epsilon = document.options.coincidenceEpsilon;
  const leadLength = distance(lead.from, lead.to);
  if (!Number.isFinite(leadLength) || leadLength <= 0) {
    return invalid('Robofil v2 lead-in must have finite, non-zero length.');
  }
  if (distance(lead.to, operation.startPoint) > epsilon) {
    return invalid('Robofil v2 lead-in must end at the canonical operation start.');
  }
  const formattedFrom = formatGcodePointWords(lead.from, coordinatePrecision);
  const formattedTo = formatGcodePointWords(lead.to, coordinatePrecision);
  if (!formattedFrom || !formattedTo || formattedFrom === formattedTo) {
    return invalid('Robofil v2 lead-in collapses at the configured coordinate precision.');
  }

  const segmentsById = segmentMap(document.segments);
  const sourceRef = operation.segmentRefs.find((ref) => ref.segmentId === lead.sourceSegmentId);
  if (!sourceRef || !segmentsById.has(lead.sourceSegmentId)) {
    return invalid('Robofil v2 lead-in is disconnected from its target operation.');
  }

  if (lead.source === 'circle-center') {
    const circularSegments = operation.segmentRefs.map((ref) => segmentsById.get(ref.segmentId));
    const first = circularSegments[0];
    if (
      !operation.closed ||
      !first ||
      first.kind === 'line' ||
      circularSegments.some((segment) =>
        !segment ||
        segment.kind === 'line' ||
        distance(segment.center, first.center) > epsilon ||
        Math.abs(segment.radius - first.radius) > epsilon
      ) ||
      distance(lead.from, first.center) > epsilon
    ) {
      return invalid('A circle-center lead-in is only valid for a circular operation from its center.');
    }
  }

  const leadSegment = createLineSegment({
    id: `generated-lead-${operation.id}`,
    source: generatedLeadSource,
    start: lead.from,
    end: lead.to
  });
  for (const ref of operation.segmentRefs) {
    const target = segmentsById.get(ref.segmentId);
    if (!target) return invalid('Robofil v2 lead-in references missing target geometry.');
    const relation = classifyPathSegmentIntersection(leadSegment, target, epsilon);
    if (
      relation.kind === 'overlap' ||
      (relation.kind === 'points' && relation.points.some((point) => distance(point, lead.to) > epsilon))
    ) {
      return invalid('Robofil v2 lead-in crosses its target contour before the intended endpoint.');
    }
  }

  return { valid: true };
}

function finitePoint(point: Point2) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function invalid(message: string): RobofilV2LeadValidation {
  return { valid: false, message };
}
