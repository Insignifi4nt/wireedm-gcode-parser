import { withWorkbenchMutationLock } from '@/domain/storage/workbenchMutationLock';

import {
  WORKBENCH_CATALOG_PATH,
  type ConnectedWorkbenchCatalog,
  type WorkbenchCatalogManifest,
  type WorkbenchCatalogManifestValue
} from './workbenchCatalog';
import type { WorkbenchProjectDocument } from './workbenchProject';
import {
  deleteWorkbenchProjectStorage,
  readWorkbenchProjectStorage,
  writeWorkbenchProjectStorage,
  type WorkbenchProjectStorageError
} from './workbenchProjectStorage';

type CatalogMutationAccessError = Extract<
  WorkbenchProjectStorageError,
  { code: 'WORKBENCH_PROJECT_STORAGE_ACCESS_FAILED' }
> | {
  code: 'WORKBENCH_CATALOG_MUTATION_MANIFEST_WRITE_FAILED';
  message: string;
  path: typeof WORKBENCH_CATALOG_PATH;
};

type CatalogRollbackError = {
  code: 'WORKBENCH_CATALOG_MUTATION_ROLLBACK_FAILED';
  message: string;
  originalError: CatalogMutationAccessError;
  rollbackError: CatalogMutationAccessError;
};

export type AddStoredWorkbenchProjectResult =
  | { ok: true; workbench: ConnectedWorkbenchCatalog; project: WorkbenchProjectDocument }
  | {
      ok: false;
      error:
        | WorkbenchProjectStorageError
        | CatalogMutationAccessError
        | CatalogRollbackError
        | {
            code: 'WORKBENCH_CATALOG_PROJECT_CONFLICT';
            message: string;
            projectId: string;
            path: string;
          };
    };

export type ReplaceStoredWorkbenchProjectResult =
  | { ok: true; workbench: ConnectedWorkbenchCatalog; project: WorkbenchProjectDocument }
  | {
      ok: false;
      error:
        | WorkbenchProjectStorageError
        | CatalogMutationAccessError
        | CatalogRollbackError
        | {
            code: 'WORKBENCH_CATALOG_PROJECT_NOT_FOUND';
            message: string;
            projectId: string;
          }
        | {
            code: 'WORKBENCH_CATALOG_PROJECT_ID_MISMATCH';
            message: string;
            expectedProjectId: string;
            actualProjectId: string;
          };
    };

export type DeleteStoredWorkbenchProjectResult =
  | { ok: true; workbench: ConnectedWorkbenchCatalog; deleted: WorkbenchProjectDocument }
  | {
      ok: false;
      error:
        | WorkbenchProjectStorageError
        | CatalogMutationAccessError
        | CatalogRollbackError
        | {
            code: 'WORKBENCH_CATALOG_PROJECT_NOT_FOUND';
            message: string;
            projectId: string;
          };
    };

export async function addStoredWorkbenchProject(
  workbench: ConnectedWorkbenchCatalog,
  project: WorkbenchProjectDocument
): Promise<AddStoredWorkbenchProjectResult> {
  return withWorkbenchMutationLock(workbench.adapter, async () => {
    const path = projectPath(project.id);
    const conflict = workbench.manifest.projects.find(
      (entry) => entry.id === project.id || entry.path === path
    );
    if (conflict) {
      return {
        ok: false,
        error: {
          code: 'WORKBENCH_CATALOG_PROJECT_CONFLICT',
          message: `Workbench project conflicts with ${conflict.id} at ${conflict.path}.`,
          projectId: project.id,
          path
        }
      };
    }
    let existing: string | null;
    try {
      existing = await workbench.adapter.readText(path);
    } catch (error) {
      return projectAccessFailure('read', path, error);
    }
    if (existing !== null) {
      return {
        ok: false,
        error: {
          code: 'WORKBENCH_CATALOG_PROJECT_CONFLICT',
          message: `Unindexed project storage already exists at ${path}.`,
          projectId: project.id,
          path
        }
      };
    }

    const written = await writeWorkbenchProjectStorage(workbench.adapter, path, project);
    if (!written.ok) return written;
    const nextManifest = withProjectEntry(workbench.manifest, project, path);
    const manifestWrite = await writeManifest(workbench, nextManifest);
    if (!manifestWrite.ok) {
      const rollback = await deleteWorkbenchProjectStorage(workbench.adapter, path);
      if (!rollback.ok) return rollbackFailure(manifestWrite.error, rollback.error);
      return manifestWrite;
    }
    return {
      ok: true,
      project,
      workbench: freezeWorkbench(workbench, nextManifest)
    };
  });
}

export async function replaceStoredWorkbenchProject(
  workbench: ConnectedWorkbenchCatalog,
  project: WorkbenchProjectDocument
): Promise<ReplaceStoredWorkbenchProjectResult> {
  return withWorkbenchMutationLock(workbench.adapter, async () => {
    const entry = workbench.manifest.projects.find(({ id }) => id === project.id);
    if (!entry) return projectNotFound(project.id);
    const previous = await readWorkbenchProjectStorage(workbench.adapter, entry.path);
    if (!previous.ok) return previous;
    if (previous.project.id !== project.id) {
      return {
        ok: false,
        error: {
          code: 'WORKBENCH_CATALOG_PROJECT_ID_MISMATCH',
          message: `Project ${entry.path} contains ${previous.project.id}, expected ${project.id}.`,
          expectedProjectId: project.id,
          actualProjectId: previous.project.id
        }
      };
    }
    const written = await writeWorkbenchProjectStorage(workbench.adapter, entry.path, project);
    if (!written.ok) return written;
    const nextManifest = replaceProjectEntry(workbench.manifest, project, entry.path);
    const manifestWrite = await writeManifest(workbench, nextManifest);
    if (!manifestWrite.ok) {
      const rollback = await writeWorkbenchProjectStorage(
        workbench.adapter,
        entry.path,
        previous.project
      );
      if (!rollback.ok) return rollbackFailure(manifestWrite.error, rollback.error);
      return manifestWrite;
    }
    return {
      ok: true,
      project,
      workbench: freezeWorkbench(workbench, nextManifest)
    };
  });
}

export async function deleteStoredWorkbenchProject(
  workbench: ConnectedWorkbenchCatalog,
  projectId: string,
  deletedAt: Date
): Promise<DeleteStoredWorkbenchProjectResult> {
  return withWorkbenchMutationLock(workbench.adapter, async () => {
    const entry = workbench.manifest.projects.find(({ id }) => id === projectId);
    if (!entry) return projectNotFound(projectId);
    const previous = await readWorkbenchProjectStorage(workbench.adapter, entry.path);
    if (!previous.ok) return previous;
    const nextManifest = deepFreeze({
      ...workbench.manifest,
      updatedAt: deletedAt.toISOString(),
      projects: workbench.manifest.projects.filter(({ id }) => id !== projectId)
    } satisfies WorkbenchCatalogManifestValue);
    const manifestWrite = await writeManifest(workbench, nextManifest);
    if (!manifestWrite.ok) return manifestWrite;
    const deleted = await deleteWorkbenchProjectStorage(workbench.adapter, entry.path);
    if (!deleted.ok) {
      const rollback = await writeManifest(workbench, workbench.manifest);
      if (!rollback.ok) return rollbackFailure(deleted.error, rollback.error);
      return deleted;
    }
    return {
      ok: true,
      deleted: previous.project,
      workbench: freezeWorkbench(workbench, nextManifest)
    };
  });
}

function projectPath(projectId: string) {
  return `projects/${projectId}.json`;
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
    projects: manifest.projects.map((entry) =>
      entry.id === project.id ? projectEntry(project, path) : entry
    )
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

async function writeManifest(
  workbench: ConnectedWorkbenchCatalog,
  manifest: WorkbenchCatalogManifest
) {
  try {
    await workbench.adapter.writeText(
      WORKBENCH_CATALOG_PATH,
      `${JSON.stringify(manifest, null, 2)}\n`
    );
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

function rollbackFailure(
  originalError: CatalogMutationAccessError,
  rollbackError: CatalogMutationAccessError
) {
  return {
    ok: false as const,
    error: {
      code: 'WORKBENCH_CATALOG_MUTATION_ROLLBACK_FAILED' as const,
      message: `Workbench project mutation failed and rollback also failed: ${rollbackError.message}`,
      originalError,
      rollbackError
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
