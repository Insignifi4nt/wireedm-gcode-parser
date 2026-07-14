import type { PathDiagnostic, PathPlanningDocument } from '@/domain/path-intel/types';
import { initializeProjectCompensationIntents } from '@/domain/compensation/intent';
import { normalizeMachineProfile } from '@/domain/machine/machineProfiles';
import {
  WORKBENCH_MANIFEST_FILE,
  type ConnectedWorkbench,
  type WorkbenchManifest,
  type WorkbenchStorageAdapter
} from '@/domain/storage/workbenchStorage';
import { createWorkbenchProject } from '@/domain/workbench/defaultProject';
import { baseNameFromFileName, uniqueProjectId } from '@/domain/workbench/projectNaming';
import type { WorkbenchProject } from '@/domain/workbench/types';
import { createProjectUpid } from '@/domain/upid/projectUpid';

import {
  buildDxfImportUnitCandidates,
  type DxfImportUnitCandidate
} from './dxfImportUnits';
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

interface DxfCommitState {
  latestManifest?: WorkbenchManifest;
  reservedProjectIds: Set<string>;
  tail: Promise<void>;
}

const dxfCommitStates = new WeakMap<WorkbenchStorageAdapter, DxfCommitState>();

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
  const reviewedMachine = preparation.machineProfiles.find(
    ({ id }) => id === decision.machineProfileId
  );
  if (!reviewedMachine) {
    throw new Error(
      `Selected machine profile was not part of DXF import review: ${decision.machineProfileId}.`
    );
  }
  const machineProfile = normalizeMachineProfile(structuredClone(storedMachine));
  const reviewedMachineProfile = normalizeMachineProfile(structuredClone(reviewedMachine));
  if (!sameReviewSemantics(machineProfile, reviewedMachineProfile)) {
    throw new Error('Selected machine profile changed after DXF import review.');
  }
  const currentUnitCandidate = buildDxfImportUnitCandidates(
    preparation.parseResult.unitDeclaration,
    machineProfile
  ).find(({ id }) => id === decision.unitCandidateId);
  const reviewedUnitCandidates = decision.machineProfileId === preparation.activeMachineProfileId
    ? preparation.unitCandidates
    : buildDxfImportUnitCandidates(
        preparation.parseResult.unitDeclaration,
        reviewedMachineProfile
      );
  const reviewedUnitCandidate = reviewedUnitCandidates.find(
    ({ id }) => id === decision.unitCandidateId
  );
  if (!currentUnitCandidate || !reviewedUnitCandidate) {
    throw new Error(
      `DXF unit candidate is no longer available for selected machine: ${decision.unitCandidateId}.`
    );
  }
  if (!sameReviewSemantics(currentUnitCandidate, reviewedUnitCandidate)) {
    throw new Error('Selected DXF unit candidate changed after import review.');
  }

  const declaration = preparation.parseResult.unitDeclaration;
  const declaredUnits = declaration.status === 'recognized' ? declaration.units : null;
  const overridesDeclaration =
    declaredUnits?.scaleToMillimeters != null &&
    currentUnitCandidate.scaleToMillimeters !== declaredUnits.scaleToMillimeters;
  if (overridesDeclaration && !decision.declaredUnitOverrideAcknowledged) {
    throw new Error('Changing declared DXF units requires explicit acknowledgement.');
  }

  const timestamp = preparation.preparedAt;
  const now = new Date(timestamp);
  if (Number.isNaN(now.getTime())) {
    throw new Error('DXF import preparation time is invalid.');
  }

  return serializeDxfCommit(workbench.adapter, (state) => commitValidatedDxfProject({
    workbench,
    preparation,
    machineProfile,
    unitCandidate: currentUnitCandidate,
    declaredUnits,
    overridesDeclaration,
    timestamp,
    now,
    state
  }));
}

async function commitValidatedDxfProject(input: {
  workbench: ConnectedWorkbench;
  preparation: DxfImportPreparation;
  machineProfile: WorkbenchProject['machine'];
  unitCandidate: DxfImportUnitCandidate;
  declaredUnits: DxfParseResult['units'] | null;
  overridesDeclaration: boolean;
  timestamp: string;
  now: Date;
  state: DxfCommitState;
}): Promise<ImportDxfProjectResult> {
  const {
    workbench,
    preparation,
    machineProfile,
    unitCandidate,
    declaredUnits,
    overridesDeclaration,
    timestamp,
    now,
    state
  } = input;
  const manifest = mergeCommitManifest(workbench.manifest, state.latestManifest);
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
    [
      ...manifest.projects.map(({ id }) => id),
      ...state.reservedProjectIds
    ]
  );
  state.reservedProjectIds.add(projectId);
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
  const importedPathDocument = dxfEntitiesToUpidDocument(preparation.parseResult.entities, {}, {
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
  const pathDocument = initializeProjectCompensationIntents(
    importedPathDocument,
    machineProfile
  );
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
    ...manifest,
    updatedAt: timestamp,
    projects: [
      ...manifest.projects,
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
  state.latestManifest = updatedManifest;

  return {
    workbench: { ...workbench, manifest: updatedManifest },
    project,
    parseResult: preparation.parseResult,
    entityCount: preparation.entityCount,
    pathDocument,
    pathDiagnostics: pathDocument.diagnostics
  };
}

function serializeDxfCommit<T>(
  adapter: WorkbenchStorageAdapter,
  action: (state: DxfCommitState) => Promise<T>
): Promise<T> {
  let state = dxfCommitStates.get(adapter);
  if (!state) {
    state = {
      reservedProjectIds: new Set<string>(),
      tail: Promise.resolve()
    };
    dxfCommitStates.set(adapter, state);
  }
  const result = state.tail.then(() => action(state!));
  state.tail = result.then(() => undefined, () => undefined);
  return result;
}

function mergeCommitManifest(
  current: WorkbenchManifest,
  latest: WorkbenchManifest | undefined
): WorkbenchManifest {
  if (!latest) return current;
  const projects = new Map(latest.projects.map((project) => [project.id, project]));
  current.projects.forEach((project) => projects.set(project.id, project));
  return {
    ...current,
    projects: [...projects.values()]
  };
}

function sameReviewSemantics(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
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
