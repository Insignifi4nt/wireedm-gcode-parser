import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { projectNameError } from '@/domain/workbench-catalog/projectName';
import {
  readStoredWorkbenchProject,
  replaceStoredWorkbenchProject,
  type ReadStoredWorkbenchProjectError,
  type ReplaceStoredWorkbenchProjectResult
} from '@/domain/workbench-catalog/workbenchCatalogMutations';
import {
  parseWorkbenchProjectDocument,
  type WorkbenchProjectDocument,
  type WorkbenchProjectError
} from '@/domain/workbench-catalog/workbenchProject';

export interface RenameWorkbenchProjectInput {
  readonly projectId: string;
  readonly name: string;
  readonly now?: Date;
}

export type RenameWorkbenchProjectError =
  | WorkbenchProjectError
  | ReadStoredWorkbenchProjectError
  | Extract<ReplaceStoredWorkbenchProjectResult, { readonly ok: false }>['error']
  | { readonly code: 'WORKBENCH_PROJECT_NAME_INVALID'; readonly message: string }
  | { readonly code: 'WORKBENCH_PROJECT_RENAME_TIMESTAMP_INVALID'; readonly message: string };

export type RenameWorkbenchProjectResult =
  | {
      readonly ok: true;
      readonly project: WorkbenchProjectDocument;
      readonly workbench: ConnectedWorkbenchCatalog;
    }
  | { readonly ok: false; readonly error: RenameWorkbenchProjectError };

export async function renameWorkbenchProject(
  workbench: ConnectedWorkbenchCatalog,
  input: RenameWorkbenchProjectInput
): Promise<RenameWorkbenchProjectResult> {
  const name = input.name.trim();
  const nameError = projectNameError(input.name);
  if (nameError) {
    return {
      ok: false,
      error: {
        code: 'WORKBENCH_PROJECT_NAME_INVALID',
        message: nameError
      }
    };
  }
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return {
      ok: false,
      error: {
        code: 'WORKBENCH_PROJECT_RENAME_TIMESTAMP_INVALID',
        message: 'Project rename timestamp is invalid.'
      }
    };
  }
  const read = await readStoredWorkbenchProject(workbench, input.projectId);
  if (!read.ok) return read;
  const parsed = parseWorkbenchProjectDocument(JSON.stringify({
    ...read.project,
    name,
    updatedAt: now.toISOString()
  }));
  if (!parsed.ok) return parsed;
  const replaced = await replaceStoredWorkbenchProject(workbench, {
    project: parsed.project,
    ownedFileChanges: []
  });
  if (!replaced.ok) return replaced;
  return {
    ok: true,
    project: replaced.project,
    workbench: replaced.workbench
  };
}
