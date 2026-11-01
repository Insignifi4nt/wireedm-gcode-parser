import { Type } from '@sinclair/typebox';
import type { CadPlane } from '../../cadDocument';
import { CadError } from '../../cadError';
import { CadPlaneSchema } from '../../cadPrimitives';
import { MAX_CAD_PATTERN_COUNT, MIN_CAD_PATTERN_COUNT, resolveCadCircularPattern } from '../../cadPatterns';
import { CAD_PRECISION } from '../../../precision/cadPrecision';
import type { CadFeatureDefinition, CadFeatureFormComponent } from '../cadFeatureDefinitionTypes';
import { cadFeatureField, cadFeatureReference, cadFeatureScalarField, cadFeatureShape, cadFeatureVectorField } from '../cadFeatureFields';
import { cadSourceBodyField, cadTargetBodyField } from './solidFields';

const booleanOperation = Type.Union([Type.Literal('union'), Type.Literal('cut'), Type.Literal('intersect')]);
const booleanShape = cadFeatureShape(Type.Literal('boolean'), {
  targetId: cadTargetBodyField,
  toolId: cadFeatureReference({ role: 'tool', accepts: ['body'] }),
  operation: cadFeatureField<typeof booleanOperation, 'union' | 'cut' | 'intersect'>(booleanOperation,
    { choices: [{ value: 'union', label: 'Union' }, { value: 'cut', label: 'Subtract tool' }, { value: 'intersect', label: 'Intersection' }] })
});

export const boolean = {
  kind: 'boolean', family: 'body', ...booleanShape,
  outputs: ['body'], body: 'consume-tools', suppression: 'pass-through', evaluator: { owner: 'kernel', version: 1 },
  diagnostics: ['invalid-operation', 'missing-body'],
  check(feature) { if (feature.targetId === feature.toolId) throw new CadError('invalid-operation', 'Boolean target and tool must be different bodies.'); },
  form: { editor: 'fields', title: 'Boolean', controls: [
    { control: 'body', field: 'targetId', label: 'Target body' },
    { control: 'body', field: 'toolId', label: 'Tool body' },
    { control: 'choice', field: 'operation', label: 'Operation' }] },
  agent: { exposed: true, description: 'Union/cut/intersect current target and tool bodies. Both inputs are consumed and replaced by this feature.' }
} satisfies CadFeatureDefinition<'boolean'>;

const xyz = (label: (axis: string) => CadFeatureFormComponent) =>
  [label('X'), label('Y'), label('Z')] as const satisfies readonly [CadFeatureFormComponent, CadFeatureFormComponent, CadFeatureFormComponent];

const transformShape = cadFeatureShape(Type.Literal('transform'), {
  sourceId: cadSourceBodyField,
  translation: cadFeatureVectorField({ quantity: 'length' }),
  // Degrees around world X, then Y, then Z, about the world origin.
  rotation: cadFeatureVectorField({ quantity: 'angle' })
});

export const transform = {
  kind: 'transform', family: 'body', ...transformShape,
  outputs: ['body'], body: 'modify-target', suppression: 'pass-through', evaluator: { owner: 'kernel', version: 1 },
  diagnostics: ['missing-body'],
  check(feature, context) { context.vector(feature, 'translation'); context.vector(feature, 'rotation'); },
  form: { editor: 'fields', title: 'Move / rotate', controls: [
    { control: 'body', field: 'sourceId', label: 'Body' },
    { control: 'vector', field: 'translation', label: 'Translation', unit: 'mm', components: xyz(axis => ({ label: axis, inputLabel: `Translation ${axis}` })) },
    { control: 'vector', field: 'rotation', label: 'Rotation about world origin', unit: 'deg', components: xyz(axis => ({ label: `Around ${axis}`, unit: 'deg' })) }] },
  agent: { exposed: true, description: 'Translate in mm and rotate in degrees about global axes. Replaces its current source body.' }
} satisfies CadFeatureDefinition<'transform'>;

/** Instances of a pattern, including the original. A literal until S8's format cut lets it hold expressions. */
const patternCount = cadFeatureField(Type.Integer({ minimum: MIN_CAD_PATTERN_COUNT, maximum: MAX_CAD_PATTERN_COUNT }),
  { scalar: { quantity: 'count', integer: true, min: MIN_CAD_PATTERN_COUNT, max: MAX_CAD_PATTERN_COUNT, literal: true, repeats: true } });
const patternDiagnostics = ['invalid-dimension', 'pattern-limit', 'missing-body'];

const linearPatternShape = cadFeatureShape(Type.Literal('linear-pattern'), {
  sourceId: cadSourceBodyField,
  count: patternCount,
  // The translation between instances.
  spacing: cadFeatureVectorField({ quantity: 'length', nonzero: true, tolerance: CAD_PRECISION.minimumLengthMm, refusal: 'Pattern spacing must be nonzero.' })
});

export const linearPattern = {
  kind: 'linear-pattern', family: 'body', ...linearPatternShape,
  outputs: ['body'], body: 'modify-target', suppression: 'pass-through', evaluator: { owner: 'kernel', version: 1 },
  diagnostics: patternDiagnostics,
  check(feature, context) { context.vector(feature, 'spacing'); },
  form: { editor: 'fields', title: 'Linear pattern', controls: [
    { control: 'body', field: 'sourceId', label: 'Body' },
    { control: 'count', field: 'count', label: 'Instances, including original' },
    { control: 'vector', field: 'spacing', label: 'Spacing between instances', unit: 'mm', components: xyz(axis => ({ label: axis, inputLabel: `Spacing ${axis}` })) }] },
  agent: { exposed: true, description: 'Fuse the original current source and translated copies, retaining disconnected solids where copies do not touch. Count includes the original; spacing is the XYZ translation between instances in mm. Replaces sourceId.' }
} satisfies CadFeatureDefinition<'linear-pattern'>;

const worldAxis = Type.Union([Type.Literal('x'), Type.Literal('y'), Type.Literal('z')]);
const circularPatternShape = cadFeatureShape(Type.Literal('circular-pattern'), {
  sourceId: cadSourceBodyField,
  count: patternCount,
  // The positive world axis the copies turn around, through `center`. K4 makes it a reference.
  axis: cadFeatureField<typeof worldAxis, 'x' | 'y' | 'z'>(worldAxis, { choices: [{ value: 'x', label: 'World X' }, { value: 'y', label: 'World Y' }, { value: 'z', label: 'World Z' }] }),
  center: cadFeatureVectorField({ quantity: 'length' }),
  // The signed total extent; resolving the pattern holds it to its range.
  angle: cadFeatureScalarField({ quantity: 'angle' })
});

export const circularPattern = {
  kind: 'circular-pattern', family: 'body', ...circularPatternShape,
  outputs: ['body'], body: 'modify-target', suppression: 'pass-through', evaluator: { owner: 'kernel', version: 1 },
  diagnostics: ['invalid-pattern', ...patternDiagnostics],
  check(feature, context) { resolveCadCircularPattern(feature, context.document.parameters); },
  form: { editor: 'fields', title: 'Circular pattern', controls: [
    { control: 'body', field: 'sourceId', label: 'Body' },
    { control: 'count', field: 'count', label: 'Instances, including original' },
    { control: 'choice', field: 'axis', label: 'Axis' },
    { control: 'scalar', field: 'angle', label: 'Angular extent', unit: 'deg' },
    { control: 'vector', field: 'center', label: 'Axis center', unit: 'mm', components: xyz(axis => ({ label: `Center ${axis}` })) }] },
  agent: { exposed: true, description: 'Fuse the original current source and rotated copies, retaining disconnected solids where copies do not touch. Count includes the original (2–100). Rotate about the positive world x/y/z axis through center in mm, following the right-hand rule. angle is the signed total angular extent in degrees, greater than 0.0000001 in magnitude and at most 360. Exactly ±360 distributes count instances without a duplicate endpoint; partial extents include both endpoints. Center and angle accept parameter expressions. Replaces sourceId; combined expanded pattern instances are limited to 1000.' }
} satisfies CadFeatureDefinition<'circular-pattern'>;

const mirrorShape = cadFeatureShape(Type.Literal('mirror'), {
  sourceId: cadSourceBodyField,
  // A principal plane through the world origin. K4 makes it a reference.
  plane: cadFeatureField<typeof CadPlaneSchema, CadPlane>(CadPlaneSchema, { choices: (['XY', 'XZ', 'YZ'] as const).map(value => ({ value, label: `${value} plane` })) })
});

export const mirror = {
  kind: 'mirror', family: 'body', ...mirrorShape,
  // The source stays a body of its own beside the mirrored copy.
  outputs: ['body'], body: 'new', suppression: 'no-output', evaluator: { owner: 'kernel', version: 1 },
  diagnostics: ['missing-body'],
  form: { editor: 'fields', title: 'Mirror', controls: [
    { control: 'body', field: 'sourceId', label: 'Body' },
    { control: 'choice', field: 'plane', label: 'Mirror plane through origin' }] },
  agent: { exposed: true, description: 'Mirror the current source across a global reference plane, preserving the original source as a separate body.' }
} satisfies CadFeatureDefinition<'mirror'>;
