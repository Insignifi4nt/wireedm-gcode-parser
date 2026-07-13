import type { DxfPoint } from './types';

export interface DxfSplineDefinition {
  controlPoints: DxfPoint[];
  degree: number;
  flags: number;
  knots: number[];
  weights?: number[];
}

export interface ApproximateSplineOptions {
  maxChordError: number;
}

export type ApproximateSplineResult =
  | { ok: true; points: DxfPoint[] }
  | { ok: false; reason: string };

interface HomogeneousPoint {
  x: number;
  y: number;
  weight: number;
}

interface HomogeneousSpline {
  controlPoints: HomogeneousPoint[];
  degree: number;
  knots: number[];
}

type InternalResult = { ok: true } | { ok: false; reason: string };

const MAX_SUBDIVISION_DEPTH = 20;
const POINT_EPSILON = 1e-12;

/**
 * Produces a polyline with a conservative curve-to-chord bound.
 *
 * Each B-spline knot span is converted to a positive-weight rational Bézier
 * span. A rational Bézier curve with positive weights lies inside the convex
 * hull of its Cartesian control points, so the maximum control-point distance
 * to the endpoint chord bounds the entire curve. Homogeneous de Casteljau
 * subdivision shrinks that hull; if it still exceeds the requested bound at
 * depth 20, approximation fails instead of returning an unproven polyline.
 */
export function approximateSpline(
  definition: DxfSplineDefinition,
  options: ApproximateSplineOptions
): ApproximateSplineResult {
  const validationError = validateSpline(definition, options);
  if (validationError) return { ok: false, reason: validationError };

  const spans = rationalBezierSpans(definition);
  if (!spans.ok) return spans;

  const points: DxfPoint[] = [];
  for (const controlPoints of spans.spans) {
    const start = toCartesianPoint(controlPoints[0]);
    if (!start) {
      return { ok: false, reason: 'SPLINE Bézier span has a non-finite endpoint.' };
    }
    appendUniquePoint(points, start);

    const subdivision = subdivideBezier(
      controlPoints,
      options.maxChordError,
      0,
      points
    );
    if (!subdivision.ok) return subdivision;
  }

  if (points.length < 2) {
    return { ok: false, reason: 'SPLINE has no non-empty knot span.' };
  }

  return { ok: true, points };
}

function validateSpline(
  definition: DxfSplineDefinition,
  options: ApproximateSplineOptions
): string | null {
  if (!Number.isFinite(options.maxChordError) || options.maxChordError <= 0) {
    return 'SPLINE chord error must be a positive finite number.';
  }

  if (!Number.isInteger(definition.flags) || definition.flags < 0) {
    return 'SPLINE flags must be a non-negative integer.';
  }

  if (!Number.isInteger(definition.degree) || definition.degree < 1) {
    return 'SPLINE degree must be a positive integer.';
  }

  if (definition.controlPoints.length <= definition.degree) {
    return 'SPLINE does not have enough control points for its degree.';
  }

  if (definition.knots.length !== definition.controlPoints.length + definition.degree + 1) {
    return 'SPLINE knot count does not match its control points and degree.';
  }

  if (
    definition.controlPoints.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)
    )
  ) {
    return 'SPLINE contains a non-finite control point.';
  }

  for (let index = 0; index < definition.knots.length; index++) {
    const knot = definition.knots[index];
    if (!Number.isFinite(knot)) return 'SPLINE contains a non-finite knot.';
    if (index > 0 && knot < definition.knots[index - 1]) {
      return 'SPLINE knots are not non-decreasing.';
    }
  }

  if (definition.weights) {
    if (definition.weights.length !== definition.controlPoints.length) {
      return 'SPLINE weight count does not match its control points.';
    }
    if (definition.weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) {
      return 'SPLINE rational weights must be positive finite numbers.';
    }
  }

  const domainStart = definition.knots[definition.degree];
  const domainEnd = definition.knots[definition.controlPoints.length];
  if (!(domainEnd > domainStart)) return 'SPLINE parameter domain is empty.';

  const distinctKnots = uniqueKnots(definition.knots);
  if (
    distinctKnots.some(
      (knot) => knotMultiplicity(definition.knots, knot) > definition.degree + 1
    )
  ) {
    return 'SPLINE knot multiplicity exceeds its degree.';
  }

  const interiorKnots = distinctKnots.filter(
    (knot) => knot > domainStart && knot < domainEnd
  );
  if (
    interiorKnots.some(
      (knot) => knotMultiplicity(definition.knots, knot) > definition.degree
    )
  ) {
    return 'SPLINE contains a discontinuous interior knot.';
  }

  return null;
}

function rationalBezierSpans(
  definition: DxfSplineDefinition
): { ok: true; spans: HomogeneousPoint[][] } | { ok: false; reason: string } {
  const homogeneousControlPoints: HomogeneousPoint[] = [];
  for (let index = 0; index < definition.controlPoints.length; index++) {
    const point = definition.controlPoints[index];
    const weight = definition.weights?.[index] ?? 1;
    const homogeneous = {
      x: point.x * weight,
      y: point.y * weight,
      weight
    };
    if (!isFiniteHomogeneousPoint(homogeneous)) {
      return {
        ok: false,
        reason: 'SPLINE control point overflowed homogeneous coordinates.'
      };
    }
    homogeneousControlPoints.push(homogeneous);
  }

  let spline: HomogeneousSpline = {
    controlPoints: homogeneousControlPoints,
    degree: definition.degree,
    knots: [...definition.knots]
  };
  const domainStart = definition.knots[definition.degree];
  const domainEnd = definition.knots[definition.controlPoints.length];
  const targets = [
    { knot: domainStart, multiplicity: definition.degree + 1 },
    ...uniqueKnots(definition.knots)
      .filter((knot) => knot > domainStart && knot < domainEnd)
      .map((knot) => ({ knot, multiplicity: definition.degree })),
    { knot: domainEnd, multiplicity: definition.degree + 1 }
  ];

  for (const target of targets) {
    while (knotMultiplicity(spline.knots, target.knot) < target.multiplicity) {
      const insertion = insertKnotOnce(spline, target.knot);
      if (!insertion.ok) return insertion;
      spline = insertion.spline;
    }
  }

  const spans: HomogeneousPoint[][] = [];
  const lastControlPointIndex = spline.controlPoints.length - 1;
  for (let spanIndex = spline.degree; spanIndex <= lastControlPointIndex; spanIndex++) {
    const start = spline.knots[spanIndex];
    const end = spline.knots[spanIndex + 1];
    if (end <= start || start < domainStart || end > domainEnd) continue;

    const controlPoints = spline.controlPoints.slice(
      spanIndex - spline.degree,
      spanIndex + 1
    );
    if (controlPoints.length !== spline.degree + 1) {
      return { ok: false, reason: 'SPLINE Bézier span extraction failed.' };
    }
    spans.push(controlPoints);
  }

  return spans.length > 0
    ? { ok: true, spans }
    : { ok: false, reason: 'SPLINE has no non-empty knot span.' };
}

function insertKnotOnce(
  spline: HomogeneousSpline,
  knot: number
): { ok: true; spline: HomogeneousSpline } | { ok: false; reason: string } {
  const span = findInsertionSpan(spline, knot);
  const multiplicity = knotMultiplicity(spline.knots, knot);
  if (multiplicity > spline.degree) {
    return { ok: false, reason: 'SPLINE knot insertion exceeded degree.' };
  }

  const lastControlPointIndex = spline.controlPoints.length - 1;
  const controlPoints = new Array<HomogeneousPoint>(spline.controlPoints.length + 1);

  for (let index = 0; index <= span - spline.degree; index++) {
    controlPoints[index] = { ...spline.controlPoints[index] };
  }

  for (let index = span - multiplicity; index <= lastControlPointIndex; index++) {
    controlPoints[index + 1] = { ...spline.controlPoints[index] };
  }

  for (
    let index = span - spline.degree + 1;
    index <= span - multiplicity;
    index++
  ) {
    const denominator = spline.knots[index + spline.degree] - spline.knots[index];
    if (!(denominator > 0) || !Number.isFinite(denominator)) {
      return { ok: false, reason: 'SPLINE knot insertion has an invalid interval.' };
    }
    const alpha = (knot - spline.knots[index]) / denominator;
    const point = interpolateHomogeneous(
      spline.controlPoints[index - 1],
      spline.controlPoints[index],
      alpha
    );
    if (!point) {
      return { ok: false, reason: 'SPLINE knot insertion produced non-finite geometry.' };
    }
    controlPoints[index] = point;
  }

  if (controlPoints.some((point) => !point || !isFiniteHomogeneousPoint(point))) {
    return { ok: false, reason: 'SPLINE knot insertion left invalid control points.' };
  }

  return {
    ok: true,
    spline: {
      controlPoints,
      degree: spline.degree,
      knots: [
        ...spline.knots.slice(0, span + 1),
        knot,
        ...spline.knots.slice(span + 1)
      ]
    }
  };
}

function findInsertionSpan(spline: HomogeneousSpline, knot: number) {
  const lastControlPointIndex = spline.controlPoints.length - 1;
  const domainEnd = spline.knots[lastControlPointIndex + 1];
  if (knot >= domainEnd) return lastControlPointIndex;

  let low = spline.degree;
  let high = lastControlPointIndex + 1;
  let middle = Math.floor((low + high) / 2);

  while (knot < spline.knots[middle] || knot >= spline.knots[middle + 1]) {
    if (knot < spline.knots[middle]) high = middle;
    else low = middle;
    middle = Math.floor((low + high) / 2);
  }

  return middle;
}

function subdivideBezier(
  controlPoints: HomogeneousPoint[],
  maxChordError: number,
  depth: number,
  points: DxfPoint[]
): InternalResult {
  const cartesianControlPoints = controlPoints.map(toCartesianPoint);
  if (cartesianControlPoints.some((point) => point == null)) {
    return { ok: false, reason: 'SPLINE Bézier span produced non-finite geometry.' };
  }
  const cartesian = cartesianControlPoints as DxfPoint[];
  const start = cartesian[0];
  const end = cartesian[cartesian.length - 1];
  const flatness = Math.max(
    ...cartesian.map((point) => distanceToChord(point, start, end))
  );
  if (!Number.isFinite(flatness)) {
    return { ok: false, reason: 'SPLINE chord-error bound is non-finite.' };
  }

  if (flatness <= maxChordError) {
    appendUniquePoint(points, end);
    return { ok: true };
  }

  if (depth >= MAX_SUBDIVISION_DEPTH) {
    return {
      ok: false,
      reason: `SPLINE subdivision depth ${MAX_SUBDIVISION_DEPTH} cannot satisfy the chord-error bound.`
    };
  }

  const split = splitBezierHalf(controlPoints);
  if (!split) {
    return { ok: false, reason: 'SPLINE Bézier subdivision produced non-finite geometry.' };
  }
  const left = subdivideBezier(split.left, maxChordError, depth + 1, points);
  if (!left.ok) return left;
  return subdivideBezier(split.right, maxChordError, depth + 1, points);
}

function splitBezierHalf(controlPoints: HomogeneousPoint[]) {
  let level = controlPoints.map((point) => ({ ...point }));
  const left = [{ ...level[0] }];
  const right = [{ ...level[level.length - 1] }];

  while (level.length > 1) {
    const next: HomogeneousPoint[] = [];
    for (let index = 0; index < level.length - 1; index++) {
      const point = interpolateHomogeneous(level[index], level[index + 1], 0.5);
      if (!point) return null;
      next.push(point);
    }
    left.push({ ...next[0] });
    right.unshift({ ...next[next.length - 1] });
    level = next;
  }

  return { left, right };
}

function interpolateHomogeneous(
  start: HomogeneousPoint,
  end: HomogeneousPoint,
  alpha: number
): HomogeneousPoint | null {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
  const inverse = 1 - alpha;
  const point = {
    x: start.x * inverse + end.x * alpha,
    y: start.y * inverse + end.y * alpha,
    weight: start.weight * inverse + end.weight * alpha
  };
  return isFiniteHomogeneousPoint(point) ? point : null;
}

function toCartesianPoint(point: HomogeneousPoint): DxfPoint | null {
  if (!isFiniteHomogeneousPoint(point) || point.weight <= 0) return null;
  const cartesian = {
    x: point.x / point.weight,
    y: point.y / point.weight
  };
  return Number.isFinite(cartesian.x) && Number.isFinite(cartesian.y)
    ? cartesian
    : null;
}

function isFiniteHomogeneousPoint(point: HomogeneousPoint) {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.weight) &&
    point.weight > 0
  );
}

function distanceToChord(point: DxfPoint, start: DxfPoint, end: DxfPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length)) return Number.POSITIVE_INFINITY;
  if (length <= POINT_EPSILON) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const offsetX = point.x - start.x;
  const offsetY = point.y - start.y;
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
    return Number.POSITIVE_INFINITY;
  }
  const unitX = dx / length;
  const unitY = dy / length;
  const projection = offsetX * unitX + offsetY * unitY;
  if (!Number.isFinite(projection)) return Number.POSITIVE_INFINITY;
  const clampedProjection = Math.max(0, Math.min(length, projection));
  return Math.hypot(
    offsetX - clampedProjection * unitX,
    offsetY - clampedProjection * unitY
  );
}

function appendUniquePoint(points: DxfPoint[], point: DxfPoint) {
  const previous = points.at(-1);
  if (previous && previous.x === point.x && previous.y === point.y) {
    return;
  }

  points.push({ x: point.x, y: point.y });
}

function uniqueKnots(knots: number[]) {
  return knots.filter((knot, index) => index === 0 || knot !== knots[index - 1]);
}

function knotMultiplicity(knots: number[], knot: number) {
  return knots.reduce((count, candidate) => count + (candidate === knot ? 1 : 0), 0);
}
