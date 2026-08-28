import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import {
  addStoredWorkbenchProject,
  type AddStoredWorkbenchProjectResult
} from '@/domain/workbench-catalog/workbenchCatalogMutations';
import { importedProjectIdentity } from '@/domain/workbench-catalog/importedProjectIdentity';
import {
  createWorkbenchProjectDocument,
  type WorkbenchProjectDocument,
  type WorkbenchProjectError
} from '@/domain/workbench-catalog/workbenchProject';

import { parseGCodeProgram } from './gcodeParser';
import { stripForEditing } from './isoNormalizer';
import type { LoadedGCodeEditorProgram } from './loadEditorProgram';

const SUPPORTED_EDITOR_EXTENSIONS = ['gcode', 'nc', 'iso', 'txt'] as const;
const MAX_EDITOR_FILE_BYTES = 50 * 1024 * 1024;

export interface ImportExternalProgramInput {
  readonly fileName: string;
  readonly text: string;
  readonly now?: Date;
}

export type ImportExternalProgramError =
  | WorkbenchProjectError
  | Extract<AddStoredWorkbenchProjectResult, { readonly ok: false }>['error']
  | {
      readonly code: 'EXTERNAL_PROGRAM_EXTENSION_UNSUPPORTED';
      readonly message: string;
      readonly fileName: string;
    }
  | {
      readonly code: 'EXTERNAL_PROGRAM_TOO_LARGE';
      readonly message: string;
      readonly actualBytes: number;
      readonly maximumBytes: number;
    }
  | { readonly code: 'EXTERNAL_PROGRAM_EMPTY'; readonly message: string }
  | { readonly code: 'EXTERNAL_PROGRAM_TIMESTAMP_INVALID'; readonly message: string };

export type ImportExternalProgramResult =
  | {
      readonly ok: true;
      readonly workbench: ConnectedWorkbenchCatalog;
      readonly project: WorkbenchProjectDocument;
      readonly editorProgram: LoadedGCodeEditorProgram;
    }
  | { readonly ok: false; readonly error: ImportExternalProgramError };

export async function importExternalProgram(
  workbench: ConnectedWorkbenchCatalog,
  input: ImportExternalProgramInput
): Promise<ImportExternalProgramResult> {
  const extension = editorExtension(input.fileName);
  if (!extension) {
    return {
      ok: false,
      error: {
        code: 'EXTERNAL_PROGRAM_EXTENSION_UNSUPPORTED',
        message: `Unsupported editor file type: ${input.fileName}.`,
        fileName: input.fileName
      }
    };
  }
  const actualBytes = new TextEncoder().encode(input.text).byteLength;
  if (actualBytes > MAX_EDITOR_FILE_BYTES) {
    return {
      ok: false,
      error: {
        code: 'EXTERNAL_PROGRAM_TOO_LARGE',
        message: `External program is ${actualBytes} bytes; the maximum is ${MAX_EDITOR_FILE_BYTES}.`,
        actualBytes,
        maximumBytes: MAX_EDITOR_FILE_BYTES
      }
    };
  }
  if (actualBytes === 0) {
    return {
      ok: false,
      error: { code: 'EXTERNAL_PROGRAM_EMPTY', message: 'External program is empty.' }
    };
  }
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return {
      ok: false,
      error: {
        code: 'EXTERNAL_PROGRAM_TIMESTAMP_INVALID',
        message: 'External program import timestamp is invalid.'
      }
    };
  }
  const timestamp = now.toISOString();
  const identity = importedProjectIdentity({
    fileName: input.fileName,
    fallbackName: 'External Program',
    stripExtension: /\.[a-z0-9]+$/i,
    timestamp,
    existingIds: workbench.manifest.projects.map(({ id }) => id)
  });
  const originalPath = `imports/${identity.id}.${extension}`;
  const editablePath = `projects/${identity.id}/editable.${extension}`;
  const editorText = stripForEditing(input.text);
  const created = createWorkbenchProjectDocument({
    id: identity.id,
    name: identity.name,
    source: {
      kind: 'external-gcode',
      files: [
        {
          name: input.fileName,
          path: originalPath,
          kind: 'external-gcode',
          createdAt: timestamp
        },
        {
          name: `editable.${extension}`,
          path: editablePath,
          kind: 'external-gcode',
          createdAt: timestamp
        }
      ]
    },
    content: { kind: 'external-gcode', activeFilePath: editablePath },
    now: new Date(timestamp)
  });
  if (!created.ok) return created;
  const stored = await addStoredWorkbenchProject(workbench, {
    project: created.project,
    ownedFiles: [
      { path: originalPath, contents: input.text },
      { path: editablePath, contents: editorText }
    ]
  });
  if (!stored.ok) return stored;
  return {
    ok: true,
    workbench: stored.workbench,
    project: stored.project,
    editorProgram: {
      filePath: editablePath,
      model: 'gcode-text',
      text: editorText,
      parseResult: parseGCodeProgram(editorText),
      project: stored.project
    }
  };
}

function editorExtension(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase();
  return SUPPORTED_EDITOR_EXTENSIONS.find((candidate) => candidate === extension) ?? null;
}
