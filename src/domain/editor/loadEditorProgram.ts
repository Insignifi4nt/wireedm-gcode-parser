import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import { projectUpidDocument } from '@/domain/upid/projectUpid';
import type { WorkbenchProject } from '@/domain/workbench/types';

import { parseGCodeProgram } from './gcodeParser';
import type { GCodeParseResult } from './types';

export interface LoadedEditorProgram {
  filePath: string;
  text: string;
  parseResult: GCodeParseResult;
  project?: WorkbenchProject;
}

export async function loadEditorProgram(
  workbench: ConnectedWorkbench,
  project: WorkbenchProject
): Promise<LoadedEditorProgram> {
  if (projectUpidDocument(project)) {
    return createUpidEditorProgram(project);
  }

  const filePath = project.editor.activeFilePath;
  if (!filePath) {
    throw new Error('Project does not reference an editor program.');
  }

  const text = await workbench.adapter.readText(filePath);
  if (text === null) {
    throw new Error(`Editor program file not found: ${filePath}`);
  }

  return {
    filePath,
    text,
    parseResult: parseGCodeProgram(text),
    project
  };
}

function createUpidEditorProgram(project: WorkbenchProject): LoadedEditorProgram {
  return {
    filePath: project.source.files.at(-1)?.path ?? `projects/${project.id}/project.json`,
    text: '',
    parseResult: parseGCodeProgram(''),
    project
  };
}
