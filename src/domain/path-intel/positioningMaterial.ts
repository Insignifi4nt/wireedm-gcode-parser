import { classifyPathSegmentIntersection, findPathSegmentIntersectionDiagnostics } from './intersections';
import { closedPathContainsPoint } from './pathContainment';
import { createLineSegment, pathBounds, pathStartPoint, pointsEqual, signedAreaOfPath } from './segments';
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
  return createPositioningMaterialClassifier(document)(from, to);
}

/** Reuse only for one unchanged document evaluation; discard it when geometry or intent changes. */
export function createPositioningMaterialClassifier(
  document: PathPlanningDocument
): (from: Point2, to: Point2) => PositioningMaterialResult {
  const epsilon = document.options.coincidenceEpsilon;
  let prepared: ReturnType<typeof prepareMaterialRegions> | undefined;
  return (from, to) => {
    if (document.geometryBasis !== 'finished-contour' || pointsEqual(from, to, epsilon) ||
      document.segments.length === 0) return { status: 'unknown' };
    prepared ??= prepareMaterialRegions(document);
    const { regions, segments } = prepared;
    if (regions.length === 0) return { status: 'unknown' };

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
      let deepest: typeof regions[number] | undefined;
      for (const candidate of regions) {
        if (closedPathContainsPoint(candidate.refs, middle, segments) &&
          (!deepest || candidate.containmentDepth > deepest.containmentDepth)) {
          deepest = candidate;
        }
      }
      if (deepest && (deepest.contour.classification === 'exterior' || deepest.contour.classification === 'island')) {
        materialLengthMm += (end - start) * route.length;
      }
    }
    if (materialLengthMm > epsilon) return { status: 'crosses-finished-material', materialLengthMm };
    return { status: 'unknown' };
  };
}

function prepareMaterialRegions(document: PathPlanningDocument) {
  const epsilon = document.options.coincidenceEpsilon;
  const incompleteSegments = new Set(document.machiningParticipation?.spans
    .filter((span) => span.participation === 'inactive-reference')
    .map((span) => span.sourceSegmentId) ?? []);
  const chainsById = new Map(document.chains.map((chain) => [chain.id, chain]));
  const contours = document.contours.filter((contour) => contour.closed);
  const segments = new Map(document.segments.map((segment) => [segment.id, segment]));
  const sourceRegions = contours.map((contour) => {
    const refs = chainsById.get(contour.chainId)?.segmentRefs ?? [];
    return {
      contour,
      refs,
      witness: pathStartPoint(refs, segments),
      area: Math.abs(signedAreaOfPath(refs, segments)),
      bounds: pathBounds(refs, segments)
    };
  });
  // A clean boundary with a reviewed ambiguous role still establishes ancestry.
  // Inspect source intersections when an ambiguous boundary could establish ancestry;
  // recorded diagnostics cannot establish whether that boundary is simple.
  const sourceSegmentIds = new Set(document.chains.flatMap((chain) => chain.segmentRefs.map((ref) => ref.segmentId)));
  const intersectedChains = sourceRegions.some((region) =>
    region.contour.classification === 'ambiguous' && region.area > epsilon)
    ? new Set(findPathSegmentIntersectionDiagnostics(document.segments.filter((segment) => sourceSegmentIds.has(segment.id)),
      document.chains, document.options).flatMap((diagnostic) => diagnostic.relatedChainIds ?? []))
    : new Set<string>();
  const simpleRegions = sourceRegions.filter((region) =>
    Number.isFinite(region.area) && region.area > epsilon && !intersectedChains.has(region.contour.chainId));
  // Contour analysis counts all eligible containers, including inactive boundaries.
  // Area epsilon is not transitive, so neither parent depth nor the smallest area
  // determines that count. Derive it once, preserving source-order ties and roles.
  const regions = sourceRegions.map((region) => {
    const witness = region.witness;
    return {
      ...region,
      containmentDepth: region.area <= epsilon || intersectedChains.has(region.contour.chainId) || !witness ? 0 : simpleRegions.filter((candidate) =>
        candidate !== region && candidate.area > region.area + epsilon &&
        candidate.bounds.minX <= region.bounds.minX + epsilon &&
        candidate.bounds.minY <= region.bounds.minY + epsilon &&
        candidate.bounds.maxX >= region.bounds.maxX - epsilon &&
        candidate.bounds.maxY >= region.bounds.maxY - epsilon &&
        closedPathContainsPoint(candidate.refs, witness, segments)).length
    };
  }).filter((region) => region.contour.classification !== 'ambiguous' &&
    !region.refs.some(({ segmentId }) => incompleteSegments.has(segmentId)));
  return { regions, segments };
}

function pointAt(from: Point2, to: Point2, fraction: number): Point2 {
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
}
