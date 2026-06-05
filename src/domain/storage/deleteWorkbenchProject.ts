import {
  WORKBENCH_MANIFEST_FILE,
  type ConnectedWorkbench,
  type WorkbenchManifest
} from './workbenchStorage';
import type { WorkbenchProject } from '@/domain/workbench/types';

export interface DeleteWorkbenchProjectInput {
  projectId: string;
  now?: Date;
}

export interface DeleteWorkbenchProjectResult {
  cleanupErrorMessages: string[];
  project: WorkbenchProject;
  workbench: ConnectedWorkbench;
}

export async function deleteWorkbenchProject(
  workbench: ConnectedWorkbench,
  input: DeleteWorkbenchProjectInput
): Promise<DeleteWorkbenchProjectResult> {
  const timestamp = (input.now ?? new Date()).toISOString();
  const projectEntry = workbench.manifest.projects.find((entry) => entry.id === input.projectId);
  if (!projectEntry) {
    throw new Error(`Project index entry not found: ${input.projectId}`);
  }

  const projectText = await workbench.adapter.readText(projectEntry.path);
  if (projectText === null) {
    throw new Error(`Workbench project file not found: ${projectEntry.path}`);
  }

  let project: WorkbenchProject;
  try {
    project = JSON.parse(projectText) as WorkbenchProject;
  } catch {
    throw new Error(`Workbench project file is not valid JSON: ${projectEntry.path}`);
  }

  const updatedManifest: WorkbenchManifest = {
    ...workbench.manifest,
    updatedAt: timestamp,
    projects: workbench.manifest.projects.filter((entry) => entry.id !== input.projectId)
  };

  await workbench.adapter.writeText(
    WORKBENCH_MANIFEST_FILE,
    JSON.stringify(updatedManifest, null, 2)
  );

  const ownedFileDeletes = project.source.files.map((file) => workbench.adapter.deleteText(file.path));
  if (project.editor.activeFilePath) {
    ownedFileDeletes.push(workbench.adapter.deleteText(project.editor.activeFilePath));
  }

  const cleanupResults = await Promise.allSettled([
    workbench.adapter.deleteText(projectEntry.path),
    ...ownedFileDeletes
  ]);
  const cleanupErrorMessages = cleanupResults.flatMap((result) =>
    result.status === 'rejected' ? [formatCleanupError(result.reason)] : []
  );

  return {
    cleanupErrorMessages,
    project,
    workbench: {
      ...workbench,
      manifest: updatedManifest
    }
  };
}

function formatCleanupError(error: unknown) {
  return error instanceof Error ? error.message : 'Could not delete an owned project file.';
}
