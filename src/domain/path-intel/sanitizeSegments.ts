import {
  classifyPathSegmentIntersection,
  expandBounds,
  pathSegmentsShareSweptLocus,
  spatialCellSizeForSegments
} from './intersections';
import {
  nextDown,
  nextUp,
  normalizeAngle,
  resolvePathPlanningOptions
} from './segments';
import { SpatialHash } from './spatialIndex';
import type {
  PathDiagnostic,
  PathPlanningOptions,
  PathSegment,
  SegmentBuildResult,
  SegmentSourceRef
} from './types';

interface IndexedSegment {
  index: number;
  segment: PathSegment;
}

export function sanitizePathSegments(
  segments: PathSegment[],
  options: PathPlanningOptions = {}
): SegmentBuildResult {
  const resolved = resolvePathPlanningOptions(options);
  const epsilon = resolved.coincidenceEpsilon;
  const diagnostics: PathDiagnostic[] = [];
  const candidates: PathSegment[] = [];

  for (const segment of segments) {
    if (!pathSegmentHasFiniteGeometry(segment)) {
      diagnostics.push(nonFiniteGeometryDiagnostic(diagnostics.length, segment));
      continue;
    }
    if (
      !pathSegmentHasExecutableCircularGeometry(segment, epsilon) ||
      !pathSegmentHasConsistentArcAngularGeometry(segment, epsilon)
    ) {
      diagnostics.push(invalidCircularGeometryDiagnostic(diagnostics.length, segment));
      continue;
    }
    candidates.push(segment);
  }

  const retained: PathSegment[] = [];
  const duplicateGroups = new Map<number, PathSegment[]>();
  const index = new SpatialHash<IndexedSegment>({
    cellSize: spatialCellSizeForSegments(candidates, epsilon),
    maxCellsPerBounds: 256
  });

  for (const segment of candidates) {
    const nearby = index
      .queryBounds(expandBounds(segment.bounds, epsilon))
      .sort((left, right) => left.index - right.index);
    const duplicate = nearby.find((candidate) => {
      if (!pathSegmentsShareSweptLocus(candidate.segment, segment, epsilon)) return false;
      return (duplicateGroups.get(candidate.index) ?? []).every((groupMember) =>
        pathSegmentsShareSweptLocus(groupMember, segment, epsilon)
      );
    });

    if (duplicate) {
      const group = duplicateGroups.get(duplicate.index) ?? [];
      group.push(segment);
      duplicateGroups.set(duplicate.index, group);
      continue;
    }

    for (const candidate of nearby) {
      const relation = classifyPathSegmentIntersection(candidate.segment, segment, epsilon);
      if (relation.kind !== 'overlap') continue;
      diagnostics.push(overlapDiagnostic(diagnostics.length, candidate.segment, segment));
    }

    const retainedIndex = retained.length;
    retained.push(segment);
    index.insertBounds(segment.bounds, { index: retainedIndex, segment });
  }

  for (const [representativeIndex, duplicates] of duplicateGroups) {
    const representative = retained[representativeIndex];
    diagnostics.push(
      duplicateDiagnostic(diagnostics.length, representative, duplicates)
    );
  }

  return { segments: retained, diagnostics };
}

function pathSegmentHasFiniteGeometry(segment: PathSegment) {
  const values = [
    segment.start.x,
    segment.start.y,
    segment.end.x,
    segment.end.y,
    segment.length,
    segment.bounds.minX,
    segment.bounds.minY,
    segment.bounds.maxX,
    segment.bounds.maxY
  ];

  if (segment.kind === 'arc') {
    values.push(
      segment.center.x,
      segment.center.y,
      segment.radius,
      segment.startAngleRadians,
      segment.endAngleRadians,
      segment.sweepRadians
    );
  }

  if (segment.kind === 'circle') {
    values.push(
      segment.center.x,
      segment.center.y,
      segment.radius,
      segment.preferredStart.x,
      segment.preferredStart.y
    );
  }

  return (
    values.every(Number.isFinite) &&
    segment.bounds.minX <= segment.bounds.maxX &&
    segment.bounds.minY <= segment.bounds.maxY
  );
}

export function pathSegmentHasExecutableCircularGeometry(
  segment: PathSegment,
  epsilon: number
) {
  if (segment.kind === 'line') return true;
  if (!Number.isFinite(segment.radius) || segment.radius <= 0) return false;

  if (segment.kind === 'circle') {
    return radialPointMatchesRadius(segment.center, segment.preferredStart, segment.radius, epsilon);
  }

  if (
    !radialPointMatchesRadius(segment.center, segment.start, segment.radius, epsilon) ||
    !radialPointMatchesRadius(segment.center, segment.end, segment.radius, epsilon)
  ) {
    return false;
  }

  const fullTurn =
    Math.abs(Math.abs(segment.sweepRadians) - 2 * Math.PI) <=
    64 * Number.EPSILON * 2 * Math.PI;
  const endpointsCoincide =
    segment.start.x === segment.end.x && segment.start.y === segment.end.y;
  return !endpointsCoincide || fullTurn;
}

export function pathSegmentHasConsistentArcAngularGeometry(
  segment: PathSegment,
  epsilon: number
) {
  if (segment.kind !== 'arc') return true;
  const fullTurn = 2 * Math.PI;
  if (
    typeof segment.clockwise !== 'boolean' ||
    !Number.isFinite(segment.startAngleRadians) ||
    !Number.isFinite(segment.endAngleRadians) ||
    !Number.isFinite(segment.sweepRadians) ||
    segment.sweepRadians === 0 ||
    Math.abs(segment.sweepRadians) > fullTurn ||
    (segment.clockwise ? segment.sweepRadians > 0 : segment.sweepRadians < 0) ||
    segment.startAngleRadians < 0 ||
    segment.startAngleRadians >= fullTurn ||
    segment.endAngleRadians < 0 ||
    segment.endAngleRadians >= fullTurn
  ) {
    return false;
  }

  const angularTolerance = Math.max(
    128 * Number.EPSILON * fullTurn,
    epsilon / segment.radius
  );
  const startFromPoint = normalizeAngle(
    Math.atan2(
      segment.start.y - segment.center.y,
      segment.start.x - segment.center.x
    )
  );
  const endFromPoint = normalizeAngle(
    Math.atan2(segment.end.y - segment.center.y, segment.end.x - segment.center.x)
  );
  const endFromSweep = normalizeAngle(segment.startAngleRadians + segment.sweepRadians);

  return (
    angularDistance(segment.startAngleRadians, startFromPoint) <= angularTolerance &&
    angularDistance(segment.endAngleRadians, endFromPoint) <= angularTolerance &&
    angularDistance(segment.endAngleRadians, endFromSweep) <= angularTolerance
  );
}

function angularDistance(left: number, right: number) {
  const difference = Math.abs(normalizeAngle(left) - normalizeAngle(right));
  return Math.min(difference, 2 * Math.PI - difference);
}

function radialPointMatchesRadius(
  center: { x: number; y: number },
  point: { x: number; y: number },
  radius: number,
  epsilon: number
) {
  const radialX = point.x - center.x;
  const radialY = point.y - center.y;
  const radialDistance = Math.hypot(radialX, radialY);
  if (!Number.isFinite(radialDistance) || radialDistance === 0) return false;

  const representationTolerance =
    (Math.abs(radialX) / radialDistance) * halfFloatingStep(point.x) +
    (Math.abs(radialY) / radialDistance) * halfFloatingStep(point.y);
  const arithmeticTolerance =
    64 * Number.EPSILON * Math.max(1, radius, radialDistance);
  const tolerance = Math.max(epsilon, representationTolerance, arithmeticTolerance);
  return Math.abs(radialDistance - radius) <= tolerance;
}

function halfFloatingStep(value: number) {
  const upward = nextUp(value) - value;
  const downward = value - nextDown(value);
  const finiteSteps = [upward, downward].filter(
    (step) => Number.isFinite(step) && step >= 0
  );
  return (finiteSteps.length > 0 ? Math.max(...finiteSteps) : 0) / 2;
}

function nonFiniteGeometryDiagnostic(index: number, segment: PathSegment): PathDiagnostic {
  return {
    id: `diag_sanitize_${String(index + 1).padStart(4, '0')}`,
    severity: 'error',
    code: 'non-finite-geometry',
    message: `Removed segment ${segment.id} because executable or derived geometry is non-finite.`,
    relatedSegmentIds: [segment.id],
    details: sourceDetails(segment)
  };
}

function invalidCircularGeometryDiagnostic(
  index: number,
  segment: PathSegment
): PathDiagnostic {
  return {
    id: `diag_sanitize_${String(index + 1).padStart(4, '0')}`,
    severity: 'error',
    code: 'invalid-arc',
    message: `Removed segment ${segment.id} because its finite circular fields do not describe representable executable geometry.`,
    relatedSegmentIds: [segment.id],
    details: sourceDetails(segment)
  };
}

function duplicateDiagnostic(
  index: number,
  representative: PathSegment,
  duplicates: PathSegment[]
): PathDiagnostic {
  const allSegments = [representative, ...duplicates];
  return {
    id: `diag_sanitize_${String(index + 1).padStart(4, '0')}`,
    severity: 'error',
    code: 'duplicate-segment',
    message: `Kept first segment ${representative.id} and removed ${duplicates.length} direction-independent duplicate${duplicates.length === 1 ? '' : 's'}.`,
    relatedSegmentIds: allSegments.map((segment) => segment.id),
    details: {
      retainedSegmentId: representative.id,
      sources: allSegments.map(sourceDetails)
    }
  };
}

function overlapDiagnostic(
  index: number,
  left: PathSegment,
  right: PathSegment
): PathDiagnostic {
  return {
    id: `diag_sanitize_${String(index + 1).padStart(4, '0')}`,
    severity: 'error',
    code: 'overlapping-segment',
    message: `Segments ${left.id} and ${right.id} overlap along a positive-length geometric locus.`,
    relatedSegmentIds: [left.id, right.id],
    details: { sources: [sourceDetails(left), sourceDetails(right)] }
  };
}

function sourceDetails(segment: PathSegment) {
  return {
    segmentId: segment.id,
    layer: segment.layer,
    source: copySource(segment.source),
    sourceEntityIndex: segment.source.sourceEntityIndex,
    sourceEntityHandle: segment.source.sourceEntityHandle ?? null,
    sourceEntityType: segment.source.sourceEntityType,
    sourceSubIndex: segment.source.sourceSubIndex ?? null
  };
}

function copySource(source: SegmentSourceRef): SegmentSourceRef {
  return {
    ...source,
    ...(source.approximation
      ? { approximation: { ...source.approximation } }
      : {}),
    ...(source.dxf
      ? {
          dxf: {
            ...source.dxf,
            insertChain: source.dxf.insertChain.map((insert) => ({
              ...insert,
              transform: {
                ...insert.transform,
                insertion: { ...insert.transform.insertion },
                ...(insert.transform.localOffset
                  ? { localOffset: { ...insert.transform.localOffset } }
                  : {}),
                ...(insert.transform.blockBasePoint
                  ? { blockBasePoint: { ...insert.transform.blockBasePoint } }
                  : {})
              }
            }))
          }
        }
      : {}),
    ...(source.edit
      ? { edit: { ...source.edit, point: { ...source.edit.point } } }
      : {})
  };
}
