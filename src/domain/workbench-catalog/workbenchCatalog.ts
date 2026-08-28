import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { PostIdentifierSchema } from '@/domain/post-processor/postFormatPrimitives';
import {
  initializePostLibraryStorage,
  POST_LIBRARY_PATH,
  readPostLibraryStorage,
  type PostLibraryStorageError
} from '@/domain/post-processor/postLibraryStorage';
import type { PostLibrary } from '@/domain/post-processor/postLibrary';
import type { DeepReadonly } from '@/domain/post-processor/postPackageSchema';
import {
  initializeMachineLibraryStorage,
  MACHINE_LIBRARY_PATH,
  readMachineLibraryStorage,
  type MachineLibraryStorageError
} from '@/domain/machine-definition/machineLibraryStorage';
import type { MachineLibrary } from '@/domain/machine-definition/machineLibrary';

export const WORKBENCH_CATALOG_PATH = 'workbench.json';
export const WORKBENCH_SCHEMA_VERSION = 2 as const;
export const WORKBENCH_CATALOG_DIRECTORIES = ['imports', 'exports', 'projects'] as const;
const MAX_WORKBENCH_CATALOG_BYTES = 1024 * 1024;
const strictObject = { additionalProperties: false } as const;
const TimestampSchema = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
});

const ProjectIndexEntrySchema = Type.Object({
  id: PostIdentifierSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  path: Type.String({ minLength: 1, maxLength: 1_024, pattern: '^projects/[^\\u0000]+\\.json$' }),
  sourceKind: Type.Union([
    Type.Literal('dxf'),
    Type.Literal('upid'),
    Type.Literal('external-gcode')
  ]),
  updatedAt: TimestampSchema
}, strictObject);

const ImportUnitPreferenceSchema = Type.Union([
  Type.Object({ mode: Type.Literal('ask') }, strictObject),
  Type.Object({
    mode: Type.Literal('fixed'),
    unit: Type.Union([Type.Literal('millimeters'), Type.Literal('inches')])
  }, strictObject)
]);

const OutputExtensionPreferenceSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('standard'),
    extension: Type.Union([Type.Literal('iso'), Type.Literal('nc'), Type.Literal('gcode')])
  }, strictObject),
  Type.Object({
    kind: Type.Literal('custom'),
    extension: Type.String({ minLength: 1, maxLength: 16, pattern: '^[A-Za-z0-9]+$' })
  }, strictObject)
]);

const ExportPreferenceSchema = Type.Union([
  Type.Object({ status: Type.Literal('unconfigured') }, strictObject),
  Type.Object({
    status: Type.Literal('configured'),
    fileExtension: OutputExtensionPreferenceSchema,
    lineEnding: Type.Union([Type.Literal('lf'), Type.Literal('crlf')])
  }, strictObject)
]);

export const WorkbenchCatalogManifestSchema = Type.Object({
  format: Type.Literal('wire-edm-workbench'),
  schemaVersion: Type.Literal(WORKBENCH_SCHEMA_VERSION),
  name: Type.String({ minLength: 1, maxLength: 160 }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  preferences: Type.Object({
    importUnits: ImportUnitPreferenceSchema,
    export: ExportPreferenceSchema,
    recentPlanningMachineId: Type.Union([PostIdentifierSchema, Type.Null()])
  }, strictObject),
  projects: Type.Array(ProjectIndexEntrySchema, { maxItems: 10_000 })
}, {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wire-edm.local/schemas/wire-edm-workbench-v2.json',
  additionalProperties: false
});

export type WorkbenchCatalogManifestValue = Static<typeof WorkbenchCatalogManifestSchema>;
export type WorkbenchCatalogManifest = DeepReadonly<WorkbenchCatalogManifestValue>;

export interface ConnectedWorkbenchCatalog {
  readonly adapter: WorkbenchStorageAdapter;
  readonly manifest: WorkbenchCatalogManifest;
  readonly posts: PostLibrary;
  readonly machines: MachineLibrary;
}

type WorkbenchCatalogAccessError = {
  code: 'WORKBENCH_CATALOG_ACCESS_FAILED';
  message: string;
  operation: 'ensure-directory' | 'read' | 'write' | 'delete';
  path: string;
};

export type WorkbenchCatalogError =
  | PostLibraryStorageError
  | MachineLibraryStorageError
  | {
      code: 'WORKBENCH_CATALOG_VERSION_UNSUPPORTED';
      message: string;
      foundVersion: number;
      supportedVersion: typeof WORKBENCH_SCHEMA_VERSION;
    }
  | { code: 'WORKBENCH_CATALOG_JSON_INVALID'; message: string }
  | { code: 'WORKBENCH_CATALOG_SCHEMA_INVALID'; message: string; path: string }
  | { code: 'WORKBENCH_CATALOG_TIMESTAMP_INVALID'; message: string; path: string }
  | { code: 'WORKBENCH_CATALOG_DUPLICATE_PROJECT'; message: string; path: string }
  | {
      code: 'WORKBENCH_CATALOG_MACHINE_NOT_FOUND';
      message: string;
      path: '/preferences/recentPlanningMachineId';
      machineId: string;
    }
  | {
      code: 'WORKBENCH_CATALOG_INCOMPLETE';
      message: string;
      existingPaths: readonly string[];
    }
  | WorkbenchCatalogAccessError
  | {
      code: 'WORKBENCH_CATALOG_ROLLBACK_FAILED';
      message: string;
      originalError: WorkbenchCatalogAccessError;
      rollbackErrors: readonly WorkbenchCatalogAccessError[];
    };

export type InitializeWorkbenchCatalogResult =
  | { ok: true; kind: 'created' | 'opened'; workbench: ConnectedWorkbenchCatalog }
  | { ok: false; error: WorkbenchCatalogError };

interface InitializeWorkbenchCatalogOptions {
  readonly now?: Date;
}

export async function initializeWorkbenchCatalog(
  adapter: WorkbenchStorageAdapter,
  options: InitializeWorkbenchCatalogOptions = {}
): Promise<InitializeWorkbenchCatalogResult> {
  const catalogRead = await readStorageText(adapter, WORKBENCH_CATALOG_PATH);
  if (!catalogRead.ok) return catalogRead;

  if (catalogRead.rawText === null) {
    const companions = await existingCompanionPaths(adapter);
    if (!companions.ok) return companions;
    if (companions.paths.length > 0) {
      return {
        ok: false,
        error: {
          code: 'WORKBENCH_CATALOG_INCOMPLETE',
          message: `Workbench manifest is missing while companion data exists: ${companions.paths.join(', ')}.`,
          existingPaths: companions.paths
        }
      };
    }
    return createWorkbenchCatalog(adapter, options.now ?? new Date());
  }

  const parsedValue = parseCatalogJson(catalogRead.rawText);
  if (!parsedValue.ok) return parsedValue;
  const posts = await readPostLibraryStorage(adapter);
  if (!posts.ok) return posts;
  const machines = await readMachineLibraryStorage(adapter, posts.library);
  if (!machines.ok) return machines;
  const manifest = validateWorkbenchCatalogValue(parsedValue.value, machines.library);
  if (!manifest.ok) return manifest;

  return {
    ok: true,
    kind: 'opened',
    workbench: Object.freeze({
      adapter,
      manifest: manifest.manifest,
      posts: posts.library,
      machines: machines.library
    })
  };
}

async function createWorkbenchCatalog(
  adapter: WorkbenchStorageAdapter,
  now: Date
): Promise<InitializeWorkbenchCatalogResult> {
  const timestamp = now.toISOString();
  for (const directory of WORKBENCH_CATALOG_DIRECTORIES) {
    const ensured = await accessStorage(
      adapter,
      'ensure-directory',
      directory,
      () => adapter.ensureDirectory(directory)
    );
    if (!ensured.ok) return ensured;
  }
  const posts = await initializePostLibraryStorage(adapter);
  if (!posts.ok) return posts;
  const machines = await initializeMachineLibraryStorage(adapter, posts.library);
  if (!machines.ok) return machines;

  const manifest = Object.freeze({
    format: 'wire-edm-workbench' as const,
    schemaVersion: WORKBENCH_SCHEMA_VERSION,
    name: adapter.name,
    createdAt: timestamp,
    updatedAt: timestamp,
    preferences: Object.freeze({
      importUnits: Object.freeze({ mode: 'ask' as const }),
      export: Object.freeze({ status: 'unconfigured' as const }),
      recentPlanningMachineId: null
    }),
    projects: Object.freeze([])
  });
  const written = await accessStorage(
    adapter,
    'write',
    WORKBENCH_CATALOG_PATH,
    () => adapter.writeText(WORKBENCH_CATALOG_PATH, JSON.stringify(manifest, null, 2))
  );
  if (!written.ok) {
    const rollbackErrors: WorkbenchCatalogAccessError[] = [];
    for (const path of [MACHINE_LIBRARY_PATH, POST_LIBRARY_PATH]) {
      const deleted = await deleteStorage(adapter, path);
      if (!deleted.ok) rollbackErrors.push(deleted.error);
    }
    if (rollbackErrors.length > 0) {
      return {
        ok: false,
        error: {
          code: 'WORKBENCH_CATALOG_ROLLBACK_FAILED',
          message: `Workbench creation failed and companion cleanup also failed: ${rollbackErrors.map(({ message }) => message).join('; ')}.`,
          originalError: written.error,
          rollbackErrors
        }
      };
    }
    return written;
  }

  return {
    ok: true,
    kind: 'created',
    workbench: Object.freeze({
      adapter,
      manifest,
      posts: posts.library,
      machines: machines.library
    })
  };
}

function parseCatalogJson(rawText: string) {
  const actualBytes = new TextEncoder().encode(rawText).byteLength;
  if (actualBytes > MAX_WORKBENCH_CATALOG_BYTES) {
    return {
      ok: false as const,
      error: {
        code: 'WORKBENCH_CATALOG_SCHEMA_INVALID' as const,
        message: `Workbench manifest is ${actualBytes} UTF-8 bytes; the maximum is ${MAX_WORKBENCH_CATALOG_BYTES}.`,
        path: ''
      }
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(rawText);
  } catch {
    return {
      ok: false as const,
      error: {
        code: 'WORKBENCH_CATALOG_JSON_INVALID' as const,
        message: 'Workbench manifest is not valid JSON.'
      }
    };
  }
  const record = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (
    record &&
    typeof record.schemaVersion === 'number' &&
    record.schemaVersion !== WORKBENCH_SCHEMA_VERSION
  ) {
    return {
      ok: false as const,
      error: {
        code: 'WORKBENCH_CATALOG_VERSION_UNSUPPORTED' as const,
        message: `Workbench schema version ${record.schemaVersion} is unsupported. Create a new version-2 workbench.`,
        foundVersion: record.schemaVersion,
        supportedVersion: WORKBENCH_SCHEMA_VERSION
      }
    };
  }
  return { ok: true as const, value };
}

function validateWorkbenchCatalogValue(value: unknown, machines: MachineLibrary) {
  const schemaError = Value.Errors(WorkbenchCatalogManifestSchema, value).First();
  if (schemaError) {
    return {
      ok: false as const,
      error: {
        code: 'WORKBENCH_CATALOG_SCHEMA_INVALID' as const,
        message: `Workbench manifest schema violation at ${schemaError.path || '/'}: ${schemaError.message}.`,
        path: schemaError.path
      }
    };
  }
  const manifest = value as WorkbenchCatalogManifestValue;
  for (const [path, timestamp] of [
    ['/createdAt', manifest.createdAt],
    ['/updatedAt', manifest.updatedAt],
    ...manifest.projects.map((project, index) => [`/projects/${index}/updatedAt`, project.updatedAt])
  ] as const) {
    if (isCanonicalTimestamp(timestamp)) continue;
    return {
      ok: false as const,
      error: {
        code: 'WORKBENCH_CATALOG_TIMESTAMP_INVALID' as const,
        message: `${path} must be a real canonical UTC timestamp.`,
        path
      }
    };
  }
  const firstProjectIndex = new Map<string, number>();
  for (const [index, project] of manifest.projects.entries()) {
    const identity = `${project.id}\u0000${project.path}`;
    const firstIndex = firstProjectIndex.get(identity);
    if (firstIndex !== undefined) {
      return {
        ok: false as const,
        error: {
          code: 'WORKBENCH_CATALOG_DUPLICATE_PROJECT' as const,
          message: `Project ${project.id} at ${project.path} is duplicated; it first appears at /projects/${firstIndex}.`,
          path: `/projects/${index}`
        }
      };
    }
    firstProjectIndex.set(identity, index);
  }
  const machineId = manifest.preferences.recentPlanningMachineId;
  if (machineId !== null && !machines.machines.some(({ id }) => id === machineId)) {
    return {
      ok: false as const,
      error: {
        code: 'WORKBENCH_CATALOG_MACHINE_NOT_FOUND' as const,
        message: `Remembered planning machine not found: ${machineId}. Clear or replace the explicit selection.`,
        path: '/preferences/recentPlanningMachineId' as const,
        machineId
      }
    };
  }
  return { ok: true as const, manifest: deepFreeze(manifest) };
}

async function existingCompanionPaths(adapter: WorkbenchStorageAdapter) {
  const paths: string[] = [];
  for (const path of [POST_LIBRARY_PATH, MACHINE_LIBRARY_PATH]) {
    const read = await readStorageText(adapter, path);
    if (!read.ok) return read;
    if (read.rawText !== null) paths.push(path);
  }
  return { ok: true as const, paths };
}

async function readStorageText(adapter: WorkbenchStorageAdapter, path: string) {
  try {
    return { ok: true as const, rawText: await adapter.readText(path) };
  } catch (error) {
    return storageAccessFailure('read', path, error);
  }
}

async function accessStorage(
  adapter: WorkbenchStorageAdapter,
  operation: 'ensure-directory' | 'write',
  path: string,
  action: () => Promise<void>
) {
  try {
    await action();
    return { ok: true as const };
  } catch (error) {
    return storageAccessFailure(operation, path, error);
  }
}

async function deleteStorage(adapter: WorkbenchStorageAdapter, path: string) {
  try {
    await adapter.deleteText(path);
    return { ok: true as const };
  } catch (error) {
    return storageAccessFailure('delete', path, error);
  }
}

function storageAccessFailure(
  operation: 'ensure-directory' | 'read' | 'write' | 'delete',
  path: string,
  error: unknown
) {
  const cause = error instanceof Error ? error.message : String(error);
  return {
    ok: false as const,
    error: {
      code: 'WORKBENCH_CATALOG_ACCESS_FAILED' as const,
      message: `Workbench catalog ${operation} failed at ${path}: ${cause}`,
      operation,
      path
    }
  };
}

function isCanonicalTimestamp(value: string) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
