import {
  normalizeWorkbenchSimulationSettings,
  type ProjectSimulationSettings,
  type WorkbenchSimulationSettings
} from '@/domain/simulation/simulationConfig';
import type { WorkbenchProject } from '@/domain/workbench/types';

import {
  writeWorkbenchManifest,
  type ConnectedWorkbench,
  type WorkbenchManifest
} from './workbenchStorage';

export interface UpdateProjectSimulationSettingsResult {
  project: WorkbenchProject;
  workbench: ConnectedWorkbench;
}

export async function updateProjectSimulationSettings(
  workbench: ConnectedWorkbench,
  projectId: string,
  settings: ProjectSimulationSettings,
  now: Date = new Date()
): Promise<UpdateProjectSimulationSettingsResult> {
  const projectEntry = workbench.manifest.projects.find((entry) => entry.id === projectId);
  if (!projectEntry) {
    throw new Error(`Project index entry not found: ${projectId}`);
  }

  const projectText = await workbench.adapter.readText(projectEntry.path);
  if (projectText === null) {
    throw new Error(`Workbench project file not found: ${projectEntry.path}`);
  }

  const project = parseProject(projectText, projectEntry.path);
  if (project.id !== projectId) {
    throw new Error(`Workbench project ID does not match its index entry: ${projectEntry.path}`);
  }

  const updatedProject: WorkbenchProject = {
    ...project,
    updatedAt: now.toISOString(),
    simulation: settings
  };

  await workbench.adapter.writeText(
    projectEntry.path,
    JSON.stringify(updatedProject, null, 2)
  );

  return {
    project: updatedProject,
    workbench
  };
}

export async function updateWorkbenchSimulationSettings(
  workbench: ConnectedWorkbench,
  settings: WorkbenchSimulationSettings,
  now: Date = new Date()
): Promise<ConnectedWorkbench> {
  const simulation = normalizeWorkbenchSimulationSettings(
    settings,
    workbench.manifest.machineProfiles
  );
  const manifest: WorkbenchManifest = {
    ...workbench.manifest,
    updatedAt: now.toISOString(),
    simulation
  };

  await writeWorkbenchManifest(workbench.adapter, manifest);

  return {
    ...workbench,
    manifest
  };
}

function parseProject(text: string, path: string): WorkbenchProject {
  try {
    const project = JSON.parse(text) as WorkbenchProject;
    if (project.schemaVersion !== 1) {
      throw new Error('Unsupported project schema version.');
    }
    return project;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Workbench project file is not valid JSON: ${path}`);
    }
    throw error;
  }
}
