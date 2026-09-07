import type { PathPlanningDocument } from '@/domain/path-intel/types';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import {
  addStoredWorkbenchProject,
  readStoredWorkbenchProject,
  type AddStoredWorkbenchProjectResult,
  type ReadStoredWorkbenchProjectError
} from '@/domain/workbench-catalog/workbenchCatalogMutations';
import { importedProjectIdentity } from '@/domain/workbench-catalog/importedProjectIdentity';
import {
  createWorkbenchProjectDocument,
  type WorkbenchProjectDocument,
  type WorkbenchProjectError
} from '@/domain/workbench-catalog/workbenchProject';

import { assertPortableUpidV1Shape } from './portableUpidV1Shape';
import { validateUpidDocument } from './validateUpidDocument';

export interface PortableUpidProjectExport {
  readonly fileName: string;
  readonly text: string;
}

export interface ImportPortableUpidProjectInput {
  readonly fileName: string;
  readonly text: string;
  readonly now?: Date;
}

export type PortableUpidProjectError =
  | WorkbenchProjectError
  | ReadStoredWorkbenchProjectError
  | Extract<AddStoredWorkbenchProjectResult, { readonly ok: false }>['error']
  | { readonly code: 'PORTABLE_UPID_JSON_INVALID'; readonly message: string }
  | { readonly code: 'PORTABLE_UPID_SCHEMA_INVALID'; readonly message: string }
  | {
      readonly code: 'PORTABLE_UPID_VERSION_UNSUPPORTED';
      readonly message: string;
      readonly foundVersion: number;
      readonly supportedVersion: 1;
    }
  | { readonly code: 'PORTABLE_UPID_DOCUMENT_INVALID'; readonly message: string }
  | { readonly code: 'PORTABLE_UPID_PROJECT_REQUIRED'; readonly message: string }
  | { readonly code: 'PORTABLE_UPID_TIMESTAMP_INVALID'; readonly message: string };

export type ExportPortableUpidProjectResult =
  | { readonly ok: true; readonly file: PortableUpidProjectExport }
  | { readonly ok: false; readonly error: PortableUpidProjectError };

export type ImportPortableUpidProjectResult =
  | {
      readonly ok: true;
      readonly workbench: ConnectedWorkbenchCatalog;
      readonly project: WorkbenchProjectDocument;
      readonly pathDocument: PathPlanningDocument;
    }
  | { readonly ok: false; readonly error: PortableUpidProjectError };

export async function exportPortableUpidProject(
  workbench: ConnectedWorkbenchCatalog,
  projectId: string
): Promise<ExportPortableUpidProjectResult> {
  const read = await readStoredWorkbenchProject(workbench, projectId);
  if (!read.ok) return read;
  if (read.project.content.kind !== 'upid-document') {
    return ownFailure(
      'PORTABLE_UPID_PROJECT_REQUIRED',
      'Only DXF or UPID projects can be exported as portable UPID.'
    );
  }
  const document = detachedPortableDocument(
    read.project.content.document as PathPlanningDocument
  );
  try {
    assertPortableUpidV1Shape(document);
  } catch (error) {
    return ownFailure(
      'PORTABLE_UPID_DOCUMENT_INVALID',
      error instanceof Error ? error.message : String(error)
    );
  }
  const file = {
    fileName: `${portableFileBaseName(read.project.name)}.upid.json`,
    text: JSON.stringify({ format: 'upid', schemaVersion: 1, document }, null, 2)
  };
  return { ok: true, file };
}

export async function importPortableUpidProject(
  workbench: ConnectedWorkbenchCatalog,
  input: ImportPortableUpidProjectInput
): Promise<ImportPortableUpidProjectResult> {
  const parsed = parsePortableUpid(input.text);
  if (!parsed.ok) return parsed;
  const document = detachedPortableDocument(parsed.document);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return ownFailure(
      'PORTABLE_UPID_TIMESTAMP_INVALID',
      'Portable UPID import timestamp is invalid.'
    );
  }
  const timestamp = now.toISOString();
  const identity = importedProjectIdentity({
    fileName: input.fileName,
    fallbackName: 'UPID Import',
    stripExtension: /\.upid\.json$/i,
    timestamp,
    existingIds: [...workbench.manifest.projects, ...(workbench.manifest.deletedProjects ?? []).map(({ project }) => project)].map(({ id }) => id)
  });
  const sourcePath = `imports/${identity.id}.upid.json`;
  const portableText = JSON.stringify({ format: 'upid', schemaVersion: 1, document }, null, 2);
  const created = createWorkbenchProjectDocument({
    id: identity.id,
    name: identity.name,
    source: {
      kind: 'upid',
      files: [{
        name: input.fileName,
        path: sourcePath,
        kind: 'upid',
        createdAt: timestamp
      }]
    },
    content: { kind: 'upid-document', document },
    now: new Date(timestamp)
  });
  if (!created.ok) return created;
  const stored = await addStoredWorkbenchProject(workbench, {
    project: created.project,
    ownedFiles: [{ path: sourcePath, contents: portableText }]
  });
  if (!stored.ok) return stored;
  return {
    ok: true,
    workbench: stored.workbench,
    project: stored.project,
    pathDocument: document
  };
}

function parsePortableUpid(
  text: string
): { readonly ok: true; readonly document: PathPlanningDocument } |
  { readonly ok: false; readonly error: PortableUpidProjectError } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return ownFailure('PORTABLE_UPID_JSON_INVALID', 'Portable UPID is not valid JSON.');
  }
  if (!isRecord(value)) {
    return ownFailure('PORTABLE_UPID_SCHEMA_INVALID', 'Portable UPID must be an object.');
  }
  if (typeof value.schemaVersion === 'number' && value.schemaVersion !== 1) {
    return {
      ok: false,
      error: {
        code: 'PORTABLE_UPID_VERSION_UNSUPPORTED',
        message: `Portable UPID schema version ${value.schemaVersion} is unsupported.`,
        foundVersion: value.schemaVersion,
        supportedVersion: 1
      }
    };
  }
  if (
    value.format !== 'upid' ||
    value.schemaVersion !== 1 ||
    Object.keys(value).sort().join(',') !== 'document,format,schemaVersion'
  ) {
    return ownFailure('PORTABLE_UPID_SCHEMA_INVALID', 'Portable UPID must match the strict schema.');
  }
  const document = value.document as PathPlanningDocument;
  try {
    assertPortableUpidV1Shape(document);
  } catch (error) {
    return ownFailure(
      'PORTABLE_UPID_SCHEMA_INVALID',
      error instanceof Error ? error.message : String(error)
    );
  }
  const report = validateUpidDocument(document);
  if (!report.structurallyValid) {
    return ownFailure(
      'PORTABLE_UPID_DOCUMENT_INVALID',
      report.structuralDiagnostics.map(({ message }) => message).join('; ')
    );
  }
  return { ok: true, document: jsonSnapshot(document) };
}

function detachedPortableDocument(document: PathPlanningDocument) {
  const clone = jsonSnapshot(document);
  delete clone.source.projectId;
  return clone;
}

function portableFileBaseName(name: string) {
  const safe = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '');
  return safe || 'UPID Project';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ownFailure(
  code:
    | 'PORTABLE_UPID_JSON_INVALID'
    | 'PORTABLE_UPID_SCHEMA_INVALID'
    | 'PORTABLE_UPID_DOCUMENT_INVALID'
    | 'PORTABLE_UPID_PROJECT_REQUIRED'
    | 'PORTABLE_UPID_TIMESTAMP_INVALID',
  message: string
): { readonly ok: false; readonly error: PortableUpidProjectError } {
  return { ok: false, error: { code, message } };
}

function jsonSnapshot<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
