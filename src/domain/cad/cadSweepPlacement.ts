import type { CadLoftSection } from './cadLoft';
import type { CadResolvedCurve } from './cadCurve';
import { CadError } from './cadError';
import { CAD_DATUM_ORTHONORMAL_RESIDUAL, cadFramePointToWorld } from './cadDatumPlanes';
import { cadPlaneBasis, type CadNumericPoint2, type CadNumericPoint3 } from './cadPlanes';
import { cadSweepProfileRadius } from './cadSweepClearance';
import { nextUp } from '../path-intel/segments';
import { CAD_PRECISION } from '../precision/cadPrecision';

export interface CadSweepPlacement {
  readonly legacyPrincipal: boolean;
  readonly sectionOriginWorldMm: CadNumericPoint3;
  readonly anchorInSectionMm: CadNumericPoint2;
  readonly planeResidualMm: number;
  readonly tangentResidual: number;
  /** Initial reserve, before per-segment arithmetic and authored joint residuals. */
  readonly uncertaintyMm: number;
  readonly worldScaleMm: number;
}
const dot = (a: CadNumericPoint3, b: CadNumericPoint3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const magnitude = (point: CadNumericPoint3) => Math.max(...point.map(Math.abs));
function cross(a: CadNumericPoint3, b: CadNumericPoint3): CadNumericPoint3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function principalAdvice(curve: CadResolvedCurve): string {
  for (const plane of ['XY', 'XZ', 'YZ'] as const) {
    const basis = cadPlaneBasis(plane);
    if (Math.hypot(...cross(basis.normal, curve.startTangentWorld)) <= CAD_DATUM_ORTHONORMAL_RESIDUAL)
      return `Use a ${plane} sketch at offset ${dot(curve.startWorld, basis.normal)} mm; preserve the curve start's local section position.`;
  }
  return 'The first curve tangent must be perpendicular to a principal sketch plane. Edit the curve start direction; Sweep does not relocate or rotate the sketch.';
}

/** Preserve both authored frames, including section roll and antiparallel normals. */
export function resolveCadSweepPlacement(section: CadLoftSection, curve: CadResolvedCurve) {
  const legacyPrincipal = typeof section.plane === 'string' && typeof curve.plane === 'string';
  const sectionFrame = section.placement.frame;
  const sectionOrigin = cadFramePointToWorld(sectionFrame, section.offset, [0, 0]);
  const delta: CadNumericPoint3 = [curve.startWorld[0] - sectionOrigin[0], curve.startWorld[1] - sectionOrigin[1], curve.startWorld[2] - sectionOrigin[2]];
  // Retain the prior principal arithmetic, including its sign and scale policy.
  const anchor: CadNumericPoint2 = legacyPrincipal ? [dot(curve.startWorld, sectionFrame.u), dot(curve.startWorld, sectionFrame.v)]
    : [dot(delta, sectionFrame.u), dot(delta, sectionFrame.v)];
  const planeStation = legacyPrincipal ? dot(curve.startWorld, sectionFrame.normal) - section.offset : dot(delta, sectionFrame.normal);
  const planeResidual = Math.abs(planeStation);
  const angularResidual = Math.hypot(...cross(sectionFrame.normal, curve.startTangentWorld));
  const localRadius = cadSweepProfileRadius(section.geometry, { x: anchor[0], y: anchor[1] });
  const profileRadius = nextUp(Math.hypot(localRadius, planeResidual));
  if (angularResidual > CAD_DATUM_ORTHONORMAL_RESIDUAL || profileRadius * angularResidual > CAD_PRECISION.kernelConfusionMm || planeResidual > CAD_PRECISION.kernelConfusionMm) {
    const advice = legacyPrincipal ? principalAdvice(curve) : `The Curve starts at (${curve.startWorld.join(', ')}) mm with tangent (${curve.startTangentWorld.join(', ')}). Place the section there with parallel or antiparallel normal; preserve its authored local position and roll.`;
    throw new CadError('unsupported-sweep-placement', `The sketch plane must contain the actual curve start and be perpendicular to its first tangent. ${advice}`);
  }
  let worldScaleMm = 0;
  let uncertaintyMm = planeResidual + profileRadius * angularResidual;
  let sectionScaleMm = Math.max(1, Math.abs(section.offset), Math.abs(anchor[0]), Math.abs(anchor[1]), profileRadius);
  if (!legacyPrincipal) {
    const railFrame = curve.frame;
    const railOrigin = cadFramePointToWorld(railFrame, curve.offset, [0, 0]);
    let railLocalScale = Math.max(1, ...curve.start.map(Math.abs), ...curve.end.map(Math.abs));
    worldScaleMm = Math.max(1, magnitude(sectionOrigin) + Math.SQRT2 * section.localCoordinateScaleMm, magnitude(railOrigin), magnitude(curve.startWorld), magnitude(sectionFrame.origin), magnitude(railFrame.origin),
      magnitude(curve.worldBounds.min) + profileRadius, magnitude(curve.worldBounds.max) + profileRadius);
    for (const entity of curve.entities) {
      for (const point of [entity.start, entity.end]) {
        railLocalScale = Math.max(railLocalScale, Math.abs(point.x), Math.abs(point.y));
        worldScaleMm = Math.max(worldScaleMm, magnitude(cadFramePointToWorld(railFrame, curve.offset, [point.x, point.y])));
      }
      if (entity.type === 'arc') {
        railLocalScale = Math.max(railLocalScale, Math.abs(entity.center.x) + entity.radius, Math.abs(entity.center.y) + entity.radius);
        worldScaleMm = Math.max(worldScaleMm, magnitude(cadFramePointToWorld(railFrame, curve.offset, [entity.center.x, entity.center.y])) + entity.radius);
      }
    }
    const component = (index: number) => sectionFrame.u[index] * anchor[0] + sectionFrame.v[index] * anchor[1] + sectionFrame.normal[index] * planeStation;
    const rebuilt: CadNumericPoint3 = [component(0), component(1), component(2)];
    const roundtrip = Math.hypot(...rebuilt.map((value, index) => value - delta[index]));
    const offsetError = (origin: CadNumericPoint3, offset: number) => offset === 0 ? 0 : CAD_DATUM_ORTHONORMAL_RESIDUAL * Math.max(1, magnitude(origin), Math.abs(offset));
    sectionScaleMm = Math.max(sectionScaleMm, section.localCoordinateScaleMm);
    uncertaintyMm += sectionFrame.precision.originUncertaintyMm + railFrame.precision.originUncertaintyMm
      + offsetError(sectionFrame.origin, section.offset) + offsetError(railFrame.origin, curve.offset) + roundtrip
      + CAD_DATUM_ORTHONORMAL_RESIDUAL * (worldScaleMm + Math.max(1, magnitude(delta), sectionScaleMm, railLocalScale))
      + sectionFrame.precision.angularUncertainty * (section.localCoordinateScaleMm + Math.abs(section.offset))
      + railFrame.precision.angularUncertainty * (railLocalScale + Math.abs(curve.offset) + profileRadius);
  }
  return Object.freeze({ profileRadiusMm: profileRadius, sectionScaleMm, placement: Object.freeze({ legacyPrincipal,
    sectionOriginWorldMm: sectionOrigin, anchorInSectionMm: Object.freeze(anchor), planeResidualMm: planeResidual,
    tangentResidual: angularResidual, uncertaintyMm, worldScaleMm }) });
}
