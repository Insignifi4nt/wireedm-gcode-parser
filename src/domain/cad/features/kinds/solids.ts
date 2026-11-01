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
import { cadProfileSketchField, cadRegionSelectionField, cadSolidOperationField, cadSolidTargetField, cadTargetBodyField } from './solidFields';

const strict = { additionalProperties: false };

const importedShape = cadFeatureShape(Type.Literal('imported'), { source: cadFeatureField(CadSolidImportSourceSchema) });

export const imported = {
  kind: 'imported', family: 'solid', ...importedShape,
  outputs: ['body'], body: 'new', suppression: 'no-output', evaluator: { owner: 'kernel', version: 1 },
  diagnostics: ['import-size', 'invalid-import', 'invalid-import-encoding'],
  check(feature) { parseCadSolidImportSource(feature.source); },
  form: { editor: 'bespoke', title: 'Imported solid' },
  agent: { exposed: true, description: 'An independent solid from an original STEP or STL file. Original source bytes are preserved in the document. STEP retains exact BRep; STL is faceted and requires explicit mm/inch source units. Native validation rejects open or invalid solids.' }
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
  diagnostics: ['empty-sketch', 'invalid-operation', 'invalid-region-selection', 'stale-sketch-region', 'unsupported-sketch-format', 'unsupported-datum-frame'],
  check(feature, context) { checkSketchSolid(feature, context, () => context.scalar(feature, 'distance')); },
  form: { editor: 'bespoke', title: 'Pad / pocket' },
  agent: { exposed: true, description: 'Pad the preceding sketch, symmetrically if requested. New creates a body; join/cut consumes and replaces targetId. Absent regionSelection keeps whole-sketch automatic holes. Explicit regionSelection accepts the unchanged nonempty contour-reference array, or a graph-cells envelope packed from inspected cellIds. Contour references retain exact boundaryProfileId, sorted immediate voidProfileIds and complete ordered ancestorProfileIds. Graph cells require schema 2 and deliberate selection; exact source/event witnesses reject topology changes. Neighboring selected cells cancel their shared contour. Changed/missing topology rejects; never infer references from profile names, array indices or points.' }
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
  diagnostics: ['empty-sketch', 'invalid-feature', 'suppressed-sketch', 'invalid-pocket-bounds', 'invalid-pocket-extent', 'unsupported-pocket-span',
    'invalid-region-selection', 'stale-sketch-region', 'unsupported-sketch-format'],
  // Each material region an active Pocket cuts is one operand; its region checks run here, before the instance limit.
  instances: (feature, operands, context) => operands + (context.active ? resolveCadPocketInputs(feature, context.previous, context.document.parameters).regionCount : 1),
  form: { editor: 'bespoke', title: 'Pocket' },
  agent: { exposed: true, description: 'Cut the whole sketch automatic material regions, or explicit bounded regionSelection cells, through a current target body. Obtain complete cell references from cad_inspect_sketch_regions; changed/missing topology rejects instead of substituting another area. extent.kind is through-all; direction positive follows the sketch normal (XY +Z, XZ -Y, YZ +X) from its authored plane, negative follows the opposite side, and both spans the complete target independent of sketch offset. Recomputes finite caps from exact target bounds on each build. Replaces targetId and retains the sketch. No distance, symmetric or operation fields. Rejects no material, complete erasure, uncertain native precision and required spans above one million mm; build and inspect diagnostics before export or CAM handoff.' }
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
  diagnostics: ['empty-sketch', 'invalid-operation', 'unsupported-datum-frame'],
  check(feature, context) { checkSketchSolid(feature, context, () => context.scalar(feature, 'angle')); },
  form: { editor: 'fields', title: 'Revolve', controls: [
    { control: 'part', part: 'sketch-source' },
    { control: 'scalar', field: 'angle', label: 'Angle', unit: 'deg' },
    { control: 'choice', field: 'axis', label: 'Sketch axis' },
    { control: 'operation', field: 'operation', label: 'Operation', target: 'targetId', targetLabel: 'Target body' }] },
  agent: { exposed: true, description: 'Revolve the preceding sketch around its local x or y axis by degrees. New creates a body; join/cut replaces targetId.' }
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
  diagnostics: ['invalid-operation', 'duplicate-loft-section', 'loft-section-limit', 'invalid-loft-order', 'unsupported-datum-frame'],
  // The new section solid is one more operand before a join or cut.
  instances: (_feature, operands) => operands + 1,
  check(feature, context) { if (context.active) resolveCadLoftSections(feature, context.previous, context.document.parameters, context.datums); },
  form: { editor: 'fields', title: 'Loft', controls: [
    { control: 'part', part: 'loft-sections' },
    { control: 'choice', field: 'ruled', label: 'Transition' },
    { control: 'operation', field: 'operation', label: 'Operation', target: 'targetId', targetLabel: 'Target body' }] },
  agent: { exposed: true, description: 'Build a solid through 2–16 unique sketchIds in their supplied order. Each active sketch must have one closed material boundary without holes; construction geometry is ignored. All sections share oriented local axes and normal, on a principal plane or compatible datum planes. Effective normal stations must increase or decrease strictly beyond modeling precision; authored origin translations and in-plane shifts are preserved. Call cad_inspect_loft before adding the feature. No sorting or dropped contours. ruled=true connects consecutive sections directly; false uses fitted native smooth surfaces. New creates a body; join/cut replaces targetId while retaining sketches. Invalid solids and end-plane overshoot fail. STEP preserves the resulting BRep; some section curves cannot transfer to analytic-only CAM.' }
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
  diagnostics: ['invalid-feature', 'invalid-operation', 'suppressed-curve', 'sweep-work-limit', 'unsupported-sweep-placement',
    'unsupported-sweep-clearance', 'unsupported-sweep-corner', 'unsupported-sweep-precision', 'unsupported-sweep-section'],
  // The new section solid is one more operand before a join or cut.
  instances: (_feature, operands) => operands + 1,
  check(feature, context) { if (context.active) resolveCadSweepInputs(feature, context.previous, context.document.parameters, context.datums); },
  form: { editor: 'fields', title: 'Sweep', controls: [
    { control: 'part', part: 'sweep-sources' },
    { control: 'operation', field: 'operation', label: 'Operation', target: 'targetId', targetLabel: 'Target body' }] },
  agent: { exposed: true, description: 'Transport one preceding sketch along one preceding open Curve with fixed planar binormal, using exact extrusions and signed revolutions. Principal or datum sources must preserve their actual world placement. The sketch must contain one active closed material boundary without holes and lie at the actual curve start, perpendicular to its first tangent. Section roll and parallel or antiparallel normal orientation are retained. Preserves authored position, orientation and traversal; no automatic relocation or reversal. Curve joints require matching tangent directions. Conservative enclosing-radius, global clearance and precision checks may reject otherwise valid sections. Supports up to 64 curve segments and section edges × curve segments <= 2048. Call cad_inspect_sweep before adding the feature; then build and inspect diagnostics. New creates one body; join/cut replaces targetId while retaining both references.' }
} satisfies CadFeatureDefinition<'sweep'>;
