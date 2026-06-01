import type { WorkbenchProject, WorkbenchUpidState } from '@/domain/workbench/types';

import type { UniversalPathIntelligenceDocument } from './upidDocument';

const PROJECT_UPID_FORMAT = 'upid';
const PROJECT_UPID_SCHEMA_VERSION = 1;
const UPID_DOCUMENT_SCHEMA_VERSION = 1;

interface ProjectUpidCandidate {
  format?: unknown;
  schemaVersion?: unknown;
  document?: {
    schemaVersion?: unknown;
  };
}

export function createProjectUpid(document: UniversalPathIntelligenceDocument): WorkbenchUpidState {
  return {
    format: PROJECT_UPID_FORMAT,
    schemaVersion: PROJECT_UPID_SCHEMA_VERSION,
    document
  };
}

export function projectUpidDocument(project: WorkbenchProject | null | undefined) {
  const upid = project?.upid as ProjectUpidCandidate | undefined;
  if (!upid) {
    return null;
  }

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

  return upid.document as UniversalPathIntelligenceDocument;
}

export function withProjectUpid(
  project: WorkbenchProject,
  document: UniversalPathIntelligenceDocument
): WorkbenchProject {
  return {
    ...project,
    upid: createProjectUpid(document)
  };
}
