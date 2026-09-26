import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { withWorkbenchMutationLock } from '@/domain/storage/workbenchMutationLock';
import { commitWorkbenchFileTransaction } from '@/domain/storage/workbenchFileTransaction';
import { recoverProjectTrashTransaction, type ProjectTrashTransactionError } from '@/domain/storage/projectTrashTransaction';
import { recoverSavedRevisionTransaction, type SavedRevisionTransactionError } from '@/domain/storage/savedRevisionTransaction';
import {
  recoverCatalogPairTransaction,
  type CatalogPairTransactionError
} from '@/domain/storage/catalogPairTransaction';
import { PostIdentifierSchema } from '@/domain/post-processor/postFormatPrimitives';
import {
  initializePostLibraryStorage,
  POST_LIBRARY_PATH,
  readPostLibraryStorage,
  type PostLibraryStorageError
} from '@/domain/post-processor/postLibraryStorage';
import { createEmptyPostLibrary, type PostLibrary } from '@/domain/post-processor/postLibrary';
import type { DeepReadonly } from '@/domain/post-processor/postPackageSchema';
import {
  initializeMachineLibraryStorage,
  MACHINE_LIBRARY_PATH,
  readMachineLibraryStorage,
  serializeMachineLibraryStorage,
  type MachineLibraryStorageError
} from '@/domain/machine-definition/machineLibraryStorage';
import { createEmptyMachineLibrary, type MachineLibrary } from '@/domain/machine-definition/machineLibrary';
import { parseWorkbenchProjectDocument } from './workbenchProject';
import {
  validateWorkbenchProjectPathOwnership,
  workbenchProjectDocumentPath,
  type WorkbenchProjectIndexIntegrityError,
  type WorkbenchProjectStorageError
} from './workbenchProjectStorage';

export const WORKBENCH_CATALOG_PATH = 'workbench.json';
export const WORKBENCH_SCHEMA_VERSION = 3 as const;
export const WORKBENCH_CATALOG_DIRECTORIES = ['imports', 'exports', 'projects'] as const;
const LEGACY_V1_BACKUP_DIRECTORY = 'legacy/v1';
const LEGACY_V1_MANIFEST_BACKUP_PATH = `${LEGACY_V1_BACKUP_DIRECTORY}/workbench.json`;
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

const LegacyOutputExtensionPreferenceSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('standard'),
    extension: Type.Union([Type.Literal('iso'), Type.Literal('nc'), Type.Literal('gcode')])
  }, strictObject),
  Type.Object({
    kind: Type.Literal('custom'),
    extension: Type.String({ minLength: 1, maxLength: 16, pattern: '^[A-Za-z0-9]+$' })
  }, strictObject)
]);

const LegacyExportPreferenceSchema = Type.Union([
  Type.Object({ status: Type.Literal('unconfigured') }, strictObject),
  Type.Object({
    status: Type.Literal('configured'),
    fileExtension: LegacyOutputExtensionPreferenceSchema,
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
    recentPlanningMachineId: Type.Union([PostIdentifierSchema, Type.Null()])
  }, strictObject),
  projects: Type.Array(ProjectIndexEntrySchema, { maxItems: 10_000 }),
  deletedProjects: Type.Optional(Type.Array(Type.Object({
    project: ProjectIndexEntrySchema,
    deletedAt: TimestampSchema
  }, strictObject), { maxItems: 10_000 }))
}, {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wire-edm.local/schemas/wire-edm-workbench-v3.json',
  additionalProperties: false
});

const LegacyWorkbenchCatalogManifestSchema = Type.Object({
  format: Type.Literal('wire-edm-workbench'),
  schemaVersion: Type.Literal(2),
  name: Type.String({ minLength: 1, maxLength: 160 }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  preferences: Type.Object({
    importUnits: ImportUnitPreferenceSchema,
    export: LegacyExportPreferenceSchema,
    recentPlanningMachineId: Type.Union([PostIdentifierSchema, Type.Null()])
  }, strictObject),
  projects: Type.Array(ProjectIndexEntrySchema, { maxItems: 10_000 })
}, strictObject);

const LegacyV1WorkbenchManifestSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  name: Type.String({ minLength: 1, maxLength: 160 }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  templates: Type.Unknown(),
  output: Type.Unknown(),
  activeMachineProfileId: Type.String({ minLength: 1 }),
  machineProfiles: Type.Array(Type.Unknown()),
  projects: Type.Array(ProjectIndexEntrySchema, { maxItems: 10_000 })
}, strictObject);

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
  | ProjectTrashTransactionError
  | SavedRevisionTransactionError
  | PostLibraryStorageError
  | MachineLibraryStorageError
  | WorkbenchProjectStorageError
  | WorkbenchProjectIndexIntegrityError
  | CatalogPairTransactionError
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

export type WorkbenchCatalogManifestError = Extract<
  WorkbenchCatalogError,
  { code:
      | 'WORKBENCH_CATALOG_VERSION_UNSUPPORTED'
      | 'WORKBENCH_CATALOG_JSON_INVALID'
      | 'WORKBENCH_CATALOG_SCHEMA_INVALID'
      | 'WORKBENCH_CATALOG_TIMESTAMP_INVALID'
      | 'WORKBENCH_CATALOG_DUPLICATE_PROJECT'
      | 'WORKBENCH_CATALOG_MACHINE_NOT_FOUND' }
>;

export type ParseWorkbenchCatalogManifestResult =
  | { ok: true; manifest: WorkbenchCatalogManifest }
  | { ok: false; error: WorkbenchCatalogManifestError };

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
  return withWorkbenchMutationLock(adapter, () => (
    initializeWorkbenchCatalogUnderMutationLock(adapter, options)
  ));
}

/** Internal integration point for callers that already own the workbench mutation lock. */
export async function initializeWorkbenchCatalogUnderMutationLock(
  adapter: WorkbenchStorageAdapter,
  options: InitializeWorkbenchCatalogOptions = {}
): Promise<InitializeWorkbenchCatalogResult> {
  const recoveredTrash = await recoverProjectTrashTransaction(adapter);
  if (!recoveredTrash.ok) return recoveredTrash;
  const recoveredRevision = await recoverSavedRevisionTransaction(adapter);
  if (!recoveredRevision.ok) return recoveredRevision;
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

  const parsedValue = parseCatalogJson(catalogRead.rawText, true);
  if (!parsedValue.ok) return parsedValue;
  const legacyMigration = await migrateLegacyV1WorkbenchCatalog(
    adapter,
    parsedValue.value,
    catalogRead.rawText
  );
  if (!legacyMigration.ok) return legacyMigration;
  if (legacyMigration.migrated) {
    return initializeWorkbenchCatalogUnderMutationLock(adapter, options);
  }
  const recovered = await recoverCatalogPairTransaction(adapter);
  if (!recovered.ok) return recovered;
  const posts = await readPostLibraryStorage(adapter);
  if (!posts.ok) return posts;
  const machines = await readMachineLibraryStorage(adapter, posts.library);
  if (!machines.ok) return machines;
  const migrated = migrateLegacyWorkbenchCatalogValue(parsedValue.value);
  if (!migrated.ok) return migrated;
  const manifest = validateWorkbenchCatalogValue(migrated.value, machines.library);
  if (!manifest.ok) return manifest;
  const ownership = await validateWorkbenchProjectPathOwnership(
    adapter,
    manifest.manifest.projects
  );
  if (!ownership.ok) return ownership;
  if (migrated.kind === 'migrated') {
    const backup = await preserveLegacyV2Manifest(adapter, catalogRead.rawText);
    if (!backup.ok) return backup;
    const written = await accessStorage(
      adapter,
      'write',
      WORKBENCH_CATALOG_PATH,
      () => adapter.writeText(WORKBENCH_CATALOG_PATH, `${JSON.stringify(manifest.manifest, null, 2)}\n`)
    );
    if (!written.ok) return written;
  }

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

async function preserveLegacyV2Manifest(adapter: WorkbenchStorageAdapter, original: string) {
  const path = 'legacy/v2/workbench.json';
  const existing = await readStorageText(adapter, path);
  if (!existing.ok) return existing;
  if (existing.rawText !== null && existing.rawText !== original) {
    return {
      ok: false as const,
      error: {
        code: 'WORKBENCH_CATALOG_INCOMPLETE' as const,
        message: 'Workbench migration found a conflicting version-2 backup. Preserve both files before recovery.',
        existingPaths: [path]
      }
    };
  }
  if (existing.rawText === null) {
    const ensured = await accessStorage(adapter, 'ensure-directory', 'legacy/v2', () => adapter.ensureDirectory('legacy/v2'));
    if (!ensured.ok) return ensured;
    const written = await accessStorage(adapter, 'write', path, () => adapter.writeText(path, original));
    if (!written.ok) return written;
  }
  const verified = await readStorageText(adapter, path);
  if (!verified.ok) return verified;
  if (verified.rawText !== original) {
    return storageAccessFailure('read', path, new Error('Migration backup did not read back exactly. The original manifest is unchanged.'));
  }
  return { ok: true as const };
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

function parseCatalogJson(rawText: string, allowLegacyV2 = false) {
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
    value = JSON.parse(rawText.replace(/^\uFEFF/, ''));
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
    record.schemaVersion !== WORKBENCH_SCHEMA_VERSION &&
    !(allowLegacyV2 && (record.schemaVersion === 1 || record.schemaVersion === 2))
  ) {
    return {
      ok: false as const,
      error: {
        code: 'WORKBENCH_CATALOG_VERSION_UNSUPPORTED' as const,
        message: `Workbench schema version ${record.schemaVersion} is unsupported; this app supports storage schema ${WORKBENCH_SCHEMA_VERSION}. Keep the existing files and open them with an app that supports their storage version.`,
        foundVersion: record.schemaVersion,
        supportedVersion: WORKBENCH_SCHEMA_VERSION
      }
    };
  }
  return { ok: true as const, value };
}

async function migrateLegacyV1WorkbenchCatalog(
  adapter: WorkbenchStorageAdapter,
  value: unknown,
  originalManifest: string
): Promise<
  | { readonly ok: true; readonly migrated: boolean }
  | { readonly ok: false; readonly error: WorkbenchCatalogError }
> {
  const record = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (record?.schemaVersion !== 1) return { ok: true, migrated: false };
  const schemaError = Value.Errors(LegacyV1WorkbenchManifestSchema, value).First();
  if (schemaError) {
    return {
      ok: false,
      error: {
        code: 'WORKBENCH_CATALOG_SCHEMA_INVALID',
        message: `Legacy workbench manifest schema violation at ${schemaError.path || '/'}: ${schemaError.message}.`,
        path: schemaError.path
      }
    };
  }
  const legacy = Value.Decode(LegacyV1WorkbenchManifestSchema, value);
  const projectTexts = new Map<string, { readonly next: string }>();
  const backupTexts = new Map<string, { readonly existed: boolean; readonly text: string }>();
  const placeholderPaths = new Map<string, boolean>();
  const manifestBackup = await readStorageText(adapter, LEGACY_V1_MANIFEST_BACKUP_PATH);
  if (!manifestBackup.ok) return manifestBackup;
  if (manifestBackup.rawText !== null && manifestBackup.rawText !== originalManifest) {
    return {
      ok: false,
      error: {
        code: 'WORKBENCH_CATALOG_INCOMPLETE',
        message: 'Legacy workbench migration found a conflicting version-1 manifest backup.',
        existingPaths: [LEGACY_V1_MANIFEST_BACKUP_PATH]
      }
    };
  }
  backupTexts.set(LEGACY_V1_MANIFEST_BACKUP_PATH, {
    existed: manifestBackup.rawText !== null,
    text: originalManifest
  });
  for (const entry of legacy.projects) {
    let raw: string | null;
    try {
      raw = await (adapter.readExactText ? adapter.readExactText(entry.path) : adapter.readText(entry.path));
    } catch (error) {
      return storageAccessFailure('read', entry.path, error);
    }
    if (raw === null) {
      return {
        ok: false,
        error: {
          code: 'WORKBENCH_CATALOG_PROJECT_DANGLING',
          message: `Legacy workbench project file is missing: ${entry.path}.`,
          projectId: entry.id,
          path: entry.path
        }
      };
    }
    const backupPath = `${LEGACY_V1_BACKUP_DIRECTORY}/projects/${entry.id}.json`;
    const backup = await readStorageText(adapter, backupPath);
    if (!backup.ok) return backup;
    const originalProject = backup.rawText ?? raw;
    const parsed = parseWorkbenchProjectDocument(originalProject);
    if (!parsed.ok) return parsed;
    const next = JSON.stringify(parsed.project, null, 2);
    if (backup.rawText !== null && raw !== originalProject && raw !== next) {
      return {
        ok: false, error: {
          code: 'WORKBENCH_CATALOG_INCOMPLETE',
          message: 'Legacy workbench migration found a project that conflicts with its exact backup. Preserve both files before recovery.',
          existingPaths: [entry.path, backupPath]
        }
      };
    }
    const projectPath = workbenchProjectDocumentPath(entry.id);
    if (entry.path !== projectPath) {
      // Only the actual former layout can be upgraded; arbitrary index paths remain invalid.
      if (entry.path !== `projects/${entry.id}/project.json`) {
        return {
          ok: false, error: {
            code: 'WORKBENCH_CATALOG_INCOMPLETE',
            message: 'Legacy project uses an unrecognized project document path. Preserve storage before recovery.',
            existingPaths: [entry.path]
          }
        };
      }
      const destination = await readStorageText(adapter, projectPath);
      if (!destination.ok) return destination;
      if (destination.rawText !== null && destination.rawText !== next) {
        return {
          ok: false, error: {
            code: 'WORKBENCH_CATALOG_INCOMPLETE',
            message: 'Legacy workbench migration found conflicting content at the current project document path. Preserve both files before recovery.',
            existingPaths: [entry.path, projectPath]
          }
        };
      }
    }
    backupTexts.set(backupPath, {
      existed: backup.rawText !== null,
      text: originalProject
    });
    if (
      parsed.project.content.kind === 'external-gcode' &&
      parsed.project.content.activeFilePath === `projects/${entry.id}/legacy-empty.txt`
    ) {
      const placeholder = await readStorageText(adapter, parsed.project.content.activeFilePath);
      if (!placeholder.ok) return placeholder;
      if (placeholder.rawText !== null && placeholder.rawText !== '') {
        return {
          ok: false,
          error: {
            code: 'WORKBENCH_CATALOG_INCOMPLETE',
            message: 'Legacy workbench migration found conflicting content at its empty-program placeholder path.',
            existingPaths: [parsed.project.content.activeFilePath]
          }
        };
      }
      placeholderPaths.set(parsed.project.content.activeFilePath, placeholder.rawText !== null);
    }
    projectTexts.set(projectPath, { next });
  }
  const activeProfile = legacy.machineProfiles.find((candidate) => (
    candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate) &&
    (candidate as Record<string, unknown>).id === legacy.activeMachineProfileId
  ));
  const preferredUnit = activeProfile !== null && typeof activeProfile === 'object' && !Array.isArray(activeProfile)
    ? (activeProfile as Record<string, unknown>).preferredDxfImportUnit
    : null;
  const manifest: WorkbenchCatalogManifestValue = {
    format: 'wire-edm-workbench',
    schemaVersion: WORKBENCH_SCHEMA_VERSION,
    name: legacy.name,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
    preferences: {
      importUnits: preferredUnit === 'millimeters' || preferredUnit === 'inches'
        ? { mode: 'fixed', unit: preferredUnit }
        : { mode: 'ask' },
      recentPlanningMachineId: null
    },
    projects: legacy.projects.map((entry) => ({ ...entry, path: workbenchProjectDocumentPath(entry.id) }))
  };
  const validatedManifest = validateWorkbenchCatalogValue(manifest, createEmptyMachineLibrary());
  if (!validatedManifest.ok) return validatedManifest;
  // Check the proposed project files before writing backups or replacing any live data.
  const proposedStorage: WorkbenchStorageAdapter = {
    ...adapter,
    readText: async (path) => projectTexts.get(path)?.next
      ?? (placeholderPaths.has(path) ? '' : adapter.readText(path))
  };
  const ownership = await validateWorkbenchProjectPathOwnership(proposedStorage, manifest.projects);
  if (!ownership.ok) return ownership;
  const existingPosts = await readStorageText(adapter, POST_LIBRARY_PATH);
  if (!existingPosts.ok) return existingPosts;
  const existingMachines = await readStorageText(adapter, MACHINE_LIBRARY_PATH);
  if (!existingMachines.ok) return existingMachines;
  // Empty companion catalogs are a durable checkpoint left by an interrupted migration.
  // They can be opened safely; a non-empty catalog could contain unrelated user data.
  let resumablePosts = createEmptyPostLibrary();
  if (existingPosts.rawText !== null) {
    const openedPosts = await readPostLibraryStorage(adapter);
    if (!openedPosts.ok) return openedPosts;
    if (openedPosts.library.installations.length > 0) {
      return {
        ok: false,
        error: {
          code: 'WORKBENCH_CATALOG_INCOMPLETE',
          message: 'Legacy workbench migration found a non-empty new-format post catalog.',
          existingPaths: [POST_LIBRARY_PATH]
        }
      };
    }
    resumablePosts = openedPosts.library;
  }
  if (existingMachines.rawText !== null) {
    const openedMachines = await readMachineLibraryStorage(adapter, resumablePosts);
    if (!openedMachines.ok) return openedMachines;
    if (openedMachines.library.machines.length > 0) {
      return {
        ok: false,
        error: {
          code: 'WORKBENCH_CATALOG_INCOMPLETE',
          message: 'Legacy workbench migration found a non-empty new-format machine catalog.',
          existingPaths: [MACHINE_LIBRARY_PATH]
        }
      };
    }
  }
  try {
    for (const directory of WORKBENCH_CATALOG_DIRECTORIES) await adapter.ensureDirectory(directory);
    await adapter.ensureDirectory('legacy');
    await adapter.ensureDirectory(LEGACY_V1_BACKUP_DIRECTORY);
    await adapter.ensureDirectory(`${LEGACY_V1_BACKUP_DIRECTORY}/projects`);
    for (const [path, backup] of backupTexts) {
      if (!backup.existed) await adapter.writeText(path, backup.text);
      if (await (adapter.readExactText ? adapter.readExactText(path) : adapter.readText(path)) !== backup.text) {
        throw new Error(`Legacy backup did not read back exactly: ${path}.`);
      }
    }
    await commitWorkbenchFileTransaction(adapter, [
      ...[...placeholderPaths].filter(([, existed]) => !existed).map(([path]) => ({ path, contents: '' })),
      ...[...projectTexts].map(([path, texts]) => ({ path, contents: texts.next })),
      ...(existingPosts.rawText === null ? [{ path: POST_LIBRARY_PATH, contents: JSON.stringify({ format: 'wire-edm-post-library', schemaVersion: 1, installations: [] }, null, 2) }] : []),
      ...(existingMachines.rawText === null ? [{ path: MACHINE_LIBRARY_PATH, contents: serializeMachineLibraryStorage(createEmptyMachineLibrary()) }] : []),
      { path: WORKBENCH_CATALOG_PATH, contents: JSON.stringify(manifest, null, 2) }
    ]);
    return { ok: true, migrated: true };
  } catch (error) {
    // Exact legacy backups stay available after failed writes; the file journal owns rollback/recovery.
    return storageAccessFailure('write', WORKBENCH_CATALOG_PATH, error);
  }
}

function migrateLegacyWorkbenchCatalogValue(value: unknown):
  | { readonly ok: true; readonly kind: 'current' | 'migrated'; readonly value: unknown }
  | { readonly ok: false; readonly error: WorkbenchCatalogManifestError } {
  const record = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (record?.schemaVersion !== 2) return { ok: true, kind: 'current', value };
  const schemaError = Value.Errors(LegacyWorkbenchCatalogManifestSchema, value).First();
  if (schemaError) {
    return {
      ok: false,
      error: {
        code: 'WORKBENCH_CATALOG_SCHEMA_INVALID',
        message: `Legacy workbench manifest schema violation at ${schemaError.path || '/'}: ${schemaError.message}.`,
        path: schemaError.path
      }
    };
  }
  const legacy = value as Static<typeof LegacyWorkbenchCatalogManifestSchema>;
  return {
    ok: true,
    kind: 'migrated',
    value: {
      ...legacy,
      schemaVersion: WORKBENCH_SCHEMA_VERSION,
      preferences: {
        importUnits: legacy.preferences.importUnits,
        recentPlanningMachineId: legacy.preferences.recentPlanningMachineId
      }
    }
  };
}

export function parseWorkbenchCatalogManifest(
  rawText: string,
  machines: MachineLibrary
): ParseWorkbenchCatalogManifestResult {
  const parsed = parseCatalogJson(rawText);
  if (!parsed.ok) return parsed;
  return validateWorkbenchCatalogValue(parsed.value, machines);
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
    ...manifest.projects.map((project, index) => [`/projects/${index}/updatedAt`, project.updatedAt]),
    ...(manifest.deletedProjects ?? []).flatMap((entry, index) => [
      [`/deletedProjects/${index}/deletedAt`, entry.deletedAt],
      [`/deletedProjects/${index}/project/updatedAt`, entry.project.updatedAt]
    ])
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
  const firstProjectIdIndex = new Map<string, string>();
  const firstProjectPathIndex = new Map<string, string>();
  const indexed = [
    ...manifest.projects.map((project, index) => ({ project, path: `/projects/${index}` })),
    ...(manifest.deletedProjects ?? []).map(({ project }, index) => ({ project, path: `/deletedProjects/${index}/project` }))
  ];
  for (const { project, path } of indexed) {
    const firstIndex = firstProjectIdIndex.get(project.id) ?? firstProjectPathIndex.get(project.path);
    if (firstIndex !== undefined) {
      return {
        ok: false as const,
        error: {
          code: 'WORKBENCH_CATALOG_DUPLICATE_PROJECT' as const,
          message: `Project ${project.id} at ${project.path} is duplicated; it first appears at ${firstIndex}.`,
          path
        }
      };
    }
    firstProjectIdIndex.set(project.id, path);
    firstProjectPathIndex.set(project.path, path);
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
  if (paths.length === 0 && adapter.listFiles) {
    try {
      const inventory = await adapter.listFiles();
      const managedDirectories = [...WORKBENCH_CATALOG_DIRECTORIES, 'posts', 'machines', 'transactions', 'legacy'];
      const retained = inventory.paths.filter((path) => managedDirectories.some((directory) => path.startsWith(`${directory}/`)));
      if (retained.length > 0 || inventory.truncated) {
        return {
          ok: false as const,
          error: {
            code: 'WORKBENCH_CATALOG_INCOMPLETE' as const,
            message: retained.length > 0
              ? 'Workbench manifest is missing but stored workbench files remain. Preserve this storage and recover its manifest before opening it.'
              : 'Workbench manifest is missing and the storage inventory is incomplete. Choose an empty workbench folder or recover the existing manifest.',
            existingPaths: retained.slice(0, 20)
          }
        };
      }
    } catch (error) {
      return storageAccessFailure('read', WORKBENCH_CATALOG_PATH, error);
    }
  }
  return { ok: true as const, paths };
}

async function readStorageText(adapter: WorkbenchStorageAdapter, path: string) {
  try {
    return { ok: true as const, rawText: await (adapter.readExactText ? adapter.readExactText(path) : adapter.readText(path)) };
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
