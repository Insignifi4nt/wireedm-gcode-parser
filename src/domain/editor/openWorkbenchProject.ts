import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import type { WorkbenchProject } from '@/domain/workbench/types';

import { loadEditorProgram, type LoadedEditorProgram } from './loadEditorProgram';

export interface OpenWorkbenchProjectResult {
  project: WorkbenchProject;
  editorProgram: LoadedEditorProgram;
}

export async function openWorkbenchProject(
  workbench: ConnectedWorkbench,
  projectPath: string
): Promise<OpenWorkbenchProjectResult> {
  const projectText = await workbench.adapter.readText(projectPath);
  if (projectText === null) {
    throw new Error(`Workbench project file not found: ${projectPath}`);
  }

  let project: WorkbenchProject;
  try {
    project = JSON.parse(projectText) as WorkbenchProject;
  } catch {
    throw new Error(`Workbench project file is not valid JSON: ${projectPath}`);
  }

  return {
    project,
    editorProgram: await loadEditorProgram(workbench, project)
  };
}
