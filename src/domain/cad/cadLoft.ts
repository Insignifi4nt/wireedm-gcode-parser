import type { CadFeature, CadPlane, CadSketchFeature } from './cadDocument';
import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';
import { resolveCadSketchRegions, type ResolvedCadProfile } from './cadSketchGeometry';
import { requireCadPrincipalPlane } from './cadDatumPlanes';

export const MIN_CAD_LOFT_SECTIONS = 2;
export const MAX_CAD_LOFT_SECTIONS = 16;
export const CAD_LOFT_NATIVE_PRECISION = 1e-7;
export type CadLoftFeature = Extract<CadFeature, { kind: 'loft' }>;
export interface CadLoftSection {
  readonly sketchId: string;
  readonly sketch: CadSketchFeature;
  readonly plane: CadPlane;
  readonly offset: number;
  readonly geometry: ResolvedCadProfile;
}
export type CadLoftSketchInspection =
  | { readonly eligible: true; readonly section: CadLoftSection }
  | { readonly eligible: false; readonly code: string; readonly message: string };

/** Compare native precision and floating-point subtraction at the actual offsets. */
export function cadLoftOffsetTolerance(offsets: readonly number[]): number {
  let scale = 1;
  for (const offset of offsets) {
    if (!Number.isFinite(offset) || Math.abs(offset) > 1e9) throw new CadError('invalid-scalar', 'Loft offsets must be finite and within one billion millimetres.');
    scale = Math.max(scale, Math.abs(offset));
  }
  return Math.max(CAD_LOFT_NATIVE_PRECISION, 8 * Number.EPSILON * scale);
}

/** UI callers cache this inspection against immutable sketch/parameter snapshots. */
export function inspectCadLoftSketch(sketch: CadSketchFeature, parameters: Readonly<Record<string, number>>): CadLoftSketchInspection {
  if (sketch.suppressed) return { eligible: false, code: 'suppressed-sketch', message: `Loft section "${sketch.name}" is suppressed.` };
  try {
    const plane = requireCadPrincipalPlane(sketch.plane, 'Loft');
    const offset = evaluateCadScalar(sketch.offset, parameters);
    const regions = resolveCadSketchRegions(sketch, parameters);
    if (regions.length === 0) return { eligible: false, code: 'empty-sketch', message: `Loft section "${sketch.name}" needs a closed non-construction contour.` };
    if (regions.length !== 1 || regions[0].voids.length !== 0) return { eligible: false, code: 'unsupported-loft-section', message: `Loft section "${sketch.name}" must contain exactly one material boundary without holes or islands.` };
    return { eligible: true, section: Object.freeze({ sketchId: sketch.id, sketch, plane, offset, geometry: regions[0].boundary.geometry }) };
  } catch (error) {
    if (error instanceof CadError) return { eligible: false, code: error.code, message: error.message };
    throw error;
  }
}

/** Preserve authored section order; never sort planes or discard material contours. */
export function resolveCadLoftSections(feature: CadLoftFeature, precedingFeatures: ReadonlyMap<string, CadFeature>, parameters: Readonly<Record<string, number>>) {
  if (feature.sketchIds.length < MIN_CAD_LOFT_SECTIONS || feature.sketchIds.length > MAX_CAD_LOFT_SECTIONS) {
    throw new CadError('loft-section-limit', 'Lofts require 2–16 ordered sketch sections.');
  }
  if (new Set(feature.sketchIds).size !== feature.sketchIds.length) throw new CadError('duplicate-loft-section', 'Loft sketch sections must have unique IDs.');
  const sections = feature.sketchIds.map(id => {
    const sketch = precedingFeatures.get(id);
    if (sketch?.kind !== 'sketch') throw new CadError('invalid-reference', `Loft "${feature.name}" needs a preceding sketch "${id}".`);
    const inspection = inspectCadLoftSketch(sketch, parameters);
    if (!inspection.eligible) throw new CadError(inspection.code, inspection.message);
    return inspection.section;
  });
  const offsetTolerance = cadLoftOffsetTolerance(sections.map(section => section.offset));
  let direction = 0;
  for (let index = 1; index < sections.length; index++) {
    const previous = sections[index - 1]; const current = sections[index];
    if (current.plane !== previous.plane) throw new CadError('unsupported-loft-planes', 'Loft sections must use the same principal sketch plane.');
    const difference = current.offset - previous.offset;
    if (Math.abs(difference) <= offsetTolerance) throw new CadError('invalid-loft-order', 'Loft section offsets must be separated beyond native and floating-point precision.');
    const sign = Math.sign(difference);
    if (direction !== 0 && sign !== direction) throw new CadError('invalid-loft-order', 'Loft section offsets must increase or decrease strictly in the supplied order.');
    direction = sign;
  }
  return Object.freeze({ sections: Object.freeze(sections), offsetTolerance });
}
