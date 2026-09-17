import { withWorkbenchMutationLock } from '@/domain/storage/workbenchMutationLock';
import { parseSavedWireEdmJobRevision } from '@/domain/wire-edm-job/savedWireEdmJobRevision';
import { commitProjectPurgeTransaction, commitProjectTrashTransaction, recoverProjectTrashTransaction, type ProjectTrashTransactionError } from '@/domain/storage/projectTrashTransaction';
import { recoverSavedRevisionTransaction, type SavedRevisionTransactionError } from '@/domain/storage/savedRevisionTransaction';

import {
  WORKBENCH_CATALOG_PATH,
  parseWorkbenchCatalogManifest,
  type WorkbenchCatalogManifestError,
  type ConnectedWorkbenchCatalog,
  type WorkbenchCatalogManifest
} from './workbenchCatalog';
import { serializeWorkbenchProjectDocument, type WorkbenchProjectDocument } from './workbenchProject';
import {
  readIndexedWorkbenchProjectStorage,
  readWorkbenchProjectStorage,
  validateWorkbenchProjectPathOwnership,
  workbenchProjectDocumentPath,
  workbenchProjectRevisionPath,
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
  readonly expectedContent?: WorkbenchProjectDocument['content'];
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

type ProjectContentChangedError = { code: 'WORKBENCH_PROJECT_CONTENT_CHANGED'; message: string };

type MutationError =
  | ProjectContentChangedError
  | WorkbenchCatalogManifestError
  | ProjectTrashTransactionError
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
  | WorkbenchCatalogManifestError
  | ProjectTrashTransactionError
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
  | ProjectContentChangedError
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
    const conflict = [...workbench.manifest.projects, ...(workbench.manifest.deletedProjects ?? []).map(({ project }) => project)].find(
      (entry) => entry.id === input.project.id || entry.path === path
    );
    if (conflict) return projectConflict(input.project.id, path, `indexed project ${conflict.id}`);
    const serialized = serializeWorkbenchProjectDocument(input.project);
    if (!serialized.ok) return serialized;

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
    const documentWrite = await writeStorageText(workbench, path, serialized.text);
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
    if (input.expectedContent && JSON.stringify(input.expectedContent) !== JSON.stringify(previous.project.content)) {
      return { ok: false, error: { code: 'WORKBENCH_PROJECT_CONTENT_CHANGED', message: 'The saved project changed before the edit could be committed. Reopen the project.' } };
    }
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
    const serialized = serializeWorkbenchProjectDocument(input.project);
    if (!serialized.ok) return serialized;

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
    const documentWrite = await writeStorageText(workbench, entry.path, serialized.text);
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
    const ownedPaths = workbenchProjectOwnedPaths(previous.project);
    const snapshots = await captureSnapshots(
      workbench,
      [...ownedPaths, WORKBENCH_CATALOG_PATH]
    );
    if (!snapshots.ok) return snapshots;
    const dangling = snapshots.snapshots.find(
      (snapshot) => ownedPaths.includes(snapshot.path) && snapshot.contents === null
    );
    if (dangling) return { ok: false, error: ownedFileDangling(input.projectId, dangling.path) };

    const nextManifest = deepFreeze({
      ...workbench.manifest,
      updatedAt: input.deletedAt.toISOString(),
      projects: workbench.manifest.projects.filter(({ id }) => id !== input.projectId),
      deletedProjects: [...(workbench.manifest.deletedProjects ?? []), {
        project: entry, deletedAt: input.deletedAt.toISOString()
      }]
    } satisfies WorkbenchCatalogManifest);
    const manifestWrite = await writeTrashManifest(workbench, nextManifest);
    if (!manifestWrite.ok) return manifestWrite;
    return {
      ok: true,
      deleted: previous.project,
      workbench: freezeWorkbench(workbench, nextManifest)
    };
  });
}

export async function restoreStoredWorkbenchProject(
  workbench: ConnectedWorkbenchCatalog,
  input: { readonly projectId: string; readonly restoredAt?: Date }
): Promise<
  | { readonly ok: true; readonly workbench: ConnectedWorkbenchCatalog; readonly project: WorkbenchProjectDocument }
  | { readonly ok: false; readonly error: DeleteStoredWorkbenchProjectError | ProjectConflictError }
> {
  return withWorkbenchMutationLock(workbench.adapter, async () => {
    const current = await verifyManifestCurrent(workbench);
    if (!current.ok) return current;
    const restoredAt = input.restoredAt ?? new Date();
    if (!Number.isFinite(restoredAt.getTime())) return { ok: false, error: {
      code: 'WORKBENCH_CATALOG_MUTATION_TIMESTAMP_INVALID', projectId: input.projectId,
      message: 'Project restoration requires a valid timestamp.'
    } };
    const entry = workbench.manifest.deletedProjects?.find(({ project }) => project.id === input.projectId);
    if (!entry) return projectNotFound(input.projectId);
    if (workbench.manifest.projects.some(({ id }) => id === input.projectId)) {
      return projectConflict(input.projectId, entry.project.path, 'an active project');
    }
    const ownership = await validateWorkbenchProjectPathOwnership(workbench.adapter, [
      ...workbench.manifest.projects, entry.project
    ]);
    if (!ownership.ok) return ownership;
    const read = await readIndexedWorkbenchProjectStorage(workbench.adapter, entry.project);
    if (!read.ok) return read;
    for (const path of workbenchProjectOwnedPaths(read.project)) {
      try {
        if (await workbench.adapter.readText(path) === null) {
          return { ok: false, error: ownedFileDangling(input.projectId, path) };
        }
      } catch (error) { return projectAccessFailure('read', path, error); }
    }
    for (const revisionId of read.project.savedRevisionIds) {
      const path = workbenchProjectRevisionPath(read.project.id, revisionId);
      try {
        const raw = await workbench.adapter.readText(path);
        if (raw === null) return { ok: false, error: ownedFileDangling(input.projectId, path) };
        const parsed = await parseSavedWireEdmJobRevision(raw);
        if (!parsed.ok || parsed.candidate.revisionId !== revisionId || parsed.candidate.project.id !== input.projectId) {
          return { ok: false, error: {
            code: 'WORKBENCH_PROJECT_SCHEMA_INVALID', path,
            message: `Cannot restore project because saved revision ${revisionId} is invalid or belongs to another project.`
          } };
        }
      } catch (error) { return projectAccessFailure('read', path, error); }
    }
    const nextManifest = deepFreeze({
      ...workbench.manifest, updatedAt: restoredAt.toISOString(),
      projects: [...workbench.manifest.projects, entry.project],
      deletedProjects: workbench.manifest.deletedProjects?.filter(({ project }) => project.id !== input.projectId) ?? []
    } satisfies WorkbenchCatalogManifest);
    const committed = await writeTrashManifest(workbench, nextManifest);
    if (!committed.ok) return committed;
    return { ok: true, workbench: freezeWorkbench(workbench, nextManifest), project: read.project };
  });
}

/** Remove an archived project and every file declared as belonging to it. */
export async function purgeArchivedWorkbenchProject(
  workbench: ConnectedWorkbenchCatalog,
  input: { readonly projectId: string; readonly deletedAt?: Date }
): Promise<
  | { readonly ok: true; readonly workbench: ConnectedWorkbenchCatalog }
  | { readonly ok: false; readonly error: DeleteStoredWorkbenchProjectError }
> {
  return withWorkbenchMutationLock(workbench.adapter, async () => {
    const current = await verifyManifestCurrent(workbench);
    if (!current.ok) return current;
    const deletedAt = input.deletedAt ?? new Date();
    if (!Number.isFinite(deletedAt.getTime())) return { ok: false, error: {
      code: 'WORKBENCH_CATALOG_MUTATION_TIMESTAMP_INVALID', projectId: input.projectId,
      message: 'Permanent deletion requires a valid timestamp.'
    } };
    const entry = workbench.manifest.deletedProjects?.find(({ project }) => project.id === input.projectId);
    if (!entry) return projectNotFound(input.projectId);
    const targetProjectRead = await readWorkbenchProjectStorage(workbench.adapter, entry.project.path);
    if (!targetProjectRead.ok) return targetProjectRead;
    const allowedMissing = targetProjectRead.project.id === input.projectId &&
      entry.project.path === workbenchProjectDocumentPath(input.projectId)
      ? new Set(workbenchProjectOwnedPaths(targetProjectRead.project)) : new Set<string>();
    const ownership = await validateWorkbenchProjectPathOwnership(workbench.adapter, [
      ...workbench.manifest.projects,
      ...(workbench.manifest.deletedProjects ?? []).map(({ project }) => project)
    ], allowedMissing);
    if (!ownership.ok) return ownership;
    const project = ownership.projects.find(({ id }) => id === input.projectId);
    if (!project) return projectNotFound(input.projectId);
    const ownedPaths = workbenchProjectOwnedPaths(project);
    const nextManifest = deepFreeze({
      ...workbench.manifest,
      updatedAt: deletedAt.toISOString(),
      deletedProjects: workbench.manifest.deletedProjects?.filter(({ project }) => project.id !== input.projectId) ?? []
    } satisfies WorkbenchCatalogManifest);
    const raw = `${JSON.stringify(nextManifest, null, 2)}\n`;
    const parsed = parseWorkbenchCatalogManifest(raw, workbench.machines);
    if (!parsed.ok) return parsed;
    const committed = await commitProjectPurgeTransaction(workbench.adapter, {
      projectId: input.projectId, ownedPaths, next: raw
    });
    if (!committed.ok) return committed;
    return { ok: true, workbench: freezeWorkbench(workbench, nextManifest) };
  });
}

async function writeTrashManifest(workbench: ConnectedWorkbenchCatalog, manifest: WorkbenchCatalogManifest) {
  const raw = `${JSON.stringify(manifest, null, 2)}\n`;
  const parsed = parseWorkbenchCatalogManifest(raw, workbench.machines);
  if (!parsed.ok) return parsed;
  return commitProjectTrashTransaction(workbench.adapter, raw);
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
  const recoveredTrash = await recoverProjectTrashTransaction(workbench.adapter);
  if (!recoveredTrash.ok) return recoveredTrash;
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
  } satisfies WorkbenchCatalogManifest);
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
  } satisfies WorkbenchCatalogManifest);
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
