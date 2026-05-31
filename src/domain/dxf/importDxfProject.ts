import type { PathDiagnostic, PathPlanningDocument } from '@/domain/path-intel/types';
import {
  WORKBENCH_MANIFEST_FILE,
  type ConnectedWorkbench,
  type WorkbenchManifest
} from '@/domain/storage/workbenchStorage';
import { createWorkbenchProject } from '@/domain/workbench/defaultProject';
import { baseNameFromFileName, uniqueProjectId } from '@/domain/workbench/projectNaming';
import type { WorkbenchProject } from '@/domain/workbench/types';
import { createProjectUpid } from '@/domain/upid/projectUpid';

import { dxfEntitiesToPathPlanningDocument } from './dxfToGcode';
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
  pathDocument: PathPlanningDocument;
  pathDiagnostics: PathDiagnostic[];
  postDiagnostics: PathDiagnostic[];
}

export async function importDxfProject(
  workbench: ConnectedWorkbench,
  input: ImportDxfProjectInput
): Promise<ImportDxfProjectResult> {
  const timestamp = (input.now ?? new Date()).toISOString();
  const projectName = baseNameFromFileName(input.fileName, {
    fallback: 'DXF Import',
    stripExtension: /\.dxf$/i
  });
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

  const pathDocument = dxfEntitiesToPathPlanningDocument(parseResult.entities);
  if (pathDocument.segments.length === 0 || pathDocument.plan.operations.length === 0) {
    throw new Error('DXF did not contain valid cut geometry.');
  }

  const machineProfile = workbench.activeMachineProfile;
  const generatedBody = '';
  const generatedProgram = '';
  const postDiagnostics: PathDiagnostic[] = [];

  const sourcePath = `imports/${project.id}.dxf`;
  const projectDirectory = `projects/${project.id}`;
  const projectPath = `${projectDirectory}/project.json`;

  project.machine = { ...machineProfile };
  project.generated.body = generatedBody;
  project.upid = createProjectUpid(pathDocument, postDiagnostics);
  project.source.files = [
    {
      name: `${project.id}.dxf`,
      path: sourcePath,
      kind: 'dxf',
      createdAt: timestamp
    }
  ];

  await workbench.adapter.ensureDirectory(projectDirectory);
  await workbench.adapter.writeText(sourcePath, input.text);
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
    generatedProgram,
    pathDocument,
    pathDiagnostics: pathDocument.diagnostics,
    postDiagnostics
  };
}
