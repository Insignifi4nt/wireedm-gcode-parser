import type { PathDiagnostic, PathPlanningDocument } from '@/domain/path-intel/types';
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

import { buildDxfImportUnitCandidates, type DxfImportUnitCandidate } from './dxfImportUnits';
import { dxfEntitiesToUpidDocument } from './dxfToUpid';
import {
  prepareDxfProjectImport,
  type DxfImportPreparation,
  type DxfImportPreparationError
} from './prepareDxfProjectImport';
import type { DxfParseResult } from './types';

export interface ImportDxfProjectInput {
  readonly fileName: string;
  readonly text: string;
  readonly unitCandidateId: string;
  readonly declaredUnitOverrideAcknowledged: boolean;
  readonly now?: Date;
}

export interface DxfImportDecision {
  readonly unitCandidateId: string;
  readonly confirmed: boolean;
  readonly declaredUnitOverrideAcknowledged: boolean;
}

export interface ImportedDxfProject {
  readonly workbench: ConnectedWorkbenchCatalog;
  readonly project: WorkbenchProjectDocument;
  readonly parseResult: DxfParseResult;
  readonly entityCount: number;
  readonly pathDocument: PathPlanningDocument;
  readonly pathDiagnostics: readonly PathDiagnostic[];
}

export type DxfProjectImportError =
  | DxfImportPreparationError
  | WorkbenchProjectError
  | Extract<AddStoredWorkbenchProjectResult, { readonly ok: false }>['error']
  | {
      readonly code:
        | 'DXF_IMPORT_CONFIRMATION_REQUIRED'
        | 'DXF_IMPORT_DECLARED_UNIT_OVERRIDE_UNACKNOWLEDGED'
        | 'DXF_IMPORT_GEOMETRY_REQUIRED';
      readonly message: string;
    }
  | {
      readonly code: 'DXF_IMPORT_UNIT_CANDIDATE_NOT_FOUND';
      readonly message: string;
      readonly candidateId: string;
    }
  | {
      readonly code: 'DXF_IMPORT_REVIEW_CHANGED';
      readonly message: string;
      readonly candidateId: string;
    };

export type ImportDxfProjectResult =
  | ({ readonly ok: true } & ImportedDxfProject)
  | { readonly ok: false; readonly error: DxfProjectImportError };

export async function commitDxfProjectImport(
  workbench: ConnectedWorkbenchCatalog,
  preparation: DxfImportPreparation,
  decision: DxfImportDecision
): Promise<ImportDxfProjectResult> {
  if (!decision.confirmed) {
    return failure('DXF_IMPORT_CONFIRMATION_REQUIRED', 'DXF import requires explicit confirmation.');
  }
  const reviewed = preparation.unitCandidates.find(({ id }) => id === decision.unitCandidateId);
  if (!reviewed) return candidateNotFound(decision.unitCandidateId);
  const current = buildDxfImportUnitCandidates(
    preparation.parseResult.unitDeclaration,
    workbench.manifest.preferences.importUnits
  ).find(({ id }) => id === decision.unitCandidateId);
  if (!current || JSON.stringify(current) !== JSON.stringify(reviewed)) {
    return {
      ok: false,
      error: {
        code: 'DXF_IMPORT_REVIEW_CHANGED',
        message: `DXF unit candidate changed after review: ${decision.unitCandidateId}.`,
        candidateId: decision.unitCandidateId
      }
    };
  }
  const declaration = preparation.parseResult.unitDeclaration;
  const declaredScale = declaration.status === 'recognized'
    ? declaration.units.scaleToMillimeters
    : null;
  const overridesDeclaration = declaredScale !== null && declaredScale !== current.scaleToMillimeters;
  if (overridesDeclaration && !decision.declaredUnitOverrideAcknowledged) {
    return failure(
      'DXF_IMPORT_DECLARED_UNIT_OVERRIDE_UNACKNOWLEDGED',
      'Changing declared DXF units requires explicit acknowledgement.'
    );
  }

  const identity = importedProjectIdentity({
    fileName: preparation.fileName,
    fallbackName: 'DXF Import',
    stripExtension: /\.dxf$/i,
    timestamp: preparation.preparedAt,
    existingIds: [...workbench.manifest.projects, ...(workbench.manifest.deletedProjects ?? []).map(({ project }) => project)].map(({ id }) => id)
  });
  let pathDocument: PathPlanningDocument;
  try {
    pathDocument = jsonSnapshot(dxfEntitiesToUpidDocument(
      preparation.parseResult.entities,
      {},
      sourceMetadata(preparation, identity.id, current, overridesDeclaration)
    ));
  } catch (error) {
    return failure(
      'DXF_IMPORT_GEOMETRY_REQUIRED',
      error instanceof Error ? error.message : String(error)
    );
  }
  if (pathDocument.segments.length === 0 || pathDocument.plan.operations.length === 0) {
    return failure('DXF_IMPORT_GEOMETRY_REQUIRED', 'DXF did not contain valid cut geometry.');
  }
  const sourcePath = `imports/${identity.id}.dxf`;
  const created = createWorkbenchProjectDocument({
    id: identity.id,
    name: identity.name,
    source: {
      kind: 'dxf',
      files: [{
        name: preparation.fileName,
        path: sourcePath,
        kind: 'dxf',
        createdAt: preparation.preparedAt
      }]
    },
    content: { kind: 'upid-document', document: pathDocument },
    now: new Date(preparation.preparedAt)
  });
  if (!created.ok) return created;
  const stored = await addStoredWorkbenchProject(workbench, {
    project: created.project,
    ownedFiles: [{ path: sourcePath, contents: preparation.text }]
  });
  if (!stored.ok) return stored;
  return {
    ok: true,
    workbench: stored.workbench,
    project: stored.project,
    parseResult: preparation.parseResult,
    entityCount: preparation.entityCount,
    pathDocument,
    pathDiagnostics: pathDocument.diagnostics
  };
}

export async function importDxfProject(
  workbench: ConnectedWorkbenchCatalog,
  input: ImportDxfProjectInput
): Promise<ImportDxfProjectResult> {
  const prepared = prepareDxfProjectImport(workbench, input);
  if (!prepared.ok) return prepared;
  return commitDxfProjectImport(workbench, prepared.preparation, {
    unitCandidateId: input.unitCandidateId,
    confirmed: true,
    declaredUnitOverrideAcknowledged: input.declaredUnitOverrideAcknowledged
  });
}

function sourceMetadata(
  preparation: DxfImportPreparation,
  projectId: string,
  candidate: DxfImportUnitCandidate,
  overridesDeclaration: boolean
) {
  const declared = preparation.parseResult.unitDeclaration.status === 'recognized'
    ? preparation.parseResult.unitDeclaration.units
    : null;
  const overrideWarning = overridesDeclaration
    ? `Declared DXF units "${declared?.label}" were overridden with confirmed units "${candidate.label}".`
    : null;
  return {
    fileName: preparation.fileName,
    importedAt: preparation.preparedAt,
    importWarnings: [
      ...preparation.parseResult.warnings,
      ...(overrideWarning ? [overrideWarning] : [])
    ],
    projectId,
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

function candidateNotFound(candidateId: string): ImportDxfProjectResult {
  return {
    ok: false,
    error: {
      code: 'DXF_IMPORT_UNIT_CANDIDATE_NOT_FOUND',
      message: `DXF unit candidate was not reviewed: ${candidateId}.`,
      candidateId
    }
  };
}

function failure(
  code:
    | 'DXF_IMPORT_CONFIRMATION_REQUIRED'
    | 'DXF_IMPORT_DECLARED_UNIT_OVERRIDE_UNACKNOWLEDGED'
    | 'DXF_IMPORT_GEOMETRY_REQUIRED',
  message: string
): { readonly ok: false; readonly error: DxfProjectImportError } {
  return { ok: false, error: { code, message } };
}

function jsonSnapshot<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
