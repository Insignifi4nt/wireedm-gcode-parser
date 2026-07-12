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

const MAX_SUBDIVISION_DEPTH = 20;
const POINT_EPSILON = 1e-12;

export function approximateSpline(
  definition: DxfSplineDefinition,
  options: ApproximateSplineOptions
): ApproximateSplineResult {
  const validationError = validateSpline(definition, options);
  if (validationError) return { ok: false, reason: validationError };

  const points: DxfPoint[] = [];
  const finalSpanIndex = definition.controlPoints.length - 1;

  for (let spanIndex = definition.degree; spanIndex <= finalSpanIndex; spanIndex++) {
    const startParameter = definition.knots[spanIndex];
    const endParameter = definition.knots[spanIndex + 1];
    if (endParameter <= startParameter) continue;

    const start = evaluateSpline(definition, startParameter);
    const end = evaluateSpline(definition, endParameter);
    if (!start || !end) {
      return { ok: false, reason: 'SPLINE evaluation produced a non-finite point.' };
    }

    appendUniquePoint(points, start);
    const subdivision = subdivideSpan(
      definition,
      startParameter,
      endParameter,
      start,
      end,
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
    if (
      definition.weights.some(
        (weight) => !Number.isFinite(weight) || Math.abs(weight) <= Number.EPSILON
      )
    ) {
      return 'SPLINE contains an invalid rational weight.';
    }
  }

  const domainStart = definition.knots[definition.degree];
  const domainEnd = definition.knots[definition.controlPoints.length];
  if (!(domainEnd > domainStart)) return 'SPLINE parameter domain is empty.';

  return null;
}

function subdivideSpan(
  definition: DxfSplineDefinition,
  startParameter: number,
  endParameter: number,
  start: DxfPoint,
  end: DxfPoint,
  maxChordError: number,
  depth: number,
  points: DxfPoint[]
): ApproximateSplineResult {
  const midpointParameter = (startParameter + endParameter) / 2;
  const midpoint = evaluateSpline(definition, midpointParameter);
  if (!midpoint) {
    return { ok: false, reason: 'SPLINE evaluation produced a non-finite midpoint.' };
  }

  if (
    depth >= MAX_SUBDIVISION_DEPTH ||
    distanceToChord(midpoint, start, end) <= maxChordError
  ) {
    appendUniquePoint(points, end);
    return { ok: true, points };
  }

  const left = subdivideSpan(
    definition,
    startParameter,
    midpointParameter,
    start,
    midpoint,
    maxChordError,
    depth + 1,
    points
  );
  if (!left.ok) return left;

  return subdivideSpan(
    definition,
    midpointParameter,
    endParameter,
    midpoint,
    end,
    maxChordError,
    depth + 1,
    points
  );
}

function evaluateSpline(definition: DxfSplineDefinition, parameter: number): DxfPoint | null {
  const span = findKnotSpan(definition, parameter);
  const degree = definition.degree;
  const working: HomogeneousPoint[] = [];

  for (let index = 0; index <= degree; index++) {
    const controlPointIndex = span - degree + index;
    const point = definition.controlPoints[controlPointIndex];
    const weight = definition.weights?.[controlPointIndex] ?? 1;
    working.push({
      x: point.x * weight,
      y: point.y * weight,
      weight
    });
  }

  for (let level = 1; level <= degree; level++) {
    for (let index = degree; index >= level; index--) {
      const leftKnotIndex = span - degree + index;
      const rightKnotIndex = span + 1 + index - level;
      const denominator =
        definition.knots[rightKnotIndex] - definition.knots[leftKnotIndex];
      const alpha =
        Math.abs(denominator) <= Number.EPSILON
          ? 0
          : (parameter - definition.knots[leftKnotIndex]) / denominator;
      working[index] = interpolateHomogeneous(working[index - 1], working[index], alpha);
    }
  }

  const result = working[degree];
  if (
    !Number.isFinite(result.x) ||
    !Number.isFinite(result.y) ||
    !Number.isFinite(result.weight) ||
    Math.abs(result.weight) <= Number.EPSILON
  ) {
    return null;
  }

  const point = {
    x: result.x / result.weight,
    y: result.y / result.weight
  };
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

function findKnotSpan(definition: DxfSplineDefinition, parameter: number) {
  const finalSpanIndex = definition.controlPoints.length - 1;
  const domainEnd = definition.knots[definition.controlPoints.length];
  if (parameter >= domainEnd) return finalSpanIndex;

  let low = definition.degree;
  let high = definition.controlPoints.length;
  let middle = Math.floor((low + high) / 2);

  while (
    parameter < definition.knots[middle] ||
    parameter >= definition.knots[middle + 1]
  ) {
    if (parameter < definition.knots[middle]) high = middle;
    else low = middle;
    middle = Math.floor((low + high) / 2);
  }

  return middle;
}

function interpolateHomogeneous(
  start: HomogeneousPoint,
  end: HomogeneousPoint,
  alpha: number
): HomogeneousPoint {
  return {
    x: start.x + (end.x - start.x) * alpha,
    y: start.y + (end.y - start.y) * alpha,
    weight: start.weight + (end.weight - start.weight) * alpha
  };
}

function distanceToChord(point: DxfPoint, start: DxfPoint, end: DxfPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const squaredLength = dx * dx + dy * dy;
  if (squaredLength <= POINT_EPSILON * POINT_EPSILON) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength)
  );
  const closest = {
    x: start.x + projection * dx,
    y: start.y + projection * dy
  };
  return Math.hypot(point.x - closest.x, point.y - closest.y);
}

function appendUniquePoint(points: DxfPoint[], point: DxfPoint) {
  const previous = points.at(-1);
  if (
    previous &&
    Math.abs(previous.x - point.x) <= POINT_EPSILON &&
    Math.abs(previous.y - point.y) <= POINT_EPSILON
  ) {
    return;
  }

  points.push({ x: point.x, y: point.y });
}
