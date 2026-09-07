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
  preflightMachinePhysicalRequirements,
  type MachinePhysicalPreflightError
} from '@/domain/machine-definition/machinePhysicalPreflight';
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
  beginSavedRevisionTransaction,
  finishSavedRevisionTransaction,
  recoverSavedRevisionTransaction,
  type SavedRevisionTransactionError
} from '@/domain/storage/savedRevisionTransaction';
import {
  parseWorkbenchProjectDocument,
  WorkbenchProjectDocumentSchema,
  type WorkbenchProjectDocument,
  type WorkbenchProjectError
} from '@/domain/workbench-catalog/workbenchProject';
import {
  WORKBENCH_CATALOG_PATH,
  type ConnectedWorkbenchCatalog,
  type WorkbenchCatalogManifestValue
} from '@/domain/workbench-catalog/workbenchCatalog';
import {
  validateWorkbenchProjectPathOwnership,
  workbenchProjectDocumentPath,
  workbenchProjectOwnedPaths,
  workbenchProjectRevisionPath,
  type WorkbenchProjectIndexIntegrityError,
  type WorkbenchProjectStorageError
} from '@/domain/workbench-catalog/workbenchProjectStorage';

export const SAVED_WIRE_EDM_JOB_REVISION_SCHEMA_VERSION = 1 as const;
export const WIRE_EDM_ENGINE_VERSION = '1' as const;

const MAX_SAVED_REVISION_BYTES = 128 * 1024 * 1024;
const strictObject = { additionalProperties: false } as const;
const canonicalTimestampPattern = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const randomUuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const revisionCandidateBrand = Symbol('saved-wire-edm-job-revision-candidate');
const persistedRevisionBrand = Symbol('persisted-saved-wire-edm-job-revision');

const MachinePhysicalSnapshotSchema = Type.Omit(MachineDefinitionSchema, ['bindings', 'activeBindingId']);
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

export type MachinePhysicalSnapshot = Omit<MachineDefinition, 'bindings' | 'activeBindingId'>;

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
  | {
      readonly code: 'SAVED_REVISION_MACHINE_PHYSICAL_INVALID';
      readonly message: string;
      readonly physicalError: MachinePhysicalPreflightError;
    }
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

export type CreateSavedWireEdmJobRevisionError = Exclude<
  SavedWireEdmJobRevisionError,
  { readonly code:
      | 'SAVED_REVISION_VERSION_UNSUPPORTED'
      | 'SAVED_REVISION_FILE_TOO_LARGE'
      | 'SAVED_REVISION_JSON_INVALID'
      | 'SAVED_REVISION_EXECUTION_PLAN_MISMATCH' }
>;

export type ParseSavedWireEdmJobRevisionError = SavedWireEdmJobRevisionError;

type SavedWireEdmJobRevisionCandidateSuccess =
  { readonly ok: true; readonly candidate: SavedWireEdmJobRevisionCandidate };

export type CreateSavedWireEdmJobRevisionResult =
  | SavedWireEdmJobRevisionCandidateSuccess
  | { readonly ok: false; readonly error: CreateSavedWireEdmJobRevisionError };

export type ParseSavedWireEdmJobRevisionResult =
  | { readonly ok: true; readonly candidate: SavedWireEdmJobRevisionCandidate }
  | { readonly ok: false; readonly error: ParseSavedWireEdmJobRevisionError };

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
      readonly error: Exclude<
        SavedWireEdmJobRevisionStorageError,
        { readonly code: 'SAVED_REVISION_STORAGE_NOT_FOUND' }
      >;
    };

export type LoadSavedWireEdmJobRevisionResult =
  | { readonly ok: true; readonly path: string; readonly revision: SavedWireEdmJobRevision }
  | {
      readonly ok: false;
      readonly error:
        | ParseSavedWireEdmJobRevisionError
        | Extract<
            SavedWireEdmJobRevisionStorageError,
            { readonly code:
                | 'SAVED_REVISION_STORAGE_READ_FAILED'
                | 'SAVED_REVISION_STORAGE_READBACK_MISMATCH'
                | 'SAVED_REVISION_STORAGE_NOT_FOUND' }
          >;
    };

type SavedRevisionCatalogMutationError =
  | SavedRevisionTransactionError
  | SavedWireEdmJobRevisionStorageError
  | WorkbenchProjectStorageError
  | WorkbenchProjectIndexIntegrityError
  | {
      readonly code: 'SAVED_REVISION_CATALOG_PROJECT_NOT_FOUND';
      readonly message: string;
      readonly projectId: string;
    }
  | {
      readonly code: 'SAVED_REVISION_CATALOG_PROJECT_STALE';
      readonly message: string;
      readonly projectId: string;
    }
  | {
      readonly code: 'SAVED_REVISION_CATALOG_PROJECT_UPDATE_INVALID';
      readonly message: string;
      readonly projectError: WorkbenchProjectError;
    }
  | {
      readonly code: 'SAVED_REVISION_CATALOG_MANIFEST_STALE';
      readonly message: string;
      readonly path: typeof WORKBENCH_CATALOG_PATH;
    }
  | {
      readonly code: 'SAVED_REVISION_CATALOG_REVISION_CONFLICT';
      readonly message: string;
      readonly projectId: string;
      readonly revisionId: string;
      readonly path: string;
    }
  | {
      readonly code: 'SAVED_REVISION_CATALOG_MANIFEST_WRITE_FAILED';
      readonly message: string;
      readonly path: typeof WORKBENCH_CATALOG_PATH;
    }
  | {
      readonly code:
        | 'SAVED_REVISION_CATALOG_PROJECT_READBACK_MISMATCH'
        | 'SAVED_REVISION_CATALOG_MANIFEST_READBACK_MISMATCH';
      readonly message: string;
      readonly path: string;
    };

type SavedRevisionCatalogRollbackError = {
  readonly code: 'SAVED_REVISION_CATALOG_ROLLBACK_FAILED';
  readonly message: string;
  readonly originalError: SavedRevisionCatalogMutationError;
  readonly rollbackErrors: readonly WorkbenchProjectStorageError[];
};

export type SaveStoredWireEdmJobRevisionResult =
  | {
      readonly ok: true;
      readonly path: string;
      readonly revision: SavedWireEdmJobRevision;
      readonly project: WorkbenchProjectDocument;
      readonly workbench: ConnectedWorkbenchCatalog;
    }
  | {
      readonly ok: false;
      readonly error: SavedRevisionCatalogMutationError | SavedRevisionCatalogRollbackError;
    };

export function createSavedWireEdmJobRevisionId(randomUuid: string) {
  if (!randomUuidV4Pattern.test(randomUuid)) {
    throw new Error('Saved revision IDs require a canonical lowercase UUID v4 source.');
  }
  return `revision.${randomUuid}`;
}

export async function createSavedWireEdmJobRevision(
  input: CreateSavedWireEdmJobRevisionInput
): Promise<CreateSavedWireEdmJobRevisionResult> {
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
  const physical = preflightMachinePhysicalRequirements({
    machine: resolved.machine,
    plan: compiled.plan
  });
  if (!physical.ok) return physicalFailure(physical.error);

  const snapshot = jsonSnapshot({
    project: project.project,
    machine: physicalMachineSnapshot(resolved.machine),
    post: {
      binding: resolved.binding,
      installation: {
        ref: resolved.installation.ref,
        package: parsedPackage.package
      },
      properties: resolved.properties
    } satisfies SavedPostBindingSnapshot,
    executionPlan: compiled.plan
  });
  const hashes = await calculateHashes({
    upid: snapshot.project.content.document,
    executionPlan: snapshot.executionPlan,
    machine: snapshot.machine,
    post: snapshot.post
  }, packageHash);
  if (!hashes) return hashUnavailable();

  const candidate: SavedWireEdmJobRevisionData = {
    format: 'wire-edm-job-revision',
    schemaVersion: SAVED_WIRE_EDM_JOB_REVISION_SCHEMA_VERSION,
    engineVersion: WIRE_EDM_ENGINE_VERSION,
    revisionId: input.revisionId,
    savedAt: input.savedAt,
    project: snapshot.project,
    machine: snapshot.machine,
    post: snapshot.post,
    executionPlan: snapshot.executionPlan,
    hashes
  };
  const schemaError = Value.Errors(SavedWireEdmJobRevisionSchema, candidate).First();
  if (schemaError) return schemaFailure(schemaError.path, schemaError.message);
  return candidateSuccess(candidate);
}

export async function parseSavedWireEdmJobRevision(
  rawText: string
): Promise<ParseSavedWireEdmJobRevisionResult> {
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
    bindings: [candidate.post.binding],
    activeBindingId: candidate.post.binding.id
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
  const physical = preflightMachinePhysicalRequirements({
    machine: parsedMachine.machine,
    plan: compiled.plan
  });
  if (!physical.ok) return physicalFailure(physical.error);
  const snapshot = jsonSnapshot({
    project: project.project,
    machine: physicalMachineSnapshot(resolved.machine),
    post: {
      binding: resolved.binding,
      installation: resolved.installation,
      properties: resolved.properties
    } satisfies SavedPostBindingSnapshot,
    executionPlan: compiled.plan
  });
  if (canonicalJson(candidate.executionPlan) !== canonicalJson(snapshot.executionPlan)) {
    return failure({
      code: 'SAVED_REVISION_EXECUTION_PLAN_MISMATCH',
      message: 'Saved execution plan does not match a fresh compilation of the saved UPID.'
    });
  }
  const hashes = await calculateHashes({
    upid: snapshot.project.content.document,
    executionPlan: snapshot.executionPlan,
    machine: snapshot.machine,
    post: snapshot.post
  }, packageHash);
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
    project: snapshot.project,
    machine: snapshot.machine,
    post: snapshot.post,
    executionPlan: snapshot.executionPlan,
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

export function saveStoredWireEdmJobRevision(
  workbench: ConnectedWorkbenchCatalog,
  candidate: SavedWireEdmJobRevisionCandidate
): Promise<SaveStoredWireEdmJobRevisionResult> {
  return withWorkbenchMutationLock(workbench.adapter, async () => {
    if (!isSavedWireEdmJobRevisionCandidate(candidate)) {
      return catalogMutationFailure(savedRevisionStorageError(
        'SAVED_REVISION_STORAGE_WRITE_FAILED',
        'Only a revision candidate returned by the creator or parser can be persisted.'
      ));
    }
    const recovered = await recoverSavedRevisionTransaction(workbench.adapter);
    if (!recovered.ok) return recovered;
    const manifestCurrent = await verifyCatalogManifestCurrent(workbench);
    if (!manifestCurrent.ok) return manifestCurrent;
    const ownership = await validateWorkbenchProjectPathOwnership(
      workbench.adapter,
      workbench.manifest.projects
    );
    if (!ownership.ok) return ownership;
    const project = ownership.projects.find(({ id }) => id === candidate.project.id);
    if (!project) {
      return catalogMutationFailure({
        code: 'SAVED_REVISION_CATALOG_PROJECT_NOT_FOUND',
        message: `Workbench project is not indexed: ${candidate.project.id}.`,
        projectId: candidate.project.id
      });
    }
    if (canonicalJson(project) !== canonicalJson(candidate.project)) {
      return catalogMutationFailure({
        code: 'SAVED_REVISION_CATALOG_PROJECT_STALE',
        message: `Saved revision ${candidate.revisionId} was created from stale project ${project.id}.`,
        projectId: project.id
      });
    }

    const path = workbenchProjectRevisionPath(project.id, candidate.revisionId);
    if (project.savedRevisionIds.includes(candidate.revisionId)) {
      return catalogMutationFailure(revisionCatalogConflict(project.id, candidate.revisionId, path));
    }
    const existingOwner = ownership.projects.find((storedProject) => (
      workbenchProjectOwnedPaths(storedProject).includes(path)
    ));
    if (existingOwner) {
      return catalogMutationFailure({
        code: 'WORKBENCH_CATALOG_PROJECT_PATH_COLLISION',
        message: `Workbench path ${path} is already claimed by ${existingOwner.id}.`,
        path,
        firstProjectId: existingOwner.id,
        secondProjectId: project.id
      });
    }

    const nextProjectValue = {
      ...project,
      updatedAt: candidate.savedAt,
      savedRevisionIds: [...project.savedRevisionIds, candidate.revisionId]
    };
    const nextProject = parseWorkbenchProjectDocument(JSON.stringify(nextProjectValue));
    if (!nextProject.ok) {
      return catalogMutationFailure({
        code: 'SAVED_REVISION_CATALOG_PROJECT_UPDATE_INVALID',
        message: nextProject.error.message,
        projectError: nextProject.error
      });
    }
    const nextManifest = deepFreeze({
      ...workbench.manifest,
      updatedAt: candidate.savedAt,
      projects: workbench.manifest.projects.map((entry) => entry.id === project.id
        ? { ...entry, updatedAt: candidate.savedAt }
        : entry)
    } satisfies WorkbenchCatalogManifestValue);
    const documentPath = workbenchProjectDocumentPath(project.id);
    const snapshots = await captureCatalogSnapshots(
      workbench,
      [path, documentPath, WORKBENCH_CATALOG_PATH]
    );
    if (!snapshots.ok) return snapshots;
    const applied: CatalogStorageSnapshot[] = [];
    const revisionSnapshot = snapshots.snapshots.find((snapshot) => snapshot.path === path);
    if (revisionSnapshot?.contents !== null) {
      return catalogMutationFailure(revisionCatalogConflict(project.id, candidate.revisionId, path));
    }

    try {
      await workbench.adapter.ensureDirectory(`projects/${project.id}/revisions`);
    } catch (error) {
      return catalogMutationFailure(catalogStorageAccessFailure('write', path, error));
    }
    const serializedRevision = serializeSavedWireEdmJobRevision(candidate);
    const serializedProject = `${JSON.stringify(nextProject.project, null, 2)}\n`;
    const serializedManifest = `${JSON.stringify(nextManifest, null, 2)}\n`;
    const previousProject = snapshots.snapshots.find((snapshot) => snapshot.path === documentPath)?.contents;
    const previousManifest = snapshots.snapshots.find((snapshot) => snapshot.path === WORKBENCH_CATALOG_PATH)?.contents;
    if (previousProject == null || previousManifest == null) {
      return catalogMutationFailure(savedRevisionStorageError('SAVED_REVISION_STORAGE_CONFLICT', 'Project or manifest disappeared before saving the revision.'));
    }
    const begun = await beginSavedRevisionTransaction(workbench.adapter, {
      projectId: project.id,
      revisionId: candidate.revisionId,
      previousProject,
      previousManifest,
      nextRevision: serializedRevision,
      nextProject: serializedProject,
      nextManifest: serializedManifest
    });
    if (!begun.ok) return begun;
    journalCatalogSnapshot(applied, snapshots.snapshots, path);
    const revisionWrite = await writeCatalogTransactionText(workbench, path, serializedRevision);
    if (!revisionWrite.ok) {
      return rollbackCatalogRevision(workbench, applied, revisionWrite.error);
    }
    const revisionReadback = await readCatalogTransactionText(workbench, path);
    if (!revisionReadback.ok) {
      return rollbackCatalogRevision(workbench, applied, revisionReadback.error);
    }
    if (revisionReadback.contents !== serializedRevision) {
      return rollbackCatalogRevision(workbench, applied, savedRevisionStorageError(
        'SAVED_REVISION_STORAGE_READBACK_MISMATCH',
        `Saved revision at ${path} did not read back byte-for-byte.`
      ));
    }
    journalCatalogSnapshot(applied, snapshots.snapshots, documentPath);
    const projectWrite = await writeCatalogTransactionText(workbench, documentPath, serializedProject);
    if (!projectWrite.ok) {
      return rollbackCatalogRevision(workbench, applied, projectWrite.error);
    }
    const projectReadback = await readCatalogTransactionText(workbench, documentPath);
    if (!projectReadback.ok) {
      return rollbackCatalogRevision(workbench, applied, projectReadback.error);
    }
    if (projectReadback.contents !== serializedProject) {
      return rollbackCatalogRevision(workbench, applied, {
        code: 'SAVED_REVISION_CATALOG_PROJECT_READBACK_MISMATCH',
        message: `Updated project at ${documentPath} did not read back byte-for-byte.`,
        path: documentPath
      });
    }
    journalCatalogSnapshot(applied, snapshots.snapshots, WORKBENCH_CATALOG_PATH);
    const manifestWrite = await writeCatalogManifest(workbench, nextManifest);
    if (!manifestWrite.ok) {
      return rollbackCatalogRevision(workbench, applied, manifestWrite.error);
    }
    const manifestReadback = await readCatalogTransactionText(workbench, WORKBENCH_CATALOG_PATH);
    if (!manifestReadback.ok) {
      return rollbackCatalogRevision(workbench, applied, manifestReadback.error);
    }
    if (manifestReadback.contents !== serializedManifest) {
      return rollbackCatalogRevision(workbench, applied, {
        code: 'SAVED_REVISION_CATALOG_MANIFEST_READBACK_MISMATCH',
        message: `Updated manifest at ${WORKBENCH_CATALOG_PATH} did not read back byte-for-byte.`,
        path: WORKBENCH_CATALOG_PATH
      });
    }
    const finished = await finishSavedRevisionTransaction(workbench.adapter);
    if (!finished.ok) return finished;
    return {
      ok: true,
      path,
      revision: persistedSuccess(candidate),
      project: nextProject.project,
      workbench: Object.freeze({ ...workbench, manifest: nextManifest })
    };
  });
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
    if (!parsed.ok) {
      return storageFailure(
        'SAVED_REVISION_STORAGE_READBACK_MISMATCH',
        `Existing saved revision at ${path} is not the valid candidate it matches: ${parsed.error.message}`
      );
    }
    return { ok: true, path, revision: persistedSuccess(parsed.candidate) };
  }

  try {
    await adapter.ensureDirectory(directory);
  } catch (error) {
    return storageFailure(
      'SAVED_REVISION_STORAGE_WRITE_FAILED',
      `Could not prepare saved revision directory ${directory}: ${errorMessage(error)}.`
    );
  }
  try {
    await adapter.writeText(path, serialized);
  } catch (error) {
    return rollbackNewRevision(adapter, path, storageFailure(
      'SAVED_REVISION_STORAGE_WRITE_FAILED',
      `Could not persist saved revision at ${path}: ${errorMessage(error)}.`
    ));
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
  if (!parsed.ok) {
    return rollbackNewRevision(adapter, path, storageFailure(
      'SAVED_REVISION_STORAGE_READBACK_MISMATCH',
      `Saved revision at ${path} failed validation after write: ${parsed.error.message}`
    ));
  }
  return { ok: true, path, revision: persistedSuccess(parsed.candidate) };
}

export async function loadSavedWireEdmJobRevision(
  adapter: WorkbenchStorageAdapter,
  projectId: string,
  revisionId: string
): Promise<LoadSavedWireEdmJobRevisionResult> {
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
):
  | { ok: true; project: UpidWorkbenchProjectDocument }
  | { ok: false; error: Extract<
      SavedWireEdmJobRevisionError,
      { code: 'SAVED_REVISION_PROJECT_INVALID' | 'SAVED_REVISION_UPID_PROJECT_REQUIRED' }
    > } {
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
  const { bindings: _bindings, activeBindingId: _activeBindingId, ...physical } = machine;
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
}, postPackage: string): Promise<SavedRevisionHashes | null> {
  const [upid, executionPlan, machine, binding, postProperties] = await Promise.all([
    sha256(canonicalJson(input.upid)),
    sha256(canonicalJson(input.executionPlan)),
    sha256(canonicalJson(input.machine)),
    sha256(canonicalJson(input.post.binding)),
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
): SavedWireEdmJobRevisionCandidateSuccess {
  Object.defineProperty(data, revisionCandidateBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return {
    ok: true,
    candidate: deepFreeze(data) as SavedWireEdmJobRevisionCandidate
  };
}

function persistedSuccess(candidate: SavedWireEdmJobRevisionCandidate): SavedWireEdmJobRevision {
  const revision = jsonSnapshot(candidate) as SavedWireEdmJobRevisionData;
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

interface CatalogStorageSnapshot {
  readonly path: string;
  readonly contents: string | null;
}

async function verifyCatalogManifestCurrent(workbench: ConnectedWorkbenchCatalog) {
  const read = await readCatalogTransactionText(workbench, WORKBENCH_CATALOG_PATH);
  if (!read.ok) return read;
  if (read.contents === null) {
    return catalogMutationFailure({
      code: 'SAVED_REVISION_CATALOG_MANIFEST_STALE',
      message: 'Workbench manifest disappeared after this catalog snapshot was opened.',
      path: WORKBENCH_CATALOG_PATH
    });
  }
  let stored: unknown;
  try {
    stored = JSON.parse(read.contents);
  } catch {
    return catalogMutationFailure({
      code: 'SAVED_REVISION_CATALOG_MANIFEST_STALE',
      message: 'Workbench manifest became invalid after this catalog snapshot was opened.',
      path: WORKBENCH_CATALOG_PATH
    });
  }
  if (JSON.stringify(stored) !== JSON.stringify(workbench.manifest)) {
    return catalogMutationFailure({
      code: 'SAVED_REVISION_CATALOG_MANIFEST_STALE',
      message: 'Workbench manifest changed after this catalog snapshot was opened.',
      path: WORKBENCH_CATALOG_PATH
    });
  }
  return { ok: true as const };
}

async function captureCatalogSnapshots(
  workbench: ConnectedWorkbenchCatalog,
  paths: readonly string[]
) {
  const snapshots: CatalogStorageSnapshot[] = [];
  for (const path of new Set(paths)) {
    const read = await readCatalogTransactionText(workbench, path);
    if (!read.ok) return read;
    snapshots.push({ path, contents: read.contents });
  }
  return { ok: true as const, snapshots };
}

async function readCatalogTransactionText(
  workbench: ConnectedWorkbenchCatalog,
  path: string
) {
  try {
    return { ok: true as const, contents: await workbench.adapter.readText(path) };
  } catch (error) {
    return { ok: false as const, error: catalogStorageAccessFailure('read', path, error) };
  }
}

async function writeCatalogTransactionText(
  workbench: ConnectedWorkbenchCatalog,
  path: string,
  contents: string
) {
  try {
    await workbench.adapter.writeText(path, contents);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: catalogStorageAccessFailure('write', path, error) };
  }
}

async function deleteCatalogTransactionText(
  workbench: ConnectedWorkbenchCatalog,
  path: string
) {
  try {
    await workbench.adapter.deleteText(path);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: catalogStorageAccessFailure('delete', path, error) };
  }
}

async function writeCatalogManifest(
  workbench: ConnectedWorkbenchCatalog,
  manifest: WorkbenchCatalogManifestValue
) {
  try {
    await workbench.adapter.writeText(
      WORKBENCH_CATALOG_PATH,
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: {
        code: 'SAVED_REVISION_CATALOG_MANIFEST_WRITE_FAILED' as const,
        message: `Workbench manifest write failed: ${errorMessage(error)}.`,
        path: WORKBENCH_CATALOG_PATH as typeof WORKBENCH_CATALOG_PATH
      }
    };
  }
}

function journalCatalogSnapshot(
  applied: CatalogStorageSnapshot[],
  snapshots: readonly CatalogStorageSnapshot[],
  path: string
) {
  const snapshot = snapshots.find((entry) => entry.path === path);
  if (!snapshot) throw new Error(`Missing captured catalog snapshot for ${path}.`);
  applied.push(snapshot);
}

async function rollbackCatalogRevision(
  workbench: ConnectedWorkbenchCatalog,
  snapshots: readonly CatalogStorageSnapshot[],
  originalError: SavedRevisionCatalogMutationError
): Promise<Extract<SaveStoredWireEdmJobRevisionResult, { readonly ok: false }>> {
  const rollbackErrors: WorkbenchProjectStorageError[] = [];
  for (const snapshot of [...snapshots].reverse()) {
    const restored = snapshot.contents === null
      ? await deleteCatalogTransactionText(workbench, snapshot.path)
      : await writeCatalogTransactionText(workbench, snapshot.path, snapshot.contents);
    if (!restored.ok) rollbackErrors.push(restored.error);
    else {
      const readback = await readCatalogTransactionText(workbench, snapshot.path);
      if (!readback.ok) rollbackErrors.push(readback.error);
      else if (readback.contents !== snapshot.contents) {
        rollbackErrors.push(catalogStorageAccessFailure('write', snapshot.path, 'Rollback did not read back exactly'));
      }
    }
  }
  if (rollbackErrors.length === 0) {
    const finished = await finishSavedRevisionTransaction(workbench.adapter);
    return finished.ok ? catalogMutationFailure(originalError) : finished;
  }
  return {
    ok: false,
    error: {
      code: 'SAVED_REVISION_CATALOG_ROLLBACK_FAILED',
      message: `Saved revision transaction failed and ${rollbackErrors.length} rollback operation(s) also failed.`,
      originalError,
      rollbackErrors
    }
  };
}

function revisionCatalogConflict(
  projectId: string,
  revisionId: string,
  path: string
): Extract<
  SavedRevisionCatalogMutationError,
  { code: 'SAVED_REVISION_CATALOG_REVISION_CONFLICT' }
> {
  return {
    code: 'SAVED_REVISION_CATALOG_REVISION_CONFLICT',
    message: `Project ${projectId} already owns saved revision ${revisionId} at ${path}.`,
    projectId,
    revisionId,
    path
  };
}

function catalogStorageAccessFailure(
  operation: 'read' | 'write' | 'delete',
  path: string,
  error: unknown
): Extract<
  WorkbenchProjectStorageError,
  { code: 'WORKBENCH_PROJECT_STORAGE_ACCESS_FAILED' }
> {
  return {
    code: 'WORKBENCH_PROJECT_STORAGE_ACCESS_FAILED',
    message: `Workbench project ${operation} failed at ${path}: ${errorMessage(error)}.`,
    operation,
    path
  };
}

function catalogMutationFailure(
  error: SavedRevisionCatalogMutationError
): { readonly ok: false; readonly error: SavedRevisionCatalogMutationError } {
  return { ok: false, error };
}

function savedRevisionStorageError(
  code: SavedWireEdmJobRevisionStorageError['code'],
  message: string
): SavedWireEdmJobRevisionStorageError {
  return { code, message };
}

function savedRevisionDirectory(projectId: string) {
  return `projects/${projectId}/revisions`;
}

function savedRevisionPath(projectId: string, revisionId: string) {
  return workbenchProjectRevisionPath(projectId, revisionId);
}

function schemaFailure(
  path: string,
  detail: string
): { readonly ok: false; readonly error: Extract<
    SavedWireEdmJobRevisionError,
    { readonly code: 'SAVED_REVISION_SCHEMA_INVALID' }
  > } {
  return failure({
    code: 'SAVED_REVISION_SCHEMA_INVALID',
    message: `Saved revision schema violation at ${path || '/'}: ${detail}.`,
    path
  });
}

function hashMismatch(
  field: keyof SavedRevisionHashes
): { readonly ok: false; readonly error: Extract<
    SavedWireEdmJobRevisionError,
    { readonly code: 'SAVED_REVISION_HASH_MISMATCH' }
  > } {
  return failure({
    code: 'SAVED_REVISION_HASH_MISMATCH',
    message: `Saved revision ${field} hash does not match its snapshotted content.`,
    field
  });
}

function hashUnavailable(): { readonly ok: false; readonly error: Extract<
  SavedWireEdmJobRevisionError,
  { readonly code: 'SAVED_REVISION_HASH_UNAVAILABLE' }
> } {
  return failure({
    code: 'SAVED_REVISION_HASH_UNAVAILABLE',
    message: 'SHA-256 is unavailable; a reproducible saved revision cannot be created or verified.'
  });
}

function physicalFailure(
  physicalError: MachinePhysicalPreflightError
): { readonly ok: false; readonly error: Extract<
    SavedWireEdmJobRevisionError,
    { readonly code: 'SAVED_REVISION_MACHINE_PHYSICAL_INVALID' }
  > } {
  return failure({
    code: 'SAVED_REVISION_MACHINE_PHYSICAL_INVALID',
    message: physicalError.message,
    physicalError
  });
}

function failure<Error extends SavedWireEdmJobRevisionError>(
  error: Error
): { readonly ok: false; readonly error: Error } {
  return { ok: false, error };
}

function storageFailure<Code extends SavedWireEdmJobRevisionStorageError['code']>(
  code: Code,
  message: string
): { readonly ok: false; readonly error: Extract<
    SavedWireEdmJobRevisionStorageError,
    { readonly code: Code }
  > } {
  return { ok: false, error: { code, message } } as {
    readonly ok: false;
    readonly error: Extract<SavedWireEdmJobRevisionStorageError, { readonly code: Code }>;
  };
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
