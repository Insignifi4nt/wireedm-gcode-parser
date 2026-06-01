import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import {
  WORKBENCH_MANIFEST_FILE,
  type WorkbenchManifest
} from '@/domain/storage/workbenchStorage';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import {
  projectUpidDocument,
  withProjectUpid
} from '@/domain/upid/projectUpid';
import type { WorkbenchProject } from '@/domain/workbench/types';

import { upidEditorDocumentPath } from './editorProjectPaths';
import { parseGCodeProgram } from './gcodeParser';
import type { LoadedEditorProgram } from './loadEditorProgram';

export interface SaveEditorProgramInput {
  filePath: string;
  now?: Date;
  pathDocument?: PathPlanningDocument | null;
  project?: WorkbenchProject;
  text: string;
}

export interface SaveEditorProgramResult {
  editorProgram: LoadedEditorProgram;
  workbench: ConnectedWorkbench;
}

export async function saveEditorProgram(
  workbench: ConnectedWorkbench,
  input: SaveEditorProgramInput
): Promise<SaveEditorProgramResult> {
  if (input.project && projectUpidDocument(input.project) && !input.pathDocument) {
    throw new Error('UPID path projects must be saved with a path document.');
  }

  const savesPathDocument = Boolean(input.project && input.pathDocument);
  const textToSave = savesPathDocument ? '' : input.text;

  if (!savesPathDocument) {
    const existingText = await workbench.adapter.readText(input.filePath);
    if (existingText === null) {
      throw new Error(`Editor program file not found: ${input.filePath}`);
    }

    await workbench.adapter.writeText(input.filePath, textToSave);
  }

  const projectSave = savesPathDocument ? await saveProjectPathState(workbench, input) : null;
  const updatedWorkbench = projectSave?.workbench ?? workbench;
  const updatedProject = projectSave?.project ?? input.project;
  const editorFilePath =
    savesPathDocument && updatedProject
      ? upidEditorDocumentPath(updatedWorkbench, updatedProject)
      : input.filePath;
  const editorProgram: LoadedEditorProgram =
    savesPathDocument && input.pathDocument
      ? {
          filePath: editorFilePath,
          model: 'upid-document',
          pathDocument: input.pathDocument,
          parseResult: null,
          project: updatedProject,
          text: ''
        }
      : {
          filePath: editorFilePath,
          model: 'gcode-text',
          parseResult: parseGCodeProgram(textToSave),
          project: updatedProject,
          text: textToSave
        };

  return {
    workbench: updatedWorkbench,
    editorProgram
  };
}

async function saveProjectPathState(
  workbench: ConnectedWorkbench,
  input: SaveEditorProgramInput
) {
  if (!input.project || !input.pathDocument) return null;

  const timestamp = (input.now ?? new Date()).toISOString();
  const projectEntry = workbench.manifest.projects.find((entry) => entry.id === input.project?.id);
  if (!projectEntry) {
    throw new Error(`Project index entry not found: ${input.project.id}`);
  }

  let nextProject: WorkbenchProject = {
    ...input.project,
    updatedAt: timestamp
  };

  nextProject = withProjectUpid(
    {
      ...nextProject,
      editor: {
        ...nextProject.editor,
        activeFilePath: null
      }
    },
    input.pathDocument
  );

  await workbench.adapter.writeText(projectEntry.path, JSON.stringify(nextProject, null, 2));

  const updatedManifest: WorkbenchManifest = {
    ...workbench.manifest,
    updatedAt: timestamp,
    projects: workbench.manifest.projects.map((entry) =>
      entry.id === nextProject.id
        ? {
            ...entry,
            name: nextProject.name,
            sourceKind: nextProject.source.kind,
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
    project: nextProject,
    workbench: {
      ...workbench,
      manifest: updatedManifest
    }
  };
}
