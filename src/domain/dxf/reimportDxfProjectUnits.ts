import { normalizeMachineProfile } from '@/domain/machine/machineProfiles';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import {
  WORKBENCH_MANIFEST_FILE,
  type ConnectedWorkbench,
  type WorkbenchManifest
} from '@/domain/storage/workbenchStorage';
import {
  createProjectUpid,
  projectUpidDocument
} from '@/domain/upid/projectUpid';
import type { WorkbenchFileRef, WorkbenchProject } from '@/domain/workbench/types';

import {
  buildDxfImportUnitCandidates,
  type DxfImportUnitCandidate
} from './dxfImportUnits';
import { dxfEntitiesToUpidDocument } from './dxfToUpid';
import type { DxfImportDecision } from './importDxfProject';
import {
  prepareDxfProjectImport,
  type DxfImportPreparation
} from './prepareDxfProjectImport';

export interface DxfProjectReimportPreparation extends DxfImportPreparation {
  projectId: string;
  projectPath: string;
  rawSource: WorkbenchFileRef;
  reviewedProjectJson: string;
  reviewedProjectEntryJson: string;
  reviewedStoredProjectText: string;
}

export interface DxfProjectReimportDecision extends DxfImportDecision {
  rebuildAcknowledged: boolean;
}

export interface DxfProjectReimportResult {
  mode: 'metadata-only' | 'rebuilt';
  pathDocument: PathPlanningDocument;
  project: WorkbenchProject;
  projectPath: string;
  workbench: ConnectedWorkbench;
}

export function dxfProjectReimportRequiresRebuild(
  project: WorkbenchProject,
  candidate: DxfImportUnitCandidate
) {
  const document = projectUpidDocument(project);
  return !document || !isLegacyMillimeterConfirmation(document, candidate);
}

export async function prepareDxfProjectReimport(
  workbench: ConnectedWorkbench,
  project: WorkbenchProject,
  options: { now?: Date } = {}
): Promise<DxfProjectReimportPreparation> {
  if (project.source.kind !== 'dxf' || !project.upid) {
    throw new Error('Only DXF UPID projects can be re-imported with different units.');
  }
  const sourceFiles = project.source.files.filter((file) => file.kind === 'dxf');
  if (sourceFiles.length !== 1) {
    throw new Error('Project must reference exactly one persisted raw DXF for unit re-import.');
  }
  const rawSource = structuredClone(sourceFiles[0]);
  if (rawSource.path.trim().length === 0) {
    throw new Error('Project must reference exactly one persisted raw DXF with a usable path.');
  }
  let text: string | null;
  try {
    text = await workbench.adapter.readText(rawSource.path);
  } catch (error) {
    throw new Error(
      `Persisted raw DXF is unreadable: ${rawSource.path}: ${errorMessage(error)}`
    );
  }
  if (text === null) {
    throw new Error(`Persisted raw DXF is unavailable: ${rawSource.path}.`);
  }
  const projectEntry = workbench.manifest.projects.find(({ id }) => id === project.id);
  if (!projectEntry) {
    throw new Error(`Project index entry not found: ${project.id}.`);
  }
  const storedProjectText = await workbench.adapter.readText(projectEntry.path);
  if (storedProjectText === null) {
    throw new Error(`Persisted project is unavailable: ${projectEntry.path}.`);
  }
  const reviewedProject = canonicalProjectForReview(project);
  const storedProject = parseStoredProjectForReview(storedProjectText, projectEntry.path);
  if (JSON.stringify(storedProject) !== JSON.stringify(reviewedProject)) {
    throw new Error('Persisted project does not match the project opened for unit review.');
  }
  const machine = normalizeMachineProfile(structuredClone(project.machine));
  const lockedWorkbench: ConnectedWorkbench = {
    ...workbench,
    activeMachineProfile: machine,
    header: machine.templates.header,
    footer: machine.templates.footer,
    manifest: {
      ...workbench.manifest,
      activeMachineProfileId: machine.id,
      machineProfiles: [machine]
    }
  };
  const existingDocument = projectUpidDocument(project);
  const preparation = prepareDxfProjectImport(lockedWorkbench, {
    fileName: existingDocument?.source.fileName ?? rawSource.name,
    text,
    now: options.now
  });

  return {
    ...preparation,
    projectId: project.id,
    projectPath: projectEntry.path,
    rawSource,
    reviewedProjectJson: JSON.stringify(reviewedProject),
    reviewedProjectEntryJson: JSON.stringify(projectEntry),
    reviewedStoredProjectText: storedProjectText
  };
}

export async function commitDxfProjectReimport(
  workbench: ConnectedWorkbench,
  project: WorkbenchProject,
  preparation: DxfProjectReimportPreparation,
  decision: DxfProjectReimportDecision
): Promise<DxfProjectReimportResult> {
  if (!decision.confirmed) {
    throw new Error('DXF unit re-import must be confirmed before it can be committed.');
  }
  if (
    preparation.projectId !== project.id ||
    preparation.reviewedProjectJson !== JSON.stringify(canonicalProjectForReview(project))
  ) {
    throw new Error('Project changed after unit review; review the raw DXF again.');
  }
  const projectEntry = workbench.manifest.projects.find(({ id }) => id === project.id);
  if (
    !projectEntry ||
    projectEntry.path !== preparation.projectPath ||
    JSON.stringify(projectEntry) !== preparation.reviewedProjectEntryJson
  ) {
    throw new Error('Project index changed after unit review; review the raw DXF again.');
  }
  const currentStoredProjectText = await workbench.adapter.readText(preparation.projectPath);
  if (currentStoredProjectText === null) {
    throw new Error('Persisted project changed after unit review; review it again.');
  }
  let currentStoredProject: WorkbenchProject;
  try {
    currentStoredProject = parseStoredProjectForReview(
      currentStoredProjectText,
      preparation.projectPath
    );
  } catch {
    throw new Error('Persisted project changed after unit review; review it again.');
  }
  if (
    currentStoredProjectText !== preparation.reviewedStoredProjectText ||
    JSON.stringify(currentStoredProject) !== preparation.reviewedProjectJson
  ) {
    throw new Error('Persisted project changed after unit review; review it again.');
  }
  if (
    decision.machineProfileId !== project.machine.id ||
    preparation.machineProfiles.length !== 1 ||
    preparation.machineProfiles[0].id !== project.machine.id
  ) {
    throw new Error('DXF unit re-import must keep the project machine snapshot.');
  }
  let currentRawText: string | null;
  try {
    currentRawText = await workbench.adapter.readText(preparation.rawSource.path);
  } catch (error) {
    throw new Error(
      `Persisted raw DXF is unreadable: ${preparation.rawSource.path}: ${errorMessage(error)}`
    );
  }
  if (currentRawText !== preparation.text) {
    throw new Error('Persisted raw DXF changed after unit review; review it again.');
  }
  const currentMachine = normalizeMachineProfile(structuredClone(project.machine));
  if (JSON.stringify(currentMachine) !== JSON.stringify(preparation.machineProfiles[0])) {
    throw new Error('Project machine snapshot changed after unit review.');
  }
  const unitCandidate = requireReviewedCandidate(preparation, currentMachine, decision.unitCandidateId);
  const declaration = preparation.parseResult.unitDeclaration;
  const declaredUnits = declaration.status === 'recognized' ? declaration.units : null;
  const overridesDeclaration =
    declaredUnits?.scaleToMillimeters != null &&
    declaredUnits.scaleToMillimeters !== unitCandidate.scaleToMillimeters;
  if (overridesDeclaration && !decision.declaredUnitOverrideAcknowledged) {
    throw new Error('Changing declared DXF units requires explicit acknowledgement.');
  }

  const currentDocument = projectUpidDocument(project);
  if (!currentDocument) {
    throw new Error('DXF project does not contain a UPID document.');
  }
  const metadataOnly = !dxfProjectReimportRequiresRebuild(project, unitCandidate);
  if (!metadataOnly && !decision.rebuildAcknowledged) {
    throw new Error('Rebuilding geometry from the raw DXF requires explicit acknowledgement.');
  }

  const timestamp = preparation.preparedAt;
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error('DXF unit re-import preparation time is invalid.');
  }
  const pathDocument = metadataOnly
    ? confirmLegacyMillimeters(currentDocument, timestamp)
    : rebuildPathDocument(project, preparation, unitCandidate, timestamp, overridesDeclaration);
  const updatedProject: WorkbenchProject = {
    ...structuredClone(project),
    updatedAt: timestamp
  };
  updatedProject.upid = createProjectUpid(updatedProject, pathDocument);
  const updatedManifest: WorkbenchManifest = {
    ...workbench.manifest,
    updatedAt: timestamp,
    projects: workbench.manifest.projects.map((entry) =>
      entry.id === project.id
        ? {
            ...entry,
            name: project.name,
            sourceKind: project.source.kind,
            updatedAt: timestamp
          }
        : entry
    )
  };

  await persistReplacement(
    workbench,
    preparation.projectPath,
    preparation.reviewedStoredProjectText,
    updatedProject,
    updatedManifest
  );

  return {
    mode: metadataOnly ? 'metadata-only' : 'rebuilt',
    pathDocument: updatedProject.upid.document,
    project: updatedProject,
    projectPath: preparation.projectPath,
    workbench: { ...workbench, manifest: updatedManifest }
  };
}

function requireReviewedCandidate(
  preparation: DxfProjectReimportPreparation,
  machine: WorkbenchProject['machine'],
  candidateId: string
) {
  const current = buildDxfImportUnitCandidates(
    preparation.parseResult.unitDeclaration,
    machine
  ).find(({ id }) => id === candidateId);
  const reviewed = preparation.unitCandidates.find(({ id }) => id === candidateId);
  if (!current || !reviewed || JSON.stringify(current) !== JSON.stringify(reviewed)) {
    throw new Error(`DXF unit candidate changed after review: ${candidateId}.`);
  }
  return current;
}

function isLegacyMillimeterConfirmation(
  document: PathPlanningDocument,
  candidate: DxfImportUnitCandidate
) {
  const applied = document.source.appliedUnits;
  return (
    candidate.scaleToMillimeters === 1 &&
    document.source.coordinateScaleToMillimeters === 1 &&
    applied?.basis === 'legacy-assumed' &&
    applied.confirmed === false &&
    applied.scaleToMillimeters === 1
  );
}

function confirmLegacyMillimeters(document: PathPlanningDocument, timestamp: string) {
  const clone = structuredClone(document);
  clone.source = {
    ...clone.source,
    coordinateScaleToMillimeters: 1,
    appliedUnits: {
      label: 'millimeters',
      scaleToMillimeters: 1,
      basis: 'user-confirmed',
      confirmed: true,
      confirmedAt: timestamp
    }
  };
  clone.diagnostics = clone.diagnostics.filter(
    ({ code }) => code !== 'units-assumed-millimeters'
  );
  return clone;
}

function rebuildPathDocument(
  project: WorkbenchProject,
  preparation: DxfProjectReimportPreparation,
  unitCandidate: DxfImportUnitCandidate,
  timestamp: string,
  overridesDeclaration: boolean
) {
  const declaredUnits = preparation.parseResult.unitDeclaration.status === 'recognized'
    ? preparation.parseResult.unitDeclaration.units
    : null;
  const overrideWarning = overridesDeclaration
    ? `Declared DXF units "${declaredUnits!.label}" were overridden with confirmed units "${unitCandidate.label}".`
    : null;
  return dxfEntitiesToUpidDocument(preparation.parseResult.entities, {}, {
    fileName: preparation.fileName,
    importedAt: timestamp,
    importWarnings: [
      ...preparation.parseResult.warnings,
      ...(overrideWarning ? [overrideWarning] : [])
    ],
    projectId: project.id,
    unitDeclaration: preparation.parseResult.unitDeclaration,
    appliedUnits: {
      label: unitCandidate.label,
      scaleToMillimeters: unitCandidate.scaleToMillimeters,
      basis: unitCandidate.source === 'dxf-declared' ? 'dxf-declared' : 'user-confirmed',
      confirmed: true,
      confirmedAt: timestamp,
      ...(unitCandidate.suggestion ? { suggestion: { ...unitCandidate.suggestion } } : {})
    },
    ...(preparation.parseResult.drawing ? { drawing: preparation.parseResult.drawing } : {}),
    ...(preparation.parseResult.units ? { units: preparation.parseResult.units } : {})
  });
}

async function persistReplacement(
  workbench: ConnectedWorkbench,
  projectPath: string,
  expectedProjectText: string,
  project: WorkbenchProject,
  manifest: WorkbenchManifest
) {
  const snapshots = await Promise.all([
    snapshot(workbench, projectPath),
    snapshot(workbench, WORKBENCH_MANIFEST_FILE)
  ]);
  if (snapshots[0].contents !== expectedProjectText) {
    throw new Error('Persisted project changed after unit review; review it again.');
  }
  try {
    await workbench.adapter.writeText(projectPath, JSON.stringify(project, null, 2));
    await workbench.adapter.writeText(
      WORKBENCH_MANIFEST_FILE,
      JSON.stringify(manifest, null, 2)
    );
  } catch (writeError) {
    const recoveryErrors: string[] = [];
    for (const file of snapshots) {
      try {
        if (file.contents === null) await workbench.adapter.deleteText(file.path);
        else await workbench.adapter.writeText(file.path, file.contents);
      } catch (error) {
        recoveryErrors.push(`${file.path}: ${errorMessage(error)}`);
      }
    }
    if (recoveryErrors.length > 0) {
      throw new Error(
        `DXF unit re-import failed: ${errorMessage(writeError)}; recovery failed: ${recoveryErrors.join('; ')}`
      );
    }
    throw writeError;
  }
}

async function snapshot(workbench: ConnectedWorkbench, path: string) {
  return { path, contents: await workbench.adapter.readText(path) };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parseStoredProjectForReview(text: string, path: string) {
  let project: WorkbenchProject;
  try {
    project = JSON.parse(text) as WorkbenchProject;
  } catch {
    throw new Error(`Persisted project is not valid JSON: ${path}.`);
  }
  return canonicalProjectForReview(project);
}

function canonicalProjectForReview(project: WorkbenchProject): WorkbenchProject {
  const normalized: WorkbenchProject = {
    ...structuredClone(project),
    machine: normalizeMachineProfile(project.machine)
  };
  const document = projectUpidDocument(normalized);
  if (document && normalized.upid) {
    normalized.upid = {
      ...normalized.upid,
      document
    };
  }
  return normalized;
}
