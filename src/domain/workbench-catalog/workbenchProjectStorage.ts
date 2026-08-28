import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';

import {
  parseWorkbenchProjectDocument,
  type WorkbenchProjectDocument,
  type WorkbenchProjectError
} from './workbenchProject';

export type WorkbenchProjectStorageError =
  | WorkbenchProjectError
  | {
      code: 'WORKBENCH_PROJECT_STORAGE_ACCESS_FAILED';
      message: string;
      operation: 'read' | 'write' | 'delete';
      path: string;
    }
  | {
      code: 'WORKBENCH_PROJECT_STORAGE_NOT_FOUND';
      message: string;
      path: string;
    };

export interface StoredWorkbenchProjectIndexEntry {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly sourceKind: WorkbenchProjectDocument['source']['kind'];
  readonly updatedAt: string;
}

export type WorkbenchProjectIndexIntegrityError =
  | {
      code: 'WORKBENCH_CATALOG_PROJECT_DANGLING';
      message: string;
      projectId: string;
      path: string;
    }
  | {
      code: 'WORKBENCH_CATALOG_PROJECT_INDEX_MISMATCH';
      message: string;
      projectId: string;
      field: 'id' | 'name' | 'path' | 'sourceKind' | 'updatedAt';
      expected: string;
      actual: string;
    }
  | {
      code: 'WORKBENCH_CATALOG_PROJECT_SOURCE_DANGLING';
      message: string;
      projectId: string;
      path: string;
    };

export type ReadWorkbenchProjectStorageResult =
  | { ok: true; project: WorkbenchProjectDocument }
  | { ok: false; error: WorkbenchProjectStorageError };

export async function readWorkbenchProjectStorage(
  adapter: WorkbenchStorageAdapter,
  path: string
): Promise<ReadWorkbenchProjectStorageResult> {
  let rawText: string | null;
  try {
    rawText = await adapter.readText(path);
  } catch (error) {
    return accessFailure('read', path, error);
  }
  if (rawText === null) {
    return {
      ok: false,
      error: {
        code: 'WORKBENCH_PROJECT_STORAGE_NOT_FOUND',
        message: `Workbench project file not found: ${path}.`,
        path
      }
    };
  }
  return parseWorkbenchProjectDocument(rawText);
}

export function workbenchProjectDocumentPath(projectId: string) {
  return `projects/${projectId}.json`;
}

export async function readIndexedWorkbenchProjectStorage(
  adapter: WorkbenchStorageAdapter,
  entry: StoredWorkbenchProjectIndexEntry
): Promise<
  | { ok: true; project: WorkbenchProjectDocument }
  | { ok: false; error: WorkbenchProjectStorageError | WorkbenchProjectIndexIntegrityError }
> {
  const canonicalPath = workbenchProjectDocumentPath(entry.id);
  if (entry.path !== canonicalPath) {
    return indexMismatch(entry, 'path', canonicalPath, entry.path);
  }
  const read = await readWorkbenchProjectStorage(adapter, entry.path);
  if (!read.ok) {
    if (read.error.code !== 'WORKBENCH_PROJECT_STORAGE_NOT_FOUND') return read;
    return {
      ok: false,
      error: {
        code: 'WORKBENCH_CATALOG_PROJECT_DANGLING',
        message: `Indexed workbench project file is missing: ${entry.path}.`,
        projectId: entry.id,
        path: entry.path
      }
    };
  }
  for (const [field, expected, actual] of [
    ['id', entry.id, read.project.id],
    ['name', entry.name, read.project.name],
    ['sourceKind', entry.sourceKind, read.project.source.kind],
    ['updatedAt', entry.updatedAt, read.project.updatedAt]
  ] as const) {
    if (expected !== actual) return indexMismatch(entry, field, expected, actual);
  }
  for (const sourceFile of read.project.source.files) {
    let contents: string | null;
    try {
      contents = await adapter.readText(sourceFile.path);
    } catch (error) {
      return accessFailure('read', sourceFile.path, error);
    }
    if (contents === null) {
      return {
        ok: false,
        error: {
          code: 'WORKBENCH_CATALOG_PROJECT_SOURCE_DANGLING',
          message: `Project ${entry.id} owns a missing source file: ${sourceFile.path}.`,
          projectId: entry.id,
          path: sourceFile.path
        }
      };
    }
  }
  return read;
}

export async function writeWorkbenchProjectStorage(
  adapter: WorkbenchStorageAdapter,
  path: string,
  project: WorkbenchProjectDocument
) {
  try {
    await adapter.writeText(path, `${JSON.stringify(project, null, 2)}\n`);
    return { ok: true as const };
  } catch (error) {
    return accessFailure('write', path, error);
  }
}

export async function deleteWorkbenchProjectStorage(
  adapter: WorkbenchStorageAdapter,
  path: string
) {
  try {
    await adapter.deleteText(path);
    return { ok: true as const };
  } catch (error) {
    return accessFailure('delete', path, error);
  }
}

function accessFailure(
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

function indexMismatch(
  entry: StoredWorkbenchProjectIndexEntry,
  field: Extract<
    WorkbenchProjectIndexIntegrityError,
    { code: 'WORKBENCH_CATALOG_PROJECT_INDEX_MISMATCH' }
  >['field'],
  expected: string,
  actual: string
) {
  return {
    ok: false as const,
    error: {
      code: 'WORKBENCH_CATALOG_PROJECT_INDEX_MISMATCH' as const,
      message: `Project index field ${field} for ${entry.id} is ${actual}, expected ${expected}.`,
      projectId: entry.id,
      field,
      expected,
      actual
    }
  };
}
