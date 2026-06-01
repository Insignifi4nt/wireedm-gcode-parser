import {
  WORKBENCH_MANIFEST_FILE,
  type ConnectedWorkbench,
  type WorkbenchManifest
} from '@/domain/storage/workbenchStorage';
import { createWorkbenchProject } from '@/domain/workbench/defaultProject';
import { baseNameFromFileName, uniqueProjectId } from '@/domain/workbench/projectNaming';
import type { WorkbenchProject } from '@/domain/workbench/types';

import { parseGCodeProgram } from './gcodeParser';
import { stripForEditing } from './isoNormalizer';
import type { LoadedEditorProgram } from './loadEditorProgram';

const SUPPORTED_EDITOR_EXTENSIONS = ['gcode', 'nc', 'iso', 'txt'] as const;
const MAX_EDITOR_FILE_BYTES = 50 * 1024 * 1024;

export interface ImportExternalProgramInput {
  fileName: string;
  text: string;
  byteLength?: number;
  now?: Date;
}

export interface ImportExternalProgramResult {
  workbench: ConnectedWorkbench;
  project: WorkbenchProject;
  editorProgram: LoadedEditorProgram;
}

export async function importExternalProgram(
  workbench: ConnectedWorkbench,
  input: ImportExternalProgramInput
): Promise<ImportExternalProgramResult> {
  const extension = editorExtension(input.fileName);
  if (!extension) {
    throw new Error(
      `Unsupported editor file type. Supported formats: ${SUPPORTED_EDITOR_EXTENSIONS.map((item) => `.${item}`).join(', ')}`
    );
  }

  const byteLength = input.byteLength ?? new TextEncoder().encode(input.text).byteLength;
  if (byteLength > MAX_EDITOR_FILE_BYTES) {
    throw new Error(
      `File too large (${formatMegabytes(byteLength)}MB). Maximum size is 50MB.`
    );
  }
  if (byteLength === 0) {
    throw new Error('File is empty.');
  }

  const timestamp = (input.now ?? new Date()).toISOString();
  const projectName = baseNameFromFileName(input.fileName, {
    fallback: 'External Program',
    stripExtension: /\.[a-z0-9]+$/i
  });
  const initialProject = createWorkbenchProject({
    name: projectName,
    sourceKind: 'external-gcode',
    now: input.now
  });
  const projectId = uniqueProjectId(
    initialProject.id,
    workbench.manifest.projects.map((project) => project.id)
  );
  const project =
    projectId === initialProject.id
      ? initialProject
      : createWorkbenchProject({
          id: projectId,
          name: projectName,
          sourceKind: 'external-gcode',
          now: input.now
        });

  const sourcePath = `imports/${project.id}.${extension}`;
  const editorPath = `editor/${project.id}.${extension}`;
  const projectDirectory = `projects/${project.id}`;
  const projectPath = `${projectDirectory}/project.json`;
  const editorText = stripForEditing(input.text);

  project.editor.activeFilePath = editorPath;
  project.source.files = [
    {
      name: `${project.id}.${extension}`,
      path: sourcePath,
      kind: 'external-gcode',
      createdAt: timestamp
    }
  ];

  await workbench.adapter.ensureDirectory(projectDirectory);
  await workbench.adapter.writeText(sourcePath, input.text);
  await workbench.adapter.writeText(editorPath, editorText);
  await workbench.adapter.writeText(projectPath, JSON.stringify(project, null, 2));

  const updatedManifest: WorkbenchManifest = {
    ...workbench.manifest,
    updatedAt: timestamp,
    projects: [
      ...workbench.manifest.projects.filter((entry) => entry.id !== project.id),
      {
        id: project.id,
        name: project.name,
        path: projectPath,
        sourceKind: 'external-gcode',
        updatedAt: timestamp
      }
    ]
  };

  await workbench.adapter.writeText(
    WORKBENCH_MANIFEST_FILE,
    JSON.stringify(updatedManifest, null, 2)
  );

  const editorProgram: LoadedEditorProgram = {
    filePath: editorPath,
    model: 'gcode-text',
    text: editorText,
    parseResult: parseGCodeProgram(editorText),
    project
  };

  return {
    workbench: {
      ...workbench,
      manifest: updatedManifest
    },
    project,
    editorProgram
  };
}

function editorExtension(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase();
  return SUPPORTED_EDITOR_EXTENSIONS.find((candidate) => candidate === extension) ?? null;
}

function formatMegabytes(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(2);
}
