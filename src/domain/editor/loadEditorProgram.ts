import type { PathPlanningDocument } from '@/domain/path-intel/types';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import {
  readStoredWorkbenchProject,
  type ReadStoredWorkbenchProjectError
} from '@/domain/workbench-catalog/workbenchCatalogMutations';
import type { WorkbenchProjectDocument } from '@/domain/workbench-catalog/workbenchProject';
import { workbenchProjectDocumentPath } from '@/domain/workbench-catalog/workbenchProjectStorage';

import { parseGCodeProgram } from './gcodeParser';
import type { GCodeParseResult } from './types';

export type LoadedEditorProgram = LoadedGCodeEditorProgram | LoadedUpidEditorProgram;

interface LoadedEditorProgramBase {
  readonly filePath: string;
  readonly project: WorkbenchProjectDocument;
}

export interface LoadedGCodeEditorProgram extends LoadedEditorProgramBase {
  readonly model: 'gcode-text';
  readonly parseResult: GCodeParseResult;
  readonly text: string;
}

export interface LoadedUpidEditorProgram extends LoadedEditorProgramBase {
  readonly model: 'upid-document';
  readonly parseResult: null;
  readonly pathDocument: PathPlanningDocument;
  readonly text: '';
}

export type LoadEditorProgramError =
  | ReadStoredWorkbenchProjectError
  | {
      readonly code: 'EDITOR_PROGRAM_STORAGE_ACCESS_FAILED';
      readonly message: string;
      readonly path: string;
    }
  | {
      readonly code: 'EDITOR_PROGRAM_FILE_NOT_FOUND';
      readonly message: string;
      readonly path: string;
    };

export type LoadEditorProgramResult =
  | { readonly ok: true; readonly editorProgram: LoadedEditorProgram }
  | { readonly ok: false; readonly error: LoadEditorProgramError };

export async function loadEditorProgram(
  workbench: ConnectedWorkbenchCatalog,
  projectId: string
): Promise<LoadEditorProgramResult> {
  const read = await readStoredWorkbenchProject(workbench, projectId);
  if (!read.ok) return read;
  const project = read.project;
  if (project.content.kind === 'upid-document') {
    return {
      ok: true,
      editorProgram: {
        filePath: workbenchProjectDocumentPath(project.id),
        model: 'upid-document',
        pathDocument: project.content.document as PathPlanningDocument,
        parseResult: null,
        text: '',
        project
      }
    };
  }

  const path = project.content.activeFilePath;
  let text: string | null;
  try {
    text = await workbench.adapter.readText(path);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'EDITOR_PROGRAM_STORAGE_ACCESS_FAILED',
        message: `Could not read editor program ${path}: ${errorMessage(error)}.`,
        path
      }
    };
  }
  if (text === null) {
    return {
      ok: false,
      error: {
        code: 'EDITOR_PROGRAM_FILE_NOT_FOUND',
        message: `Catalog-owned editor program is missing: ${path}.`,
        path
      }
    };
  }
  return {
    ok: true,
    editorProgram: {
      filePath: path,
      model: 'gcode-text',
      parseResult: parseGCodeProgram(text),
      text,
      project
    }
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
