import { Type, type Static } from '@sinclair/typebox';

import {
  POST_IDENTIFIER_PATTERN,
  PostIdentifierSchema,
  PostVersionSchema,
  Sha256Schema
} from './postFormatPrimitives';

const strictObject = { additionalProperties: false } as const;

const LabelSchema = Type.String({ minLength: 1, maxLength: 160 });
const DescriptionSchema = Type.String({ minLength: 1, maxLength: 4_096 });
const PropertyValueSchema = Type.Union([
  Type.Boolean(),
  Type.Integer(),
  Type.Number(),
  Type.String({ maxLength: 4_096 })
]);

const PropertyCommon = {
  description: Type.String({ minLength: 1, maxLength: 1_024 }),
  required: Type.Boolean()
};

const BooleanPropertySchema = Type.Object({
  type: Type.Literal('boolean'),
  ...PropertyCommon,
  suggestedValue: Type.Optional(Type.Boolean())
}, strictObject);

const IntegerPropertySchema = Type.Object({
  type: Type.Literal('integer'),
  ...PropertyCommon,
  minimum: Type.Optional(Type.Integer()),
  maximum: Type.Optional(Type.Integer()),
  suggestedValue: Type.Optional(Type.Integer())
}, strictObject);

const NumberPropertySchema = Type.Object({
  type: Type.Literal('number'),
  ...PropertyCommon,
  minimum: Type.Optional(Type.Number()),
  maximum: Type.Optional(Type.Number()),
  suggestedValue: Type.Optional(Type.Number())
}, strictObject);

const StringPropertySchema = Type.Object({
  type: Type.Literal('string'),
  ...PropertyCommon,
  minLength: Type.Optional(Type.Integer({ minimum: 0, maximum: 4_096 })),
  maxLength: Type.Optional(Type.Integer({ minimum: 0, maximum: 4_096 })),
  suggestedValue: Type.Optional(Type.String({ maxLength: 4_096 }))
}, strictObject);

const ChoicePropertySchema = Type.Object({
  type: Type.Literal('choice'),
  ...PropertyCommon,
  choices: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
    minItems: 1,
    maxItems: 64,
    uniqueItems: true
  }),
  suggestedValue: Type.Optional(Type.String({ minLength: 1, maxLength: 160 }))
}, strictObject);

export const PostPropertyDefinitionSchema = Type.Union([
  BooleanPropertySchema,
  IntegerPropertySchema,
  NumberPropertySchema,
  StringPropertySchema,
  ChoicePropertySchema
]);

const ParameterDescription = Type.String({ minLength: 1, maxLength: 512 });
const MotionEndRoleSchema = Type.Union([
  Type.Literal('motion.end-x'),
  Type.Literal('motion.end-y')
]);
const MotionCenterRoleSchema = Type.Union([
  Type.Literal('motion.center-x'),
  Type.Literal('motion.center-y')
]);
const ArcCenterReferenceSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('fixed'),
    mode: Type.Union([Type.Literal('absolute'), Type.Literal('incremental')])
  }, strictObject),
  Type.Object({
    kind: Type.Literal('property'),
    property: PostIdentifierSchema
  }, strictObject)
]);

const CommandParameterSchema = Type.Union([
  Type.Object({
    type: Type.Literal('integer'),
    role: Type.Literal('none'),
    description: ParameterDescription,
    minimum: Type.Optional(Type.Integer()),
    maximum: Type.Optional(Type.Integer())
  }, strictObject),
  Type.Object({
    type: Type.Literal('number'),
    role: Type.Literal('none'),
    description: ParameterDescription,
    minimum: Type.Optional(Type.Number()),
    maximum: Type.Optional(Type.Number())
  }, strictObject),
  Type.Object({
    type: Type.Literal('number'),
    role: MotionEndRoleSchema,
    description: ParameterDescription,
    minimum: Type.Optional(Type.Number()),
    maximum: Type.Optional(Type.Number())
  }, strictObject),
  Type.Object({
    type: Type.Literal('number'),
    role: MotionCenterRoleSchema,
    centerReference: ArcCenterReferenceSchema,
    description: ParameterDescription,
    minimum: Type.Optional(Type.Number()),
    maximum: Type.Optional(Type.Number())
  }, strictObject),
  Type.Object({
    type: Type.Literal('string'),
    role: Type.Literal('none'),
    description: ParameterDescription
  }, strictObject)
]);

export const DialectStateTokenSchema = Type.Union([
  Type.Literal('program.delimiter'),
  Type.Literal('program.ended'),
  Type.Literal('program.paused'),
  Type.Literal('distance.absolute'),
  Type.Literal('units.millimeters'),
  Type.Literal('plane.xy'),
  Type.Literal('work-offset.selected'),
  Type.Literal('origin.wire-position-set'),
  Type.Literal('position.changed'),
  Type.Literal('compensation.prepared'),
  Type.Literal('compensation.left'),
  Type.Literal('compensation.right'),
  Type.Literal('compensation.off'),
  Type.Literal('wire.separated'),
  Type.Literal('wire.threaded')
]);

const DialectCommandSchema = Type.Object({
  template: Type.String({ minLength: 1, maxLength: 512, pattern: '^[^\\r\\n\\u0000]+$' }),
  parameters: Type.Record(Type.String({ pattern: POST_IDENTIFIER_PATTERN }), CommandParameterSchema, {
    unevaluatedProperties: false,
    maxProperties: 32
  }),
  effects: Type.Array(DialectStateTokenSchema, { minItems: 1, maxItems: 32, uniqueItems: true }),
  requires: Type.Array(DialectStateTokenSchema, { maxItems: 32, uniqueItems: true }),
  evidenceRefs: Type.Array(PostIdentifierSchema, { minItems: 1, maxItems: 32, uniqueItems: true })
}, strictObject);

const PostTargetSchema = Type.Object({
  manufacturer: LabelSchema,
  controller: LabelSchema,
  machineModels: Type.Array(LabelSchema, { maxItems: 64, uniqueItems: true })
}, strictObject);

const PostCapabilitiesSchema = Type.Object({
  circularInterpolation: Type.Union([
    Type.Literal('none'),
    Type.Literal('clockwise-only'),
    Type.Literal('counterclockwise-only'),
    Type.Literal('both')
  ]),
  controllerCompensation: Type.Union([Type.Literal('none'), Type.Literal('left-right')]),
  operations: Type.Union([Type.Literal('single'), Type.Literal('multiple')]),
  passes: Type.Union([Type.Literal('single'), Type.Literal('multiple')]),
  threading: Type.Union([
    Type.Literal('none'),
    Type.Literal('manual'),
    Type.Literal('automatic'),
    Type.Literal('manual-and-automatic')
  ]),
  wireSeparation: Type.Boolean(),
  programStops: Type.Boolean(),
  taperAxes: Type.Boolean(),
  technologySelection: Type.Boolean(),
  initialWirePosition: Type.Boolean()
}, strictObject);

const PostExecutionContractSchema = Type.Object({
  initialWirePosition: Type.Literal('required'),
  compensationLifecycle: Type.Union([
    Type.Literal('none'),
    Type.Literal('authored-linear'),
    Type.Literal('controller-native-program'),
    Type.Literal('controller-native-operation')
  ]),
  compensationRequiredForEveryOperation: Type.Boolean()
}, strictObject);

const EvidenceSourceIdentity = {
  id: PostIdentifierSchema,
  name: LabelSchema,
  uri: Type.String({ minLength: 1, maxLength: 2_048 }),
  mediaType: Type.String({ minLength: 1, maxLength: 160, pattern: '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$' }),
  contentSha256: Sha256Schema
};

const EvidenceSourceSchema = Type.Union([
  Type.Object({
    ...EvidenceSourceIdentity,
    kind: Type.Union([
      Type.Literal('manufacturer-manual'),
      Type.Literal('controller-reference')
    ]),
    documentNumber: Type.String({ minLength: 1, maxLength: 160 }),
    revision: Type.String({ minLength: 1, maxLength: 160 })
  }, strictObject),
  Type.Object({
    ...EvidenceSourceIdentity,
    kind: Type.Union([
      Type.Literal('verified-program'),
      Type.Literal('operator-test')
    ]),
    recordedAt: Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
    }),
    description: Type.String({ minLength: 1, maxLength: 4_096 })
  }, strictObject)
]);

const EvidenceSelectorSchema = Type.Object({
  location: Type.String({ minLength: 1, maxLength: 1_024 }),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  section: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  exact: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  prefix: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  suffix: Type.Optional(Type.String({ minLength: 1, maxLength: 256 }))
}, strictObject);

const EvidenceApplicabilitySchema = Type.Object({
  controllerModels: Type.Array(LabelSchema, { minItems: 1, maxItems: 64, uniqueItems: true }),
  machineModels: Type.Array(LabelSchema, { maxItems: 64, uniqueItems: true }),
  firmware: Type.Optional(Type.String({ minLength: 1, maxLength: 160 }))
}, strictObject);

const EvidenceReviewSchema = Type.Union([
  Type.Object({ status: Type.Literal('unreviewed') }, strictObject),
  Type.Object({
    status: Type.Literal('reviewed'),
    reviewer: Type.String({ minLength: 1, maxLength: 160 }),
    reviewedAt: Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$'
    })
  }, strictObject)
]);

const EvidenceSchema = Type.Object({
  id: PostIdentifierSchema,
  sourceRef: PostIdentifierSchema,
  selector: EvidenceSelectorSchema,
  claim: Type.String({ minLength: 1, maxLength: 4_096 }),
  supports: Type.Array(Type.Object({
    kind: Type.Literal('command'),
    id: PostIdentifierSchema
  }, strictObject), { minItems: 1, maxItems: 64, uniqueItems: true }),
  appliesTo: EvidenceApplicabilitySchema,
  review: EvidenceReviewSchema
}, strictObject);

const FixtureSchema = Type.Object({
  id: PostIdentifierSchema,
  description: DescriptionSchema,
  planFixture: PostIdentifierSchema,
  properties: Type.Record(Type.String({ pattern: POST_IDENTIFIER_PATTERN }), PropertyValueSchema, {
    unevaluatedProperties: false,
    maxProperties: 128
  }),
  expectedProgram: Type.String({ maxLength: 262_144 }),
  evidenceRefs: Type.Array(PostIdentifierSchema, { minItems: 1, maxItems: 32, uniqueItems: true })
}, strictObject);

export const WireEdmPostPackageSchema = Type.Object({
  format: Type.Literal('wire-edm-post'),
  schemaVersion: Type.Literal(1),
  manifest: Type.Object({
    id: PostIdentifierSchema,
    name: LabelSchema,
    version: PostVersionSchema,
    engineApiVersion: Type.Literal('1'),
    description: DescriptionSchema,
    targets: Type.Array(PostTargetSchema, { minItems: 1, maxItems: 64 }),
    capabilities: PostCapabilitiesSchema,
    execution: PostExecutionContractSchema,
    properties: Type.Record(Type.String({ pattern: POST_IDENTIFIER_PATTERN }), PostPropertyDefinitionSchema, {
      unevaluatedProperties: false,
      maxProperties: 128
    })
  }, strictObject),
  dialect: Type.Object({
    id: PostIdentifierSchema,
    description: DescriptionSchema,
    commands: Type.Record(Type.String({ pattern: POST_IDENTIFIER_PATTERN }), DialectCommandSchema, {
      unevaluatedProperties: false,
      minProperties: 1,
      maxProperties: 512
    })
  }, strictObject),
  source: Type.Object({
    language: Type.Literal('javascript'),
    entrypoint: Type.Literal('createPost'),
    code: Type.String({ minLength: 1, maxLength: 262_144, pattern: '^[^\\u0000]*$' })
  }, strictObject),
  sources: Type.Array(EvidenceSourceSchema, { minItems: 1, maxItems: 128 }),
  evidence: Type.Array(EvidenceSchema, { minItems: 1, maxItems: 256 }),
  fixtures: Type.Array(FixtureSchema, { minItems: 1, maxItems: 128 })
}, {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wire-edm.local/schemas/wire-edm-post-package-v1.json',
  $comment: 'Generated from src/domain/post-processor/postPackageSchema.ts by npm run post:docs:generate.',
  additionalProperties: false
});

export type WireEdmPostPackageValue = Static<typeof WireEdmPostPackageSchema>;

export type DeepReadonly<T> =
  T extends string | number | boolean | null | undefined ? T
    : T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
      : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
        : T;

export type WireEdmPostPackage = DeepReadonly<WireEdmPostPackageValue>;
export type PostPropertyDefinition = WireEdmPostPackage['manifest']['properties'][string];
