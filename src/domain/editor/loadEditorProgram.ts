import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
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
  const filePath = project.editor.activeFilePath ?? project.generated.files.at(-1)?.path;
  if (!filePath) {
    throw new Error('Project does not reference a generated program for the editor.');
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
