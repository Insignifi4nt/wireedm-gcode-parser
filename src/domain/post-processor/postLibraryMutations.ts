import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorage';
import { withWorkbenchMutationLock } from '@/domain/storage/workbenchMutationLock';
import { machineBindingReferences } from '@/domain/machine-definition/machineLibrary';
import {
  readMachineLibraryStorage,
  type MachineLibraryStorageError
} from '@/domain/machine-definition/machineLibraryStorage';

import {
  installPostPackage,
  removePostInstallation,
  type InstallPostPackageResult,
  type PostInstallationRef,
  type PostInstallation,
  type PostLibrary,
  type RemovePostInstallationResult
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
type RemoveDomainError = Extract<RemovePostInstallationResult, { ok: false }>['error'];

type InvalidPostPackageError = {
  code: 'POST_PACKAGE_INVALID';
  message: string;
  diagnostics: readonly PostPackageDiagnostic[];
};

export type InstallStoredPostPackageError =
  | PostLibraryStorageError
  | InstallDomainError
  | InvalidPostPackageError;

export type RemoveStoredPostInstallationError =
  | PostLibraryStorageError
  | MachineLibraryStorageError
  | RemoveDomainError;

export type InstallStoredPostPackageResult =
  | {
      ok: true;
      kind: 'installed' | 'already-installed';
      library: PostLibrary;
      installation: PostInstallation;
    }
  | { ok: false; error: InstallStoredPostPackageError };

export type RemoveStoredPostInstallationResult =
  | { ok: true; library: PostLibrary; removed: PostInstallation }
  | { ok: false; error: RemoveStoredPostInstallationError };

export async function installStoredPostPackage(
  adapter: WorkbenchStorageAdapter,
  rawPackageText: string
): Promise<InstallStoredPostPackageResult> {
  return withWorkbenchMutationLock(adapter, () => installStoredPostPackageUnlocked(adapter, rawPackageText));
}

async function installStoredPostPackageUnlocked(
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

export async function removeStoredPostInstallation(
  adapter: WorkbenchStorageAdapter,
  ref: PostInstallationRef
): Promise<RemoveStoredPostInstallationResult> {
  return withWorkbenchMutationLock(adapter, () => removeStoredPostInstallationUnlocked(adapter, ref));
}

async function removeStoredPostInstallationUnlocked(
  adapter: WorkbenchStorageAdapter,
  ref: PostInstallationRef
): Promise<RemoveStoredPostInstallationResult> {
  const posts = await readPostLibraryStorage(adapter);
  if (!posts.ok) return posts;
  const machines = await readMachineLibraryStorage(adapter, posts.library);
  if (!machines.ok) return machines;

  const removed = removePostInstallation(
    posts.library,
    ref,
    machineBindingReferences(machines.library)
  );
  if (!removed.ok) return removed;

  const written = await writePostLibraryStorage(adapter, removed.library);
  return written.ok ? removed : written;
}
