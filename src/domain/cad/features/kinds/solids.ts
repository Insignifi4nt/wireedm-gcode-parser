import { Type } from '@sinclair/typebox';
import { CadError } from '../../cadError';
import { CadIdentifierSchema } from '../../cadPrimitives';
import { CadSolidImportSourceSchema, parseCadSolidImportSource } from '../../cadImports';
import { CadPocketDirectionSchema } from '../../cadPocketExtent';
import { MAX_CAD_LOFT_SECTIONS, MIN_CAD_LOFT_SECTIONS } from '../../cadLoftLimits';
import { resolveCadExtrudeRevolvePlacement } from '../../cadDatumPlanes';
import { resolveCadLoftSections } from '../../cadLoft';
import { resolveCadSweepInputs } from '../../cadSweep';
import { resolveCadPocketInputs } from '../../cadPocket';
import { CAD_PRECISION } from '../../../precision/cadPrecision';
import type { CadFeatureCheckContext, CadFeatureDefinition, CadFeatureOf } from '../cadFeatureDefinitionTypes';
import { cadFeatureField, cadFeatureReference, cadFeatureScalarField, cadFeatureShape } from '../cadFeatureFields';
import { cadMaterialDiagnostics, cadProfileSketchField, cadRegionSelectionField, cadSketchRegionDiagnostics, cadSolidOperationField, cadSolidTargetField,
  cadTargetBodyField } from './solidFields';

const strict = { additionalProperties: false };

const importedShape = cadFeatureShape(Type.Literal('imported'), { source: cadFeatureField(CadSolidImportSourceSchema) });

export const imported = {
  kind: 'imported', family: 'solid', ...importedShape,
  outputs: ['body'], body: 'new', suppression: 'no-output', evaluator: { owner: 'kernel', version: 1 },
  diagnostics: ['import-size', 'invalid-import', 'invalid-import-encoding', 'import-empty', 'import-invalid', 'import-open', 'import-not-solid', 'import-bounds',
    'import-volume', 'step-read', 'step-roots', 'step-transfer', 'step-units', 'step-units-unsupported', 'stl-read', 'stl-coordinate', 'stl-facets',
    'stl-incomplete', 'stl-open', 'stl-orientation', 'stl-shells', 'invalid-instances'],
  check(feature) { parseCadSolidImportSource(feature.source); }
} satisfies CadFeatureDefinition<'imported'>;

/** The checks a Pad or Revolve makes of its sketch: that it is active with regions to use, and where it places the solid. */
function checkSketchSolid(feature: CadFeatureOf<'extrude' | 'revolve'>, context: CadFeatureCheckContext, dimension: () => void) {
  const sketch = context.previous.get(feature.sketchId);
  if (sketch?.kind !== 'sketch') throw new CadError('invalid-reference', `Feature "${feature.name}" needs a preceding sketch.`);
  if (context.active) context.checkUsableSketch(feature, sketch, feature.kind === 'extrude' ? feature.regionSelection : undefined);
  dimension();
  if (context.active) resolveCadExtrudeRevolvePlacement(feature, sketch, context.document.parameters, context.datums);
}

const extrudeShape = cadFeatureShape(Type.Literal('extrude'), {
  sketchId: cadProfileSketchField,
  regionSelection: cadRegionSelectionField,
  distance: cadFeatureScalarField({ quantity: 'length', magnitude: true, min: CAD_PRECISION.minimumLengthMm, exclusiveMin: true, max: CAD_PRECISION.modelExtentMm,
    refusal: 'Extrusion distance must be nonzero and within one million millimetres.' }),
  symmetric: cadFeatureField(Type.Boolean()),
  operation: cadSolidOperationField,
  targetId: cadSolidTargetField
});

export const extrude = {
  kind: 'extrude', family: 'solid', ...extrudeShape,
  outputs: ['body'], body: 'new-or-modify', suppression: 'pass-through', evaluator: { owner: 'kernel', version: 1 },
  diagnostics: [...cadSketchRegionDiagnostics, 'unsupported-sketch-format', 'unsupported-datum-frame', 'unsupported-datum-precision', 'invalid-dimension',
    'missing-sketch', 'missing-target', 'missing-body', 'invalid-instances', ...cadMaterialDiagnostics('cut')],
  check(feature, context) { checkSketchSolid(feature, context, () => context.scalar(feature, 'distance')); }
} satisfies CadFeatureDefinition<'extrude'>;

const pocketShape = cadFeatureShape(Type.Literal('pocket'), {
  sketchId: cadProfileSketchField,
  regionSelection: cadRegionSelectionField,
  targetId: cadTargetBodyField,
  extent: cadFeatureField(Type.Object({ kind: Type.Literal('through-all'), direction: CadPocketDirectionSchema }, strict))
});
export const CadPocketFeatureSchema = pocketShape.schema;

export const pocket = {
  kind: 'pocket', family: 'solid', ...pocketShape,
  outputs: ['body'], body: 'modify-target', suppression: 'pass-through', evaluator: { owner: 'kernel', version: 1 },
  diagnostics: [...cadSketchRegionDiagnostics, 'unsupported-sketch-format', 'invalid-feature', 'suppressed-sketch', 'invalid-plane', 'unsupported-datum-operation',
    'invalid-pocket-bounds', 'invalid-pocket-extent', 'unsupported-pocket-span', 'pocket-span-limit', 'missing-body', 'invalid-instances',
    ...cadMaterialDiagnostics('pocket')],
  // Each material region an active Pocket cuts is one operand; its region checks run here, before the instance limit.
  instances: (feature, operands, context) => operands + (context.active ? resolveCadPocketInputs(feature, context.previous, context.document.parameters).regionCount : 1)
} satisfies CadFeatureDefinition<'pocket'>;

/** The sketch's local axis a Revolve turns around. */
const sketchAxis = Type.Union([Type.Literal('x'), Type.Literal('y')]);
const revolveShape = cadFeatureShape(Type.Literal('revolve'), {
  sketchId: cadProfileSketchField,
  angle: cadFeatureScalarField({ quantity: 'angle', min: CAD_PRECISION.minimumAngleDeg, exclusiveMin: true, max: 360,
    refusal: 'Revolve angle must be greater than zero and at most 360 degrees.' }),
  axis: cadFeatureField<typeof sketchAxis, 'x' | 'y'>(sketchAxis, { choices: [{ value: 'x', label: 'Horizontal X' }, { value: 'y', label: 'Vertical Y' }] }),
  operation: cadSolidOperationField,
  targetId: cadSolidTargetField
});

export const revolve = {
  kind: 'revolve', family: 'solid', ...revolveShape,
  outputs: ['body'], body: 'new-or-modify', suppression: 'pass-through', evaluator: { owner: 'kernel', version: 1 },
  diagnostics: [...cadSketchRegionDiagnostics, 'unsupported-datum-frame', 'unsupported-datum-precision', 'invalid-dimension', 'missing-sketch', 'missing-target',
    'missing-body', 'invalid-instances', ...cadMaterialDiagnostics('cut')],
  check(feature, context) { checkSketchSolid(feature, context, () => context.scalar(feature, 'angle')); }
} satisfies CadFeatureDefinition<'revolve'>;

const loftSections = Type.Array(CadIdentifierSchema, { minItems: MIN_CAD_LOFT_SECTIONS, maxItems: MAX_CAD_LOFT_SECTIONS, uniqueItems: true });
const loftShape = cadFeatureShape(Type.Literal('loft'), {
  sketchIds: cadFeatureField<typeof loftSections, readonly string[]>(loftSections, { slot: { role: 'sections', accepts: ['sketch'], count: 'many', ordered: true, ids: ids => ids } }),
  ruled: cadFeatureField<ReturnType<typeof Type.Boolean>, boolean>(Type.Boolean(),
    { choices: [{ value: false, label: 'Smooth', key: 'smooth' }, { value: true, label: 'Ruled', key: 'ruled' }] }),
  operation: cadSolidOperationField,
  targetId: cadSolidTargetField
});

export const loft = {
  kind: 'loft', family: 'solid', ...loftShape,
  outputs: ['body'], body: 'new-or-modify', suppression: 'pass-through', evaluator: { owner: 'kernel', version: 1 },
  diagnostics: ['duplicate-loft-section', 'loft-section-limit', 'invalid-loft-order', 'loft-sections', 'unsupported-loft-planes', 'unsupported-loft-section',
    'loft-placement', 'loft-failed', 'loft-invalid', 'loft-open', 'loft-overshoot', 'loft-volume', ...cadSketchRegionDiagnostics, 'suppressed-sketch', 'invalid-plane',
    'invalid-datum-plane', 'unsupported-datum-frame', 'unsupported-datum-precision', 'missing-target', 'missing-body', 'invalid-instances',
    ...cadMaterialDiagnostics('cut')],
  // The new section solid is one more operand before a join or cut.
  instances: (_feature, operands) => operands + 1,
  check(feature, context) { if (context.active) resolveCadLoftSections(feature, context.previous, context.document.parameters, context.datums); }
} satisfies CadFeatureDefinition<'loft'>;

const sweepShape = cadFeatureShape(Type.Literal('sweep'), {
  sketchId: cadProfileSketchField,
  curveId: cadFeatureReference({ role: 'path', accepts: ['curve'] }),
  operation: cadSolidOperationField,
  targetId: cadSolidTargetField
});
export const CadSweepFeatureSchema = sweepShape.schema;

export const sweep = {
  kind: 'sweep', family: 'solid', ...sweepShape,
  outputs: ['body'], body: 'new-or-modify', suppression: 'pass-through', evaluator: { owner: 'kernel', version: 1 },
  diagnostics: ['invalid-feature', 'suppressed-curve', 'sweep-work-limit', 'unsupported-sweep-placement', 'unsupported-sweep-clearance', 'unsupported-sweep-corner',
    'unsupported-sweep-precision', 'unsupported-sweep-section', 'sweep-curve', 'sweep-section', 'sweep-empty', 'sweep-failed', 'sweep-invalid', 'sweep-open',
    'sweep-volume', 'empty-reference', 'invalid-curve-placement', 'unsupported-loft-section', ...cadSketchRegionDiagnostics, 'suppressed-sketch', 'invalid-plane',
    'invalid-datum-plane', 'unsupported-datum-frame', 'unsupported-datum-operation', 'missing-target', 'missing-body', 'invalid-instances',
    ...cadMaterialDiagnostics('cut')],
  // The new section solid is one more operand before a join or cut.
  instances: (_feature, operands) => operands + 1,
  check(feature, context) { if (context.active) resolveCadSweepInputs(feature, context.previous, context.document.parameters, context.datums); }
} satisfies CadFeatureDefinition<'sweep'>;
