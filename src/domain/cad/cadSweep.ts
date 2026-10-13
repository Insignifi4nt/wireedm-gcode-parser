import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { CadCurveFeature, CadFeature, CadPlane, CadSketchFeature, CadSweepFeature } from './cadDocument';
export type { CadSweepFeature } from './cadDocument';
import { CadError } from './cadError';
import { isCadImportData } from './cadImportData';
import { CadFeatureBaseSchemaFields, CadIdentifierSchema } from './cadPrimitives';
import { inspectCadLoftSketch, type CadLoftSection } from './cadLoft';
import { resolveCadCurve, type CadResolvedCurve } from './cadCurve';
import { cadPlaneBasis, type CadNumericPoint3 } from './cadPlanes';
import { cadSweepProfileRadius, resolveCadSweepClearance, type CadSweepClearance } from './cadSweepClearance';
import { cadOrderedCurveEntities } from './cadAnalyticSegments';
import { cadProfileToEntities } from './cadSketchGeometry';
import { nextUp } from '../path-intel/segments';
import { requireCadPrincipalPlane } from './cadDatumPlanes';

export const MAX_CAD_SWEEP_SEGMENTS = 64;
export const MAX_CAD_SWEEP_WORK = 2048;
export { CAD_SWEEP_NATIVE_PRECISION, CAD_SWEEP_TOPOLOGY_TOLERANCE } from './cadSweepClearance';
export const CadSweepFeatureSchema = Type.Object({ ...CadFeatureBaseSchemaFields, kind: Type.Literal('sweep'), sketchId: CadIdentifierSchema, curveId: CadIdentifierSchema,
  operation: Type.Union([Type.Literal('new'), Type.Literal('join'), Type.Literal('cut')]), targetId: Type.Union([CadIdentifierSchema, Type.Null()]) }, { additionalProperties: false });
export type CadSweepSection = Omit<CadLoftSection, 'plane'> & { readonly plane: CadPlane };
export type CadSweepSketchInspection = { readonly eligible: true; readonly section: CadSweepSection } | { readonly eligible: false; readonly code: string; readonly message: string };
export interface CadResolvedSweepInputs {
  readonly section: CadSweepSection;
  readonly curveFeature: CadCurveFeature;
  readonly curve: CadResolvedCurve;
  readonly frame: { readonly tangent: CadNumericPoint3; readonly normal: CadNumericPoint3; readonly binormal: CadNumericPoint3 };
  readonly clearance: CadSweepClearance;
  readonly sectionEdgeCount: number;
  readonly nativeWork: number;
}
export type CadSweepInspection = { readonly eligible: true; readonly inputs: CadResolvedSweepInputs } | { readonly eligible: false; readonly code: string; readonly message: string };

/** Same one-boundary contract as Loft, with operation-specific diagnostics. */
export function inspectCadSweepSketch(sketch: CadSketchFeature, parameters: Readonly<Record<string, number>>): CadSweepSketchInspection {
  if (typeof sketch.plane !== 'string') return { eligible: false, code: 'unsupported-datum-operation',
    message: 'Sweep does not yet support datum placement. Use a principal-plane section; the local reference geometry remains valid.' };
  const inspection = inspectCadLoftSketch(sketch, parameters);
  return inspection.eligible ? { eligible: true, section: Object.freeze({ ...inspection.section, plane: sketch.plane }) } : { ...inspection, code: inspection.code === 'unsupported-loft-section' ? 'unsupported-sweep-section' : inspection.code,
    message: inspection.message.replaceAll('Loft', 'Sweep') };
}
const dot = (a: CadNumericPoint3, b: CadNumericPoint3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function cross(a: CadNumericPoint3, b: CadNumericPoint3): CadNumericPoint3 {
  return Object.freeze([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]);
}
function placementAdvice(curve: CadResolvedCurve): string {
  for (const plane of ['XY', 'XZ', 'YZ'] satisfies readonly CadPlane[]) {
    const basis = cadPlaneBasis(plane); const residual = Math.hypot(...cross(basis.normal, curve.startTangentWorld));
    if (residual <= 64 * Number.EPSILON) return `Use a ${plane} sketch at offset ${dot(curve.startWorld, basis.normal)} mm; preserve the curve start's local section position.`;
  }
  return 'The first curve tangent must be perpendicular to a principal sketch plane. Edit the curve start direction; Sweep does not relocate or rotate the sketch.';
}

/** Preserve source placement and authored traversal; reject unsupported precision/clearance. */
export function resolveCadSweepInputs(feature: CadSweepFeature, precedingFeatures: ReadonlyMap<string, CadFeature>, parameters: Readonly<Record<string, number>>): CadResolvedSweepInputs {
  if (!isCadImportData(feature) || !Value.Check(CadSweepFeatureSchema, feature)) throw new CadError('invalid-feature', 'Malformed declarative Sweep feature.');
  if (feature.operation === 'new' && feature.targetId !== null || feature.operation !== 'new' && feature.targetId === null) throw new CadError('invalid-operation', 'New bodies have no target; join and cut require a target body.');
  const sketch = precedingFeatures.get(feature.sketchId); const curveFeature = precedingFeatures.get(feature.curveId);
  if (sketch?.kind !== 'sketch' || curveFeature?.kind !== 'curve') throw new CadError('invalid-reference', 'Sweep requires one preceding sketch and one preceding reference curve.');
  const sectionInspection = inspectCadSweepSketch(sketch, parameters);
  if (!sectionInspection.eligible) throw new CadError(sectionInspection.code, sectionInspection.message);
  if (curveFeature.suppressed) throw new CadError('suppressed-curve', `Sweep curve "${curveFeature.name}" is suppressed.`);
  const curvePlane = requireCadPrincipalPlane(curveFeature.plane, 'Sweep');
  const section = sectionInspection.section; const curve = resolveCadCurve(curveFeature, parameters);
  const basis = cadPlaneBasis(requireCadPrincipalPlane(section.plane, 'Sweep'));
  const anchor = { x: dot(curve.startWorld, basis.u), y: dot(curve.startWorld, basis.v) };
  const localRadius = cadSweepProfileRadius(section.geometry, anchor);
  const angularResidual = Math.hypot(...cross(basis.normal, curve.startTangentWorld));
  const planeResidual = Math.abs(dot(curve.startWorld, basis.normal) - section.offset);
  const profileRadius = nextUp(Math.hypot(localRadius, planeResidual));
  if (angularResidual > 64 * Number.EPSILON || profileRadius * angularResidual > 1e-7 || planeResidual > 1e-7) {
    throw new CadError('unsupported-sweep-placement', `The sketch plane must contain the actual curve start and be perpendicular to its first tangent. ${placementAdvice(curve)}`);
  }
  if (curve.segments.length > MAX_CAD_SWEEP_SEGMENTS) throw new CadError('sweep-work-limit', `Sweep currently supports at most ${MAX_CAD_SWEEP_SEGMENTS} curve segments. The reference curve remains valid; simplify it for this solid operation.`);
  const entities = section.geometry.kind === 'path' ? cadOrderedCurveEntities(section.geometry.segments) : cadProfileToEntities(section.geometry);
  const sectionEdgeCount = entities.length; const nativeWork = sectionEdgeCount * curve.segments.length;
  if (nativeWork > MAX_CAD_SWEEP_WORK) throw new CadError('sweep-work-limit', `Sweep section edges × curve segments must be at most ${MAX_CAD_SWEEP_WORK}. Simplify the section or curve; their reference geometry remains valid.`);
  const sectionScale = Math.max(1, Math.abs(section.offset), Math.abs(anchor.x), Math.abs(anchor.y), profileRadius);
  const clearance = resolveCadSweepClearance(curve, profileRadius, sectionScale, planeResidual + profileRadius * angularResidual);
  return Object.freeze({ section, curveFeature, curve, frame: Object.freeze({ tangent: curve.startTangentWorld,
    normal: cross(cadPlaneBasis(curvePlane).normal, curve.startTangentWorld), binormal: cadPlaneBasis(curvePlane).normal }),
    clearance, sectionEdgeCount, nativeWork });
}
export function inspectCadSweepInputs(feature: CadSweepFeature, precedingFeatures: ReadonlyMap<string, CadFeature>, parameters: Readonly<Record<string, number>>): CadSweepInspection {
  try { return { eligible: true, inputs: resolveCadSweepInputs(feature, precedingFeatures, parameters) }; }
  catch (error) { if (error instanceof CadError) return { eligible: false, code: error.code, message: error.message }; throw error; }
}
