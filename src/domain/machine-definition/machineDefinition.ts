import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import { canonicalJson } from '@/domain/post-processor/canonicalJson';
import {
  POST_IDENTIFIER_PATTERN,
  PostIdentifierSchema,
  PostInstallationRefSchema,
  Sha256Schema
} from '@/domain/post-processor/postFormatPrimitives';
import {
  resolvePostInstallation,
  type PostInstallation,
  type PostLibrary
} from '@/domain/post-processor/postLibrary';
import {
  validatePostPropertyValues,
  type PostPropertyDiagnostic,
  type PostPropertyValue
} from '@/domain/post-processor/postProperties';
import type { DeepReadonly } from '@/domain/post-processor/postPackageSchema';

const strictObject = { additionalProperties: false } as const;
const canonicalTimestampPattern = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const MAX_MACHINE_FILE_BYTES = 512 * 1024;

const LabelSchema = Type.String({ minLength: 1, maxLength: 160 });
const NotesSchema = Type.String({ maxLength: 8_192 });
const TimestampSchema = Type.String({ pattern: canonicalTimestampPattern });
const PostPropertyValueSchema = Type.Union([
  Type.Boolean(),
  Type.Integer(),
  Type.Number(),
  Type.String({ maxLength: 4_096 })
]);

const PhysicalLimitSchema = Type.Union([
  Type.Object({ status: Type.Literal('unknown') }, strictObject),
  Type.Object({
    status: Type.Literal('known'),
    millimeters: Type.Number({ exclusiveMinimum: 0, maximum: 1_000_000 })
  }, strictObject)
]);

const MachineEvidenceSchema = Type.Object({
  id: PostIdentifierSchema,
  name: LabelSchema,
  uri: Type.String({ minLength: 1, maxLength: 2_048 }),
  contentSha256: Sha256Schema
}, strictObject);

export const MachinePostCompatibilitySchema = Type.Object({
  status: Type.Literal('acknowledged'),
  acknowledgedAt: TimestampSchema,
  acknowledgedBy: LabelSchema,
  notes: NotesSchema
}, strictObject);

const UnverifiedPostSchema = Type.Object({ status: Type.Literal('unverified') }, strictObject);
const VerificationClaimSchema = Type.Object({
  status: Type.Literal('claimed'),
  verifiedAt: TimestampSchema,
  verifiedBy: LabelSchema,
  machineDefinitionHash: Sha256Schema,
  postContentHash: Sha256Schema,
  propertiesHash: Sha256Schema,
  evidenceRefs: Type.Array(PostIdentifierSchema, { minItems: 1, maxItems: 64, uniqueItems: true }),
  notes: NotesSchema
}, strictObject);

export const MachinePostBindingSchema = Type.Object({
  id: PostIdentifierSchema,
  name: LabelSchema,
  post: PostInstallationRefSchema,
  properties: Type.Record(
    Type.String({ pattern: POST_IDENTIFIER_PATTERN }),
    PostPropertyValueSchema,
    { maxProperties: 128, unevaluatedProperties: false }
  ),
  compatibility: MachinePostCompatibilitySchema,
  verification: Type.Union([UnverifiedPostSchema, VerificationClaimSchema])
}, strictObject);

export const MachineDefinitionSchema = Type.Object({
  format: Type.Literal('wire-edm-machine'),
  schemaVersion: Type.Literal(1),
  id: PostIdentifierSchema,
  name: LabelSchema,
  identity: Type.Object({
    manufacturer: LabelSchema,
    model: LabelSchema,
    serialNumber: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    controller: Type.Object({
      manufacturer: LabelSchema,
      model: LabelSchema,
      firmware: Type.Optional(Type.String({ minLength: 1, maxLength: 160 }))
    }, strictObject)
  }, strictObject),
  limits: Type.Object({
    xTravel: PhysicalLimitSchema,
    yTravel: PhysicalLimitSchema
  }, strictObject),
  hardware: Type.Object({
    manualThreading: Type.Boolean(),
    automaticThreading: Type.Boolean()
  }, strictObject),
  evidence: Type.Array(MachineEvidenceSchema, { maxItems: 128 }),
  bindings: Type.Array(MachinePostBindingSchema, { maxItems: 256 }),
  activeBindingId: Type.Union([PostIdentifierSchema, Type.Null()]),
  notes: NotesSchema
}, {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wire-edm.local/schemas/wire-edm-machine-v1.json',
  additionalProperties: false
});

const CreateMachinePostBindingInputSchema = Type.Object({
  id: PostIdentifierSchema,
  name: LabelSchema,
  properties: Type.Record(
    Type.String({ pattern: POST_IDENTIFIER_PATTERN }),
    PostPropertyValueSchema,
    { maxProperties: 128, unevaluatedProperties: false }
  ),
  compatibility: MachinePostCompatibilitySchema
}, strictObject);

export type MachineDefinitionValue = Static<typeof MachineDefinitionSchema>;
export type MachineDefinition = DeepReadonly<MachineDefinitionValue>;
export type MachinePostBinding = MachineDefinition['bindings'][number];
export type MachinePostCompatibility = Static<typeof MachinePostCompatibilitySchema>;

export interface CreateMachinePostBindingInput {
  readonly id: string;
  readonly name: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly compatibility: MachinePostCompatibility;
}

export type MachineDefinitionDiagnosticCode =
  | 'MACHINE_DEFINITION_FILE_TOO_LARGE'
  | 'MACHINE_DEFINITION_JSON_INVALID'
  | 'MACHINE_DEFINITION_SCHEMA_INVALID'
  | 'MACHINE_DEFINITION_RECORD_KEY_INVALID'
  | 'MACHINE_DEFINITION_DUPLICATE_ID'
  | 'MACHINE_DEFINITION_ACTIVE_BINDING_NOT_FOUND'
  | 'MACHINE_DEFINITION_EVIDENCE_NOT_FOUND'
  | 'MACHINE_DEFINITION_TIMESTAMP_INVALID'
  | 'MACHINE_DEFINITION_VERIFICATION_MISMATCH';

export interface MachineDefinitionDiagnostic {
  readonly code: MachineDefinitionDiagnosticCode;
  readonly path: string;
  readonly message: string;
}

export type MachineDefinitionParseResult =
  | { ok: true; machine: MachineDefinition }
  | { ok: false; diagnostics: readonly MachineDefinitionDiagnostic[] };

export type CreateMachinePostBindingResult =
  | { ok: true; machine: MachineDefinition; binding: MachinePostBinding }
  | {
      ok: false;
      error:
        | { code: 'MACHINE_POST_BINDING_INPUT_INVALID'; message: string; path: string }
        | { code: 'MACHINE_POST_BINDING_ID_CONFLICT'; message: string; bindingId: string }
        | {
            code: 'MACHINE_POST_BINDING_PROPERTIES_INVALID';
            message: string;
            diagnostics: readonly PostPropertyDiagnostic[];
          };
    };

export type ResolveMachinePostBindingResult =
  | {
      ok: true;
      machine: MachineDefinition;
      binding: MachinePostBinding;
      installation: PostInstallation;
      properties: Readonly<Record<string, PostPropertyValue>>;
    }
  | {
      ok: false;
      error:
        | { code: 'MACHINE_POST_BINDING_NOT_FOUND'; message: string; bindingId: string }
        | { code: 'MACHINE_POST_BINDING_INSTALLATION_NOT_FOUND'; message: string; bindingId: string }
        | { code: 'MACHINE_POST_BINDING_TARGET_MISMATCH'; message: string; bindingId: string }
        | {
            code: 'MACHINE_POST_BINDING_PROPERTIES_INVALID';
            message: string;
            diagnostics: readonly PostPropertyDiagnostic[];
          }
        | { code: 'MACHINE_POST_BINDING_VERIFICATION_INVALID'; message: string; bindingId: string }
        | { code: 'MACHINE_POST_BINDING_HASH_UNAVAILABLE'; message: string };
    };

export type RemoveMachinePostBindingResult =
  | { ok: true; machine: MachineDefinition; removed: MachinePostBinding }
  | {
      ok: false;
      error: { code: 'MACHINE_POST_BINDING_NOT_FOUND'; message: string; bindingId: string };
    };

export type ActivateMachinePostBindingResult =
  | { ok: true; machine: MachineDefinition; binding: MachinePostBinding }
  | {
      ok: false;
      error: { code: 'MACHINE_POST_BINDING_NOT_FOUND'; message: string; bindingId: string };
    };

export type ValidateMachinePostBindingsResult =
  | { ok: true }
  | {
      ok: false;
      binding: MachinePostBinding;
      error: Extract<ResolveMachinePostBindingResult, { ok: false }>['error'];
    };

export function parseMachineDefinition(rawText: string): MachineDefinitionParseResult {
  const actualBytes = new TextEncoder().encode(rawText).byteLength;
  if (actualBytes > MAX_MACHINE_FILE_BYTES) {
    return {
      ok: false,
      diagnostics: [{
        code: 'MACHINE_DEFINITION_FILE_TOO_LARGE',
        path: '',
        message: `Machine definition is ${actualBytes} UTF-8 bytes; the maximum is ${MAX_MACHINE_FILE_BYTES}.`
      }]
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      diagnostics: [{
        code: 'MACHINE_DEFINITION_JSON_INVALID',
        path: '',
        message: 'Machine definition is not valid JSON.'
      }]
    };
  }

  return validateMachineDefinitionValue(parsed);
}

export function validateMachineDefinitionValue(value: unknown): MachineDefinitionParseResult {
  const schemaDiagnostics = [...Value.Errors(MachineDefinitionSchema, value)].map((error) => ({
    code: 'MACHINE_DEFINITION_SCHEMA_INVALID' as const,
    path: error.path,
    message: `Machine definition schema violation at ${error.path || '/'}: ${error.message}.`
  }));
  if (schemaDiagnostics.length > 0) return { ok: false, diagnostics: schemaDiagnostics };

  return validateMachineDefinitionSemantics(value as MachineDefinitionValue);
}

export function validateMachineDefinitionSemantics(
  machine: MachineDefinitionValue
): MachineDefinitionParseResult {
  const semanticDiagnostics = collectMachineDefinitionSemanticDiagnostics(machine);
  return semanticDiagnostics.length > 0
    ? { ok: false, diagnostics: semanticDiagnostics }
    : { ok: true, machine: deepFreeze(machine) };
}

export function serializeMachineDefinition(machine: MachineDefinition) {
  return `${JSON.stringify(machine, null, 2)}\n`;
}

export function createMachinePostBinding(
  machine: MachineDefinition,
  installation: PostInstallation,
  input: CreateMachinePostBindingInput
): CreateMachinePostBindingResult {
  const inputError = Value.Errors(CreateMachinePostBindingInputSchema, input).First();
  if (inputError) {
    return {
      ok: false,
      error: {
        code: 'MACHINE_POST_BINDING_INPUT_INVALID',
        message: `Machine post binding input is invalid at ${inputError.path || '/'}: ${inputError.message}.`,
        path: inputError.path
      }
    };
  }
  const invalidKey = Object.keys(input.properties).find((key) => !postIdentifier.test(key));
  if (invalidKey) {
    return {
      ok: false,
      error: {
        code: 'MACHINE_POST_BINDING_INPUT_INVALID',
        message: `Post property key ${JSON.stringify(invalidKey)} must match ${POST_IDENTIFIER_PATTERN}.`,
        path: `/properties/${escapeJsonPointer(invalidKey)}`
      }
    };
  }
  if (machine.bindings.some(({ id }) => id === input.id)) {
    return {
      ok: false,
      error: {
        code: 'MACHINE_POST_BINDING_ID_CONFLICT',
        message: `Machine post binding already exists: ${input.id}.`,
        bindingId: input.id
      }
    };
  }

  const properties = validatePostPropertyValues(installation.package, input.properties);
  if (!properties.ok) return invalidProperties(properties.diagnostics);

  const binding = deepFreeze({
    id: input.id,
    name: input.name,
    post: installation.ref,
    properties: properties.values,
    compatibility: input.compatibility,
    verification: { status: 'unverified' as const }
  });
  const nextMachine = deepFreeze({
    ...machine,
    bindings: [...machine.bindings, binding]
  });
  return { ok: true, machine: nextMachine, binding };
}

export function activateMachinePostBinding(
  machine: MachineDefinition,
  bindingId: string
): ActivateMachinePostBindingResult {
  const binding = machine.bindings.find(({ id }) => id === bindingId);
  if (!binding) return bindingNotFound(bindingId);
  return {
    ok: true,
    machine: deepFreeze({ ...machine, activeBindingId: bindingId }),
    binding
  };
}

export async function resolveMachinePostBinding(
  machine: MachineDefinition,
  library: PostLibrary,
  bindingId: string
): Promise<ResolveMachinePostBindingResult> {
  const binding = machine.bindings.find(({ id }) => id === bindingId);
  if (!binding) return bindingNotFound(bindingId);

  return resolveMachinePostBindingValue(machine, library, binding);
}

export async function validateMachinePostBindings(
  machine: MachineDefinition,
  library: PostLibrary
): Promise<ValidateMachinePostBindingsResult> {
  for (const binding of machine.bindings) {
    const resolved = await resolveMachinePostBindingValue(machine, library, binding);
    if (!resolved.ok) return { ok: false, binding, error: resolved.error };
  }
  return { ok: true };
}

async function resolveMachinePostBindingValue(
  machine: MachineDefinition,
  library: PostLibrary,
  binding: MachinePostBinding
): Promise<ResolveMachinePostBindingResult> {
  const bindingId = binding.id;

  const installed = resolvePostInstallation(library, binding.post);
  if (!installed.ok) {
    return {
      ok: false,
      error: {
        code: 'MACHINE_POST_BINDING_INSTALLATION_NOT_FOUND',
        message: `Binding ${bindingId} references an unavailable exact post installation: ${installed.error.message}`,
        bindingId
      }
    };
  }

  if (!postTargetsMachine(installed.installation, machine)) {
    const controller = machine.identity.controller;
    return {
      ok: false,
      error: {
        code: 'MACHINE_POST_BINDING_TARGET_MISMATCH',
        message: `Binding ${bindingId} post does not target ${machine.identity.manufacturer} ${machine.identity.model} with controller ${controller.manufacturer} ${controller.model} firmware ${controller.firmware ?? 'unknown'}.`,
        bindingId
      }
    };
  }

  const properties = validatePostPropertyValues(installed.installation.package, binding.properties);
  if (!properties.ok) return invalidProperties(properties.diagnostics);

  if (binding.verification.status === 'claimed') {
    const machineDefinitionHash = await sha256(canonicalJson(machinePhysicalSnapshot(machine)));
    const propertiesHash = await sha256(canonicalJson(properties.values));
    if (!machineDefinitionHash || !propertiesHash) {
      return {
        ok: false,
        error: {
          code: 'MACHINE_POST_BINDING_HASH_UNAVAILABLE',
          message: 'SHA-256 is unavailable; verified post binding identity cannot be checked.'
        }
      };
    }
    if (
      binding.verification.machineDefinitionHash !== machineDefinitionHash ||
      binding.verification.postContentHash !== binding.post.contentHash ||
      binding.verification.propertiesHash !== propertiesHash
    ) {
      return {
        ok: false,
        error: {
          code: 'MACHINE_POST_BINDING_VERIFICATION_INVALID',
          message: `Verification for binding ${bindingId} does not cover its current machine, post, and properties.`,
          bindingId
        }
      };
    }
  }

  return {
    ok: true,
    machine,
    binding,
    installation: installed.installation,
    properties: properties.values
  };
}

function postTargetsMachine(installation: PostInstallation, machine: MachineDefinition) {
  return installation.package.manifest.targets.some((target) => (
    target.manufacturer === machine.identity.manufacturer &&
    target.controllerManufacturer === machine.identity.controller.manufacturer &&
    target.controller === machine.identity.controller.model &&
    (target.firmware.status === 'unknown'
      ? machine.identity.controller.firmware === undefined
      : machine.identity.controller.firmware !== undefined &&
        target.firmware.versions.includes(machine.identity.controller.firmware)) &&
    (target.machineModels.length === 0 || target.machineModels.includes(machine.identity.model))
  ));
}

export function removeMachinePostBinding(
  machine: MachineDefinition,
  bindingId: string
): RemoveMachinePostBindingResult {
  const binding = machine.bindings.find(({ id }) => id === bindingId);
  if (!binding) return bindingNotFound(bindingId);
  return {
    ok: true,
    machine: deepFreeze({
      ...machine,
      bindings: machine.bindings.filter(({ id }) => id !== bindingId),
      activeBindingId: machine.activeBindingId === bindingId ? null : machine.activeBindingId
    }),
    removed: binding
  };
}

function collectMachineDefinitionSemanticDiagnostics(machine: MachineDefinitionValue) {
  const diagnostics: MachineDefinitionDiagnostic[] = [];
  appendDuplicateIdDiagnostics(diagnostics, machine.evidence, '/evidence');
  appendDuplicateIdDiagnostics(diagnostics, machine.bindings, '/bindings');
  if (
    machine.activeBindingId !== null &&
    !machine.bindings.some(({ id }) => id === machine.activeBindingId)
  ) {
    diagnostics.push({
      code: 'MACHINE_DEFINITION_ACTIVE_BINDING_NOT_FOUND',
      path: '/activeBindingId',
      message: `Active machine setup not found: ${machine.activeBindingId}.`
    });
  }
  const evidenceIds = new Set(machine.evidence.map(({ id }) => id));
  for (const [bindingIndex, binding] of machine.bindings.entries()) {
    appendTimestampDiagnostic(
      diagnostics,
      binding.compatibility.acknowledgedAt,
      `/bindings/${bindingIndex}/compatibility/acknowledgedAt`
    );
    for (const key of Object.keys(binding.properties)) {
      if (postIdentifier.test(key)) continue;
      diagnostics.push({
        code: 'MACHINE_DEFINITION_RECORD_KEY_INVALID',
        path: `/bindings/${bindingIndex}/properties/${escapeJsonPointer(key)}`,
        message: `Post property key ${JSON.stringify(key)} must match ${POST_IDENTIFIER_PATTERN}.`
      });
    }
    if (binding.verification.status !== 'claimed') continue;
    appendTimestampDiagnostic(
      diagnostics,
      binding.verification.verifiedAt,
      `/bindings/${bindingIndex}/verification/verifiedAt`
    );
    if (binding.verification.postContentHash !== binding.post.contentHash) {
      diagnostics.push({
        code: 'MACHINE_DEFINITION_VERIFICATION_MISMATCH',
        path: `/bindings/${bindingIndex}/verification/postContentHash`,
        message: `Binding ${binding.id} verification claim does not name the binding's exact post content hash.`
      });
    }
    for (const [refIndex, evidenceRef] of binding.verification.evidenceRefs.entries()) {
      if (evidenceIds.has(evidenceRef)) continue;
      diagnostics.push({
        code: 'MACHINE_DEFINITION_EVIDENCE_NOT_FOUND',
        path: `/bindings/${bindingIndex}/verification/evidenceRefs/${refIndex}`,
        message: `Machine evidence reference ${evidenceRef} does not name an entry in /evidence.`
      });
    }
  }
  return diagnostics;
}

function appendTimestampDiagnostic(
  diagnostics: MachineDefinitionDiagnostic[],
  value: string,
  path: string
) {
  if (isCanonicalTimestamp(value)) return;
  diagnostics.push({
    code: 'MACHINE_DEFINITION_TIMESTAMP_INVALID',
    path,
    message: `${path} must be a real canonical UTC timestamp.`
  });
}

function isCanonicalTimestamp(value: string) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

const postIdentifier = new RegExp(POST_IDENTIFIER_PATTERN);

function appendDuplicateIdDiagnostics(
  diagnostics: MachineDefinitionDiagnostic[],
  values: readonly { id: string }[],
  path: string
) {
  const firstIndexById = new Map<string, number>();
  for (const [index, value] of values.entries()) {
    const firstIndex = firstIndexById.get(value.id);
    if (firstIndex === undefined) {
      firstIndexById.set(value.id, index);
      continue;
    }
    diagnostics.push({
      code: 'MACHINE_DEFINITION_DUPLICATE_ID',
      path: `${path}/${index}/id`,
      message: `Duplicate ID ${value.id}; it was first declared at ${path}/${firstIndex}/id.`
    });
  }
}

function invalidProperties(
  diagnostics: readonly PostPropertyDiagnostic[]
) {
  return {
    ok: false as const,
    error: {
      code: 'MACHINE_POST_BINDING_PROPERTIES_INVALID' as const,
      message: 'Machine post binding properties do not satisfy the exact post package.',
      diagnostics
    }
  };
}

function bindingNotFound(bindingId: string): Extract<
  RemoveMachinePostBindingResult,
  { ok: false }
> {
  return {
    ok: false,
    error: {
      code: 'MACHINE_POST_BINDING_NOT_FOUND',
      message: `Machine post binding not found: ${bindingId}.`,
      bindingId
    }
  };
}

function machinePhysicalSnapshot(machine: MachineDefinition) {
  return {
    format: machine.format,
    schemaVersion: machine.schemaVersion,
    id: machine.id,
    name: machine.name,
    identity: machine.identity,
    limits: machine.limits,
    hardware: machine.hardware,
    evidence: machine.evidence,
    notes: machine.notes
  };
}

async function sha256(value: string) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

function escapeJsonPointer(value: string) {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}
