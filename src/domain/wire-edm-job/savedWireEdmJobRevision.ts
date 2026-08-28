import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import {
  MachineDefinitionSchema,
  MachinePostBindingSchema,
  resolveMachinePostBinding,
  validateMachineDefinitionValue,
  type MachineDefinition,
  type MachinePostBinding
} from '@/domain/machine-definition/machineDefinition';
import {
  compileWireEdmExecutionPlan,
  type ExecutionPlanDiagnostic,
  type WireEdmExecutionPlan
} from '@/domain/execution-plan/executionPlan';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import { canonicalJson } from '@/domain/post-processor/canonicalJson';
import {
  PostIdentifierSchema,
  PostInstallationRefSchema,
  Sha256Schema
} from '@/domain/post-processor/postFormatPrimitives';
import type { PostInstallation, PostLibrary } from '@/domain/post-processor/postLibrary';
import {
  validateWireEdmPostPackageValue,
  type PostPackageDiagnostic
} from '@/domain/post-processor/postPackage';
import { WireEdmPostPackageSchema } from '@/domain/post-processor/postPackageSchema';
import type { PostPropertyDiagnostic, PostPropertyValue } from '@/domain/post-processor/postProperties';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { withWorkbenchMutationLock } from '@/domain/storage/workbenchMutationLock';
import {
  parseWorkbenchProjectDocument,
  WorkbenchProjectDocumentSchema,
  type WorkbenchProjectDocument,
  type WorkbenchProjectError
} from '@/domain/workbench-catalog/workbenchProject';

export const SAVED_WIRE_EDM_JOB_REVISION_SCHEMA_VERSION = 1 as const;
export const WIRE_EDM_ENGINE_VERSION = '1' as const;

const MAX_SAVED_REVISION_BYTES = 128 * 1024 * 1024;
const strictObject = { additionalProperties: false } as const;
const canonicalTimestampPattern = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const revisionCandidateBrand = Symbol('saved-wire-edm-job-revision-candidate');
const persistedRevisionBrand = Symbol('persisted-saved-wire-edm-job-revision');

const MachinePhysicalSnapshotSchema = Type.Omit(MachineDefinitionSchema, ['bindings']);
const PostPropertyValueSchema = Type.Union([
  Type.Boolean(),
  Type.Number(),
  Type.String()
]);

export const SavedWireEdmJobRevisionSchema = Type.Object({
  format: Type.Literal('wire-edm-job-revision'),
  schemaVersion: Type.Literal(SAVED_WIRE_EDM_JOB_REVISION_SCHEMA_VERSION),
  engineVersion: Type.Literal(WIRE_EDM_ENGINE_VERSION),
  revisionId: PostIdentifierSchema,
  savedAt: Type.String({ pattern: canonicalTimestampPattern }),
  project: WorkbenchProjectDocumentSchema,
  machine: MachinePhysicalSnapshotSchema,
  post: Type.Object({
    binding: MachinePostBindingSchema,
    installation: Type.Object({
      ref: PostInstallationRefSchema,
      package: WireEdmPostPackageSchema
    }, strictObject),
    properties: Type.Record(PostIdentifierSchema, PostPropertyValueSchema, {
      maxProperties: 128,
      unevaluatedProperties: false
    })
  }, strictObject),
  executionPlan: Type.Unknown(),
  hashes: Type.Object({
    upid: Sha256Schema,
    executionPlan: Sha256Schema,
    machine: Sha256Schema,
    binding: Sha256Schema,
    postPackage: Sha256Schema,
    postProperties: Sha256Schema
  }, strictObject)
}, {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wire-edm.local/schemas/wire-edm-job-revision-v1.json',
  additionalProperties: false
});

type SavedRevisionSchemaValue = Static<typeof SavedWireEdmJobRevisionSchema>;

export type UpidWorkbenchProjectDocument = WorkbenchProjectDocument & {
  readonly source: { readonly kind: 'dxf' | 'upid' };
  readonly content: {
    readonly kind: 'upid-document';
    readonly document: PathPlanningDocument;
  };
};

export type MachinePhysicalSnapshot = Omit<MachineDefinition, 'bindings'>;

export interface SavedPostBindingSnapshot {
  readonly binding: MachinePostBinding;
  readonly installation: PostInstallation;
  readonly properties: Readonly<Record<string, PostPropertyValue>>;
}

export interface SavedRevisionHashes {
  readonly upid: string;
  readonly executionPlan: string;
  readonly machine: string;
  readonly binding: string;
  readonly postPackage: string;
  readonly postProperties: string;
}

export interface SavedWireEdmJobRevisionData {
  readonly format: 'wire-edm-job-revision';
  readonly schemaVersion: typeof SAVED_WIRE_EDM_JOB_REVISION_SCHEMA_VERSION;
  readonly engineVersion: typeof WIRE_EDM_ENGINE_VERSION;
  readonly revisionId: string;
  readonly savedAt: string;
  readonly project: UpidWorkbenchProjectDocument;
  readonly machine: MachinePhysicalSnapshot;
  readonly post: SavedPostBindingSnapshot;
  readonly executionPlan: WireEdmExecutionPlan;
  readonly hashes: SavedRevisionHashes;
}

export type SavedWireEdmJobRevisionCandidate = SavedWireEdmJobRevisionData & {
  readonly [revisionCandidateBrand]: true;
};

export type SavedWireEdmJobRevision = SavedWireEdmJobRevisionData & {
  readonly [persistedRevisionBrand]: true;
};

export interface CreateSavedWireEdmJobRevisionInput {
  readonly revisionId: string;
  readonly savedAt: string;
  readonly project: WorkbenchProjectDocument;
  readonly machine: MachineDefinition;
  readonly bindingId: string;
  readonly postLibrary: PostLibrary;
}

export type SavedWireEdmJobRevisionError =
  | {
      readonly code: 'SAVED_REVISION_VERSION_UNSUPPORTED';
      readonly message: string;
      readonly foundVersion: number;
      readonly supportedVersion: typeof SAVED_WIRE_EDM_JOB_REVISION_SCHEMA_VERSION;
    }
  | { readonly code: 'SAVED_REVISION_FILE_TOO_LARGE'; readonly message: string }
  | { readonly code: 'SAVED_REVISION_JSON_INVALID'; readonly message: string }
  | { readonly code: 'SAVED_REVISION_SCHEMA_INVALID'; readonly message: string; readonly path: string }
  | { readonly code: 'SAVED_REVISION_TIMESTAMP_INVALID'; readonly message: string; readonly path: '/savedAt' }
  | {
      readonly code: 'SAVED_REVISION_PROJECT_INVALID';
      readonly message: string;
      readonly projectError: WorkbenchProjectError;
    }
  | { readonly code: 'SAVED_REVISION_UPID_PROJECT_REQUIRED'; readonly message: string }
  | { readonly code: 'SAVED_REVISION_MACHINE_INVALID'; readonly message: string }
  | { readonly code: 'SAVED_REVISION_BINDING_INVALID'; readonly message: string }
  | {
      readonly code: 'SAVED_REVISION_PACKAGE_INVALID';
      readonly message: string;
      readonly diagnostics: readonly PostPackageDiagnostic[];
    }
  | {
      readonly code: 'SAVED_REVISION_PROPERTIES_INVALID';
      readonly message: string;
      readonly diagnostics: readonly PostPropertyDiagnostic[];
    }
  | {
      readonly code: 'SAVED_REVISION_EXECUTION_PLAN_INVALID';
      readonly message: string;
      readonly diagnostics: readonly ExecutionPlanDiagnostic[];
    }
  | { readonly code: 'SAVED_REVISION_EXECUTION_PLAN_MISMATCH'; readonly message: string }
  | {
      readonly code: 'SAVED_REVISION_HASH_MISMATCH';
      readonly message: string;
      readonly field: keyof SavedRevisionHashes;
    }
  | { readonly code: 'SAVED_REVISION_HASH_UNAVAILABLE'; readonly message: string };

export type SavedWireEdmJobRevisionCandidateResult =
  | { readonly ok: true; readonly candidate: SavedWireEdmJobRevisionCandidate }
  | { readonly ok: false; readonly error: SavedWireEdmJobRevisionError };

export type SavedWireEdmJobRevisionStorageError =
  | { readonly code: 'SAVED_REVISION_STORAGE_WRITE_FAILED'; readonly message: string }
  | { readonly code: 'SAVED_REVISION_STORAGE_READ_FAILED'; readonly message: string }
  | { readonly code: 'SAVED_REVISION_STORAGE_CONFLICT'; readonly message: string }
  | { readonly code: 'SAVED_REVISION_STORAGE_READBACK_MISMATCH'; readonly message: string }
  | { readonly code: 'SAVED_REVISION_STORAGE_ROLLBACK_FAILED'; readonly message: string }
  | { readonly code: 'SAVED_REVISION_STORAGE_NOT_FOUND'; readonly message: string };

export type PersistSavedWireEdmJobRevisionResult =
  | { readonly ok: true; readonly path: string; readonly revision: SavedWireEdmJobRevision }
  | {
      readonly ok: false;
      readonly error: SavedWireEdmJobRevisionError | SavedWireEdmJobRevisionStorageError;
    };

export async function createSavedWireEdmJobRevision(
  input: CreateSavedWireEdmJobRevisionInput
): Promise<SavedWireEdmJobRevisionCandidateResult> {
  const project = validateUpidProject(input.project);
  if (!project.ok) return project;
  if (!isCanonicalTimestamp(input.savedAt)) {
    return failure({
      code: 'SAVED_REVISION_TIMESTAMP_INVALID',
      message: '/savedAt must be a real canonical UTC timestamp.',
      path: '/savedAt'
    });
  }

  const parsedMachine = validateMachineDefinitionValue(structuredClone(input.machine));
  if (!parsedMachine.ok) {
    return failure({
      code: 'SAVED_REVISION_MACHINE_INVALID',
      message: `Selected machine is invalid: ${parsedMachine.diagnostics.map(({ message }) => message).join(' ')}`
    });
  }
  const resolved = await resolveMachinePostBinding(
    parsedMachine.machine,
    input.postLibrary,
    input.bindingId
  );
  if (!resolved.ok) {
    const diagnostics = 'diagnostics' in resolved.error ? resolved.error.diagnostics : undefined;
    return diagnostics
      ? failure({
          code: 'SAVED_REVISION_PROPERTIES_INVALID',
          message: resolved.error.message,
          diagnostics
        })
      : failure({ code: 'SAVED_REVISION_BINDING_INVALID', message: resolved.error.message });
  }

  const parsedPackage = validateWireEdmPostPackageValue(resolved.installation.package);
  if (!parsedPackage.ok) {
    return failure({
      code: 'SAVED_REVISION_PACKAGE_INVALID',
      message: 'Selected post installation contains an invalid package.',
      diagnostics: parsedPackage.diagnostics
    });
  }
  const packageHash = await sha256(canonicalJson(parsedPackage.package));
  if (!packageHash) return hashUnavailable();
  if (packageHash !== resolved.installation.ref.contentHash) {
    return hashMismatch('postPackage');
  }

  const compiled = compileWireEdmExecutionPlan(project.project.content.document);
  if (!compiled.ok) {
    return failure({
      code: 'SAVED_REVISION_EXECUTION_PLAN_INVALID',
      message: 'The saved UPID cannot be compiled into an execution plan.',
      diagnostics: compiled.diagnostics
    });
  }

  const machine = jsonSnapshot(physicalMachineSnapshot(resolved.machine));
  const post: SavedPostBindingSnapshot = {
    binding: jsonSnapshot(resolved.binding),
    installation: jsonSnapshot({
      ref: resolved.installation.ref,
      package: parsedPackage.package
    }),
    properties: jsonSnapshot(resolved.properties)
  };
  const executionPlan = jsonSnapshot(compiled.plan);
  const hashes = await calculateHashes({
    upid: project.project.content.document,
    executionPlan,
    machine,
    post
  });
  if (!hashes) return hashUnavailable();

  const candidate: SavedWireEdmJobRevisionData = {
    format: 'wire-edm-job-revision',
    schemaVersion: SAVED_WIRE_EDM_JOB_REVISION_SCHEMA_VERSION,
    engineVersion: WIRE_EDM_ENGINE_VERSION,
    revisionId: input.revisionId,
    savedAt: input.savedAt,
    project: jsonSnapshot(project.project),
    machine,
    post,
    executionPlan,
    hashes
  };
  const schemaError = Value.Errors(SavedWireEdmJobRevisionSchema, candidate).First();
  if (schemaError) return schemaFailure(schemaError.path, schemaError.message);
  return candidateSuccess(candidate);
}

export async function parseSavedWireEdmJobRevision(
  rawText: string
): Promise<SavedWireEdmJobRevisionCandidateResult> {
  if (new TextEncoder().encode(rawText).byteLength > MAX_SAVED_REVISION_BYTES) {
    return failure({
      code: 'SAVED_REVISION_FILE_TOO_LARGE',
      message: `Saved revision exceeds the ${MAX_SAVED_REVISION_BYTES}-byte limit.`
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(rawText);
  } catch {
    return failure({
      code: 'SAVED_REVISION_JSON_INVALID',
      message: 'Saved revision is not valid JSON.'
    });
  }
  const record = objectRecord(value);
  if (
    record &&
    typeof record.schemaVersion === 'number' &&
    record.schemaVersion !== SAVED_WIRE_EDM_JOB_REVISION_SCHEMA_VERSION
  ) {
    return failure({
      code: 'SAVED_REVISION_VERSION_UNSUPPORTED',
      message: `Saved revision schema version ${record.schemaVersion} is unsupported.`,
      foundVersion: record.schemaVersion,
      supportedVersion: SAVED_WIRE_EDM_JOB_REVISION_SCHEMA_VERSION
    });
  }
  const schemaError = Value.Errors(SavedWireEdmJobRevisionSchema, value).First();
  if (schemaError) return schemaFailure(schemaError.path, schemaError.message);
  const candidate = value as SavedRevisionSchemaValue;
  if (!isCanonicalTimestamp(candidate.savedAt)) {
    return failure({
      code: 'SAVED_REVISION_TIMESTAMP_INVALID',
      message: '/savedAt must be a real canonical UTC timestamp.',
      path: '/savedAt'
    });
  }

  const project = validateUpidProject(candidate.project);
  if (!project.ok) return project;
  const parsedPackage = validateWireEdmPostPackageValue(candidate.post.installation.package);
  if (!parsedPackage.ok) {
    return failure({
      code: 'SAVED_REVISION_PACKAGE_INVALID',
      message: 'Saved revision contains an invalid post package snapshot.',
      diagnostics: parsedPackage.diagnostics
    });
  }
  const packageHash = await sha256(canonicalJson(parsedPackage.package));
  if (!packageHash) return hashUnavailable();
  if (packageHash !== candidate.post.installation.ref.contentHash) {
    return hashMismatch('postPackage');
  }

  const machineValue = {
    ...candidate.machine,
    bindings: [candidate.post.binding]
  };
  const parsedMachine = validateMachineDefinitionValue(machineValue);
  if (!parsedMachine.ok) {
    return failure({
      code: 'SAVED_REVISION_MACHINE_INVALID',
      message: `Saved machine snapshot is invalid: ${parsedMachine.diagnostics.map(({ message }) => message).join(' ')}`
    });
  }
  const installation: PostInstallation = {
    ref: structuredClone(candidate.post.installation.ref),
    package: parsedPackage.package
  };
  const library: PostLibrary = { schemaVersion: 1, installations: [installation] };
  const resolved = await resolveMachinePostBinding(
    parsedMachine.machine,
    library,
    candidate.post.binding.id
  );
  if (!resolved.ok) {
    const diagnostics = 'diagnostics' in resolved.error ? resolved.error.diagnostics : undefined;
    return diagnostics
      ? failure({
          code: 'SAVED_REVISION_PROPERTIES_INVALID',
          message: resolved.error.message,
          diagnostics
        })
      : failure({ code: 'SAVED_REVISION_BINDING_INVALID', message: resolved.error.message });
  }
  if (canonicalJson(candidate.post.properties) !== canonicalJson(resolved.properties)) {
    return failure({
      code: 'SAVED_REVISION_PROPERTIES_INVALID',
      message: 'Saved resolved post properties do not match the exact binding properties.',
      diagnostics: []
    });
  }

  const compiled = compileWireEdmExecutionPlan(project.project.content.document);
  if (!compiled.ok) {
    return failure({
      code: 'SAVED_REVISION_EXECUTION_PLAN_INVALID',
      message: 'The saved UPID no longer compiles into a valid execution plan.',
      diagnostics: compiled.diagnostics
    });
  }
  const executionPlan = jsonSnapshot(compiled.plan);
  if (canonicalJson(candidate.executionPlan) !== canonicalJson(executionPlan)) {
    return failure({
      code: 'SAVED_REVISION_EXECUTION_PLAN_MISMATCH',
      message: 'Saved execution plan does not match a fresh compilation of the saved UPID.'
    });
  }

  const machine = jsonSnapshot(physicalMachineSnapshot(resolved.machine));
  const post: SavedPostBindingSnapshot = {
    binding: jsonSnapshot(resolved.binding),
    installation: jsonSnapshot(resolved.installation),
    properties: jsonSnapshot(resolved.properties)
  };
  const hashes = await calculateHashes({
    upid: project.project.content.document,
    executionPlan,
    machine,
    post
  });
  if (!hashes) return hashUnavailable();
  for (const field of hashFields) {
    if (candidate.hashes[field] === hashes[field]) continue;
    return hashMismatch(field);
  }

  return candidateSuccess({
    format: 'wire-edm-job-revision',
    schemaVersion: SAVED_WIRE_EDM_JOB_REVISION_SCHEMA_VERSION,
    engineVersion: WIRE_EDM_ENGINE_VERSION,
    revisionId: candidate.revisionId,
    savedAt: candidate.savedAt,
    project: jsonSnapshot(project.project),
    machine,
    post,
    executionPlan,
    hashes
  });
}

export function serializeSavedWireEdmJobRevision(
  revision: SavedWireEdmJobRevisionCandidate | SavedWireEdmJobRevision
) {
  return `${canonicalJson(revision)}\n`;
}

export function persistSavedWireEdmJobRevision(
  adapter: WorkbenchStorageAdapter,
  candidate: SavedWireEdmJobRevisionCandidate
): Promise<PersistSavedWireEdmJobRevisionResult> {
  return withWorkbenchMutationLock(adapter, () => persistSavedWireEdmJobRevisionUnlocked(
    adapter,
    candidate
  ));
}

async function persistSavedWireEdmJobRevisionUnlocked(
  adapter: WorkbenchStorageAdapter,
  candidate: SavedWireEdmJobRevisionCandidate
): Promise<PersistSavedWireEdmJobRevisionResult> {
  if (!isSavedWireEdmJobRevisionCandidate(candidate)) {
    return storageFailure(
      'SAVED_REVISION_STORAGE_WRITE_FAILED',
      'Only a revision candidate returned by the creator or parser can be persisted.'
    );
  }
  const directory = savedRevisionDirectory(candidate.project.id);
  const path = savedRevisionPath(candidate.project.id, candidate.revisionId);
  const serialized = serializeSavedWireEdmJobRevision(candidate);
  let existing: string | null;
  try {
    existing = await adapter.readText(path);
  } catch (error) {
    return storageFailure(
      'SAVED_REVISION_STORAGE_READ_FAILED',
      `Could not check saved revision path ${path}: ${errorMessage(error)}.`
    );
  }
  if (existing !== null) {
    if (existing !== serialized) {
      return storageFailure(
        'SAVED_REVISION_STORAGE_CONFLICT',
        `Saved revision path ${path} already contains different immutable bytes.`
      );
    }
    const parsed = await parseSavedWireEdmJobRevision(existing);
    if (!parsed.ok) return parsed;
    return { ok: true, path, revision: persistedSuccess(parsed.candidate) };
  }

  try {
    await adapter.ensureDirectory(directory);
    await adapter.writeText(path, serialized);
  } catch (error) {
    return rollbackNewRevision(
      adapter,
      path,
      storageFailure(
        'SAVED_REVISION_STORAGE_WRITE_FAILED',
        `Could not persist saved revision at ${path}: ${errorMessage(error)}.`
      )
    );
  }

  let readBack: string | null;
  try {
    readBack = await adapter.readText(path);
  } catch (error) {
    return rollbackNewRevision(
      adapter,
      path,
      storageFailure(
        'SAVED_REVISION_STORAGE_READ_FAILED',
        `Could not verify saved revision at ${path}: ${errorMessage(error)}.`
      )
    );
  }
  if (readBack !== serialized) {
    return rollbackNewRevision(
      adapter,
      path,
      storageFailure(
        'SAVED_REVISION_STORAGE_READBACK_MISMATCH',
        `Saved revision at ${path} did not read back byte-for-byte.`
      )
    );
  }
  const parsed = await parseSavedWireEdmJobRevision(readBack);
  if (!parsed.ok) return rollbackNewRevision(adapter, path, parsed);
  return { ok: true, path, revision: persistedSuccess(parsed.candidate) };
}

export async function loadSavedWireEdmJobRevision(
  adapter: WorkbenchStorageAdapter,
  projectId: string,
  revisionId: string
): Promise<PersistSavedWireEdmJobRevisionResult> {
  if (!Value.Check(PostIdentifierSchema, projectId)) {
    return schemaFailure('/projectId', 'Expected a valid project identifier');
  }
  if (!Value.Check(PostIdentifierSchema, revisionId)) {
    return schemaFailure('/revisionId', 'Expected a valid revision identifier');
  }
  const path = savedRevisionPath(projectId, revisionId);
  let serialized: string | null;
  try {
    serialized = await adapter.readText(path);
  } catch (error) {
    return storageFailure(
      'SAVED_REVISION_STORAGE_READ_FAILED',
      `Could not read saved revision at ${path}: ${errorMessage(error)}.`
    );
  }
  if (serialized === null) {
    return storageFailure(
      'SAVED_REVISION_STORAGE_NOT_FOUND',
      `Saved revision was not found at ${path}.`
    );
  }
  const parsed = await parseSavedWireEdmJobRevision(serialized);
  if (!parsed.ok) return parsed;
  if (parsed.candidate.project.id !== projectId || parsed.candidate.revisionId !== revisionId) {
    return storageFailure(
      'SAVED_REVISION_STORAGE_READBACK_MISMATCH',
      `Saved revision identity does not match its storage path ${path}.`
    );
  }
  return { ok: true, path, revision: persistedSuccess(parsed.candidate) };
}

export function isValidatedSavedWireEdmJobRevision(
  revision: SavedWireEdmJobRevisionData
): revision is SavedWireEdmJobRevision {
  return Boolean(
    revision &&
    typeof revision === 'object' &&
    persistedRevisionBrand in revision &&
    revision[persistedRevisionBrand] === true
  );
}

function validateUpidProject(
  projectValue: WorkbenchProjectDocument
): { ok: true; project: UpidWorkbenchProjectDocument } | Extract<SavedWireEdmJobRevisionCandidateResult, { ok: false }> {
  const parsed = parseWorkbenchProjectDocument(JSON.stringify(projectValue));
  if (!parsed.ok) {
    return failure({
      code: 'SAVED_REVISION_PROJECT_INVALID',
      message: parsed.error.message,
      projectError: parsed.error
    });
  }
  if (
    parsed.project.content.kind !== 'upid-document' ||
    (parsed.project.source.kind !== 'dxf' && parsed.project.source.kind !== 'upid')
  ) {
    return failure({
      code: 'SAVED_REVISION_UPID_PROJECT_REQUIRED',
      message: 'A saved Wire EDM job revision requires a strict version-2 DXF or UPID project with UPID content.'
    });
  }
  return { ok: true, project: parsed.project as UpidWorkbenchProjectDocument };
}

function physicalMachineSnapshot(machine: MachineDefinition): MachinePhysicalSnapshot {
  const { bindings: _bindings, ...physical } = structuredClone(machine);
  return physical;
}

function jsonSnapshot<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

async function calculateHashes(input: {
  readonly upid: PathPlanningDocument;
  readonly executionPlan: WireEdmExecutionPlan;
  readonly machine: MachinePhysicalSnapshot;
  readonly post: SavedPostBindingSnapshot;
}): Promise<SavedRevisionHashes | null> {
  const [upid, executionPlan, machine, binding, postPackage, postProperties] = await Promise.all([
    sha256(canonicalJson(input.upid)),
    sha256(canonicalJson(input.executionPlan)),
    sha256(canonicalJson(input.machine)),
    sha256(canonicalJson(input.post.binding)),
    sha256(canonicalJson(input.post.installation.package)),
    sha256(canonicalJson(input.post.properties))
  ]);
  if (!upid || !executionPlan || !machine || !binding || !postPackage || !postProperties) {
    return null;
  }
  return { upid, executionPlan, machine, binding, postPackage, postProperties };
}

async function sha256(value: string) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

const hashFields = [
  'upid',
  'executionPlan',
  'machine',
  'binding',
  'postPackage',
  'postProperties'
] satisfies readonly (keyof SavedRevisionHashes)[];

function isCanonicalTimestamp(value: string) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function objectRecord(value: unknown) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function candidateSuccess(
  data: SavedWireEdmJobRevisionData
): SavedWireEdmJobRevisionCandidateResult {
  const revision = structuredClone(data);
  Object.defineProperty(revision, revisionCandidateBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return {
    ok: true,
    candidate: deepFreeze(revision) as SavedWireEdmJobRevisionCandidate
  };
}

function persistedSuccess(candidate: SavedWireEdmJobRevisionCandidate): SavedWireEdmJobRevision {
  const revision = structuredClone(candidate) as SavedWireEdmJobRevisionData;
  Object.defineProperty(revision, persistedRevisionBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return deepFreeze(revision) as SavedWireEdmJobRevision;
}

function isSavedWireEdmJobRevisionCandidate(
  candidate: SavedWireEdmJobRevisionData
): candidate is SavedWireEdmJobRevisionCandidate {
  return Boolean(
    candidate &&
    typeof candidate === 'object' &&
    revisionCandidateBrand in candidate &&
    candidate[revisionCandidateBrand] === true
  );
}

function savedRevisionDirectory(projectId: string) {
  return `projects/${projectId}/revisions`;
}

function savedRevisionPath(projectId: string, revisionId: string) {
  return `${savedRevisionDirectory(projectId)}/${revisionId}.wireedm-job.json`;
}

function schemaFailure(
  path: string,
  detail: string
): Extract<SavedWireEdmJobRevisionCandidateResult, { readonly ok: false }> {
  return failure({
    code: 'SAVED_REVISION_SCHEMA_INVALID',
    message: `Saved revision schema violation at ${path || '/'}: ${detail}.`,
    path
  });
}

function hashMismatch(
  field: keyof SavedRevisionHashes
): Extract<SavedWireEdmJobRevisionCandidateResult, { readonly ok: false }> {
  return failure({
    code: 'SAVED_REVISION_HASH_MISMATCH',
    message: `Saved revision ${field} hash does not match its snapshotted content.`,
    field
  });
}

function hashUnavailable(): Extract<
  SavedWireEdmJobRevisionCandidateResult,
  { readonly ok: false }
> {
  return failure({
    code: 'SAVED_REVISION_HASH_UNAVAILABLE',
    message: 'SHA-256 is unavailable; a reproducible saved revision cannot be created or verified.'
  });
}

function failure(error: SavedWireEdmJobRevisionError): Extract<
  SavedWireEdmJobRevisionCandidateResult,
  { readonly ok: false }
> {
  return { ok: false, error };
}

function storageFailure(
  code: SavedWireEdmJobRevisionStorageError['code'],
  message: string
): Extract<PersistSavedWireEdmJobRevisionResult, { readonly ok: false }> {
  return { ok: false, error: { code, message } };
}

async function rollbackNewRevision(
  adapter: WorkbenchStorageAdapter,
  path: string,
  originalFailure: Extract<PersistSavedWireEdmJobRevisionResult, { readonly ok: false }>
): Promise<Extract<PersistSavedWireEdmJobRevisionResult, { readonly ok: false }>> {
  try {
    await adapter.deleteText(path);
    return originalFailure;
  } catch (error) {
    return storageFailure(
      'SAVED_REVISION_STORAGE_ROLLBACK_FAILED',
      `${originalFailure.error.message} Cleanup of ${path} also failed: ${errorMessage(error)}.`
    );
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((entry) => deepFreeze(entry));
  }
  return value;
}
