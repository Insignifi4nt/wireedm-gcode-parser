import { buildOutputFilename } from '@/domain/post/gcodeTemplates';
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

  return requireProjectUpidDocument(project.id, upid.document as UniversalPathIntelligenceDocument);
}

export function composeProjectUpidGCodeExport(
  project: WorkbenchProject,
  document: UniversalPathIntelligenceDocument
): ProjectUpidGCodeExport {
  assertUpidProjectSource(project);
  const pathDocument = requireProjectUpidDocument(project.id, document);
  const machine = project.machine;
  const exportProgram = composeUpidGCodeExport(pathDocument, {
    header: machine.templates.header,
    footer: machine.templates.footer,
    lineEnding: machine.output.lineEnding,
    coordinatePrecision: machine.output.coordinatePrecision
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
