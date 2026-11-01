import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { CadProfile } from './cadDocument';
import { CadError } from './cadError';
import { isCadImportData } from './cadImportData';
import { cadPathClosureTolerance, validateCadSketchGeometry, type ResolvedCadPathSegment } from './cadSketchGeometry';
import { resolveCadCurve } from './cadCurve';
import { CAD_PRECISION, cadRoundoff } from '../precision/cadPrecision';

export type CadConstructionPoint = readonly [number, number];
export type CadPathConstructionStep =
  | { readonly kind: 'line'; readonly end: CadConstructionPoint }
  | { readonly kind: 'arc'; readonly end: CadConstructionPoint; readonly through: CadConstructionPoint };
export type CadConstructedArc = Extract<ResolvedCadPathSegment, { kind: 'arc' }>;
export const MAX_CAD_PATH_CONSTRUCTION_EDGES = 2048;
const coordinate = Type.Number({ minimum: -1e9, maximum: 1e9 });
export const CadConstructionPointSchema = Type.Tuple([coordinate, coordinate]);
export const CadPathConstructionStepSchema = Type.Union([
  Type.Object({ kind: Type.Literal('line'), end: CadConstructionPointSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('arc'), end: CadConstructionPointSchema, through: CadConstructionPointSchema }, { additionalProperties: false })
]);
const arcInputSchema = Type.Object({ start: CadConstructionPointSchema, end: CadConstructionPointSchema, through: CadConstructionPointSchema }, { additionalProperties: false });
const pathInputSchema = Type.Object({ start: CadConstructionPointSchema, steps: Type.Array(CadPathConstructionStepSchema, { minItems: 1, maxItems: MAX_CAD_PATH_CONSTRUCTION_EDGES }) }, { additionalProperties: false });

export function copyCadConstructionPoint(value: unknown): CadConstructionPoint {
  if (!isCadImportData(value) || !Value.Check(CadConstructionPointSchema, value)) throw new CadError('invalid-construction', 'Construction points must contain two finite numeric coordinates within ±1e9 mm.');
  return Object.freeze([value[0], value[1]]);
}

export function createCadConstructionLine(start: CadConstructionPoint, end: CadConstructionPoint): Extract<ResolvedCadPathSegment, { kind: 'line' }> {
  const a = copyCadConstructionPoint(start); const b = copyCadConstructionPoint(end);
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= CAD_PRECISION.minimumLengthMm) throw new CadError('degenerate-line', 'A path line must be longer than 1e-7 mm.');
  return Object.freeze({ kind: 'line', start: a, end: b });
}

/** Translate and scale before the circumcenter solve; retain the authored traversal direction. */
export function createCadThreePointArc(value: unknown): CadConstructedArc {
  if (!isCadImportData(value) || !Value.Check(arcInputSchema, value)) throw new CadError('invalid-construction', 'An arc requires numeric start, end and through points.');
  const { start, end, through } = value;
  const points = [start, end, through].map(point => ({ x: point[0], y: point[1] }));
  const uncertainty = cadPathClosureTolerance(points);
  const lengths = [Math.hypot(end[0] - start[0], end[1] - start[1]), Math.hypot(through[0] - start[0], through[1] - start[1]), Math.hypot(end[0] - through[0], end[1] - through[1])];
  if (lengths.some(length => length <= uncertainty)) throw new CadError('degenerate-arc', 'Three-point arcs require three distinct points.');
  const scale = Math.max(...lengths);
  const ux = (end[0] - start[0]) / scale; const uy = (end[1] - start[1]) / scale;
  const vx = (through[0] - start[0]) / scale; const vy = (through[1] - start[1]) / scale;
  const cross = ux * vy - uy * vx;
  // Bound arithmetic roundoff and the coordinate-scale uncertainty of the input differences.
  const crossError = cadRoundoff(8, Math.abs(ux * vy) + Math.abs(uy * vx))
    + uncertainty / scale * (Math.abs(ux) + Math.abs(uy) + Math.abs(vx) + Math.abs(vy));
  if (Math.abs(cross) <= crossError) throw new CadError('degenerate-arc', 'Arc points are collinear or their orientation is numerically uncertain.');
  const u2 = ux * ux + uy * uy; const v2 = vx * vx + vy * vy;
  const center: CadConstructionPoint = Object.freeze([
    start[0] + scale * (u2 * vy - v2 * uy) / (2 * cross),
    start[1] + scale * (ux * v2 - vx * u2) / (2 * cross)
  ]);
  const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
  if (!center.every(component => Number.isFinite(component) && Math.abs(component) <= 1e9) || !Number.isFinite(radius) || radius <= CAD_PRECISION.minimumLengthMm || radius > CAD_PRECISION.modelExtentMm) throw new CadError('invalid-dimension', 'Arc center and radius exceed the saved geometry limits.');
  const angle = (point: CadConstructionPoint) => Math.atan2(point[1] - center[1], point[0] - center[0]);
  const a = angle(start); const b = angle(end); const m = angle(through); const tau = 2 * Math.PI;
  const positive = (radians: number) => (radians % tau + tau) % tau;
  const endDelta = positive(b - a); const throughDelta = positive(m - a);
  const sweepRadians = throughDelta < endDelta ? endDelta : endDelta - tau;
  const startAngle = a * 180 / Math.PI; const sweep = sweepRadians * 180 / Math.PI;
  if (sweep === 0 || Math.abs(sweep) >= 360 || radius * Math.abs(sweepRadians) <= CAD_PRECISION.minimumLengthMm) throw new CadError('degenerate-arc', 'An arc needs a distinct start and end with a nonzero sweep.');
  // Check the *stored* degree encoding, including its actual chain joints. A radial
  // residual alone can miss cancellation when a shallow circle has a large radius.
  const encodedStart = (startAngle % 360) * Math.PI / 180;
  const at = (radians: number): CadConstructionPoint => [center[0] + radius * Math.cos(radians), center[1] + radius * Math.sin(radians)];
  const encoded = [at(encodedStart), at(encodedStart + sweep * Math.PI / 180), at(m)];
  const tolerance = cadPathClosureTolerance([...points, ...encoded.map(point => ({ x: point[0], y: point[1] }))]);
  if (encoded.some((point, index) => Math.hypot(point[0] - points[index].x, point[1] - points[index].y) > tolerance)) throw new CadError('arc-precision', 'This arc cannot reproduce the selected points within the saved path closure precision. Choose a less shallow arc.');
  return Object.freeze({ kind: 'arc', center, radius, startAngle, sweep });
}

/** A standalone closed contour; the application's whole-sketch gate still checks nesting. */
export function createCadPathProfile(start: CadConstructionPoint, steps: readonly CadPathConstructionStep[]): Extract<CadProfile, { kind: 'path' }> {
  const { first, current, segments } = constructCadSegments(start, steps);
  if (current[0] !== first[0] || current[1] !== first[1]) segments.push(createCadConstructionLine(current, first));
  if (segments.length > MAX_CAD_PATH_CONSTRUCTION_EDGES) throw new CadError('construction-limit', 'The closing edge must fit within the 2048-edge path limit.');
  const profile = Object.freeze({ kind: 'path' as const, segments: Object.freeze(segments) });
  validateCadSketchGeometry({ id: 'construction', name: 'Construction', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
    profiles: [{ id: 'contour', name: 'Contour', construction: false, geometry: profile }] }, {});
  return profile;
}

function constructCadSegments(start: CadConstructionPoint, steps: readonly CadPathConstructionStep[]) {
  const input = { start, steps };
  if (!isCadImportData(input) || !Value.Check(pathInputSchema, input)) throw new CadError('invalid-construction', 'A path needs 1–2048 numeric line or arc steps.');
  const first = copyCadConstructionPoint(start); let current = first;
  const segments: ResolvedCadPathSegment[] = [];
  for (const step of steps) {
    segments.push(step.kind === 'line' ? createCadConstructionLine(current, step.end) : createCadThreePointArc({ start: current, end: step.end, through: step.through }));
    current = copyCadConstructionPoint(step.end);
  }
  return { first, current, segments };
}

/** Numeric authoring only; retain supplied endpoints and never insert a closing edge. */
export function createCadOpenCurveSegments(start: CadConstructionPoint, steps: readonly CadPathConstructionStep[]): readonly ResolvedCadPathSegment[] {
  const { segments } = constructCadSegments(start, steps);
  return resolveCadCurve({ id: 'construction', name: 'Reference curve', kind: 'curve', suppressed: false, plane: 'XY', offset: 0, segments }, {}).segments;
}
