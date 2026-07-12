import {
  arcParameterAtRadial,
  cross,
  distance,
  dot,
  normalizeAngle,
  orientedSegmentEnd,
  orientedSegmentStart,
  pointOnArcAtParameter,
  pointOnCircle,
  requiredSegment,
  resolvePathPlanningOptions,
  segmentMap,
  vector
} from './segments';
import { SpatialHash } from './spatialIndex';
import type {
  ArcPathSegment,
  Bounds2,
  CirclePathSegment,
  LinePathSegment,
  PathChain,
  PathDiagnostic,
  PathPlanningOptions,
  PathSegment,
  Point2
} from './types';

const FULL_TURN = 2 * Math.PI;
const ROUNDING_FACTOR = 64;

type CircularPathSegment = ArcPathSegment | CirclePathSegment;

export type SegmentIntersection =
  | { kind: 'none'; points: [] }
  | { kind: 'points'; points: Point2[] }
  | { kind: 'overlap'; points: Point2[] };

interface IndexedSegment {
  index: number;
  segment: PathSegment;
}

interface AdjacentJunction {
  leftPoint: Point2;
  rightPoint: Point2;
  tolerance: number;
}

export function classifyPathSegmentIntersection(
  left: PathSegment,
  right: PathSegment,
  coincidenceEpsilon: number
): SegmentIntersection {
  const epsilon = finiteNonNegative(coincidenceEpsilon);

  if (left.kind === 'line' && right.kind === 'line') {
    return intersectLines(left, right, epsilon);
  }

  if (left.kind === 'line' && isCircular(right)) {
    return intersectLineCircular(left, right, epsilon);
  }

  if (isCircular(left) && right.kind === 'line') {
    return intersectLineCircular(right, left, epsilon);
  }

  if (isCircular(left) && isCircular(right)) {
    return intersectCircularSegments(left, right, epsilon);
  }

  return noIntersection();
}

export function pathSegmentsShareSweptLocus(
  left: PathSegment,
  right: PathSegment,
  coincidenceEpsilon: number
) {
  const epsilon = finiteNonNegative(coincidenceEpsilon);

  if (left.kind === 'line' || right.kind === 'line') {
    if (left.kind !== 'line' || right.kind !== 'line') return false;
    return (
      (pointsWithin(left.start, right.start, epsilon) &&
        pointsWithin(left.end, right.end, epsilon)) ||
      (pointsWithin(left.start, right.end, epsilon) &&
        pointsWithin(left.end, right.start, epsilon))
    );
  }

  if (!sameCircularSupport(left, right, epsilon)) return false;
  const leftFull = isFullCircularSegment(left, epsilon);
  const rightFull = isFullCircularSegment(right, epsilon);
  if (leftFull || rightFull) return leftFull && rightFull;
  if (left.kind !== 'arc' || right.kind !== 'arc') return false;

  const lengthsMatch =
    Math.abs(Math.abs(left.sweepRadians) * left.radius - Math.abs(right.sweepRadians) * right.radius) <=
    epsilon;
  const endpointsMatch =
    (pointsWithin(left.start, right.start, epsilon) &&
      pointsWithin(left.end, right.end, epsilon)) ||
    (pointsWithin(left.start, right.end, epsilon) &&
      pointsWithin(left.end, right.start, epsilon));
  if (!lengthsMatch || !endpointsMatch) return false;

  const leftMidpoint = pointOnArcAtParameter(
    left,
    { segmentId: left.id, reversed: false },
    0.5
  );
  const rightMidpoint = pointOnArcAtParameter(
    right,
    { segmentId: right.id, reversed: false },
    0.5
  );
  return (
    pointIsOnCircularSegment(leftMidpoint, right, epsilon) &&
    pointIsOnCircularSegment(rightMidpoint, left, epsilon)
  );
}

export function findPathSegmentIntersectionDiagnostics(
  segments: PathSegment[],
  chains: PathChain[],
  options: PathPlanningOptions = {}
) {
  const resolved = resolvePathPlanningOptions(options);
  const epsilon = resolved.coincidenceEpsilon;
  const diagnostics: PathDiagnostic[] = [];
  const allowedJunctions = adjacentJunctions(chains, segments, epsilon);
  const chainIdsBySegmentId = chainIdsBySegment(chains);
  const index = new SpatialHash<IndexedSegment>({
    cellSize: spatialCellSizeForSegments(segments, epsilon),
    maxCellsPerBounds: 256
  });

  segments.forEach((segment, segmentIndex) => {
    const candidates = index
      .queryBounds(expandBounds(segment.bounds, epsilon))
      .sort((left, right) => left.index - right.index);

    for (const candidate of candidates) {
      const relation = classifyPathSegmentIntersection(candidate.segment, segment, epsilon);
      if (relation.kind !== 'points') continue;
      const disallowedPoints = relation.points.filter(
        (point) =>
          !isAllowedAdjacentEndpointTouch(
            candidate.segment,
            segment,
            point,
            allowedJunctions
          )
      );
      if (disallowedPoints.length === 0) continue;

      const relatedSegmentIds = [candidate.segment.id, segment.id];
      diagnostics.push({
        id: `diag_intersection_${String(diagnostics.length + 1).padStart(4, '0')}`,
        severity: 'error',
        code: 'intersecting-topology',
        message: `Segments ${candidate.segment.id} and ${segment.id} meet outside a valid adjacent endpoint junction.`,
        relatedSegmentIds,
        relatedChainIds: uniqueSorted(
          relatedSegmentIds.flatMap((segmentId) => chainIdsBySegmentId.get(segmentId) ?? [])
        ),
        details: { points: disallowedPoints }
      });
    }

    index.insertBounds(segment.bounds, { index: segmentIndex, segment });
  });

  return diagnostics;
}

export function spatialCellSizeForSegments(segments: PathSegment[], epsilon: number) {
  const spans = segments
    .map((segment) => {
      const width = finiteSpan(segment.bounds.minX, segment.bounds.maxX);
      const height = finiteSpan(segment.bounds.minY, segment.bounds.maxY);
      return Math.max(width, height);
    })
    .filter((span) => Number.isFinite(span) && span > 0)
    .sort((left, right) => left - right);
  const median = spans[Math.floor(spans.length / 2)];
  if (Number.isFinite(median) && median > 0) return median;
  return Number.isFinite(epsilon) && epsilon > 0 ? epsilon : 1;
}

export function expandBounds(bounds: Bounds2, amount: number): Bounds2 {
  const safeAmount = finiteNonNegative(amount);
  return {
    minX: finiteDifference(bounds.minX, safeAmount, -Number.MAX_VALUE),
    minY: finiteDifference(bounds.minY, safeAmount, -Number.MAX_VALUE),
    maxX: finiteSum(bounds.maxX, safeAmount, Number.MAX_VALUE),
    maxY: finiteSum(bounds.maxY, safeAmount, Number.MAX_VALUE)
  };
}

function intersectLines(
  left: LinePathSegment,
  right: LinePathSegment,
  epsilon: number
): SegmentIntersection {
  const leftVector = vector(left.start, left.end);
  const rightVector = vector(right.start, right.end);
  const leftLength = Math.hypot(leftVector.x, leftVector.y);
  const rightLength = Math.hypot(rightVector.x, rightVector.y);
  if (leftLength === 0 || rightLength === 0) return noIntersection();

  const leftUnit = { x: leftVector.x / leftLength, y: leftVector.y / leftLength };
  const rightUnit = { x: rightVector.x / rightLength, y: rightVector.y / rightLength };
  const denominator = cross(leftUnit, rightUnit);
  const offset = vector(left.start, right.start);
  const tolerance = linearTolerance(
    epsilon,
    leftLength,
    rightLength,
    leftVector.x,
    leftVector.y,
    rightVector.x,
    rightVector.y,
    offset.x,
    offset.y
  );

  if (Math.abs(denominator) <= ROUNDING_FACTOR * Number.EPSILON) {
    const startDistance = Math.abs(cross(offset, leftUnit));
    const endDistance = Math.abs(cross(vector(left.start, right.end), leftUnit));
    if (startDistance > tolerance || endDistance > tolerance) return noIntersection();

    const rightStart = dot(offset, leftUnit);
    const rightEnd = dot(vector(left.start, right.end), leftUnit);
    const overlapStart = Math.max(0, Math.min(rightStart, rightEnd));
    const overlapEnd = Math.min(leftLength, Math.max(rightStart, rightEnd));
    if (overlapEnd < overlapStart - tolerance) return noIntersection();
    if (overlapEnd - overlapStart > tolerance) return overlapIntersection();

    const coordinate = Math.min(
      leftLength,
      Math.max(0, stableMidpoint(overlapStart, overlapEnd))
    );
    return pointIntersection([
      {
        x: left.start.x + leftUnit.x * coordinate,
        y: left.start.y + leftUnit.y * coordinate
      }
    ], tolerance);
  }

  const leftDistance = cross(offset, rightUnit) / denominator;
  const rightDistance = cross(offset, leftUnit) / denominator;
  if (
    leftDistance < -tolerance ||
    leftDistance > leftLength + tolerance ||
    rightDistance < -tolerance ||
    rightDistance > rightLength + tolerance
  ) {
    return noIntersection();
  }

  const leftPoint = {
    x: left.start.x + leftUnit.x * leftDistance,
    y: left.start.y + leftUnit.y * leftDistance
  };
  const rightPoint = {
    x: right.start.x + rightUnit.x * rightDistance,
    y: right.start.y + rightUnit.y * rightDistance
  };
  return pointIntersection(
    [
      {
        x: stableMidpoint(leftPoint.x, rightPoint.x),
        y: stableMidpoint(leftPoint.y, rightPoint.y)
      }
    ],
    tolerance
  );
}

function intersectLineCircular(
  line: LinePathSegment,
  circular: CircularPathSegment,
  epsilon: number
): SegmentIntersection {
  const lineVector = vector(line.start, line.end);
  const lineLength = Math.hypot(lineVector.x, lineVector.y);
  if (lineLength === 0 || circular.radius <= 0) return noIntersection();

  const unit = { x: lineVector.x / lineLength, y: lineVector.y / lineLength };
  const toCenter = vector(line.start, circular.center);
  const projection = dot(toCenter, unit);
  const closest = {
    x: line.start.x + unit.x * projection,
    y: line.start.y + unit.y * projection
  };
  const centerDistance = distance(closest, circular.center);
  const tolerance = linearTolerance(
    epsilon,
    lineLength,
    lineVector.x,
    lineVector.y,
    toCenter.x,
    toCenter.y,
    projection,
    centerDistance,
    circular.radius
  );
  if (centerDistance > circular.radius + tolerance) return noIntersection();

  const offsets =
    Math.abs(centerDistance - circular.radius) <= tolerance
      ? [0]
      : [
          -stableChordHalfLength(circular.radius, centerDistance),
          stableChordHalfLength(circular.radius, centerDistance)
        ];
  const points = offsets
    .map((offset) => ({ distanceAlongLine: projection + offset }))
    .filter(
      ({ distanceAlongLine }) =>
        distanceAlongLine >= -tolerance && distanceAlongLine <= lineLength + tolerance
    )
    .map(({ distanceAlongLine }) => ({
      point: {
        x: line.start.x + unit.x * distanceAlongLine,
        y: line.start.y + unit.y * distanceAlongLine
      },
      radial: {
        x: -toCenter.x + unit.x * distanceAlongLine,
        y: -toCenter.y + unit.y * distanceAlongLine
      }
    }))
    .filter(({ point, radial }) =>
      pointIsOnCircularSegment(point, circular, tolerance, epsilon, radial)
    )
    .map(({ point }) => point);

  return pointIntersection(points, tolerance);
}

function intersectCircularSegments(
  left: CircularPathSegment,
  right: CircularPathSegment,
  epsilon: number
): SegmentIntersection {
  if (sameCircularSupport(left, right, epsilon)) {
    return sameCircularSupportRelation(left, right, epsilon);
  }

  const centerDistance = distance(left.center, right.center);
  const centerVector = vector(left.center, right.center);
  const tolerance = linearTolerance(
    epsilon,
    centerDistance,
    centerVector.x,
    centerVector.y,
    left.radius,
    right.radius
  );
  if (
    !Number.isFinite(centerDistance) ||
    centerDistance > left.radius + right.radius + tolerance ||
    centerDistance < Math.abs(left.radius - right.radius) - tolerance ||
    centerDistance <= epsilon
  ) {
    return noIntersection();
  }

  const scale = Math.max(left.radius, right.radius, centerDistance);
  const leftRadius = left.radius / scale;
  const rightRadius = right.radius / scale;
  const distanceScaled = centerDistance / scale;
  const baseDistance =
    (leftRadius * leftRadius - rightRadius * rightRadius + distanceScaled * distanceScaled) /
    (2 * distanceScaled);
  const halfChordSquared = leftRadius * leftRadius - baseDistance * baseDistance;
  if (halfChordSquared < -ROUNDING_FACTOR * Number.EPSILON) return noIntersection();

  const centerUnit = {
    x: centerVector.x / centerDistance,
    y: centerVector.y / centerDistance
  };
  const base = {
    x: left.center.x + centerUnit.x * (baseDistance * scale),
    y: left.center.y + centerUnit.y * (baseDistance * scale)
  };
  const baseRadial = {
    x: centerUnit.x * (baseDistance * scale),
    y: centerUnit.y * (baseDistance * scale)
  };
  const halfChord = scale * Math.sqrt(Math.max(0, halfChordSquared));
  const normal = { x: -centerUnit.y, y: centerUnit.x };
  const candidates =
    halfChord <= tolerance
      ? [
          {
            point: base,
            leftRadial: baseRadial,
            rightRadial: {
              x: baseRadial.x - centerVector.x,
              y: baseRadial.y - centerVector.y
            }
          }
        ]
      : [
          circularCandidate(1),
          circularCandidate(-1)
        ];

  return pointIntersection(
    candidates
      .filter(
        ({ point, leftRadial, rightRadial }) =>
          pointIsOnCircularSegment(point, left, tolerance, epsilon, leftRadial) &&
          pointIsOnCircularSegment(point, right, tolerance, epsilon, rightRadial)
      )
      .map(({ point }) => point),
    tolerance
  );

  function circularCandidate(sign: 1 | -1) {
    const offset = {
      x: sign * normal.x * halfChord,
      y: sign * normal.y * halfChord
    };
    const leftRadial = {
      x: baseRadial.x + offset.x,
      y: baseRadial.y + offset.y
    };
    return {
      point: { x: base.x + offset.x, y: base.y + offset.y },
      leftRadial,
      rightRadial: {
        x: leftRadial.x - centerVector.x,
        y: leftRadial.y - centerVector.y
      }
    };
  }
}

function sameCircularSupportRelation(
  left: CircularPathSegment,
  right: CircularPathSegment,
  epsilon: number
): SegmentIntersection {
  const leftCoverage = circularCoverage(left, epsilon);
  const rightCoverage = circularCoverage(right, epsilon);
  if (leftCoverage.full && rightCoverage.full) return overlapIntersection();

  const angularTolerance = Math.max(
    ROUNDING_FACTOR * Number.EPSILON * FULL_TURN,
    epsilon / Math.max(left.radius, right.radius, Number.MIN_VALUE)
  );
  const touchingAngles: number[] = [];

  for (const leftInterval of leftCoverage.intervals) {
    for (const rightInterval of rightCoverage.intervals) {
      const start = Math.max(leftInterval.start, rightInterval.start);
      const end = Math.min(leftInterval.end, rightInterval.end);
      if (end < start - angularTolerance) continue;
      if (end - start > angularTolerance) return overlapIntersection();
      touchingAngles.push(normalizeAngle((start + end) / 2));
    }
  }

  const leftTouchesLower = leftCoverage.intervals.some(
    (interval) => interval.start <= angularTolerance
  );
  const leftTouchesUpper = leftCoverage.intervals.some(
    (interval) => interval.end >= FULL_TURN - angularTolerance
  );
  const rightTouchesLower = rightCoverage.intervals.some(
    (interval) => interval.start <= angularTolerance
  );
  const rightTouchesUpper = rightCoverage.intervals.some(
    (interval) => interval.end >= FULL_TURN - angularTolerance
  );
  if (
    (leftTouchesLower && rightTouchesUpper) ||
    (leftTouchesUpper && rightTouchesLower)
  ) {
    touchingAngles.push(0);
  }

  const points = touchingAngles.map((angle) => pointOnCircle(left.center, left.radius, angle));
  return pointIntersection(points, epsilon);
}

function circularCoverage(segment: CircularPathSegment, epsilon: number) {
  if (isFullCircularSegment(segment, epsilon)) {
    return { full: true, intervals: [{ start: 0, end: FULL_TURN }] };
  }

  const arc = segment as ArcPathSegment;
  const length = Math.abs(arc.sweepRadians);
  const start = normalizeAngle(
    arc.sweepRadians > 0 ? arc.startAngleRadians : arc.startAngleRadians + arc.sweepRadians
  );
  const end = start + length;
  if (end <= FULL_TURN) {
    return { full: false, intervals: [{ start, end }] };
  }
  return {
    full: false,
    intervals: [
      { start, end: FULL_TURN },
      { start: 0, end: end - FULL_TURN }
    ]
  };
}

function pointIsOnCircularSegment(
  point: Point2,
  segment: CircularPathSegment,
  radialTolerance: number,
  sweepEpsilon = radialTolerance,
  radial = vector(segment.center, point)
) {
  if (Math.abs(Math.hypot(radial.x, radial.y) - segment.radius) > radialTolerance) return false;
  if (segment.kind === 'circle' || isFullCircularSegment(segment, sweepEpsilon)) return true;
  if (
    pointsWithinPerAxisRoundoff(point, segment.start, sweepEpsilon) ||
    pointsWithinPerAxisRoundoff(point, segment.end, sweepEpsilon)
  ) {
    return true;
  }
  return (
    arcParameterAtRadial(segment, { segmentId: segment.id, reversed: false }, radial) != null
  );
}

function sameCircularSupport(
  left: CircularPathSegment,
  right: CircularPathSegment,
  epsilon: number
) {
  return (
    pointsWithin(left.center, right.center, epsilon) &&
    Math.abs(left.radius - right.radius) <= epsilon
  );
}

function isFullCircularSegment(segment: CircularPathSegment, epsilon: number) {
  if (segment.kind === 'circle') return true;
  return Math.abs(FULL_TURN - Math.abs(segment.sweepRadians)) * segment.radius <= epsilon;
}

function stableChordHalfLength(radius: number, centerDistance: number) {
  const ratio = centerDistance / radius;
  return radius * Math.sqrt(Math.max(0, (1 - ratio) * (1 + ratio)));
}

function adjacentJunctions(
  chains: PathChain[],
  segments: PathSegment[],
  epsilon: number
) {
  const segmentsById = segmentMap(segments);
  const junctions = new Map<string, AdjacentJunction[]>();

  for (const chain of chains) {
    for (let index = 0; index < chain.segmentRefs.length - 1; index++) {
      addAdjacentJunction(
        chain.segmentRefs[index],
        chain.segmentRefs[index + 1],
        junctions,
        segmentsById,
        epsilon
      );
    }
    if (chain.closed && chain.segmentRefs.length > 1) {
      addAdjacentJunction(
        chain.segmentRefs[chain.segmentRefs.length - 1],
        chain.segmentRefs[0],
        junctions,
        segmentsById,
        epsilon
      );
    }
  }

  return junctions;
}

function addAdjacentJunction(
  leftRef: PathChain['segmentRefs'][number],
  rightRef: PathChain['segmentRefs'][number],
  junctions: Map<string, AdjacentJunction[]>,
  segmentsById: Map<string, PathSegment>,
  epsilon: number
) {
  if (leftRef.segmentId === rightRef.segmentId) return;
  const left = requiredSegment(segmentsById, leftRef.segmentId);
  const right = requiredSegment(segmentsById, rightRef.segmentId);
  const leftPoint = orientedSegmentEnd(left, leftRef);
  const rightPoint = orientedSegmentStart(right, rightRef);
  const key = segmentPairKey(left.id, right.id);
  const entries = junctions.get(key) ?? [];
  entries.push({
    leftPoint,
    rightPoint,
    tolerance: epsilon + distance(leftPoint, rightPoint)
  });
  junctions.set(key, entries);
}

function isAllowedAdjacentEndpointTouch(
  left: PathSegment,
  right: PathSegment,
  point: Point2,
  allowedJunctions: Map<string, AdjacentJunction[]>
) {
  return (allowedJunctions.get(segmentPairKey(left.id, right.id)) ?? []).some(
    (junction) =>
      pointsWithin(junction.leftPoint, point, junction.tolerance) &&
      pointsWithin(junction.rightPoint, point, junction.tolerance) &&
      segmentHasEndpointAt(left, point, junction.tolerance) &&
      segmentHasEndpointAt(right, point, junction.tolerance)
  );
}

function segmentHasEndpointAt(segment: PathSegment, point: Point2, epsilon: number) {
  if (segment.kind === 'circle') return false;
  return pointsWithin(segment.start, point, epsilon) || pointsWithin(segment.end, point, epsilon);
}

function chainIdsBySegment(chains: PathChain[]) {
  const result = new Map<string, string[]>();
  for (const chain of chains) {
    for (const ref of chain.segmentRefs) {
      const ids = result.get(ref.segmentId) ?? [];
      if (!ids.includes(chain.id)) ids.push(chain.id);
      result.set(ref.segmentId, ids);
    }
  }
  return result;
}

function segmentPairKey(leftId: string, rightId: string) {
  return leftId < rightId ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;
}

function pointIntersection(points: Point2[], epsilon: number): SegmentIntersection {
  const unique = deduplicatePoints(points, epsilon);
  return unique.length > 0 ? { kind: 'points', points: unique } : noIntersection();
}

function overlapIntersection(): SegmentIntersection {
  return { kind: 'overlap', points: [] };
}

function noIntersection(): SegmentIntersection {
  return { kind: 'none', points: [] };
}

function deduplicatePoints(points: Point2[], epsilon: number) {
  const finite = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const unique: Point2[] = [];
  for (const point of finite) {
    if (!unique.some((candidate) => pointsWithin(candidate, point, epsilon))) {
      unique.push({ x: point.x === 0 ? 0 : point.x, y: point.y === 0 ? 0 : point.y });
    }
  }
  return unique.sort((left, right) => left.x - right.x || left.y - right.y);
}

function pointsWithin(left: Point2, right: Point2, epsilon: number) {
  return distance(left, right) <= epsilon;
}

function isCircular(segment: PathSegment): segment is CircularPathSegment {
  return segment.kind === 'arc' || segment.kind === 'circle';
}

function linearTolerance(epsilon: number, ...values: number[]) {
  const magnitude = Math.max(1, ...values.map((value) => Math.abs(value)));
  return Math.max(epsilon, ROUNDING_FACTOR * Number.EPSILON * magnitude);
}

function coordinateRoundoffTolerance(epsilon: number, ...coordinates: number[]) {
  const magnitude = Math.max(1, ...coordinates.map((value) => Math.abs(value)));
  return Math.max(epsilon, 8 * Number.EPSILON * magnitude);
}

function stableMidpoint(left: number, right: number) {
  const difference = right - left;
  return Number.isFinite(difference)
    ? left + difference / 2
    : left / 2 + right / 2;
}

function pointsWithinPerAxisRoundoff(left: Point2, right: Point2, epsilon: number) {
  const xTolerance = coordinateRoundoffTolerance(epsilon, left.x, right.x);
  const yTolerance = coordinateRoundoffTolerance(epsilon, left.y, right.y);
  return (
    Math.abs(left.x - right.x) <= xTolerance &&
    Math.abs(left.y - right.y) <= yTolerance
  );
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function finiteSpan(minimum: number, maximum: number) {
  const span = maximum - minimum;
  return Number.isFinite(span) ? Math.max(0, span) : Number.MAX_VALUE;
}

function finiteDifference(value: number, amount: number, fallback: number) {
  const result = value - amount;
  return Number.isFinite(result) ? result : fallback;
}

function finiteSum(value: number, amount: number, fallback: number) {
  const result = value + amount;
  return Number.isFinite(result) ? result : fallback;
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}
