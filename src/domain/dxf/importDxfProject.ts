import { composeGCodeProgram, normalizeOutputExtension } from '@/domain/post/gcodeTemplates';
import {
  WORKBENCH_MANIFEST_FILE,
  type ConnectedWorkbench,
  type WorkbenchManifest
} from '@/domain/storage/workbenchStorage';
import { createWorkbenchProject } from '@/domain/workbench/defaultProject';
import type { WorkbenchFileRef, WorkbenchProject } from '@/domain/workbench/types';

import { dxfEntitiesToGcodeBody } from './dxfToGcode';
import { parseDxf } from './parseDxf';
import type { DxfParseResult } from './types';

export interface ImportDxfProjectInput {
  fileName: string;
  text: string;
  now?: Date;
}

export interface ImportDxfProjectResult {
  workbench: ConnectedWorkbench;
  project: WorkbenchProject;
  parseResult: DxfParseResult;
  entityCount: number;
  generatedBody: string;
  generatedProgram: string;
}

export async function importDxfProject(
  workbench: ConnectedWorkbench,
  input: ImportDxfProjectInput
): Promise<ImportDxfProjectResult> {
  const timestamp = (input.now ?? new Date()).toISOString();
  const projectName = baseName(input.fileName);
  const initialProject = createWorkbenchProject({
    name: projectName,
    sourceKind: 'dxf',
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
          sourceKind: 'dxf',
          now: input.now
        });

  const parseResult = parseDxf(input.text);
  if (parseResult.entities.length === 0) {
    throw new Error('DXF did not contain supported cut geometry.');
  }

  const generatedBody = dxfEntitiesToGcodeBody(parseResult.entities);
  const generatedProgram = composeGCodeProgram({
    header: workbench.header,
    body: generatedBody,
    footer: workbench.footer,
    lineEnding: workbench.manifest.output.lineEnding
  });

  const sourcePath = `imports/${project.id}.dxf`;
  const bodyPath = `generated/${project.id}.body.gcode`;
  const programPath = `generated/${project.id}.${normalizeOutputExtension(
    workbench.manifest.output.extension,
    workbench.manifest.output.customExtension
  )}`;
  const projectDirectory = `projects/${project.id}`;
  const projectPath = `${projectDirectory}/project.json`;

  project.machine.templates = {
    header: workbench.header,
    footer: workbench.footer
  };
  project.machine.output = workbench.manifest.output;
  project.editor.activeFilePath = programPath;
  project.generated.body = generatedBody;
  project.source.files = [
    createFileRef({
      name: `${project.id}.dxf`,
      path: sourcePath,
      kind: 'dxf',
      createdAt: timestamp
    })
  ];
  project.generated.files = [
    createFileRef({
      name: `${project.id}.body.gcode`,
      path: bodyPath,
      kind: 'generated',
      createdAt: timestamp
    }),
    createFileRef({
      name: `${project.id}.${normalizeOutputExtension(
        workbench.manifest.output.extension,
        workbench.manifest.output.customExtension
      )}`,
      path: programPath,
      kind: 'generated',
      createdAt: timestamp
    })
  ];

  await workbench.adapter.ensureDirectory(projectDirectory);
  await workbench.adapter.writeText(sourcePath, input.text);
  await workbench.adapter.writeText(bodyPath, generatedBody);
  await workbench.adapter.writeText(programPath, generatedProgram);
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
        sourceKind: 'dxf',
        updatedAt: timestamp
      }
    ]
  };

  await workbench.adapter.writeText(
    WORKBENCH_MANIFEST_FILE,
    JSON.stringify(updatedManifest, null, 2)
  );

  return {
    workbench: {
      ...workbench,
      manifest: updatedManifest
    },
    project,
    parseResult,
    entityCount: parseResult.entities.length,
    generatedBody,
    generatedProgram
  };
}

function createFileRef(file: WorkbenchFileRef): WorkbenchFileRef {
  return file;
}

function baseName(fileName: string) {
  const withoutPath = fileName.split(/[\\/]/).pop() || 'DXF Import';
  return withoutPath.replace(/\.dxf$/i, '').trim() || 'DXF Import';
}

function uniqueProjectId(baseId: string, existingIds: string[]) {
  const existing = new Set(existingIds);
  if (!existing.has(baseId)) return baseId;

  for (let suffix = 2; suffix < Number.MAX_SAFE_INTEGER; suffix++) {
    const candidate = `${baseId}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }

  throw new Error('Could not create a unique project ID.');
}
