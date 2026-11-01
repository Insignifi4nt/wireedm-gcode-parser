import { Type } from '@sinclair/typebox';
import type { CadEdgeSelection, CadFaceQuery } from '../../cadTopology';
import { CadEdgeSelectionSchema, CadFaceQuerySchema, resolveCadEdgeSelection, validateCadShellOpening } from '../../cadTopology';
import { CAD_PRECISION } from '../../../precision/cadPrecision';
import type { CadFeatureCheckContext, CadFeatureDefinition, CadFeatureForm, CadFeatureOf } from '../cadFeatureDefinitionTypes';
import { cadFeatureField, cadFeatureScalarField, cadFeatureShape } from '../cadFeatureFields';
import { mapCadEdgeSelectionScalars, mapCadFaceQueryScalars } from '../cadFeatureScalarMaps';
import { cadTargetBodyField } from './solidFields';

const positiveLength = { quantity: 'length', min: CAD_PRECISION.minimumLengthMm, exclusiveMin: true, max: CAD_PRECISION.modelExtentMm } as const;
const edgeSelection = Type.Optional(Type.Union([CadEdgeSelectionSchema, Type.Null()]));

// Fillet and chamfer store one shape, whose kind is either.
const edgeTreatmentShape = cadFeatureShape(Type.Union([Type.Literal('fillet'), Type.Literal('chamfer')]), {
  targetId: cadTargetBodyField,
  // A chamfer's distance.
  radius: cadFeatureScalarField({ ...positiveLength, refusal: 'Edge radius must be positive and within one million millimetres.' }),
  // Absent or null: every edge of the target.
  selection: cadFeatureField<typeof edgeSelection, CadEdgeSelection>(edgeSelection, { scalars: mapCadEdgeSelectionScalars }),
  tangentPropagation: cadFeatureField(Type.Optional(Type.Boolean()))
});

function checkEdgeTreatment(feature: CadFeatureOf<'fillet' | 'chamfer'>, context: CadFeatureCheckContext) {
  context.scalar(feature, 'radius');
  if (feature.selection) resolveCadEdgeSelection(feature.selection, context.document.parameters);
}
const edgeTreatmentForm = (title: string, size: string): CadFeatureForm<'targetId' | 'radius'> => ({ editor: 'fields', title, controls: [
  { control: 'body', field: 'targetId', label: 'Body' },
  { control: 'part', part: 'edge-scope' },
  { control: 'part', part: 'topology-picker' },
  { control: 'scalar', field: 'radius', label: size },
  { control: 'part', part: 'tangent-chain' }] });
const edgeTreatmentDiagnostics = ['invalid-selector', 'invalid-selector-dimension', 'duplicate-pick', 'invalid-pick-kind', 'invalid-direction', 'missing-body'];

export const fillet = {
  kind: 'fillet', family: 'dress-up', ...edgeTreatmentShape,
  outputs: ['body'], body: 'modify-target', suppression: 'pass-through', evaluator: { owner: 'kernel', version: 1 },
  diagnostics: edgeTreatmentDiagnostics,
  check: checkEdgeTreatment,
  form: edgeTreatmentForm('Fillet', 'Radius'),
  agent: { exposed: true, description: 'Round current target edges. Absent/null selection means all edges; supplied geometric queries must match their exact expected counts. Selected seeds continue through native tangent chains only with tangentPropagation=true; absent/false requires the complete chain selected explicitly. Replaces targetId; invalid radii report a build diagnostic.' }
} satisfies CadFeatureDefinition<'fillet'>;

export const chamfer = {
  kind: 'chamfer', family: 'dress-up', ...edgeTreatmentShape,
  outputs: ['body'], body: 'modify-target', suppression: 'pass-through', evaluator: { owner: 'kernel', version: 1 },
  diagnostics: edgeTreatmentDiagnostics,
  check: checkEdgeTreatment,
  form: edgeTreatmentForm('Chamfer', 'Distance'),
  agent: { exposed: true, description: 'Chamfer current target edges. The radius field is the distance in mm. Optional geometric selection must match exact counts; absent/null retains all-edge semantics. Selected seeds continue through native tangent chains only with tangentPropagation=true; absent/false requires the complete chain selected explicitly.' }
} satisfies CadFeatureDefinition<'chamfer'>;

const shellShape = cadFeatureShape(Type.Literal('shell'), {
  targetId: cadTargetBodyField,
  thickness: cadFeatureScalarField({ ...positiveLength, refusal: 'Inward shell thickness must be positive and within one million millimetres.' }),
  // The one planar face the shell opens.
  opening: cadFeatureField<typeof CadFaceQuerySchema, CadFaceQuery>(CadFaceQuerySchema, { scalars: mapCadFaceQueryScalars })
});

export const shell = {
  kind: 'shell', family: 'dress-up', ...shellShape,
  outputs: ['body'], body: 'modify-target', suppression: 'pass-through', evaluator: { owner: 'kernel', version: 1 },
  diagnostics: ['invalid-shell-opening', 'invalid-selector', 'shell-failed', 'missing-body'],
  check(feature, context) {
    context.scalar(feature, 'thickness');
    validateCadShellOpening(feature.opening, context.document.parameters);
  },
  form: { editor: 'fields', title: 'Shell', controls: [
    { control: 'body', field: 'targetId', label: 'Body' },
    { control: 'part', part: 'topology-picker' },
    { control: 'scalar', field: 'thickness', label: 'Wall thickness' },
    { control: 'part', part: 'opening-summary' }] },
  agent: { exposed: true, description: 'Hollow a current solid inward by positive thickness in mm, opening exactly one planar face selected by geometric predicates. Ambiguous selections and invalid walls fail explicitly.' }
} satisfies CadFeatureDefinition<'shell'>;
