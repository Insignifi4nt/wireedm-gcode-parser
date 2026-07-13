import type { PathDiagnostic, PathPlanningDocument } from '@/domain/path-intel/types';
import { normalizeMachineProfile } from '@/domain/machine/machineProfiles';
import {
  WORKBENCH_MANIFEST_FILE,
  type ConnectedWorkbench,
  type WorkbenchManifest
} from '@/domain/storage/workbenchStorage';
import { createWorkbenchProject } from '@/domain/workbench/defaultProject';
import { baseNameFromFileName, uniqueProjectId } from '@/domain/workbench/projectNaming';
import type { WorkbenchProject } from '@/domain/workbench/types';
import { createProjectUpid } from '@/domain/upid/projectUpid';

import { buildDxfImportUnitCandidates } from './dxfImportUnits';
import { dxfEntitiesToUpidDocument } from './dxfToUpid';
import { parseDxf } from './parseDxf';
import type { DxfImportPreparation, DxfImportSelection } from './prepareDxfProjectImport';
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
  pathDocument: PathPlanningDocument;
  pathDiagnostics: PathDiagnostic[];
}

export interface DxfImportDecision extends DxfImportSelection {
  confirmed: boolean;
  declaredUnitOverrideAcknowledged: boolean;
}

export async function commitDxfProjectImport(
  workbench: ConnectedWorkbench,
  preparation: DxfImportPreparation,
  decision: DxfImportDecision
): Promise<ImportDxfProjectResult> {
  if (!decision.confirmed) {
    throw new Error('DXF import must be confirmed before it can be committed.');
  }

  const storedMachine = workbench.manifest.machineProfiles.find(
    ({ id }) => id === decision.machineProfileId
  );
  if (!storedMachine) {
    throw new Error(
      `Selected machine profile is no longer available: ${decision.machineProfileId}.`
    );
  }
  const machineProfile = normalizeMachineProfile(structuredClone(storedMachine));
  const unitCandidate = buildDxfImportUnitCandidates(
    preparation.parseResult.unitDeclaration,
    machineProfile
  ).find(({ id }) => id === decision.unitCandidateId);
  if (!unitCandidate) {
    throw new Error(
      `DXF unit candidate is no longer available for selected machine: ${decision.unitCandidateId}.`
    );
  }

  const declaration = preparation.parseResult.unitDeclaration;
  const declaredUnits = declaration.status === 'recognized' ? declaration.units : null;
  const overridesDeclaration =
    declaredUnits?.scaleToMillimeters != null &&
    unitCandidate.scaleToMillimeters !== declaredUnits.scaleToMillimeters;
  if (overridesDeclaration && !decision.declaredUnitOverrideAcknowledged) {
    throw new Error('Changing declared DXF units requires explicit acknowledgement.');
  }

  const timestamp = preparation.preparedAt;
  const now = new Date(timestamp);
  if (Number.isNaN(now.getTime())) {
    throw new Error('DXF import preparation time is invalid.');
  }
  const projectName = baseNameFromFileName(preparation.fileName, {
    fallback: 'DXF Import',
    stripExtension: /\.dxf$/i
  });
  const initialProject = createWorkbenchProject({
    name: projectName,
    sourceKind: 'dxf',
    now
  });
  const projectId = uniqueProjectId(
    initialProject.id,
    workbench.manifest.projects.map(({ id }) => id)
  );
  const project = projectId === initialProject.id
    ? initialProject
    : createWorkbenchProject({
        id: projectId,
        name: projectName,
        sourceKind: 'dxf',
        now
      });
  const overrideWarning = overridesDeclaration
    ? `Declared DXF units "${declaredUnits!.label}" were overridden with confirmed units "${unitCandidate.label}".`
    : null;
  const importWarnings = [
    ...preparation.parseResult.warnings,
    ...(overrideWarning ? [overrideWarning] : [])
  ];
  const pathDocument = dxfEntitiesToUpidDocument(preparation.parseResult.entities, {}, {
    fileName: preparation.fileName,
    importedAt: timestamp,
    importWarnings,
    projectId: project.id,
    unitDeclaration: preparation.parseResult.unitDeclaration,
    appliedUnits: {
      label: unitCandidate.label,
      scaleToMillimeters: unitCandidate.scaleToMillimeters,
      basis: unitCandidate.source === 'dxf-declared' ? 'dxf-declared' : 'user-confirmed',
      confirmed: true,
      confirmedAt: timestamp,
      ...(unitCandidate.suggestion
        ? { suggestion: { ...unitCandidate.suggestion } }
        : {})
    },
    ...(preparation.parseResult.drawing
      ? { drawing: preparation.parseResult.drawing }
      : {}),
    ...(preparation.parseResult.units ? { units: preparation.parseResult.units } : {})
  });
  if (pathDocument.segments.length === 0 || pathDocument.plan.operations.length === 0) {
    throw new Error('DXF did not contain valid cut geometry.');
  }

  const sourcePath = `imports/${project.id}.dxf`;
  const projectDirectory = `projects/${project.id}`;
  const projectPath = `${projectDirectory}/project.json`;
  project.machine = machineProfile;
  project.upid = createProjectUpid(project, pathDocument);
  project.source.files = [{
    name: `${project.id}.dxf`,
    path: sourcePath,
    kind: 'dxf',
    createdAt: timestamp
  }];

  const updatedManifest: WorkbenchManifest = {
    ...workbench.manifest,
    updatedAt: timestamp,
    projects: [
      ...workbench.manifest.projects,
      {
        id: project.id,
        name: project.name,
        path: projectPath,
        sourceKind: 'dxf',
        updatedAt: timestamp
      }
    ]
  };

  await workbench.adapter.ensureDirectory(projectDirectory);
  await workbench.adapter.writeText(sourcePath, preparation.text);
  await workbench.adapter.writeText(projectPath, JSON.stringify(project, null, 2));
  await workbench.adapter.writeText(
    WORKBENCH_MANIFEST_FILE,
    JSON.stringify(updatedManifest, null, 2)
  );

  return {
    workbench: { ...workbench, manifest: updatedManifest },
    project,
    parseResult: preparation.parseResult,
    entityCount: preparation.entityCount,
    pathDocument,
    pathDiagnostics: pathDocument.diagnostics
  };
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

  const pathDocument = dxfEntitiesToUpidDocument(parseResult.entities, {}, {
    fileName: input.fileName,
    importedAt: timestamp,
    importWarnings: parseResult.warnings,
    projectId: project.id,
    unitDeclaration: parseResult.unitDeclaration,
    appliedUnits: legacyAppliedUnits(parseResult),
    ...(parseResult.drawing ? { drawing: parseResult.drawing } : {}),
    ...(parseResult.units ? { units: parseResult.units } : {})
  });
  if (pathDocument.segments.length === 0 || pathDocument.plan.operations.length === 0) {
    throw new Error('DXF did not contain valid cut geometry.');
  }

  const machineProfile = workbench.activeMachineProfile;

  const sourcePath = `imports/${project.id}.dxf`;
  const projectDirectory = `projects/${project.id}`;
  const projectPath = `${projectDirectory}/project.json`;

  project.machine = normalizeMachineProfile(machineProfile);
  project.upid = createProjectUpid(project, pathDocument);
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
    pathDocument,
    pathDiagnostics: pathDocument.diagnostics
  };
}

function legacyAppliedUnits(parseResult: DxfParseResult) {
  const declaration = parseResult.unitDeclaration;
  if (
    declaration.status === 'recognized' &&
    declaration.units.scaleToMillimeters != null
  ) {
    return {
      label: declaration.units.label,
      scaleToMillimeters: declaration.units.scaleToMillimeters,
      basis: 'dxf-declared' as const,
      confirmed: true
    };
  }
  return {
    label: 'millimeters',
    scaleToMillimeters: 1,
    basis: 'legacy-assumed' as const,
    confirmed: false
  };
}
