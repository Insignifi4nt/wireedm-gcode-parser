import { withWorkbenchMutationLock } from '@/domain/storage/workbenchMutationLock';
import { recoverSavedRevisionTransaction, type SavedRevisionTransactionError } from '@/domain/storage/savedRevisionTransaction';

import {
  WORKBENCH_CATALOG_PATH,
  type ConnectedWorkbenchCatalog,
  type WorkbenchCatalogManifest,
  type WorkbenchCatalogManifestValue
} from './workbenchCatalog';
import type { WorkbenchProjectDocument } from './workbenchProject';
import {
  readIndexedWorkbenchProjectStorage,
  validateWorkbenchProjectPathOwnership,
  workbenchProjectDocumentPath,
  workbenchProjectOwnedPaths,
  type WorkbenchProjectIndexIntegrityError,
  type WorkbenchProjectStorageError
} from './workbenchProjectStorage';

export interface OwnedWorkbenchFileWrite {
  readonly path: string;
  readonly contents: string;
}

export type OwnedWorkbenchFileChange =
  | ({ readonly kind: 'write' } & OwnedWorkbenchFileWrite)
  | { readonly kind: 'delete'; readonly path: string };

interface AddStoredWorkbenchProjectInput {
  readonly project: WorkbenchProjectDocument;
  readonly ownedFiles: readonly OwnedWorkbenchFileWrite[];
}

interface ReplaceStoredWorkbenchProjectInput {
  readonly project: WorkbenchProjectDocument;
  readonly ownedFileChanges: readonly OwnedWorkbenchFileChange[];
}

interface DeleteStoredWorkbenchProjectInput {
  readonly projectId: string;
  readonly deletedAt: Date;
}

type ProjectNotFoundError = {
  code: 'WORKBENCH_CATALOG_PROJECT_NOT_FOUND';
  message: string;
  projectId: string;
};

type ProjectConflictError = {
  code: 'WORKBENCH_CATALOG_PROJECT_CONFLICT';
  message: string;
  projectId: string;
  path: string;
};

type OwnedFilePlanError = {
  code: 'WORKBENCH_CATALOG_OWNED_FILE_PLAN_INVALID';
  message: string;
  path: string;
};

type OwnedFileDanglingError = {
  code: 'WORKBENCH_CATALOG_OWNED_FILE_DANGLING';
  message: string;
  projectId: string;
  path: string;
};

type RevisionPlanError = {
  code: 'WORKBENCH_CATALOG_REVISION_PLAN_INVALID';
  message: string;
  projectId: string;
};

type TimestampError = {
  code: 'WORKBENCH_CATALOG_MUTATION_TIMESTAMP_INVALID';
  message: string;
  projectId: string;
};

type ManifestWriteError = {
  code: 'WORKBENCH_CATALOG_MUTATION_MANIFEST_WRITE_FAILED';
  message: string;
  path: typeof WORKBENCH_CATALOG_PATH;
};

type ManifestStateError = {
  code:
    | 'WORKBENCH_CATALOG_MUTATION_MANIFEST_MISSING'
    | 'WORKBENCH_CATALOG_MUTATION_MANIFEST_INVALID'
    | 'WORKBENCH_CATALOG_MUTATION_MANIFEST_STALE';
  message: string;
  path: typeof WORKBENCH_CATALOG_PATH;
};

type MutationError =
  | SavedRevisionTransactionError
  | WorkbenchProjectStorageError
  | WorkbenchProjectIndexIntegrityError
  | ProjectNotFoundError
  | ProjectConflictError
  | OwnedFilePlanError
  | OwnedFileDanglingError
  | RevisionPlanError
  | TimestampError
  | ManifestWriteError
  | ManifestStateError;

type MutationStateError =
  | SavedRevisionTransactionError
  | WorkbenchProjectStorageError
  | WorkbenchProjectIndexIntegrityError
  | ManifestStateError;

export type AddStoredWorkbenchProjectError =
  | MutationStateError
  | ProjectConflictError
  | OwnedFilePlanError
  | RevisionPlanError
  | ManifestWriteError;

export type ReadStoredWorkbenchProjectError =
  | WorkbenchProjectStorageError
  | WorkbenchProjectIndexIntegrityError
  | ProjectNotFoundError;

export type ReplaceStoredWorkbenchProjectError =
  | MutationStateError
  | ProjectNotFoundError
  | ProjectConflictError
  | OwnedFilePlanError
  | OwnedFileDanglingError
  | RevisionPlanError
  | ManifestWriteError;

export type DeleteStoredWorkbenchProjectError =
  | MutationStateError
  | ProjectNotFoundError
  | OwnedFileDanglingError
  | TimestampError
  | ManifestWriteError;

type CatalogRollbackError<Error extends MutationError> = {
  code: 'WORKBENCH_CATALOG_MUTATION_ROLLBACK_FAILED';
  message: string;
  originalError: Error;
  rollbackErrors: readonly WorkbenchProjectStorageError[];
};

export type AddStoredWorkbenchProjectResult =
  | { ok: true; workbench: ConnectedWorkbenchCatalog; project: WorkbenchProjectDocument }
  | { ok: false; error: AddStoredWorkbenchProjectError | CatalogRollbackError<AddStoredWorkbenchProjectError> };

export type ReadStoredWorkbenchProjectResult =
  | { ok: true; project: WorkbenchProjectDocument }
  | { ok: false; error: ReadStoredWorkbenchProjectError };

export type ReplaceStoredWorkbenchProjectResult =
  | { ok: true; workbench: ConnectedWorkbenchCatalog; project: WorkbenchProjectDocument }
  | { ok: false; error: ReplaceStoredWorkbenchProjectError | CatalogRollbackError<ReplaceStoredWorkbenchProjectError> };

export type DeleteStoredWorkbenchProjectResult =
  | { ok: true; workbench: ConnectedWorkbenchCatalog; deleted: WorkbenchProjectDocument }
  | { ok: false; error: DeleteStoredWorkbenchProjectError | CatalogRollbackError<DeleteStoredWorkbenchProjectError> };

interface StorageSnapshot {
  readonly path: string;
  readonly contents: string | null;
}

export async function addStoredWorkbenchProject(
  workbench: ConnectedWorkbenchCatalog,
  input: AddStoredWorkbenchProjectInput
): Promise<AddStoredWorkbenchProjectResult> {
  return withWorkbenchMutationLock(workbench.adapter, async () => {
    const current = await verifyManifestCurrent(workbench);
    if (!current.ok) return current;
    const ownership = await validateWorkbenchProjectPathOwnership(
      workbench.adapter,
      workbench.manifest.projects
    );
    if (!ownership.ok) return ownership;
    const path = workbenchProjectDocumentPath(input.project.id);
    if (input.project.savedRevisionIds.length > 0) {
      return { ok: false, error: revisionPlanInvalid(input.project.id) };
    }
    const collision = projectPathCollision(input.project, ownership.projects);
    if (collision) return { ok: false, error: collision };
    const planError = validateAddOwnedFilePlan(input.project, input.ownedFiles, path);
    if (planError) return { ok: false, error: planError };
    const conflict = workbench.manifest.projects.find(
      (entry) => entry.id === input.project.id || entry.path === path
    );
    if (conflict) return projectConflict(input.project.id, path, `indexed project ${conflict.id}`);

    const paths = [...input.ownedFiles.map(({ path: ownedPath }) => ownedPath), path, WORKBENCH_CATALOG_PATH];
    const snapshots = await captureSnapshots(workbench, paths);
    if (!snapshots.ok) return snapshots;
    const applied: StorageSnapshot[] = [];
    const occupied = snapshots.snapshots.find(
      (snapshot) => snapshot.path !== WORKBENCH_CATALOG_PATH && snapshot.contents !== null
    );
    if (occupied) return projectConflict(input.project.id, occupied.path, 'existing unindexed storage');

    for (const file of input.ownedFiles) {
      journalAppliedSnapshot(applied, snapshots.snapshots, file.path);
      const written = await writeStorageText(workbench, file.path, file.contents);
      if (!written.ok) return rollbackOrError(workbench, applied, written.error);
    }
    journalAppliedSnapshot(applied, snapshots.snapshots, path);
    const documentWrite = await writeProjectDocument(workbench, path, input.project);
    if (!documentWrite.ok) return rollbackOrError(workbench, applied, documentWrite.error);
    const nextManifest = withProjectEntry(workbench.manifest, input.project, path);
    journalAppliedSnapshot(applied, snapshots.snapshots, WORKBENCH_CATALOG_PATH);
    const manifestWrite = await writeManifest(workbench, nextManifest);
    if (!manifestWrite.ok) return rollbackOrError(workbench, applied, manifestWrite.error);
    return { ok: true, project: input.project, workbench: freezeWorkbench(workbench, nextManifest) };
  });
}

export async function readStoredWorkbenchProject(
  workbench: ConnectedWorkbenchCatalog,
  projectId: string
): Promise<ReadStoredWorkbenchProjectResult> {
  const entry = workbench.manifest.projects.find(({ id }) => id === projectId);
  if (!entry) return projectNotFound(projectId);
  return readIndexedWorkbenchProjectStorage(workbench.adapter, entry);
}

export async function replaceStoredWorkbenchProject(
  workbench: ConnectedWorkbenchCatalog,
  input: ReplaceStoredWorkbenchProjectInput
): Promise<ReplaceStoredWorkbenchProjectResult> {
  return withWorkbenchMutationLock(workbench.adapter, async () => {
    const current = await verifyManifestCurrent(workbench);
    if (!current.ok) return current;
    const ownership = await validateWorkbenchProjectPathOwnership(
      workbench.adapter,
      workbench.manifest.projects
    );
    if (!ownership.ok) return ownership;
    const entry = workbench.manifest.projects.find(({ id }) => id === input.project.id);
    if (!entry) return projectNotFound(input.project.id);
    const previous = await readIndexedWorkbenchProjectStorage(workbench.adapter, entry);
    if (!previous.ok) return previous;
    if (
      JSON.stringify(previous.project.savedRevisionIds) !==
      JSON.stringify(input.project.savedRevisionIds)
    ) {
      return { ok: false, error: revisionPlanInvalid(input.project.id) };
    }
    const collision = projectPathCollision(
      input.project,
      ownership.projects.filter(({ id }) => id !== input.project.id)
    );
    if (collision) return { ok: false, error: collision };
    const planError = validateReplaceOwnedFilePlan(previous.project, input.project, input.ownedFileChanges, entry.path);
    if (planError) return { ok: false, error: planError };

    const paths = [...input.ownedFileChanges.map(({ path }) => path), entry.path, WORKBENCH_CATALOG_PATH];
    const snapshots = await captureSnapshots(workbench, paths);
    if (!snapshots.ok) return snapshots;
    const applied: StorageSnapshot[] = [];
    const previousPaths = new Set(previous.project.source.files.map(({ path }) => path));
    for (const change of input.ownedFileChanges) {
      const snapshot = snapshots.snapshots.find(({ path }) => path === change.path);
      if (change.kind === 'delete' && snapshot?.contents === null) {
        return { ok: false, error: ownedFileDangling(input.project.id, change.path) };
      }
      if (change.kind === 'write' && !previousPaths.has(change.path) && snapshot?.contents !== null) {
        return projectConflict(input.project.id, change.path, 'existing unowned storage');
      }
    }

    for (const change of input.ownedFileChanges) {
      if (change.kind === 'write') {
        journalAppliedSnapshot(applied, snapshots.snapshots, change.path);
        const written = await writeStorageText(workbench, change.path, change.contents);
        if (!written.ok) return rollbackOrError(workbench, applied, written.error);
      }
    }
    for (const change of input.ownedFileChanges.filter(({ kind }) => kind === 'delete')) {
      journalAppliedSnapshot(applied, snapshots.snapshots, change.path);
      const deleted = await deleteStorageText(workbench, change.path);
      if (!deleted.ok) return rollbackOrError(workbench, applied, deleted.error);
    }
    journalAppliedSnapshot(applied, snapshots.snapshots, entry.path);
    const documentWrite = await writeProjectDocument(workbench, entry.path, input.project);
    if (!documentWrite.ok) return rollbackOrError(workbench, applied, documentWrite.error);
    const nextManifest = replaceProjectEntry(workbench.manifest, input.project, entry.path);
    journalAppliedSnapshot(applied, snapshots.snapshots, WORKBENCH_CATALOG_PATH);
    const manifestWrite = await writeManifest(workbench, nextManifest);
    if (!manifestWrite.ok) return rollbackOrError(workbench, applied, manifestWrite.error);
    return { ok: true, project: input.project, workbench: freezeWorkbench(workbench, nextManifest) };
  });
}

export async function deleteStoredWorkbenchProject(
  workbench: ConnectedWorkbenchCatalog,
  input: DeleteStoredWorkbenchProjectInput
): Promise<DeleteStoredWorkbenchProjectResult> {
  return withWorkbenchMutationLock(workbench.adapter, async () => {
    const current = await verifyManifestCurrent(workbench);
    if (!current.ok) return current;
    const ownership = await validateWorkbenchProjectPathOwnership(
      workbench.adapter,
      workbench.manifest.projects
    );
    if (!ownership.ok) return ownership;
    if (!Number.isFinite(input.deletedAt.getTime())) {
      return {
        ok: false,
        error: {
          code: 'WORKBENCH_CATALOG_MUTATION_TIMESTAMP_INVALID',
          message: `Project deletion timestamp is invalid for ${input.projectId}.`,
          projectId: input.projectId
        }
      };
    }
    const entry = workbench.manifest.projects.find(({ id }) => id === input.projectId);
    if (!entry) return projectNotFound(input.projectId);
    const previous = await readIndexedWorkbenchProjectStorage(workbench.adapter, entry);
    if (!previous.ok) return previous;
    const sourcePaths = previous.project.source.files.map(({ path }) => path);
    const ownedPaths = workbenchProjectOwnedPaths(previous.project);
    const snapshots = await captureSnapshots(
      workbench,
      [...ownedPaths, WORKBENCH_CATALOG_PATH]
    );
    if (!snapshots.ok) return snapshots;
    const applied: StorageSnapshot[] = [];
    const dangling = snapshots.snapshots.find(
      (snapshot) => sourcePaths.includes(snapshot.path) && snapshot.contents === null
    );
    if (dangling) return { ok: false, error: ownedFileDangling(input.projectId, dangling.path) };

    for (const path of ownedPaths) {
      journalAppliedSnapshot(applied, snapshots.snapshots, path);
      const deleted = await deleteStorageText(workbench, path);
      if (!deleted.ok) return rollbackOrError(workbench, applied, deleted.error);
    }
    const nextManifest = deepFreeze({
      ...workbench.manifest,
      updatedAt: input.deletedAt.toISOString(),
      projects: workbench.manifest.projects.filter(({ id }) => id !== input.projectId)
    } satisfies WorkbenchCatalogManifestValue);
    journalAppliedSnapshot(applied, snapshots.snapshots, WORKBENCH_CATALOG_PATH);
    const manifestWrite = await writeManifest(workbench, nextManifest);
    if (!manifestWrite.ok) return rollbackOrError(workbench, applied, manifestWrite.error);
    return {
      ok: true,
      deleted: previous.project,
      workbench: freezeWorkbench(workbench, nextManifest)
    };
  });
}

function validateAddOwnedFilePlan(
  project: WorkbenchProjectDocument,
  writes: readonly OwnedWorkbenchFileWrite[],
  documentPath: string
) {
  const declared = new Set(project.source.files.map(({ path }) => path));
  const seen = new Set<string>();
  for (const write of writes) {
    if (seen.has(write.path)) return ownedFilePlanInvalid(write.path, 'is duplicated');
    seen.add(write.path);
    if (!declared.has(write.path)) return ownedFilePlanInvalid(write.path, 'is not declared by the project');
  }
  if (declared.has(documentPath)) return ownedFilePlanInvalid(documentPath, 'collides with the project document');
  for (const path of declared) {
    if (!seen.has(path)) return ownedFilePlanInvalid(path, 'has no explicit write');
  }
  return null;
}

function validateReplaceOwnedFilePlan(
  previous: WorkbenchProjectDocument,
  next: WorkbenchProjectDocument,
  changes: readonly OwnedWorkbenchFileChange[],
  documentPath: string
) {
  const previousPaths = new Set(previous.source.files.map(({ path }) => path));
  const nextPaths = new Set(next.source.files.map(({ path }) => path));
  if (nextPaths.has(documentPath)) return ownedFilePlanInvalid(documentPath, 'collides with the project document');
  const seen = new Set<string>();
  const deleted = new Set<string>();
  const written = new Set<string>();
  for (const change of changes) {
    if (seen.has(change.path)) return ownedFilePlanInvalid(change.path, 'has more than one change');
    seen.add(change.path);
    if (change.kind === 'delete') {
      if (!previousPaths.has(change.path) || nextPaths.has(change.path)) {
        return ownedFilePlanInvalid(change.path, 'is not a removed owned file');
      }
      deleted.add(change.path);
    } else {
      if (!nextPaths.has(change.path)) return ownedFilePlanInvalid(change.path, 'is not owned by the replacement project');
      written.add(change.path);
    }
  }
  for (const path of previousPaths) {
    if (!nextPaths.has(path) && !deleted.has(path)) return ownedFilePlanInvalid(path, 'has no explicit delete');
  }
  for (const path of nextPaths) {
    if (!previousPaths.has(path) && !written.has(path)) return ownedFilePlanInvalid(path, 'has no explicit write');
  }
  return null;
}

async function captureSnapshots(workbench: ConnectedWorkbenchCatalog, paths: readonly string[]) {
  const snapshots: StorageSnapshot[] = [];
  for (const path of new Set(paths)) {
    try {
      snapshots.push({ path, contents: await workbench.adapter.readText(path) });
    } catch (error) {
      return projectAccessFailure('read', path, error);
    }
  }
  return { ok: true as const, snapshots };
}

async function verifyManifestCurrent(workbench: ConnectedWorkbenchCatalog) {
  const recovered = await recoverSavedRevisionTransaction(workbench.adapter);
  if (!recovered.ok) return recovered;
  let rawText: string | null;
  try {
    rawText = await workbench.adapter.readText(WORKBENCH_CATALOG_PATH);
  } catch (error) {
    return projectAccessFailure('read', WORKBENCH_CATALOG_PATH, error);
  }
  if (rawText === null) {
    return manifestStateFailure(
      'WORKBENCH_CATALOG_MUTATION_MANIFEST_MISSING',
      'Workbench manifest disappeared after the catalog was opened.'
    );
  }
  let stored: unknown;
  try {
    stored = JSON.parse(rawText);
  } catch {
    return manifestStateFailure(
      'WORKBENCH_CATALOG_MUTATION_MANIFEST_INVALID',
      'Workbench manifest became invalid JSON after the catalog was opened.'
    );
  }
  if (JSON.stringify(stored) !== JSON.stringify(workbench.manifest)) {
    return manifestStateFailure(
      'WORKBENCH_CATALOG_MUTATION_MANIFEST_STALE',
      'Workbench manifest changed after this catalog snapshot was opened.'
    );
  }
  return { ok: true as const };
}

function journalAppliedSnapshot(
  applied: StorageSnapshot[],
  snapshots: readonly StorageSnapshot[],
  path: string
) {
  const snapshot = snapshots.find((entry) => entry.path === path);
  if (!snapshot) throw new Error(`Missing captured storage snapshot for ${path}.`);
  applied.push(snapshot);
}

async function rollbackOrError<Error extends MutationError>(
  workbench: ConnectedWorkbenchCatalog,
  snapshots: readonly StorageSnapshot[],
  originalError: Error
): Promise<{ ok: false; error: Error | CatalogRollbackError<Error> }> {
  const rollbackErrors: WorkbenchProjectStorageError[] = [];
  for (const snapshot of [...snapshots].reverse()) {
    const restored = snapshot.contents === null
      ? await deleteStorageText(workbench, snapshot.path)
      : await writeStorageText(workbench, snapshot.path, snapshot.contents);
    if (!restored.ok) rollbackErrors.push(restored.error);
  }
  if (rollbackErrors.length === 0) return { ok: false, error: originalError };
  return {
    ok: false,
    error: {
      code: 'WORKBENCH_CATALOG_MUTATION_ROLLBACK_FAILED',
      message: `Workbench project mutation failed and ${rollbackErrors.length} rollback operation(s) also failed.`,
      originalError,
      rollbackErrors
    }
  };
}

async function writeProjectDocument(
  workbench: ConnectedWorkbenchCatalog,
  path: string,
  project: WorkbenchProjectDocument
) {
  return writeStorageText(workbench, path, `${JSON.stringify(project, null, 2)}\n`);
}

async function writeStorageText(workbench: ConnectedWorkbenchCatalog, path: string, contents: string) {
  try {
    await workbench.adapter.writeText(path, contents);
    return { ok: true as const };
  } catch (error) {
    return projectAccessFailure('write', path, error);
  }
}

async function deleteStorageText(workbench: ConnectedWorkbenchCatalog, path: string) {
  try {
    await workbench.adapter.deleteText(path);
    return { ok: true as const };
  } catch (error) {
    return projectAccessFailure('delete', path, error);
  }
}

async function writeManifest(
  workbench: ConnectedWorkbenchCatalog,
  manifest: WorkbenchCatalogManifest
) {
  try {
    await workbench.adapter.writeText(WORKBENCH_CATALOG_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    return { ok: true as const };
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    return {
      ok: false as const,
      error: {
        code: 'WORKBENCH_CATALOG_MUTATION_MANIFEST_WRITE_FAILED' as const,
        message: `Workbench manifest write failed at ${WORKBENCH_CATALOG_PATH}: ${cause}`,
        path: WORKBENCH_CATALOG_PATH as typeof WORKBENCH_CATALOG_PATH
      }
    };
  }
}

function withProjectEntry(
  manifest: WorkbenchCatalogManifest,
  project: WorkbenchProjectDocument,
  path: string
) {
  return deepFreeze({
    ...manifest,
    updatedAt: project.updatedAt,
    projects: [...manifest.projects, projectEntry(project, path)]
  } satisfies WorkbenchCatalogManifestValue);
}

function replaceProjectEntry(
  manifest: WorkbenchCatalogManifest,
  project: WorkbenchProjectDocument,
  path: string
) {
  return deepFreeze({
    ...manifest,
    updatedAt: project.updatedAt,
    projects: manifest.projects.map((entry) => entry.id === project.id ? projectEntry(project, path) : entry)
  } satisfies WorkbenchCatalogManifestValue);
}

function projectEntry(project: WorkbenchProjectDocument, path: string) {
  return {
    id: project.id,
    name: project.name,
    path,
    sourceKind: project.source.kind,
    updatedAt: project.updatedAt
  };
}

function projectNotFound(projectId: string) {
  return {
    ok: false as const,
    error: {
      code: 'WORKBENCH_CATALOG_PROJECT_NOT_FOUND' as const,
      message: `Workbench project is not indexed: ${projectId}.`,
      projectId
    }
  };
}

function projectConflict(projectId: string, path: string, reason: string) {
  return {
    ok: false as const,
    error: {
      code: 'WORKBENCH_CATALOG_PROJECT_CONFLICT' as const,
      message: `Cannot store project ${projectId} at ${path}; ${reason} already exists.`,
      projectId,
      path
    }
  };
}

function ownedFilePlanInvalid(path: string, reason: string): OwnedFilePlanError {
  return {
    code: 'WORKBENCH_CATALOG_OWNED_FILE_PLAN_INVALID',
    message: `Owned-file change for ${path} is invalid: ${reason}.`,
    path
  };
}

function ownedFileDangling(projectId: string, path: string): OwnedFileDanglingError {
  return {
    code: 'WORKBENCH_CATALOG_OWNED_FILE_DANGLING',
    message: `Project ${projectId} owns a missing source file: ${path}.`,
    projectId,
    path
  };
}

function revisionPlanInvalid(projectId: string): RevisionPlanError {
  return {
    code: 'WORKBENCH_CATALOG_REVISION_PLAN_INVALID',
    message: `Project ${projectId} revision IDs may change only through the atomic saved-revision mutation.`,
    projectId
  };
}

function projectPathCollision(
  project: WorkbenchProjectDocument,
  existingProjects: readonly WorkbenchProjectDocument[]
): Extract<
  WorkbenchProjectIndexIntegrityError,
  { code: 'WORKBENCH_CATALOG_PROJECT_PATH_COLLISION' }
> | null {
  const ownerByPath = new Map<string, string>();
  for (const existing of existingProjects) {
    for (const path of workbenchProjectOwnedPaths(existing)) ownerByPath.set(path, existing.id);
  }
  for (const path of workbenchProjectOwnedPaths(project)) {
    const firstProjectId = ownerByPath.get(path);
    if (firstProjectId !== undefined) {
      return {
        code: 'WORKBENCH_CATALOG_PROJECT_PATH_COLLISION',
        message: `Workbench path ${path} is claimed by both ${firstProjectId} and ${project.id}.`,
        path,
        firstProjectId,
        secondProjectId: project.id
      };
    }
    ownerByPath.set(path, project.id);
  }
  return null;
}

function manifestStateFailure(code: ManifestStateError['code'], message: string) {
  return {
    ok: false as const,
    error: { code, message, path: WORKBENCH_CATALOG_PATH as typeof WORKBENCH_CATALOG_PATH }
  };
}

function projectAccessFailure(
  operation: 'read' | 'write' | 'delete',
  path: string,
  error: unknown
) {
  const cause = error instanceof Error ? error.message : String(error);
  return {
    ok: false as const,
    error: {
      code: 'WORKBENCH_PROJECT_STORAGE_ACCESS_FAILED' as const,
      message: `Workbench project ${operation} failed at ${path}: ${cause}`,
      operation,
      path
    }
  };
}

function freezeWorkbench(
  workbench: ConnectedWorkbenchCatalog,
  manifest: WorkbenchCatalogManifest
) {
  return Object.freeze({ ...workbench, manifest });
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((entry) => deepFreeze(entry));
  }
  return value;
}
