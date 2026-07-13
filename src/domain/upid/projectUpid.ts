import { buildOutputFilename } from '@/domain/post/gcodeTemplates';
import type { AppliedDxfUnits, DxfUnitDeclaration } from '@/domain/dxf/types';
import type { WorkbenchProject, WorkbenchUpidState } from '@/domain/workbench/types';

import {
  composeUpidGCodeExport,
  type UpidGCodeExport,
  type UniversalPathIntelligenceDocument
} from './upidDocument';
import { validateUpidDocument } from './validateUpidDocument';

const PROJECT_UPID_FORMAT = 'upid';
const PROJECT_UPID_SCHEMA_VERSION = 1;
const UPID_DOCUMENT_SCHEMA_VERSION = 1;

interface ProjectUpidCandidate {
  format?: unknown;
  schemaVersion?: unknown;
  document?: {
    schemaVersion?: unknown;
    source?: {
      projectId?: unknown;
    };
  };
}

export interface ProjectUpidGCodeExport extends UpidGCodeExport {
  fileName: string;
  machineName: string;
  pathDocument: UniversalPathIntelligenceDocument;
}

export function createProjectUpid(
  project: WorkbenchProject,
  document: UniversalPathIntelligenceDocument
): WorkbenchUpidState {
  assertUpidProjectSource(project);

  return {
    format: PROJECT_UPID_FORMAT,
    schemaVersion: PROJECT_UPID_SCHEMA_VERSION,
    document: stampProjectUpidDocument(project.id, document)
  };
}

export function projectUpidDocument(project: WorkbenchProject | null | undefined) {
  if (!project) {
    return null;
  }

  const upid = project.upid as ProjectUpidCandidate | undefined;
  if (!upid) {
    return null;
  }
  assertUpidProjectSource(project);

  if (upid.format !== PROJECT_UPID_FORMAT) {
    throw new Error(`Unsupported UPID project format: ${String(upid.format)}.`);
  }

  if (upid.schemaVersion !== PROJECT_UPID_SCHEMA_VERSION) {
    throw new Error(`Unsupported UPID project schema version: ${String(upid.schemaVersion)}.`);
  }

  if (upid.document?.schemaVersion !== UPID_DOCUMENT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported UPID document schema version: ${String(upid.document?.schemaVersion)}.`
    );
  }

  return requireProjectUpidDocument(
    project.id,
    normalizeLegacyProjectUpidDocument(upid.document as UniversalPathIntelligenceDocument)
  );
}

export function composeProjectUpidGCodeExport(
  project: WorkbenchProject,
  document: UniversalPathIntelligenceDocument
): ProjectUpidGCodeExport {
  assertUpidProjectSource(project);
  const pathDocument = requireProjectUpidDocument(project.id, document);
  const machine = project.machine;
  const exportProgram = composeUpidGCodeExport(pathDocument, {
    machine
  });

  return {
    ...exportProgram,
    fileName: buildOutputFilename(
      project.id,
      machine.output.extension,
      machine.output.customExtension
    ),
    machineName: machine.name,
    pathDocument
  };
}

function requireProjectUpidDocument(
  projectId: string,
  document: UniversalPathIntelligenceDocument
) {
  const validation = validateUpidDocument(document);
  if (!validation.structurallyValid) {
    throw new Error(
      `Invalid UPID document: ${validation.structuralDiagnostics
        .map((diagnostic) => diagnostic.message)
        .join('; ')}`
    );
  }

  const documentProjectId = document.source.projectId;
  if (typeof documentProjectId !== 'string') {
    throw new Error(`UPID document project identity is required for ${projectId}.`);
  }

  if (documentProjectId !== projectId) {
    throw new Error(
      `UPID document project mismatch: ${documentProjectId} cannot be used by ${projectId}.`
    );
  }

  return document;
}

export function normalizeLegacyProjectUpidDocument(
  document: UniversalPathIntelligenceDocument
): UniversalPathIntelligenceDocument {
  const options = document?.options as
    | Partial<UniversalPathIntelligenceDocument['options']>
    | undefined;
  const hasLayerFilters =
    options?.includeLayers !== undefined && options.excludeLayers !== undefined;
  const hasGeometryBasis = document.geometryBasis !== undefined;
  const sourceMigration = legacyDxfUnitMetadata(document);
  if ((!options || hasLayerFilters) && hasGeometryBasis && !sourceMigration) {
    return document;
  }

  return {
    ...document,
    geometryBasis: document.geometryBasis ?? 'wire-centre',
    ...(!hasGeometryBasis
      ? {
          plan: {
            ...document.plan,
            operations: document.plan.operations.map(withoutAutomaticCompensationIntent)
          },
          pathElements: document.pathElements.map(withoutAutomaticCompensationIntent)
        }
      : {}),
    ...(!options || hasLayerFilters
      ? {}
      : {
          options: {
            ...document.options,
            includeLayers: options.includeLayers === undefined ? [] : options.includeLayers,
            excludeLayers: options.excludeLayers === undefined ? [] : options.excludeLayers
          }
        }),
    ...(sourceMigration
      ? {
          source: {
            ...document.source,
            ...sourceMigration
          }
        }
      : {})
  };
}

function legacyDxfUnitMetadata(
  document: UniversalPathIntelligenceDocument
): {
  appliedUnits?: AppliedDxfUnits;
  unitDeclaration?: DxfUnitDeclaration;
} | null {
  const source = document.source;
  if (!source || typeof source !== 'object') return null;
  const unitDeclaration = source.unitDeclaration ?? legacyUnitDeclaration(source.units);
  const appliedUnits = source.appliedUnits ?? legacyAppliedUnits(
    source.units,
    source.coordinateScaleToMillimeters
  );
  if (unitDeclaration === source.unitDeclaration && appliedUnits === source.appliedUnits) {
    return null;
  }
  return {
    ...(source.unitDeclaration ? {} : { unitDeclaration }),
    ...(source.appliedUnits || !appliedUnits ? {} : { appliedUnits })
  };
}

function legacyUnitDeclaration(
  units: UniversalPathIntelligenceDocument['source']['units']
): DxfUnitDeclaration {
  if (!units) return { status: 'missing' };
  if (units.code === 0) return { status: 'unitless', units: { ...units } };
  if (
    units.scaleToMillimeters != null &&
    Number.isFinite(units.scaleToMillimeters) &&
    units.scaleToMillimeters > 0
  ) {
    return { status: 'recognized', units: { ...units } };
  }
  return { status: 'unknown', units: { ...units } };
}

function legacyAppliedUnits(
  units: UniversalPathIntelligenceDocument['source']['units'],
  coordinateScaleToMillimeters: number | undefined
): AppliedDxfUnits | undefined {
  const rawScale = units?.scaleToMillimeters;
  if (
    units &&
    rawScale != null &&
    Number.isFinite(rawScale) &&
    rawScale > 0 &&
    coordinateScaleToMillimeters === rawScale
  ) {
    return {
      label: units.label,
      scaleToMillimeters: rawScale,
      basis: 'dxf-declared',
      confirmed: true
    };
  }
  if (
    coordinateScaleToMillimeters === 1 &&
    (!units || units.scaleToMillimeters == null)
  ) {
    return {
      label: 'millimeters',
      scaleToMillimeters: 1,
      basis: 'legacy-assumed',
      confirmed: false
    };
  }
  return undefined;
}

function withoutAutomaticCompensationIntent<T extends { compensationIntent?: unknown }>(
  value: T
): T {
  const intent = value.compensationIntent as { source?: unknown } | undefined;
  if (intent?.source !== 'automatic') return value;
  const { compensationIntent: _ignored, ...rest } = value;
  return rest as T;
}

function stampProjectUpidDocument(
  projectId: string,
  document: UniversalPathIntelligenceDocument
): UniversalPathIntelligenceDocument {
  const documentProjectId = document.source.projectId;
  if (typeof documentProjectId === 'string' && documentProjectId !== projectId) {
    throw new Error(
      `UPID document project mismatch: ${documentProjectId} cannot be used by ${projectId}.`
    );
  }

  if (documentProjectId === projectId) {
    return document;
  }

  return {
    ...document,
    source: {
      ...document.source,
      projectId
    }
  };
}

function assertUpidProjectSource(project: WorkbenchProject) {
  if (project.source.kind !== 'dxf') {
    throw new Error('UPID path state can only be attached to DXF projects.');
  }
}

export function withProjectUpid(
  project: WorkbenchProject,
  document: UniversalPathIntelligenceDocument
): WorkbenchProject {
  return {
    ...project,
    upid: createProjectUpid(project, document)
  };
}
