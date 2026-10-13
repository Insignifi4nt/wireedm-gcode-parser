import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { CadCurveFeature, CadPlane } from './cadDocument';
import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';
import { isCadImportData } from './cadImportData';
import { CadDxfImportSourceSchema, parseCadDxfImportSource } from './cadDxfSource';
import { CadFeatureBaseSchemaFields, CadPathSegmentSchema, CadPlaneSchema, CadScalarSchema } from './cadPrimitives';
import { cadAnalyticSegments, cadOrderedCurveEntities, cadPathClosureTolerance, resolveCadPathSegments,
  type CadOrderedCurveEntity, type ResolvedCadPathSegment } from './cadAnalyticSegments';
import { cadBoundariesIntersect, cadBoundaryCandidatePairs } from './cadSketchGeometry';
import { angleIsOnSweep, nextDown, nextUp } from '@/domain/path-intel/segments';
import type { Bounds2 } from '@/domain/path-intel/types';
import { cadPlaneDirectionToWorld, cadPlanePointToWorld, type CadNumericPoint2, type CadNumericPoint3 } from './cadPlanes';

export const MAX_CAD_CURVE_SEGMENTS = 2048;
export const CadCurveFeatureSchema = Type.Object({ ...CadFeatureBaseSchemaFields, kind: Type.Literal('curve'), plane: CadPlaneSchema, offset: CadScalarSchema,
  segments: Type.Array(CadPathSegmentSchema, { minItems: 1, maxItems: MAX_CAD_CURVE_SEGMENTS }), source: Type.Optional(CadDxfImportSourceSchema)
}, { additionalProperties: false });
export interface CadBounds3 { readonly min: CadNumericPoint3; readonly max: CadNumericPoint3 }
export interface CadResolvedCurve {
  readonly plane: CadPlane; readonly offset: number;
  readonly segments: readonly ResolvedCadPathSegment[]; readonly entities: readonly CadOrderedCurveEntity[];
  readonly start: CadNumericPoint2; readonly end: CadNumericPoint2;
  readonly startTangent: CadNumericPoint2; readonly endTangent: CadNumericPoint2;
  readonly startWorld: CadNumericPoint3; readonly endWorld: CadNumericPoint3;
  readonly startTangentWorld: CadNumericPoint3; readonly endTangentWorld: CadNumericPoint3;
  readonly length: number; readonly bounds: Readonly<Bounds2>; readonly worldBounds: CadBounds3;
}
export type CadCurveInspection = { readonly eligible: true; readonly curve: CadResolvedCurve }
  | { readonly eligible: false; readonly code: string; readonly message: string };

function curveBounds(entities: readonly CadOrderedCurveEntity[]): Readonly<Bounds2> {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const include = (x: number, y: number) => {
    bounds.minX = Math.min(bounds.minX, x); bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x); bounds.maxY = Math.max(bounds.maxY, y);
  };
  for (const entity of entities) {
    include(entity.start.x, entity.start.y); include(entity.end.x, entity.end.y);
    if (entity.type === 'line') continue;
    const sweep = entity.sweepRadians ?? entity.endAngle - entity.startAngle;
    // Bound angle reduction arithmetic, not a caller-controlled geometry tolerance.
    const rounding = 16 * Number.EPSILON * Math.max(1, Math.abs(entity.startAngle), Math.abs(sweep));
    const { x, y } = entity.center; const r = entity.radius;
    if (angleIsOnSweep(0, entity.startAngle, sweep, rounding)) { include(x + r, y); bounds.maxX = Math.max(bounds.maxX, nextUp(nextUp(x + r))); }
    if (angleIsOnSweep(Math.PI / 2, entity.startAngle, sweep, rounding)) { include(x, y + r); bounds.maxY = Math.max(bounds.maxY, nextUp(nextUp(y + r))); }
    if (angleIsOnSweep(Math.PI, entity.startAngle, sweep, rounding)) { include(x - r, y); bounds.minX = Math.min(bounds.minX, nextDown(nextDown(x - r))); }
    if (angleIsOnSweep(3 * Math.PI / 2, entity.startAngle, sweep, rounding)) { include(x, y - r); bounds.minY = Math.min(bounds.minY, nextDown(nextDown(y - r))); }
  }
  return Object.freeze(bounds);
}

/** An open reference chain preserves authored order, clockwise direction and endpoints. */
export function resolveCadCurve(curve: CadCurveFeature, parameters: Readonly<Record<string, number>>): CadResolvedCurve {
  if (!isCadImportData(curve) || !Value.Check(CadCurveFeatureSchema, curve) || !isCadImportData(parameters)) throw new CadError('invalid-curve', 'A reference curve requires its own complete numeric or expression-backed plane and ordered segments.');
  if (curve.source) parseCadDxfImportSource(curve.source);
  const offset = evaluateCadScalar(curve.offset, parameters);
  const segments = resolveCadPathSegments(curve.segments, parameters);
  const analytic = cadAnalyticSegments(segments);
  if (analytic.segments.some(segment => segment.length <= 1e-7)) throw new CadError('invalid-curve', 'Reference curves cannot contain zero-length edges.');
  const first = analytic.segments[0]; const last = analytic.segments[analytic.segments.length - 1];
  const continuity = cadPathClosureTolerance(analytic.segments.flatMap(segment => [segment.start, segment.end]));
  for (let index = 1; index < analytic.segments.length; index++) {
    const previous = analytic.segments[index - 1]; const current = analytic.segments[index];
    if (Math.hypot(previous.end.x - current.start.x, previous.end.y - current.start.y) > continuity) throw new CadError('disconnected-curve', 'Reference curve segments must connect in their supplied order without repairing gaps.');
  }
  if (Math.hypot(first.start.x - last.end.x, first.start.y - last.end.y) <= continuity) throw new CadError('closed-curve', 'Reference curves must stay open with distinct start and end points. Use a sketch for a closed contour.');
  if (segments.some(segment => segment.kind === 'arc' && Math.abs(segment.sweep) === 360)) throw new CadError('closed-curve', 'A reference curve cannot contain a closed circle.');
  const entities = cadOrderedCurveEntities(segments);
  for (const [i, j] of cadBoundaryCandidatePairs(entities)) {
    const joins = j === i + 1 ? [entities[i].end] : [];
    if (cadBoundariesIntersect(entities[i], entities[j], joins)) throw new CadError('self-intersection', 'Reference curve segments cannot cross, overlap or touch outside their adjacent joint.');
  }
  const point = (value: { x: number; y: number }): CadNumericPoint2 => Object.freeze([value.x, value.y]);
  const tangent = (segment: ResolvedCadPathSegment, atEnd: boolean): CadNumericPoint2 => {
    if (segment.kind === 'line') {
      const dx = segment.end[0] - segment.start[0]; const dy = segment.end[1] - segment.start[1]; const length = Math.hypot(dx, dy);
      return Object.freeze([dx / length, dy / length]);
    }
    const angle = segment.startAngle * Math.PI / 180 + (atEnd ? segment.sweep * Math.PI / 180 : 0); const sign = Math.sign(segment.sweep);
    return Object.freeze([-sign * Math.sin(angle), sign * Math.cos(angle)]);
  };
  const start = point(first.start); const end = point(last.end);
  const startTangent = tangent(segments[0], false); const endTangent = tangent(segments[segments.length - 1], true);
  const bounds = curveBounds(entities);
  const corners = [[bounds.minX, bounds.minY], [bounds.maxX, bounds.maxY]].map(value => cadPlanePointToWorld(curve.plane, offset, [value[0], value[1]]));
  const min: CadNumericPoint3 = Object.freeze([Math.min(corners[0][0], corners[1][0]), Math.min(corners[0][1], corners[1][1]), Math.min(corners[0][2], corners[1][2])]);
  const max: CadNumericPoint3 = Object.freeze([Math.max(corners[0][0], corners[1][0]), Math.max(corners[0][1], corners[1][1]), Math.max(corners[0][2], corners[1][2])]);
  let length = 0; let correction = 0;
  for (const segment of analytic.segments) { const y = segment.length - correction; const next = length + y; correction = (next - length) - y; length = next; }
  return Object.freeze({ plane: curve.plane, offset, segments, entities, start, end, startTangent, endTangent,
    startWorld: cadPlanePointToWorld(curve.plane, offset, start), endWorld: cadPlanePointToWorld(curve.plane, offset, end),
    startTangentWorld: cadPlaneDirectionToWorld(curve.plane, startTangent), endTangentWorld: cadPlaneDirectionToWorld(curve.plane, endTangent),
    length, bounds, worldBounds: Object.freeze({ min, max }) });
}

export function inspectCadCurve(curve: CadCurveFeature, parameters: Readonly<Record<string, number>>): CadCurveInspection {
  try {
    const resolved = resolveCadCurve(curve, parameters);
    return curve.suppressed ? { eligible: false, code: 'suppressed-curve', message: `Reference curve "${curve.name}" is suppressed.` } : { eligible: true, curve: resolved };
  } catch (error) {
    if (error instanceof CadError) return { eligible: false, code: error.code, message: error.message };
    throw error;
  }
}
