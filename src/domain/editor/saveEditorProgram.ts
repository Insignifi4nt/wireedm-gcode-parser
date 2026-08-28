import type { PathPlanningDocument } from '@/domain/path-intel/types';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import {
  readStoredWorkbenchProject,
  replaceStoredWorkbenchProject,
  type ReadStoredWorkbenchProjectError,
  type ReplaceStoredWorkbenchProjectResult
} from '@/domain/workbench-catalog/workbenchCatalogMutations';
import {
  parseWorkbenchProjectDocument,
  type WorkbenchProjectDocument,
  type WorkbenchProjectError
} from '@/domain/workbench-catalog/workbenchProject';
import { workbenchProjectDocumentPath } from '@/domain/workbench-catalog/workbenchProjectStorage';

import { parseGCodeProgram } from './gcodeParser';
import type { LoadedEditorProgram } from './loadEditorProgram';

export type EditorSaveDraft =
  | {
      readonly model: 'gcode-text';
      readonly text: string;
    }
  | {
      readonly model: 'upid-document';
      readonly pathDocument: PathPlanningDocument;
    };

export interface SaveEditorProgramInput {
  readonly projectId: string;
  readonly draft: EditorSaveDraft;
  readonly now?: Date;
}

export type SaveEditorProgramError =
  | WorkbenchProjectError
  | ReadStoredWorkbenchProjectError
  | Extract<ReplaceStoredWorkbenchProjectResult, { readonly ok: false }>['error']
  | {
      readonly code: 'EDITOR_SAVE_MODEL_MISMATCH';
      readonly message: string;
      readonly projectModel: 'gcode-text' | 'upid-document';
      readonly draftModel: EditorSaveDraft['model'];
    }
  | { readonly code: 'EDITOR_SAVE_TIMESTAMP_INVALID'; readonly message: string };

export type SaveEditorProgramResult =
  | {
      readonly ok: true;
      readonly editorProgram: LoadedEditorProgram;
      readonly project: WorkbenchProjectDocument;
      readonly workbench: ConnectedWorkbenchCatalog;
    }
  | { readonly ok: false; readonly error: SaveEditorProgramError };

export async function saveEditorProgram(
  workbench: ConnectedWorkbenchCatalog,
  input: SaveEditorProgramInput
): Promise<SaveEditorProgramResult> {
  const read = await readStoredWorkbenchProject(workbench, input.projectId);
  if (!read.ok) return read;
  const projectModel = read.project.content.kind === 'upid-document'
    ? 'upid-document'
    : 'gcode-text';
  if (projectModel !== input.draft.model) {
    return {
      ok: false,
      error: {
        code: 'EDITOR_SAVE_MODEL_MISMATCH',
        message: `Project ${input.projectId} uses ${projectModel}, not ${input.draft.model}.`,
        projectModel,
        draftModel: input.draft.model
      }
    };
  }
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return {
      ok: false,
      error: { code: 'EDITOR_SAVE_TIMESTAMP_INVALID', message: 'Editor save timestamp is invalid.' }
    };
  }
  const updatedAt = now.toISOString();
  const nextValue = input.draft.model === 'upid-document'
    ? {
        ...read.project,
        updatedAt,
        content: {
          kind: 'upid-document' as const,
          document: jsonSnapshot(input.draft.pathDocument)
        }
      }
    : { ...read.project, updatedAt };
  const parsed = parseWorkbenchProjectDocument(JSON.stringify(nextValue));
  if (!parsed.ok) return parsed;
  const ownedFileChanges = input.draft.model === 'gcode-text' &&
    parsed.project.content.kind === 'external-gcode'
    ? [{
        kind: 'write' as const,
        path: parsed.project.content.activeFilePath,
        contents: input.draft.text
      }]
    : [];
  const replaced = await replaceStoredWorkbenchProject(workbench, {
    project: parsed.project,
    ownedFileChanges
  });
  if (!replaced.ok) return replaced;

  const editorProgram: LoadedEditorProgram = input.draft.model === 'upid-document'
    ? {
        filePath: workbenchProjectDocumentPath(replaced.project.id),
        model: 'upid-document',
        pathDocument: (replaced.project.content as {
          readonly kind: 'upid-document';
          readonly document: PathPlanningDocument;
        }).document,
        parseResult: null,
        text: '',
        project: replaced.project
      }
    : {
        filePath: ownedFileChanges[0].path,
        model: 'gcode-text',
        parseResult: parseGCodeProgram(input.draft.text),
        text: input.draft.text,
        project: replaced.project
      };
  return {
    ok: true,
    editorProgram,
    project: replaced.project,
    workbench: replaced.workbench
  };
}

function jsonSnapshot<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
