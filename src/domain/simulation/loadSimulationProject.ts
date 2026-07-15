import { normalizeMachineProfile } from '@/domain/machine/machineProfiles';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import { projectUpidDocument } from '@/domain/upid/projectUpid';
import type { WorkbenchProject } from '@/domain/workbench/types';
import { isPathProjectSourceKind } from '@/domain/workbench/types';

export interface LoadedSimulationProject {
  document: PathPlanningDocument;
  project: WorkbenchProject;
}

export async function loadSimulationProject(
  workbench: ConnectedWorkbench,
  projectPath: string
): Promise<LoadedSimulationProject> {
  const projectText = await workbench.adapter.readText(projectPath);
  if (projectText === null) {
    throw new Error(`Workbench project file not found: ${projectPath}`);
  }

  let parsed: WorkbenchProject;
  try {
    parsed = JSON.parse(projectText) as WorkbenchProject;
  } catch {
    throw new Error(`Workbench project file is not valid JSON: ${projectPath}`);
  }

  if (!isPathProjectSourceKind(parsed.source.kind)) {
    throw new Error('3D simulation currently supports Path Projects only.');
  }

  const project: WorkbenchProject = {
    ...parsed,
    machine: normalizeMachineProfile(parsed.machine)
  };
  const document = projectUpidDocument(project);
  if (!document) {
    throw new Error('Path Project does not contain simulation-ready UPID geometry.');
  }

  return { document, project };
}
