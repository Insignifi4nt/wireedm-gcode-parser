import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorage';

import {
  installPostPackage,
  type InstallPostPackageResult,
  type PostInstallation,
  type PostLibrary
} from './postLibrary';
import {
  readPostLibraryStorage,
  writePostLibraryStorage,
  type PostLibraryStorageError
} from './postLibraryStorage';
import {
  parseWireEdmPostPackage,
  type PostPackageDiagnostic
} from './postPackage';

type InstallDomainError = Extract<InstallPostPackageResult, { ok: false }>['error'];

export type PostLibraryMutationError =
  | PostLibraryStorageError
  | InstallDomainError
  | {
      code: 'POST_PACKAGE_INVALID';
      message: string;
      diagnostics: readonly PostPackageDiagnostic[];
    };

export type InstallStoredPostPackageResult =
  | {
      ok: true;
      kind: 'installed' | 'already-installed';
      library: PostLibrary;
      installation: PostInstallation;
    }
  | { ok: false; error: PostLibraryMutationError };

export async function installStoredPostPackage(
  adapter: WorkbenchStorageAdapter,
  rawPackageText: string
): Promise<InstallStoredPostPackageResult> {
  const parsed = parseWireEdmPostPackage(rawPackageText);
  if (!parsed.ok) {
    return {
      ok: false,
      error: {
        code: 'POST_PACKAGE_INVALID',
        message: 'Uploaded post package is invalid.',
        diagnostics: parsed.diagnostics
      }
    };
  }

  const stored = await readPostLibraryStorage(adapter);
  if (!stored.ok) return stored;
  const installed = await installPostPackage(stored.library, parsed.package);
  if (!installed.ok || installed.kind === 'already-installed') return installed;

  const written = await writePostLibraryStorage(adapter, installed.library);
  return written.ok ? installed : written;
}
