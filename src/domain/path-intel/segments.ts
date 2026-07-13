import type {
  ArcPathSegment,
  Bounds2,
  CirclePathSegment,
  LinePathSegment,
  OrientedSegmentRef,
  PathPlanningOptions,
  PathSegment,
  Point2,
  SegmentId,
  SegmentSourceRef
} from './types';
import { DEFAULT_PATH_PLANNING_OPTIONS } from './types';

const FULL_TURN = Math.PI * 2;
const ANGULAR_ULP_FACTOR = 32;
const SMALL_SWEEP_SERIES_LIMIT = 1e-3;
const FLOAT64_STEP_BUFFER = new ArrayBuffer(8);
const FLOAT64_STEP_VIEW = new DataView(FLOAT64_STEP_BUFFER);

export interface CreateLineSegmentInput {
  id: SegmentId;
  source: SegmentSourceRef;
  start: Point2;
  end: Point2;
}

export interface CreateArcSegmentInput {
  id: SegmentId;
  source: SegmentSourceRef;
  start: Point2;
  end: Point2;
  center: Point2;
  radius?: number;
  clockwise: boolean;
  sweepRadians?: number;
}

export interface CreateCircleSegmentInput {
  id: SegmentId;
  source: SegmentSourceRef;
  center: Point2;
  preferredStart?: Point2;
  radius: number;
}

export function resolvePathPlanningOptions(options: PathPlanningOptions = {}) {
  return {
    ...DEFAULT_PATH_PLANNING_OPTIONS,
    ...options,
    endpointTolerance: Math.max(0, options.endpointTolerance ?? DEFAULT_PATH_PLANNING_OPTIONS.endpointTolerance),
    coincidenceEpsilon: Math.max(
      0,
      options.coincidenceEpsilon ?? DEFAULT_PATH_PLANNING_OPTIONS.coincidenceEpsilon
    ),
    approximationMaxAngleRadians: Math.max(
      Math.PI / 180,
      options.approximationMaxAngleRadians ??
        DEFAULT_PATH_PLANNING_OPTIONS.approximationMaxAngleRadians
    )
  };
}

export function createLineSegment(input: CreateLineSegmentInput): LinePathSegment {
  return {
    id: input.id,
    kind: 'line',
    source: input.source,
    layer: input.source.layer,
    start: copyPoint(input.start),
    end: copyPoint(input.end),
    length: distance(input.start, input.end),
    bounds: boundsFromPoints([input.start, input.end])
  };
}

export function createArcSegment(input: CreateArcSegmentInput): ArcPathSegment {
  const radius = input.radius ?? distance(input.center, input.start);
  const startAngleRadians = normalizeAngle(
    Math.atan2(input.start.y - input.center.y, input.start.x - input.center.x)
  );
  const inferredEndAngleRadians = normalizeAngle(
    Math.atan2(input.end.y - input.center.y, input.end.x - input.center.x)
  );
  const sweepRadians =
    input.sweepRadians == null
      ? signedSweep(startAngleRadians, inferredEndAngleRadians, input.clockwise)
      : validatedExplicitArcSweep(input.sweepRadians, input.clockwise);
  const endAngleRadians =
    input.sweepRadians == null
      ? inferredEndAngleRadians
      : normalizeAngle(startAngleRadians + sweepRadians);

  return {
    id: input.id,
    kind: 'arc',
    source: input.source,
    layer: input.source.layer,
    start: copyPoint(input.start),
    end: copyPoint(input.end),
    center: copyPoint(input.center),
    radius,
    startAngleRadians,
    endAngleRadians,
    sweepRadians,
    clockwise: input.clockwise,
    length: Math.abs(radius * sweepRadians),
    bounds: arcBounds(
      input.center,
      radius,
      startAngleRadians,
      sweepRadians,
      input.start,
      input.end
    )
  };
}

function validatedExplicitArcSweep(sweepRadians: number, clockwise: boolean) {
  const hasValidMagnitude =
    Number.isFinite(sweepRadians) && sweepRadians !== 0 && Math.abs(sweepRadians) <= FULL_TURN;
  const hasValidDirection = clockwise ? sweepRadians < 0 : sweepRadians > 0;
  if (!hasValidMagnitude || !hasValidDirection) {
    throw new RangeError('Explicit arc sweep must be finite, nonzero, at most one turn, and match its direction.');
  }
  return sweepRadians;
}

export function createCircleSegment(input: CreateCircleSegmentInput): CirclePathSegment {
  const preferredStart = input.preferredStart ?? {
    x: input.center.x + input.radius,
    y: input.center.y
  };

  return {
    id: input.id,
    kind: 'circle',
    source: input.source,
    layer: input.source.layer,
    center: copyPoint(input.center),
    radius: input.radius,
    preferredStart,
    start: copyPoint(preferredStart),
    end: copyPoint(preferredStart),
    length: FULL_TURN * input.radius,
    bounds: {
      minX: input.center.x - input.radius,
      minY: input.center.y - input.radius,
      maxX: input.center.x + input.radius,
      maxY: input.center.y + input.radius
    }
  };
}

export function segmentMap(segments: PathSegment[]) {
  return new Map(segments.map((segment) => [segment.id, segment]));
}

export function copyPoint(point: Point2): Point2 {
  return { x: point.x, y: point.y };
}

export function distance(a: Point2, b: Point2) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function pointsEqual(a: Point2, b: Point2, epsilon = DEFAULT_PATH_PLANNING_OPTIONS.coincidenceEpsilon) {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

export function endpointKey(segmentId: SegmentId, side: 'start' | 'end') {
  return `${segmentId}:${side}`;
}

export function boundsFromPoints(points: Point2[]): Bounds2 {
  if (points.length === 0) return emptyBounds();

  return points.reduce(
    (bounds, point) => ({
      minX: normalizeSignedZero(Math.min(bounds.minX, point.x)),
      minY: normalizeSignedZero(Math.min(bounds.minY, point.y)),
      maxX: normalizeSignedZero(Math.max(bounds.maxX, point.x)),
      maxY: normalizeSignedZero(Math.max(bounds.maxY, point.y))
    }),
    emptyBounds()
  );
}

export function emptyBounds(): Bounds2 {
  return {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity
  };
}

export function mergeBounds(a: Bounds2, b: Bounds2): Bounds2 {
  return {
    minX: normalizeSignedZero(Math.min(a.minX, b.minX)),
    minY: normalizeSignedZero(Math.min(a.minY, b.minY)),
    maxX: normalizeSignedZero(Math.max(a.maxX, b.maxX)),
    maxY: normalizeSignedZero(Math.max(a.maxY, b.maxY))
  };
}

function normalizeSignedZero(value: number) {
  return value === 0 ? 0 : value;
}

export function boundsAreFinite(bounds: Bounds2) {
  return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite);
}

export function normalizeAngle(angle: number) {
  return ((angle % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

export function signedSweep(startAngle: number, endAngle: number, clockwise: boolean) {
  if (clockwise) {
    let sweep = endAngle - startAngle;
    if (sweep >= 0) sweep -= FULL_TURN;
    return sweep;
  }

  let sweep = endAngle - startAngle;
  if (sweep <= 0) sweep += FULL_TURN;
  return sweep;
}

export function pointOnCircle(center: Point2, radius: number, angle: number): Point2 {
  return {
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle)
  };
}

export function arcBounds(
  center: Point2,
  radius: number,
  startAngle: number,
  sweepRadians: number,
  exactStart?: Point2,
  exactEnd?: Point2
): Bounds2 {
  let bounds = boundsFromPoints(
    exactStart && exactEnd
      ? [exactStart, exactEnd]
      : [
          pointOnCircle(center, radius, startAngle),
          pointOnCircle(center, radius, startAngle + sweepRadians)
        ]
  );

  if (exactStart && exactEnd) {
    const startRadial = normalizedDirection({
      x: exactStart.x - center.x,
      y: exactStart.y - center.y
    });

    if (startRadial) {
      for (const cardinal of [
        { radial: { x: 1, y: 0 }, extremum: 'maxX' as const },
        { radial: { x: 0, y: 1 }, extremum: 'maxY' as const },
        { radial: { x: -1, y: 0 }, extremum: 'minX' as const },
        { radial: { x: 0, y: -1 }, extremum: 'minY' as const }
      ]) {
        const delta = directedAngularDelta(startRadial, cardinal.radial, sweepRadians);
        if (
          angularDeltaIsOnSweep(delta, sweepRadians) &&
          angularDeltaIsStrictlyInterior(delta, sweepRadians)
        ) {
          const point = pointFromExactArcStart(exactStart, center, delta);
          bounds = mergeBounds(
            bounds,
            outwardRoundedExtremumBounds(point, cardinal.extremum)
          );
        }
      }
      return bounds;
    }
  }

  for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    if (angleIsOnSweep(angle, startAngle, sweepRadians)) {
      bounds = mergeBounds(bounds, boundsFromPoints([pointOnCircle(center, radius, angle)]));
    }
  }

  return bounds;
}

function outwardRoundedExtremumBounds(
  point: Point2,
  extremum: 'minX' | 'minY' | 'maxX' | 'maxY'
) {
  const bounds = boundsFromPoints([point]);
  // Cover both the analytic extremum evaluation and a later parameter round trip.
  if (extremum === 'minX') bounds.minX = nextDown(nextDown(point.x));
  if (extremum === 'minY') bounds.minY = nextDown(nextDown(point.y));
  if (extremum === 'maxX') bounds.maxX = nextUp(nextUp(point.x));
  if (extremum === 'maxY') bounds.maxY = nextUp(nextUp(point.y));
  return bounds;
}

export function nextUp(value: number) {
  if (Number.isNaN(value) || value === Number.POSITIVE_INFINITY) return value;
  if (value === Number.NEGATIVE_INFINITY) return -Number.MAX_VALUE;
  if (value === 0) return Number.MIN_VALUE;

  FLOAT64_STEP_VIEW.setFloat64(0, value);
  const bits = FLOAT64_STEP_VIEW.getBigUint64(0);
  FLOAT64_STEP_VIEW.setBigUint64(0, bits + (value > 0 ? 1n : -1n));
  return FLOAT64_STEP_VIEW.getFloat64(0);
}

export function nextDown(value: number) {
  if (Number.isNaN(value) || value === Number.NEGATIVE_INFINITY) return value;
  if (value === Number.POSITIVE_INFINITY) return Number.MAX_VALUE;
  if (value === 0) return -Number.MIN_VALUE;

  FLOAT64_STEP_VIEW.setFloat64(0, value);
  const bits = FLOAT64_STEP_VIEW.getBigUint64(0);
  FLOAT64_STEP_VIEW.setBigUint64(0, bits + (value > 0 ? -1n : 1n));
  return FLOAT64_STEP_VIEW.getFloat64(0);
}

export function angleIsOnSweep(
  angle: number,
  startAngle: number,
  sweepRadians: number,
  epsilon = DEFAULT_PATH_PLANNING_OPTIONS.coincidenceEpsilon
) {
  if (sweepRadians >= 0) {
    const delta = normalizeAngle(angle - startAngle);
    return delta <= sweepRadians + epsilon;
  }

  const delta = normalizeAngle(startAngle - angle);
  return delta <= -sweepRadians + epsilon;
}

export function getSegmentStart(segment: PathSegment): Point2 {
  return segment.kind === 'circle' ? segment.preferredStart : segment.start;
}

export function getSegmentEnd(segment: PathSegment): Point2 {
  return segment.kind === 'circle' ? segment.preferredStart : segment.end;
}

export function orientedSegmentStart(segment: PathSegment, ref: OrientedSegmentRef): Point2 {
  if (segment.kind === 'circle') return copyPoint(segment.preferredStart);
  return copyPoint(ref.reversed ? segment.end : segment.start);
}

export function orientedSegmentEnd(segment: PathSegment, ref: OrientedSegmentRef): Point2 {
  if (segment.kind === 'circle') return copyPoint(segment.preferredStart);
  return copyPoint(ref.reversed ? segment.start : segment.end);
}

export function orientedArcClockwise(segment: ArcPathSegment, ref: OrientedSegmentRef) {
  return ref.reversed ? !segment.clockwise : segment.clockwise;
}

export function orientedArcSweep(segment: ArcPathSegment, ref: OrientedSegmentRef) {
  return ref.reversed ? -segment.sweepRadians : segment.sweepRadians;
}

export function arcParameterAtAngle(
  segment: ArcPathSegment,
  ref: OrientedSegmentRef,
  angleRadians: number
) {
  if (!Number.isFinite(angleRadians)) return null;
  const exactQuadrant = exactQuadrantTrig(angleRadians);
  return arcParameterAtRadial(segment, ref, {
    x: exactQuadrant ? exactQuadrant.cosMinusOne + 1 : Math.cos(angleRadians),
    y: exactQuadrant?.sin ?? Math.sin(angleRadians)
  });
}

export function arcParameterAtRadial(
  segment: ArcPathSegment,
  ref: OrientedSegmentRef,
  radial: Point2
) {
  const targetRadial = normalizedDirection(radial);
  return targetRadial ? arcParameterForTargetRadial(segment, ref, targetRadial) : null;
}

export function arcParameterAtPoint(
  segment: ArcPathSegment,
  ref: OrientedSegmentRef,
  point: Point2
) {
  return arcParameterAtRadial(segment, ref, {
    x: point.x - segment.center.x,
    y: point.y - segment.center.y
  });
}

function arcParameterForTargetRadial(
  segment: ArcPathSegment,
  ref: OrientedSegmentRef,
  targetRadial: Point2
) {
  const start = orientedSegmentStart(segment, ref);
  const startRadial = normalizedDirection({
    x: start.x - segment.center.x,
    y: start.y - segment.center.y
  });
  if (!startRadial) return null;

  const sweep = orientedArcSweep(segment, ref);
  const delta = directedAngularDelta(startRadial, targetRadial, sweep);
  if (!angularDeltaIsOnSweep(delta, sweep)) return null;

  const parameter = delta / sweep;
  return Number.isFinite(parameter) ? Math.min(1, Math.max(0, parameter)) : null;
}

export function pointOnArcAtParameter(
  segment: ArcPathSegment,
  ref: OrientedSegmentRef,
  parameter: number
) {
  if (!Number.isFinite(parameter)) {
    throw new RangeError('Arc parameter must be finite.');
  }

  const clamped = Math.min(1, Math.max(0, parameter));
  if (clamped === 0) return orientedSegmentStart(segment, ref);
  if (clamped === 1) return orientedSegmentEnd(segment, ref);

  return pointFromExactArcStart(
    orientedSegmentStart(segment, ref),
    segment.center,
    orientedArcSweep(segment, ref) * clamped
  );
}

export function orientedCircleClockwise(_segment: CirclePathSegment, ref: OrientedSegmentRef) {
  return ref.reversed;
}

export function reverseSegmentRef(ref: OrientedSegmentRef): OrientedSegmentRef {
  return { segmentId: ref.segmentId, reversed: !ref.reversed };
}

export function reversePathRefs(refs: OrientedSegmentRef[]): OrientedSegmentRef[] {
  return refs.slice().reverse().map(reverseSegmentRef);
}

export function rotatePathRefs(refs: OrientedSegmentRef[], startIndex: number): OrientedSegmentRef[] {
  if (refs.length === 0) return [];
  const normalizedIndex = ((startIndex % refs.length) + refs.length) % refs.length;
  return [...refs.slice(normalizedIndex), ...refs.slice(0, normalizedIndex)];
}

export function pathStartPoint(refs: OrientedSegmentRef[], segmentsById: Map<SegmentId, PathSegment>) {
  const first = refs[0];
  if (!first) return null;
  return orientedSegmentStart(requiredSegment(segmentsById, first.segmentId), first);
}

export function pathEndPoint(refs: OrientedSegmentRef[], segmentsById: Map<SegmentId, PathSegment>) {
  const last = refs[refs.length - 1];
  if (!last) return null;
  return orientedSegmentEnd(requiredSegment(segmentsById, last.segmentId), last);
}

export function pathCutLength(refs: OrientedSegmentRef[], segmentsById: Map<SegmentId, PathSegment>) {
  return refs.reduce((total, ref) => total + requiredSegment(segmentsById, ref.segmentId).length, 0);
}

export function pathBounds(refs: OrientedSegmentRef[], segmentsById: Map<SegmentId, PathSegment>) {
  return refs.reduce(
    (bounds, ref) => mergeBounds(bounds, requiredSegment(segmentsById, ref.segmentId).bounds),
    emptyBounds()
  );
}

export function signedAreaOfPath(refs: OrientedSegmentRef[], segmentsById: Map<SegmentId, PathSegment>) {
  const firstRef = refs[0];
  if (!firstRef) return 0;

  const origin = orientedSegmentStart(requiredSegment(segmentsById, firstRef.segmentId), firstRef);
  let total = 0;
  let compensation = 0;

  for (const ref of refs) {
    const area = signedAreaOfSegmentRef(ref, segmentsById, origin);
    const adjusted = area - compensation;
    const next = total + adjusted;
    compensation = next - total - adjusted;
    total = next;
  }

  return total;
}

export function signedAreaOfSegmentRef(
  ref: OrientedSegmentRef,
  segmentsById: Map<SegmentId, PathSegment>,
  origin: Point2 = { x: 0, y: 0 }
) {
  const segment = requiredSegment(segmentsById, ref.segmentId);

  if (segment.kind === 'circle') {
    return (ref.reversed ? -1 : 1) * Math.PI * segment.radius * segment.radius;
  }

  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);
  const translatedTriangle =
    0.5 *
    ((start.x - origin.x) * (end.y - origin.y) -
      (end.x - origin.x) * (start.y - origin.y));

  if (segment.kind === 'line') {
    return translatedTriangle;
  }

  const sweep = orientedArcSweep(segment, ref);
  const correction = sweepMinusSin(sweep);
  const circularSegmentArea = 0.5 * segment.radius * (segment.radius * correction);
  return translatedTriangle + circularSegmentArea;
}

export function approximatePath(
  refs: OrientedSegmentRef[],
  segmentsById: Map<SegmentId, PathSegment>,
  maxAngleRadians: number
) {
  const points: Point2[] = [];

  for (const ref of refs) {
    const segment = requiredSegment(segmentsById, ref.segmentId);
    const segmentPoints = approximateSegmentRef(segment, ref, maxAngleRadians);
    for (const point of segmentPoints) {
      const previous = points[points.length - 1];
      if (!previous || !pointsEqual(previous, point)) points.push(point);
    }
  }

  return points;
}

export function approximateSegmentRef(segment: PathSegment, ref: OrientedSegmentRef, maxAngleRadians: number) {
  if (segment.kind === 'line') {
    return [orientedSegmentStart(segment, ref), orientedSegmentEnd(segment, ref)];
  }

  if (segment.kind === 'circle') {
    const clockwise = orientedCircleClockwise(segment, ref);
    const stepSign = clockwise ? -1 : 1;
    const count = Math.max(8, Math.ceil(FULL_TURN / Math.max(maxAngleRadians, Math.PI / 90)));
    const points: Point2[] = [];
    for (let index = 0; index <= count; index++) {
      points.push(pointOnCircle(segment.center, segment.radius, stepSign * (FULL_TURN * index) / count));
    }
    return points;
  }

  const sweep = orientedArcSweep(segment, ref);
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / Math.max(maxAngleRadians, Math.PI / 90)));
  const points: Point2[] = [orientedSegmentStart(segment, ref)];

  for (let index = 1; index < count; index++) {
    points.push(pointOnArcAtParameter(segment, ref, index / count));
  }
  points.push(orientedSegmentEnd(segment, ref));

  return points;
}

function normalizedDirection(vector: Point2): Point2 | null {
  const scale = Math.max(Math.abs(vector.x), Math.abs(vector.y));
  if (!Number.isFinite(scale) || scale === 0) return null;

  const scaledX = vector.x / scale;
  const scaledY = vector.y / scale;
  const length = Math.hypot(scaledX, scaledY);
  if (!Number.isFinite(length) || length === 0) return null;

  return { x: scaledX / length, y: scaledY / length };
}

function directedAngularDelta(start: Point2, target: Point2, sweepRadians: number) {
  let delta = Math.atan2(cross(start, target), dot(start, target));
  if (sweepRadians > 0 && delta < 0) delta += FULL_TURN;
  if (sweepRadians < 0 && delta > 0) delta -= FULL_TURN;
  return delta;
}

function angularDeltaIsOnSweep(delta: number, sweepRadians: number) {
  if (!Number.isFinite(delta) || !Number.isFinite(sweepRadians) || sweepRadians === 0) return false;
  const tolerance = angularUlpTolerance(delta, sweepRadians);
  return sweepRadians > 0
    ? delta >= -tolerance && delta <= sweepRadians + tolerance
    : delta <= tolerance && delta >= sweepRadians - tolerance;
}

function angularDeltaIsStrictlyInterior(delta: number, sweepRadians: number) {
  return sweepRadians > 0
    ? delta > 0 && delta < sweepRadians
    : delta < 0 && delta > sweepRadians;
}

function angularUlpTolerance(...angles: number[]) {
  const magnitude = Math.max(...angles.map((angle) => Math.abs(angle)));
  return ANGULAR_ULP_FACTOR * Number.EPSILON * magnitude;
}

function pointFromExactArcStart(start: Point2, center: Point2, delta: number): Point2 {
  const radialX = start.x - center.x;
  const radialY = start.y - center.y;
  const exactQuadrant = exactQuadrantTrig(delta);
  const sinDelta = exactQuadrant?.sin ?? Math.sin(delta);
  const sinHalf = exactQuadrant ? null : Math.sin(delta / 2);
  const cosDeltaMinusOne = exactQuadrant?.cosMinusOne ?? -2 * sinHalf! * sinHalf!;

  return {
    x: start.x + cosDeltaMinusOne * radialX - sinDelta * radialY,
    y: start.y + sinDelta * radialX + cosDeltaMinusOne * radialY
  };
}

function exactQuadrantTrig(delta: number) {
  const quadrant = Math.round(delta / (Math.PI / 2));
  const exactDelta = quadrant * (Math.PI / 2);
  if (delta !== exactDelta) return null;

  switch (((quadrant % 4) + 4) % 4) {
    case 0:
      return { sin: 0, cosMinusOne: 0 };
    case 1:
      return { sin: 1, cosMinusOne: -1 };
    case 2:
      return { sin: 0, cosMinusOne: -2 };
    default:
      return { sin: -1, cosMinusOne: -1 };
  }
}

function sweepMinusSin(sweepRadians: number) {
  if (Math.abs(sweepRadians) >= SMALL_SWEEP_SERIES_LIMIT) {
    return sweepRadians - Math.sin(sweepRadians);
  }

  const squared = sweepRadians * sweepRadians;
  return (
    sweepRadians *
    squared *
    (1 / 6 +
      squared *
        (-1 / 120 +
          squared *
            (1 / 5040 +
              squared * (-1 / 362880 + squared * (1 / 39916800 - squared / 6227020800)))))
  );
}

export function requiredSegment(segmentsById: Map<SegmentId, PathSegment>, segmentId: SegmentId) {
  const segment = segmentsById.get(segmentId);
  if (!segment) throw new Error(`Path segment not found: ${segmentId}`);
  return segment;
}

export function segmentStartTangent(segment: PathSegment, ref: OrientedSegmentRef) {
  if (segment.kind === 'circle') return { x: 0, y: ref.reversed ? -1 : 1 };
  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);
  if (segment.kind === 'line') return normalizeVector({ x: end.x - start.x, y: end.y - start.y });

  const angle = Math.atan2(start.y - segment.center.y, start.x - segment.center.x);
  const clockwise = orientedArcClockwise(segment, ref);
  return clockwise ? { x: Math.sin(angle), y: -Math.cos(angle) } : { x: -Math.sin(angle), y: Math.cos(angle) };
}

export function segmentEndTangent(segment: PathSegment, ref: OrientedSegmentRef) {
  if (segment.kind === 'circle') return { x: 0, y: ref.reversed ? -1 : 1 };
  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);
  if (segment.kind === 'line') return normalizeVector({ x: end.x - start.x, y: end.y - start.y });

  const angle = Math.atan2(end.y - segment.center.y, end.x - segment.center.x);
  const clockwise = orientedArcClockwise(segment, ref);
  return clockwise ? { x: Math.sin(angle), y: -Math.cos(angle) } : { x: -Math.sin(angle), y: Math.cos(angle) };
}

export function normalizeVector(vector: Point2): Point2 {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= DEFAULT_PATH_PLANNING_OPTIONS.coincidenceEpsilon) return { x: 0, y: 0 };
  return { x: vector.x / length, y: vector.y / length };
}

export function dot(a: Point2, b: Point2) {
  return a.x * b.x + a.y * b.y;
}

export function crossPoint(a: Point2, b: Point2) {
  return a.x * b.y - b.x * a.y;
}

export function vector(a: Point2, b: Point2): Point2 {
  return { x: b.x - a.x, y: b.y - a.y };
}

export function cross(a: Point2, b: Point2) {
  return a.x * b.y - a.y * b.x;
}
