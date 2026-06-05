import {
  WORKBENCH_MANIFEST_FILE,
  type ConnectedWorkbench,
  type WorkbenchManifest
} from './workbenchStorage';
import type { WorkbenchProject } from '@/domain/workbench/types';

export interface RenameWorkbenchProjectInput {
  projectId: string;
  name: string;
  now?: Date;
}

export interface RenameWorkbenchProjectResult {
  project: WorkbenchProject;
  workbench: ConnectedWorkbench;
}

export async function renameWorkbenchProject(
  workbench: ConnectedWorkbench,
  input: RenameWorkbenchProjectInput
): Promise<RenameWorkbenchProjectResult> {
  const timestamp = (input.now ?? new Date()).toISOString();
  const nextName = input.name.trim();
  if (!nextName) {
    throw new Error('Project name cannot be empty.');
  }

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

  const updatedProject: WorkbenchProject = {
    ...project,
    name: nextName,
    updatedAt: timestamp
  };

  await workbench.adapter.writeText(projectEntry.path, JSON.stringify(updatedProject, null, 2));

  const updatedManifest: WorkbenchManifest = {
    ...workbench.manifest,
    updatedAt: timestamp,
    projects: workbench.manifest.projects.map((entry) =>
      entry.id === input.projectId
        ? {
            ...entry,
            name: nextName,
            updatedAt: timestamp
          }
        : entry
    )
  };

  await workbench.adapter.writeText(
    WORKBENCH_MANIFEST_FILE,
    JSON.stringify(updatedManifest, null, 2)
  );

  return {
    project: updatedProject,
    workbench: {
      ...workbench,
      manifest: updatedManifest
    }
  };
}
