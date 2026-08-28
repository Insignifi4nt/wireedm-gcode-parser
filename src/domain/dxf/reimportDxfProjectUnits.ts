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

import { buildDxfImportUnitCandidates, type DxfImportUnitCandidate } from './dxfImportUnits';
import { dxfEntitiesToUpidDocument } from './dxfToUpid';
import type { DxfImportDecision } from './importDxfProject';
import {
  prepareDxfProjectImport,
  type DxfImportPreparation,
  type DxfImportPreparationError
} from './prepareDxfProjectImport';

type DxfProjectDocument = Omit<WorkbenchProjectDocument, 'source' | 'content'> & {
  readonly source: Extract<WorkbenchProjectDocument['source'], { readonly kind: 'dxf' }>;
  readonly content: {
    readonly kind: 'upid-document';
    readonly document: PathPlanningDocument;
  };
};

export interface DxfProjectReimportPreparation extends DxfImportPreparation {
  readonly projectId: string;
  readonly project: DxfProjectDocument;
  readonly rawSource: DxfProjectDocument['source']['files'][number];
  readonly reviewedRawText: string;
  readonly reviewedProjectJson: string;
}

export interface DxfProjectReimportDecision extends DxfImportDecision {
  readonly rebuildAcknowledged: boolean;
}

export type DxfProjectReimportError =
  | DxfImportPreparationError
  | WorkbenchProjectError
  | ReadStoredWorkbenchProjectError
  | Extract<ReplaceStoredWorkbenchProjectResult, { readonly ok: false }>['error']
  | { readonly code: 'DXF_REIMPORT_PROJECT_REQUIRED'; readonly message: string }
  | { readonly code: 'DXF_REIMPORT_RAW_SOURCE_REQUIRED'; readonly message: string }
  | {
      readonly code: 'DXF_REIMPORT_SOURCE_READ_FAILED';
      readonly message: string;
      readonly path: string;
    }
  | { readonly code: 'DXF_REIMPORT_SOURCE_CHANGED'; readonly message: string }
  | { readonly code: 'DXF_REIMPORT_PROJECT_CHANGED'; readonly message: string }
  | { readonly code: 'DXF_REIMPORT_CONFIRMATION_REQUIRED'; readonly message: string }
  | { readonly code: 'DXF_REIMPORT_REBUILD_ACKNOWLEDGEMENT_REQUIRED'; readonly message: string }
  | { readonly code: 'DXF_REIMPORT_DECLARED_UNIT_OVERRIDE_UNACKNOWLEDGED'; readonly message: string }
  | {
      readonly code: 'DXF_REIMPORT_UNIT_CANDIDATE_NOT_FOUND';
      readonly message: string;
      readonly candidateId: string;
    }
  | { readonly code: 'DXF_REIMPORT_GEOMETRY_REQUIRED'; readonly message: string };

export type PrepareDxfProjectReimportResult =
  | { readonly ok: true; readonly preparation: DxfProjectReimportPreparation }
  | { readonly ok: false; readonly error: DxfProjectReimportError };

export type DxfProjectReimportResult =
  | {
      readonly ok: true;
      readonly mode: 'unchanged' | 'rebuilt';
      readonly pathDocument: PathPlanningDocument;
      readonly project: DxfProjectDocument;
      readonly workbench: ConnectedWorkbenchCatalog;
    }
  | { readonly ok: false; readonly error: DxfProjectReimportError };

export function dxfProjectReimportRequiresRebuild(
  project: DxfProjectDocument,
  candidate: DxfImportUnitCandidate
) {
  return project.content.document.source.appliedUnits?.scaleToMillimeters !==
    candidate.scaleToMillimeters;
}

export async function prepareDxfProjectReimport(
  workbench: ConnectedWorkbenchCatalog,
  projectId: string,
  options: { readonly now?: Date } = {}
): Promise<PrepareDxfProjectReimportResult> {
  const read = await readStoredWorkbenchProject(workbench, projectId);
  if (!read.ok) return read;
  if (read.project.source.kind !== 'dxf' || read.project.content.kind !== 'upid-document') {
    return ownFailure(
      'DXF_REIMPORT_PROJECT_REQUIRED',
      'Only a strict V2 DXF project can be re-imported with different units.'
    );
  }
  const project = read.project as DxfProjectDocument;
  if (project.source.files.length !== 1) {
    return ownFailure(
      'DXF_REIMPORT_RAW_SOURCE_REQUIRED',
      'DXF unit re-import requires exactly one catalog-owned raw DXF file.'
    );
  }
  const rawSource = project.source.files[0];
  let text: string | null;
  try {
    text = await workbench.adapter.readText(rawSource.path);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'DXF_REIMPORT_SOURCE_READ_FAILED',
        message: `Could not read raw DXF ${rawSource.path}: ${errorMessage(error)}.`,
        path: rawSource.path
      }
    };
  }
  if (text === null) {
    return ownFailure(
      'DXF_REIMPORT_RAW_SOURCE_REQUIRED',
      `Catalog-owned raw DXF is missing: ${rawSource.path}.`
    );
  }
  const prepared = prepareDxfProjectImport(workbench, {
    fileName: rawSource.name,
    text,
    now: options.now
  });
  if (!prepared.ok) return prepared;
  return {
    ok: true,
    preparation: {
      ...prepared.preparation,
      projectId,
      project,
      rawSource,
      reviewedRawText: text,
      reviewedProjectJson: JSON.stringify(project)
    }
  };
}

export async function commitDxfProjectReimport(
  workbench: ConnectedWorkbenchCatalog,
  preparation: DxfProjectReimportPreparation,
  decision: DxfProjectReimportDecision
): Promise<DxfProjectReimportResult> {
  if (!decision.confirmed) {
    return ownFailure(
      'DXF_REIMPORT_CONFIRMATION_REQUIRED',
      'DXF unit re-import requires explicit confirmation.'
    );
  }
  const currentProject = await readStoredWorkbenchProject(workbench, preparation.projectId);
  if (!currentProject.ok) return currentProject;
  if (JSON.stringify(currentProject.project) !== preparation.reviewedProjectJson) {
    return ownFailure(
      'DXF_REIMPORT_PROJECT_CHANGED',
      'The project changed after DXF unit review.'
    );
  }
  let rawText: string | null;
  try {
    rawText = await workbench.adapter.readText(preparation.rawSource.path);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'DXF_REIMPORT_SOURCE_READ_FAILED',
        message: `Could not read raw DXF ${preparation.rawSource.path}: ${errorMessage(error)}.`,
        path: preparation.rawSource.path
      }
    };
  }
  if (rawText !== preparation.reviewedRawText) {
    return ownFailure(
      'DXF_REIMPORT_SOURCE_CHANGED',
      'The raw DXF changed after unit review.'
    );
  }
  const reviewedCandidate = preparation.unitCandidates.find(
    ({ id }) => id === decision.unitCandidateId
  );
  const currentCandidate = buildDxfImportUnitCandidates(
    preparation.parseResult.unitDeclaration,
    workbench.manifest.preferences.importUnits
  ).find(({ id }) => id === decision.unitCandidateId);
  if (
    !reviewedCandidate ||
    !currentCandidate ||
    JSON.stringify(reviewedCandidate) !== JSON.stringify(currentCandidate)
  ) {
    return {
      ok: false,
      error: {
        code: 'DXF_REIMPORT_UNIT_CANDIDATE_NOT_FOUND',
        message: `DXF unit candidate was not reviewed: ${decision.unitCandidateId}.`,
        candidateId: decision.unitCandidateId
      }
    };
  }
  const declaredScale = preparation.parseResult.unitDeclaration.status === 'recognized'
    ? preparation.parseResult.unitDeclaration.units.scaleToMillimeters
    : null;
  const overridesDeclaration = declaredScale !== null &&
    declaredScale !== currentCandidate.scaleToMillimeters;
  if (overridesDeclaration && !decision.declaredUnitOverrideAcknowledged) {
    return ownFailure(
      'DXF_REIMPORT_DECLARED_UNIT_OVERRIDE_UNACKNOWLEDGED',
      'Changing declared DXF units requires explicit acknowledgement.'
    );
  }
  const project = preparation.project;
  if (!dxfProjectReimportRequiresRebuild(project, currentCandidate)) {
    return {
      ok: true,
      mode: 'unchanged',
      pathDocument: project.content.document,
      project,
      workbench
    };
  }
  if (!decision.rebuildAcknowledged) {
    return ownFailure(
      'DXF_REIMPORT_REBUILD_ACKNOWLEDGEMENT_REQUIRED',
      'Rebuilding geometry from the raw DXF requires explicit acknowledgement.'
    );
  }

  let pathDocument: PathPlanningDocument;
  try {
    pathDocument = jsonSnapshot(dxfEntitiesToUpidDocument(
      preparation.parseResult.entities,
      {},
      sourceMetadata(preparation, currentCandidate, overridesDeclaration)
    ));
  } catch (error) {
    return ownFailure(
      'DXF_REIMPORT_GEOMETRY_REQUIRED',
      error instanceof Error ? error.message : String(error)
    );
  }
  if (pathDocument.segments.length === 0 || pathDocument.plan.operations.length === 0) {
    return ownFailure(
      'DXF_REIMPORT_GEOMETRY_REQUIRED',
      'DXF did not contain valid cut geometry.'
    );
  }
  const next = parseWorkbenchProjectDocument(JSON.stringify({
    ...project,
    updatedAt: preparation.preparedAt,
    content: { kind: 'upid-document', document: pathDocument }
  }));
  if (!next.ok) return next;
  const replaced = await replaceStoredWorkbenchProject(workbench, {
    project: next.project,
    ownedFileChanges: []
  });
  if (!replaced.ok) return replaced;
  return {
    ok: true,
    mode: 'rebuilt',
    pathDocument,
    project: replaced.project as DxfProjectDocument,
    workbench: replaced.workbench
  };
}

function sourceMetadata(
  preparation: DxfProjectReimportPreparation,
  candidate: DxfImportUnitCandidate,
  overridesDeclaration: boolean
) {
  const declared = preparation.parseResult.unitDeclaration.status === 'recognized'
    ? preparation.parseResult.unitDeclaration.units
    : null;
  const warning = overridesDeclaration
    ? `Declared DXF units "${declared?.label}" were overridden with confirmed units "${candidate.label}".`
    : null;
  return {
    fileName: preparation.fileName,
    importedAt: preparation.preparedAt,
    importWarnings: [...preparation.parseResult.warnings, ...(warning ? [warning] : [])],
    projectId: preparation.projectId,
    unitDeclaration: preparation.parseResult.unitDeclaration,
    appliedUnits: candidate.source === 'dxf-declared'
      ? {
          label: candidate.label,
          scaleToMillimeters: candidate.scaleToMillimeters,
          basis: 'dxf-declared' as const,
          confirmed: true
        }
      : {
          label: candidate.label,
          scaleToMillimeters: candidate.scaleToMillimeters,
          basis: 'user-confirmed' as const,
          confirmed: true,
          confirmedAt: preparation.preparedAt
        },
    ...(preparation.parseResult.drawing ? { drawing: preparation.parseResult.drawing } : {}),
    ...(preparation.parseResult.units ? { units: preparation.parseResult.units } : {})
  };
}

function ownFailure(
  code:
    | 'DXF_REIMPORT_PROJECT_REQUIRED'
    | 'DXF_REIMPORT_RAW_SOURCE_REQUIRED'
    | 'DXF_REIMPORT_SOURCE_CHANGED'
    | 'DXF_REIMPORT_PROJECT_CHANGED'
    | 'DXF_REIMPORT_CONFIRMATION_REQUIRED'
    | 'DXF_REIMPORT_REBUILD_ACKNOWLEDGEMENT_REQUIRED'
    | 'DXF_REIMPORT_DECLARED_UNIT_OVERRIDE_UNACKNOWLEDGED'
    | 'DXF_REIMPORT_GEOMETRY_REQUIRED',
  message: string
): { readonly ok: false; readonly error: DxfProjectReimportError } {
  return { ok: false, error: { code, message } };
}

function jsonSnapshot<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
