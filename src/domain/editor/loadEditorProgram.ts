import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import { projectUpidDocument } from '@/domain/upid/projectUpid';
import type { WorkbenchProject } from '@/domain/workbench/types';

import { upidEditorDocumentPath } from './editorProjectPaths';
import { parseGCodeProgram } from './gcodeParser';
import type { GCodeParseResult } from './types';

export type LoadedEditorProgram = LoadedGCodeEditorProgram | LoadedUpidEditorProgram;

interface LoadedEditorProgramBase {
  filePath: string;
  project?: WorkbenchProject;
}

export interface LoadedGCodeEditorProgram extends LoadedEditorProgramBase {
  model: 'gcode-text';
  parseResult: GCodeParseResult;
  pathDocument?: undefined;
  text: string;
}

export interface LoadedUpidEditorProgram extends LoadedEditorProgramBase {
  model: 'upid-document';
  parseResult: null;
  pathDocument: PathPlanningDocument;
  text: '';
}

export async function loadEditorProgram(
  workbench: ConnectedWorkbench,
  project: WorkbenchProject
): Promise<LoadedEditorProgram> {
  const pathDocument = projectUpidDocument(project);
  if (pathDocument) {
    return createUpidEditorProgram(workbench, project, pathDocument);
  }

  if (project.source.kind === 'dxf') {
    throw new Error('DXF projects must contain a UPID document.');
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
    model: 'gcode-text',
    text,
    parseResult: parseGCodeProgram(text),
    project
  };
}

function createUpidEditorProgram(
  workbench: ConnectedWorkbench,
  project: WorkbenchProject,
  pathDocument: PathPlanningDocument
): LoadedEditorProgram {
  return {
    filePath: upidEditorDocumentPath(workbench, project),
    model: 'upid-document',
    pathDocument,
    parseResult: null,
    text: '',
    project
  };
}
