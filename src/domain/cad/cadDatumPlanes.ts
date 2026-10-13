import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { CadCurveFeature, CadDatumPlaneFeature, CadFeature, CadPlane, CadSketchFeature, CadSketchPlane } from './cadDocument';
import { CadError } from './cadError';
import { evaluateCadAngle, evaluateCadScalar } from './cadExpression';
import { isCadImportData } from './cadImportData';
import { CadFeatureBaseSchemaFields, CadPlaneSchema, CadScalarSchema } from './cadPrimitives';
import { cadPlaneBasis, type CadNumericPoint2, type CadNumericPoint3 } from './cadPlanes';
import { cadProfileToEntities, resolveCadSketchRegions } from './cadSketchGeometry';

export type { CadDatumPlaneFeature } from './cadDocument';
export const CAD_DATUM_ORTHONORMAL_RESIDUAL = 64 * Number.EPSILON;
export const CAD_DATUM_NATIVE_PLACEMENT_PRECISION_MM = 1e-7;
const point = Type.Tuple([CadScalarSchema, CadScalarSchema, CadScalarSchema]);
export const CadDatumPlaneFeatureSchema = Type.Object(
  {
    ...CadFeatureBaseSchemaFields,
    kind: Type.Literal('datum-plane'),
    definition: Type.Object(
      { kind: Type.Literal('world'), basePlane: CadPlaneSchema, origin: point, rotation: point },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export interface CadResolvedFrame {
  /** Base origin, before Sketch/Curve normal offset. */
  readonly origin: CadNumericPoint3;
  readonly u: CadNumericPoint3;
  readonly v: CadNumericPoint3;
  readonly normal: CadNumericPoint3;
  readonly precision: { readonly angularUncertainty: number; readonly originUncertaintyMm: number };
}
export interface CadDatumFrameLookup {
  get(id: string): CadResolvedFrame | undefined;
}
export interface CadResolvedPlacement {
  readonly plane: CadSketchPlane;
  readonly datumId: string | null;
  readonly offsetMm: number;
  readonly frame: CadResolvedFrame;
}
const tuple = (x: number, y: number, z: number): CadNumericPoint3 => Object.freeze([x === 0 ? 0 : x, y === 0 ? 0 : y, z === 0 ? 0 : z]);
const dot = (a: CadNumericPoint3, b: CadNumericPoint3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: CadNumericPoint3, b: CadNumericPoint3) =>
  tuple(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
function unit(a: CadNumericPoint3): CadNumericPoint3 {
  const length = Math.hypot(...a);
  return tuple(a[0] / length, a[1] / length, a[2] / length);
}
function frame(
  origin: CadNumericPoint3,
  u: CadNumericPoint3,
  v: CadNumericPoint3,
  normal: CadNumericPoint3,
  angularUncertainty: number,
): CadResolvedFrame {
  const residual = Math.max(
    Math.abs(Math.hypot(...u) - 1),
    Math.abs(Math.hypot(...v) - 1),
    Math.abs(Math.hypot(...normal) - 1),
    Math.abs(dot(u, v)),
    Math.abs(dot(u, normal)),
    Math.abs(dot(v, normal)),
  );
  if (
    ![...origin, ...u, ...v, ...normal, residual].every(Number.isFinite) ||
    residual > CAD_DATUM_ORTHONORMAL_RESIDUAL ||
    dot(cross(u, v), normal) <= 0
  ) {
    throw new CadError(
      'unsupported-datum-frame',
      'The datum frame cannot preserve a finite right-handed orthonormal basis at supported precision.',
    );
  }
  const n = angularUncertainty === 0 ? normal : unit(normal);
  const projection = dot(u, n);
  const x = angularUncertainty === 0 ? u : unit(tuple(u[0] - projection * n[0], u[1] - projection * n[1], u[2] - projection * n[2]));
  const y = angularUncertainty === 0 ? v : unit(cross(n, x));
  return Object.freeze({ origin, u: x, v: y, normal: n, precision: Object.freeze({ angularUncertainty, originUncertaintyMm: 0 }) });
}
export function cadPrincipalFrame(plane: CadPlane): CadResolvedFrame {
  const basis = cadPlaneBasis(plane);
  return frame(tuple(0, 0, 0), basis.u, basis.v, basis.normal, 0);
}
function trig(angle: number): readonly [number, number] {
  if (angle % 90 === 0) {
    switch ((((angle / 90) % 4) + 4) % 4) {
      case 0:
        return [1, 0];
      case 1:
        return [0, 1];
      case 2:
        return [-1, 0];
      default:
        return [0, -1];
    }
  }
  const radians = (angle * Math.PI) / 180;
  return [Math.cos(radians), Math.sin(radians)];
}
function rotate(value: CadNumericPoint3, rotations: readonly number[]): CadNumericPoint3 {
  let [x, y, z] = value;
  for (const [axis, angle] of rotations.entries()) {
    const [c, s] = trig(angle);
    if (axis === 0) [y, z] = [c * y - s * z, s * y + c * z];
    else if (axis === 1) [x, z] = [c * x + s * z, -s * x + c * z];
    else [x, y] = [c * x - s * y, s * x + c * y];
  }
  return tuple(x, y, z);
}
export function resolveCadWorldDatum(feature: CadDatumPlaneFeature, parameters: Readonly<Record<string, number>>): CadResolvedFrame {
  if (!isCadImportData(feature) || !Value.Check(CadDatumPlaneFeatureSchema, feature) || !isCadImportData(parameters))
    throw new CadError('invalid-datum-plane', 'A world datum requires its own base plane, origin and rotation data.');
  const { definition } = feature;
  const basis = cadPlaneBasis(definition.basePlane);
  const rotations = definition.rotation.map((value) => evaluateCadAngle(value, parameters));
  const [x, y, z] = definition.origin.map((value) => evaluateCadScalar(value, parameters));
  return frame(
    tuple(x, y, z),
    rotate(basis.u, rotations),
    rotate(basis.v, rotations),
    rotate(basis.normal, rotations),
    rotations.every((angle) => angle % 90 === 0) ? 0 : CAD_DATUM_ORTHONORMAL_RESIDUAL,
  );
}
export function prepareCadDatumFrames(features: readonly CadFeature[], parameters: Readonly<Record<string, number>>): CadDatumFrameLookup {
  const frames = new Map<string, CadResolvedFrame>();
  for (const feature of features)
    if (feature.kind === 'datum-plane') {
      const resolved = resolveCadWorldDatum(feature, parameters);
      if (!feature.suppressed) frames.set(feature.id, resolved);
    }
  return Object.freeze({ get: (id: string) => frames.get(id) });
}
export function resolveCadSketchPlacement(
  feature: CadSketchFeature | CadCurveFeature,
  parameters: Readonly<Record<string, number>>,
  lookup?: CadDatumFrameLookup,
): CadResolvedPlacement {
  const offsetMm = evaluateCadScalar(feature.offset, parameters);
  const datumId = typeof feature.plane === 'string' ? null : feature.plane.featureId;
  const resolved = typeof feature.plane === 'string' ? cadPrincipalFrame(feature.plane) : lookup?.get(feature.plane.featureId);
  if (!resolved)
    throw new CadError(
      'unavailable-datum-plane',
      `Datum plane "${datumId}" must precede this feature and be active. Repair or unsuppress its reference.`,
    );
  return Object.freeze({
    plane: typeof feature.plane === 'string' ? feature.plane : Object.freeze({ ...feature.plane }),
    datumId,
    offsetMm,
    frame: resolved,
  });
}
export function cadFramePointToWorld(frame: CadResolvedFrame, offsetMm: number, point: CadNumericPoint2): CadNumericPoint3 {
  const values = [0, 1, 2].map(
    (index) => frame.origin[index] + frame.u[index] * point[0] + frame.v[index] * point[1] + frame.normal[index] * offsetMm,
  );
  if (!values.every(Number.isFinite)) throw new CadError('unsupported-datum-frame', 'World placement exceeds the finite coordinate range.');
  return tuple(values[0], values[1], values[2]);
}
export function cadFrameDirectionToWorld(frame: CadResolvedFrame, direction: CadNumericPoint2): CadNumericPoint3 {
  return tuple(
    frame.u[0] * direction[0] + frame.v[0] * direction[1],
    frame.u[1] * direction[0] + frame.v[1] * direction[1],
    frame.u[2] * direction[0] + frame.v[2] * direction[1],
  );
}
export function requireCadPrincipalPlane(plane: CadSketchPlane, operation: string): CadPlane {
  if (typeof plane !== 'string')
    throw new CadError(
      'unsupported-datum-operation',
      `${operation} does not yet support datum placement. Use a principal-plane source or Pad/Revolve; the local reference geometry remains valid.`,
    );
  return plane;
}
export function resolveCadExtrudeRevolvePlacement(
  feature: Extract<CadFeature, { kind: 'extrude' | 'revolve' }>,
  sketch: CadSketchFeature,
  parameters: Readonly<Record<string, number>>,
  lookup?: CadDatumFrameLookup,
): CadResolvedPlacement {
  const placement = resolveCadSketchPlacement(sketch, parameters, lookup);
  if (typeof sketch.plane === 'string') return placement; // Preserve accepted legacy precision semantics.
  let localScale = 0;
  for (const region of resolveCadSketchRegions(sketch, parameters))
    for (const contour of [region.boundary, ...region.voids]) {
      for (const entity of cadProfileToEntities(contour.geometry)) {
        if (entity.type === 'line')
          localScale = Math.max(
            localScale,
            Math.abs(entity.start.x),
            Math.abs(entity.start.y),
            Math.abs(entity.end.x),
            Math.abs(entity.end.y),
          );
        else if (entity.type === 'circle' || entity.type === 'arc')
          localScale = Math.max(localScale, Math.abs(entity.center.x) + entity.radius, Math.abs(entity.center.y) + entity.radius);
      }
    }
  const signedDistance = feature.kind === 'extrude' ? evaluateCadScalar(feature.distance, parameters) : 0;
  const distance = Math.abs(signedDistance);
  const travel = Math.abs(placement.offsetMm) + distance * (feature.kind === 'extrude' && feature.symmetric ? 1.5 : 1);
  const lever = feature.kind === 'revolve' ? localScale : 0;
  const startStation = placement.offsetMm - (feature.kind === 'extrude' && feature.symmetric ? signedDistance / 2 : 0);
  const origins = [
    cadFramePointToWorld(placement.frame, startStation, [0, 0]),
    cadFramePointToWorld(placement.frame, startStation + signedDistance, [0, 0]),
  ];
  const scale = Math.max(1, ...origins.flatMap((origin) => origin.map(Math.abs)), localScale, travel, lever);
  const originError =
    placement.offsetMm === 0
      ? placement.frame.precision.originUncertaintyMm
      : placement.frame.precision.originUncertaintyMm +
        CAD_DATUM_ORTHONORMAL_RESIDUAL * Math.max(1, ...placement.frame.origin.map(Math.abs), Math.abs(placement.offsetMm));
  const uncertainty =
    originError + CAD_DATUM_ORTHONORMAL_RESIDUAL * scale + placement.frame.precision.angularUncertainty * (localScale + travel + lever);
  if (!Number.isFinite(uncertainty) || uncertainty > CAD_DATUM_NATIVE_PLACEMENT_PRECISION_MM)
    throw new CadError(
      'unsupported-datum-precision',
      'This datum solid placement exceeds the supported native precision. Reduce its world distance or lever arms, or use a principal/cardinal placement.',
    );
  return placement;
}
