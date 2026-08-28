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
