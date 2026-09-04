import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';

import {
  createEmptyPostLibrary,
  hashPostPackage,
  postInstallationRefsEqual,
  type PostInstallation,
  type PostLibrary
} from './postLibrary';
import {
  PostInstallationRefSchema,
  type PostInstallationRef
} from './postFormatPrimitives';
import {
  validateWireEdmPostPackageValue,
  type PostPackageDiagnostic
} from './postPackage';
import type { DeepReadonly } from './postPackageSchema';

export const POST_LIBRARY_DIRECTORY = 'posts';
export const POST_LIBRARY_PATH = `${POST_LIBRARY_DIRECTORY}/library.json`;
export const MAX_POST_LIBRARY_BYTES = 16 * 1024 * 1024;
export const MAX_POST_INSTALLATIONS = 256;

export const PostLibraryDocumentSchema = Type.Object({
  format: Type.Literal('wire-edm-post-library'),
  schemaVersion: Type.Literal(1),
  installations: Type.Array(Type.Object({
    ref: PostInstallationRefSchema,
    package: Type.Unknown({
      description: 'A wire-edm-post package validated against post-package.schema.json.'
    })
  }, { additionalProperties: false }), { maxItems: MAX_POST_INSTALLATIONS })
}, {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wire-edm.local/schemas/wire-edm-post-library-v1.json',
  $comment: 'Generated from src/domain/post-processor/postLibraryStorage.ts by npm run post:docs:generate.',
  additionalProperties: false
});

type PostLibraryDocument = Static<typeof PostLibraryDocumentSchema>;
type ReadonlyPostLibraryDocument = DeepReadonly<PostLibraryDocument>;

export type PostLibraryStorageError =
  | { code: 'POST_LIBRARY_STORAGE_NOT_FOUND'; message: string }
  | { code: 'POST_LIBRARY_STORAGE_TOO_LARGE'; message: string; actualBytes: number; maximumBytes: number }
  | { code: 'POST_LIBRARY_STORAGE_JSON_INVALID'; message: string }
  | { code: 'POST_LIBRARY_STORAGE_SCHEMA_INVALID'; message: string; path: string }
  | {
      code: 'POST_LIBRARY_STORAGE_PACKAGE_INVALID';
      message: string;
      path: string;
      diagnostics: readonly PostPackageDiagnostic[];
    }
  | {
      code: 'POST_LIBRARY_STORAGE_HASH_MISMATCH';
      message: string;
      path: string;
      stored: PostInstallationRef;
      computed: PostInstallationRef;
    }
  | { code: 'POST_LIBRARY_STORAGE_DUPLICATE_INSTALLATION'; message: string; path: string }
  | { code: 'POST_LIBRARY_STORAGE_HASH_UNAVAILABLE'; message: string; path: string }
  | {
      code: 'POST_LIBRARY_STORAGE_ACCESS_FAILED';
      message: string;
      operation: 'ensure-directory' | 'read' | 'write';
      path: string;
    };

export type ReadPostLibraryStorageResult =
  | { ok: true; library: PostLibrary }
  | { ok: false; error: PostLibraryStorageError };

export type WritePostLibraryStorageResult =
  | { ok: true }
  | { ok: false; error: PostLibraryStorageError };

export type InitializePostLibraryStorageResult =
  | { ok: true; kind: 'created' | 'opened'; library: PostLibrary }
  | { ok: false; error: PostLibraryStorageError };

export async function initializePostLibraryStorage(
  adapter: WorkbenchStorageAdapter
): Promise<InitializePostLibraryStorageResult> {
  const ensured = await accessStorage(
    'ensure-directory',
    POST_LIBRARY_DIRECTORY,
    () => adapter.ensureDirectory(POST_LIBRARY_DIRECTORY)
  );
  if (!ensured.ok) return ensured;

  const read = await readStorageText(adapter);
  if (!read.ok) return read;
  if (read.rawText === null) {
    const library = createEmptyPostLibrary();
    const written = await writePostLibraryStorage(adapter, library);
    return written.ok
      ? { ok: true, kind: 'created', library }
      : written;
  }

  const opened = await parseStoredPostLibrary(read.rawText);
  return opened.ok ? { ok: true, kind: 'opened', library: opened.library } : opened;
}

export async function readPostLibraryStorage(
  adapter: WorkbenchStorageAdapter
): Promise<ReadPostLibraryStorageResult> {
  const read = await readStorageText(adapter);
  if (!read.ok) return read;
  if (read.rawText === null) {
    return {
      ok: false,
      error: {
        code: 'POST_LIBRARY_STORAGE_NOT_FOUND',
        message: `Post library file does not exist: ${POST_LIBRARY_PATH}.`
      }
    };
  }
  return parseStoredPostLibrary(read.rawText);
}

export async function writePostLibraryStorage(
  adapter: WorkbenchStorageAdapter,
  library: PostLibrary
): Promise<WritePostLibraryStorageResult> {
  const document: ReadonlyPostLibraryDocument = {
    format: 'wire-edm-post-library',
    schemaVersion: 1,
    installations: library.installations
  };
  const rawText = JSON.stringify(document, null, 2);
  const sizeError = librarySizeError(rawText);
  if (sizeError) return { ok: false, error: sizeError };
  return accessStorage('write', POST_LIBRARY_PATH, () => adapter.writeText(POST_LIBRARY_PATH, rawText));
}

async function parseStoredPostLibrary(rawText: string): Promise<ReadPostLibraryStorageResult> {
  const sizeError = librarySizeError(rawText);
  if (sizeError) return { ok: false, error: sizeError };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      error: {
        code: 'POST_LIBRARY_STORAGE_JSON_INVALID',
        message: 'Post library file is not valid JSON.'
      }
    };
  }

  const schemaError = Value.Errors(PostLibraryDocumentSchema, parsed).First();
  if (schemaError) {
    return {
      ok: false,
      error: {
        code: 'POST_LIBRARY_STORAGE_SCHEMA_INVALID',
        message: `Post library schema violation at ${schemaError.path || '/'}: ${schemaError.message}.`,
        path: schemaError.path
      }
    };
  }

  const document = parsed as PostLibraryDocument;
  const installations: PostInstallation[] = [];
  const installationClaims = new Set<string>();
  for (const [index, stored] of document.installations.entries()) {
    const packageResult = validateWireEdmPostPackageValue(stored.package);
    if (!packageResult.ok) {
      return {
        ok: false,
        error: {
          code: 'POST_LIBRARY_STORAGE_PACKAGE_INVALID',
          message: `Stored post package at /installations/${index}/package is invalid.`,
          path: `/installations/${index}/package`,
          diagnostics: packageResult.diagnostics
        }
      };
    }

    const claim = `${stored.ref.packageId}\u0000${stored.ref.version}`;
    if (installationClaims.has(claim)) {
      return {
        ok: false,
        error: {
          code: 'POST_LIBRARY_STORAGE_DUPLICATE_INSTALLATION',
          message: `Post installation ${stored.ref.packageId}@${stored.ref.version} is duplicated.`,
          path: `/installations/${index}`
        }
      };
    }
    installationClaims.add(claim);

    const contentHash = await hashPostPackage(packageResult.package);
    if (!contentHash) {
      return {
        ok: false,
        error: {
          code: 'POST_LIBRARY_STORAGE_HASH_UNAVAILABLE',
          message: 'SHA-256 is unavailable; the stored post package cannot be opened without verifying its content identity.',
          path: `/installations/${index}`
        }
      };
    }
    const ref = Object.freeze({
      packageId: packageResult.package.manifest.id,
      version: packageResult.package.manifest.version,
      contentHash
    });
    if (!postInstallationRefsEqual(ref, stored.ref)) {
      return {
        ok: false,
        error: {
          code: 'POST_LIBRARY_STORAGE_HASH_MISMATCH',
          message: `Stored post reference at /installations/${index}/ref does not match its package content.`,
          path: `/installations/${index}/ref`,
          stored: stored.ref,
          computed: ref
        }
      };
    }
    installations.push(Object.freeze({ ref, package: packageResult.package }));
  }

  return {
    ok: true,
    library: Object.freeze({
      schemaVersion: 1,
      installations: Object.freeze(installations)
    })
  };
}

async function readStorageText(adapter: WorkbenchStorageAdapter) {
  try {
    return { ok: true as const, rawText: await adapter.readText(POST_LIBRARY_PATH) };
  } catch (error) {
    return storageAccessFailure('read', POST_LIBRARY_PATH, error);
  }
}

async function accessStorage(
  operation: 'ensure-directory' | 'write',
  path: string,
  action: () => Promise<void>
): Promise<WritePostLibraryStorageResult> {
  try {
    await action();
    return { ok: true };
  } catch (error) {
    return storageAccessFailure(operation, path, error);
  }
}

function storageAccessFailure(
  operation: 'ensure-directory' | 'read' | 'write',
  path: string,
  error: unknown
) {
  const cause = error instanceof Error ? error.message : String(error);
  return {
    ok: false as const,
    error: {
      code: 'POST_LIBRARY_STORAGE_ACCESS_FAILED' as const,
      message: `Post library ${operation} failed at ${path}: ${cause}`,
      operation,
      path
    }
  };
}

function librarySizeError(rawText: string): Extract<
  PostLibraryStorageError,
  { code: 'POST_LIBRARY_STORAGE_TOO_LARGE' }
> | null {
  const actualBytes = new TextEncoder().encode(rawText).byteLength;
  return actualBytes > MAX_POST_LIBRARY_BYTES
    ? {
        code: 'POST_LIBRARY_STORAGE_TOO_LARGE',
        message: `Post library is ${actualBytes} UTF-8 bytes; the maximum is ${MAX_POST_LIBRARY_BYTES}.`,
        actualBytes,
        maximumBytes: MAX_POST_LIBRARY_BYTES
      }
    : null;
}
