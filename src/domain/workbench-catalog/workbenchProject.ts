import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import { PostIdentifierSchema } from '@/domain/post-processor/postFormatPrimitives';
import type { DeepReadonly } from '@/domain/post-processor/postPackageSchema';
import type { PathDiagnostic, PathPlanningDocument } from '@/domain/path-intel/types';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';
import { projectNameError } from './projectName';

export const WORKBENCH_PROJECT_SCHEMA_VERSION = 2 as const;
const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
const strictObject = { additionalProperties: false } as const;
const TimestampSchema = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
});
const SourceFileCommon = {
  name: Type.String({ minLength: 1, maxLength: 512 }),
  path: Type.String({ minLength: 1, maxLength: 1_024, pattern: '^(imports|projects)/[^\\u0000]+$' }),
  createdAt: TimestampSchema
};

function projectSourceSchema<const Kind extends 'dxf' | 'upid' | 'external-gcode'>(kind: Kind) {
  return Type.Object({
    kind: Type.Literal(kind),
    files: Type.Array(Type.Object({
      ...SourceFileCommon,
      kind: Type.Literal(kind)
    }, strictObject), { maxItems: 10_000 })
  }, strictObject);
}

const UpidContentSchema = Type.Object({
  kind: Type.Literal('upid-document'),
  document: Type.Unknown({ description: 'A structurally valid Universal Path Intelligence Document.' })
}, strictObject);

const ExternalGcodeContentSchema = Type.Object({
  kind: Type.Literal('external-gcode'),
  activeFilePath: Type.String({ minLength: 1, maxLength: 1_024 })
}, strictObject);

const ProjectCommon = {
  format: Type.Literal('wire-edm-project'),
  schemaVersion: Type.Literal(WORKBENCH_PROJECT_SCHEMA_VERSION),
  id: PostIdentifierSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  editor: Type.Object({
    pinnedLineNumbers: Type.Array(Type.Integer({ minimum: 1 }), {
      maxItems: 100_000,
      uniqueItems: true
    })
  }, strictObject),
  savedRevisionIds: Type.Array(PostIdentifierSchema, { maxItems: 100_000, uniqueItems: true })
};

export const WorkbenchProjectDocumentSchema = Type.Union([
  Type.Object({ ...ProjectCommon, source: projectSourceSchema('dxf'), content: UpidContentSchema }, strictObject),
  Type.Object({ ...ProjectCommon, source: projectSourceSchema('upid'), content: UpidContentSchema }, strictObject),
  Type.Object({
    ...ProjectCommon,
    source: projectSourceSchema('external-gcode'),
    content: ExternalGcodeContentSchema
  }, strictObject)
], {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wire-edm.local/schemas/wire-edm-project-v2.json',
  additionalProperties: false
});

export type WorkbenchProjectDocumentValue = Static<typeof WorkbenchProjectDocumentSchema>;
export type WorkbenchProjectDocument = DeepReadonly<WorkbenchProjectDocumentValue>;

type WorkbenchProjectParseBoundaryError =
  | {
      code: 'WORKBENCH_PROJECT_VERSION_UNSUPPORTED';
      message: string;
      foundVersion: number;
      supportedVersion: typeof WORKBENCH_PROJECT_SCHEMA_VERSION;
    }
  | { code: 'WORKBENCH_PROJECT_FILE_TOO_LARGE'; message: string; actualBytes: number; maximumBytes: number }
  | { code: 'WORKBENCH_PROJECT_JSON_INVALID'; message: string };

type WorkbenchProjectValidationError =
  | { code: 'WORKBENCH_PROJECT_SCHEMA_INVALID'; message: string; path: string }
  | { code: 'WORKBENCH_PROJECT_TIMESTAMP_INVALID'; message: string; path: string }
  | { code: 'WORKBENCH_PROJECT_DUPLICATE_FILE'; message: string; path: string }
  | { code: 'WORKBENCH_PROJECT_ACTIVE_FILE_NOT_FOUND'; message: string; path: '/content/activeFilePath' }
  | {
      code: 'WORKBENCH_PROJECT_UPID_INVALID';
      message: string;
      path: '/content/document';
      diagnostics: readonly PathDiagnostic[];
    };

export type WorkbenchProjectError = WorkbenchProjectParseBoundaryError | WorkbenchProjectValidationError;

export type WorkbenchProjectResult =
  | { ok: true; project: WorkbenchProjectDocument }
  | { ok: false; error: WorkbenchProjectError };

export type CreateWorkbenchProjectResult =
  | { ok: true; project: WorkbenchProjectDocument }
  | { ok: false; error: WorkbenchProjectValidationError };

interface CreateWorkbenchProjectInputCommon {
  readonly id: string;
  readonly name: string;
  readonly now?: Date;
}

type SourceFileInput<Kind extends 'dxf' | 'upid' | 'external-gcode'> = {
  readonly name: string;
  readonly path: string;
  readonly kind: Kind;
  readonly createdAt: string;
};

type CreateWorkbenchProjectInput = CreateWorkbenchProjectInputCommon & (
  | {
      readonly source: {
        readonly kind: 'dxf';
        readonly files: readonly SourceFileInput<'dxf'>[];
      };
      readonly content: { readonly kind: 'upid-document'; readonly document: PathPlanningDocument };
    }
  | {
      readonly source: {
        readonly kind: 'upid';
        readonly files: readonly SourceFileInput<'upid'>[];
      };
      readonly content: { readonly kind: 'upid-document'; readonly document: PathPlanningDocument };
    }
  | {
      readonly source: {
        readonly kind: 'external-gcode';
        readonly files: readonly SourceFileInput<'external-gcode'>[];
      };
      readonly content: { readonly kind: 'external-gcode'; readonly activeFilePath: string };
    }
);

export function createWorkbenchProjectDocument(
  input: CreateWorkbenchProjectInput
): CreateWorkbenchProjectResult {
  const nameError = projectNameError(input.name);
  if (nameError) return invalidProjectName(nameError);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return { ok: false, error: {
      code: 'WORKBENCH_PROJECT_TIMESTAMP_INVALID',
      message: 'Project creation requires a valid timestamp.',
      path: '/createdAt'
    } };
  }
  const timestamp = now.toISOString();
  return validateWorkbenchProjectValue({
    format: 'wire-edm-project',
    schemaVersion: WORKBENCH_PROJECT_SCHEMA_VERSION,
    id: input.id,
    name: input.name.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
    source: input.source,
    content: input.content,
    editor: { pinnedLineNumbers: [] },
    savedRevisionIds: []
  });
}

export function parseWorkbenchProjectDocument(rawText: string): WorkbenchProjectResult {
  const sizeError = projectSizeError(rawText);
  if (sizeError) return { ok: false, error: sizeError };
  let value: unknown;
  try {
    value = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      error: {
        code: 'WORKBENCH_PROJECT_JSON_INVALID',
        message: 'Workbench project is not valid JSON.'
      }
    };
  }
  const record = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (
    record &&
    typeof record.schemaVersion === 'number' &&
    record.schemaVersion !== WORKBENCH_PROJECT_SCHEMA_VERSION &&
    record.schemaVersion !== 1
  ) {
    return {
      ok: false,
      error: {
        code: 'WORKBENCH_PROJECT_VERSION_UNSUPPORTED',
        message: `Workbench project schema version ${record.schemaVersion} is unsupported. Create or import a version-2 project.`,
        foundVersion: record.schemaVersion,
        supportedVersion: WORKBENCH_PROJECT_SCHEMA_VERSION
      }
    };
  }
  return validateWorkbenchProjectValue(migrateLegacyWorkbenchProjectValue(value));
}

/** Check the exact persisted encoding, including indentation, before changing owned files. */
export function serializeWorkbenchProjectDocument(project: WorkbenchProjectDocument):
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: Extract<WorkbenchProjectError, { code: 'WORKBENCH_PROJECT_FILE_TOO_LARGE' }> } {
  const text = `${JSON.stringify(project, null, 2)}\n`;
  const sizeError = projectSizeError(text);
  return sizeError ? { ok: false, error: sizeError } : { ok: true, text };
}

function projectSizeError(text: string): Extract<WorkbenchProjectError, { code: 'WORKBENCH_PROJECT_FILE_TOO_LARGE' }> | null {
  const actualBytes = new TextEncoder().encode(text).byteLength;
  return actualBytes > MAX_PROJECT_BYTES ? {
    code: 'WORKBENCH_PROJECT_FILE_TOO_LARGE',
    message: `Workbench project is ${actualBytes} UTF-8 bytes; the maximum is ${MAX_PROJECT_BYTES}.`,
    actualBytes, maximumBytes: MAX_PROJECT_BYTES
  } : null;
}

function migrateLegacyWorkbenchProjectValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const project = value as Record<string, unknown>;
  if (project.schemaVersion !== 1 || Object.hasOwn(project, 'format')) return value;
  const source = project.source;
  const editor = project.editor;
  if (
    source === null || typeof source !== 'object' || Array.isArray(source) ||
    editor === null || typeof editor !== 'object' || Array.isArray(editor)
  ) return value;
  const sourceRecord = source as Record<string, unknown>;
  const editorRecord = editor as Record<string, unknown>;
  const upid = project.upid;
  const upidRecord = upid !== null && typeof upid === 'object' && !Array.isArray(upid)
    ? upid as Record<string, unknown>
    : null;
  const sourceKind = sourceRecord.kind;
  const pathProject = sourceKind === 'dxf' || sourceKind === 'upid';
  const legacyEmptyPath = `projects/${String(project.id)}/legacy-empty.txt`;
  const content = pathProject
    ? {
        kind: 'upid-document',
        document: upidRecord?.format === 'upid'
          ? upidRecord.document
          : createUpidFromDxfEntities([])
      }
    : {
        kind: 'external-gcode',
        activeFilePath: typeof editorRecord.activeFilePath === 'string'
          ? editorRecord.activeFilePath
          : legacyEmptyPath
      };
  const sourceFiles = pathProject || typeof editorRecord.activeFilePath === 'string'
    ? sourceRecord.files
    : [
        ...(Array.isArray(sourceRecord.files) ? sourceRecord.files : []),
        {
          name: 'legacy-empty.txt',
          path: legacyEmptyPath,
          kind: 'external-gcode',
          createdAt: project.createdAt
        }
      ];
  return {
    format: 'wire-edm-project',
    schemaVersion: WORKBENCH_PROJECT_SCHEMA_VERSION,
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    source: { ...sourceRecord, files: sourceFiles },
    content,
    editor: { pinnedLineNumbers: editorRecord.pinnedLineNumbers },
    savedRevisionIds: []
  };
}

function validateWorkbenchProjectValue(value: unknown): CreateWorkbenchProjectResult {
  const schemaError = Value.Errors(WorkbenchProjectDocumentSchema, value).First();
  if (schemaError) {
    return {
      ok: false,
      error: {
        code: 'WORKBENCH_PROJECT_SCHEMA_INVALID',
        message: `Workbench project schema violation at ${schemaError.path || '/'}: ${schemaError.message}.`,
        path: schemaError.path
      }
    };
  }
  const project = value as WorkbenchProjectDocumentValue;
  const nameError = projectNameError(project.name);
  if (nameError) return invalidProjectName(nameError);
  for (const [path, timestamp] of [
    ['/createdAt', project.createdAt],
    ['/updatedAt', project.updatedAt],
    ...project.source.files.map((file, index) => [`/source/files/${index}/createdAt`, file.createdAt])
  ] as const) {
    if (isCanonicalTimestamp(timestamp)) continue;
    return {
      ok: false,
      error: {
        code: 'WORKBENCH_PROJECT_TIMESTAMP_INVALID',
        message: `${path} must be a real canonical UTC timestamp.`,
        path
      }
    };
  }
  const firstFileIndex = new Map<string, number>();
  for (const [index, file] of project.source.files.entries()) {
    const firstIndex = firstFileIndex.get(file.path);
    if (firstIndex !== undefined) {
      return {
        ok: false,
        error: {
          code: 'WORKBENCH_PROJECT_DUPLICATE_FILE',
          message: `Project source file path ${file.path} is duplicated; it first appears at /source/files/${firstIndex}.`,
          path: `/source/files/${index}/path`
        }
      };
    }
    firstFileIndex.set(file.path, index);
  }

  if (project.content.kind === 'external-gcode') {
    const activeFilePath = project.content.activeFilePath;
    const activeFile = project.source.files.find(({ path }) => path === activeFilePath);
    if (!activeFile || activeFile.kind !== 'external-gcode') {
      return {
        ok: false,
        error: {
          code: 'WORKBENCH_PROJECT_ACTIVE_FILE_NOT_FOUND',
          message: `Active external program does not name an external-gcode source file: ${activeFilePath}.`,
          path: '/content/activeFilePath'
        }
      };
    }
  } else {
    // Local snapshots written before UPID v2 are retained byte-for-byte. Portable v1 remains strict.
    const report = validateUpidDocument(project.content.document, { allowLegacyV1Extensions: true });
    if (!report.structurallyValid) {
      return {
        ok: false,
        error: {
          code: 'WORKBENCH_PROJECT_UPID_INVALID',
          message: 'Workbench project contains a structurally invalid UPID document.',
          path: '/content/document',
          diagnostics: report.structuralDiagnostics
        }
      };
    }
  }

  return { ok: true, project: deepFreeze(project) };
}

function isCanonicalTimestamp(value: string) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function invalidProjectName(message: string): CreateWorkbenchProjectResult {
  return { ok: false, error: {
    code: 'WORKBENCH_PROJECT_SCHEMA_INVALID', message, path: '/name'
  } };
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
