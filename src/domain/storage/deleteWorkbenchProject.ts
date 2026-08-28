import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import {
  deleteStoredWorkbenchProject,
  type DeleteStoredWorkbenchProjectResult
} from '@/domain/workbench-catalog/workbenchCatalogMutations';
export interface DeleteWorkbenchProjectInput {
  readonly projectId: string;
  readonly now?: Date;
}

export type DeleteWorkbenchProjectResult = DeleteStoredWorkbenchProjectResult;

export function deleteWorkbenchProject(
  workbench: ConnectedWorkbenchCatalog,
  input: DeleteWorkbenchProjectInput
): Promise<DeleteWorkbenchProjectResult> {
  return deleteStoredWorkbenchProject(workbench, {
    projectId: input.projectId,
    deletedAt: input.now ?? new Date()
  });
}
