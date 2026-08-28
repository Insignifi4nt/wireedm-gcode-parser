import { describe, expect, it } from 'vitest';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import {
  removeMachinePostBinding
} from '@/domain/machine-definition/machineDefinition';
import {
  boundMachineFixture
} from '@/domain/machine-definition/__tests__/machineDefinitionFixture';
import {
  createEmptyMachineLibrary,
  installMachineDefinition
} from '@/domain/machine-definition/machineLibrary';
import {
  initializeMachineLibraryStorage,
  writeMachineLibraryStorage
} from '@/domain/machine-definition/machineLibraryStorage';

import {
  installStoredPostPackage,
  removeStoredPostInstallation
} from '../postLibraryMutations';
import {
  initializePostLibraryStorage,
  POST_LIBRARY_PATH
} from '../postLibraryStorage';
import { minimalPostPackage } from './postPackageFixture';

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();

  constructor(readonly name = 'post-library-mutations') {}

  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async writeText(path: string, contents: string) { this.files.set(path, contents); }
  async deleteText(path: string) { this.files.delete(path); }
}

describe('persisted post library mutations', () => {
  it('installs parsed package content and leaves stored bytes unchanged on a version conflict', async () => {
    const adapter = new MemoryAdapter();
    await initializePostLibraryStorage(adapter);
    const installed = await installStoredPostPackage(adapter, JSON.stringify(minimalPostPackage()));
    expect(installed.ok).toBe(true);
    if (!installed.ok) throw new Error(installed.error.message);
    const storedAfterInstall = adapter.files.get(POST_LIBRARY_PATH);

    const conflict = minimalPostPackage();
    conflict.source.code += '\n// conflicting implementation';
    expect(await installStoredPostPackage(adapter, JSON.stringify(conflict))).toMatchObject({
      ok: false,
      error: { code: 'POST_LIBRARY_VERSION_CONFLICT' }
    });
    expect(adapter.files.get(POST_LIBRARY_PATH)).toBe(storedAfterInstall);
  });

  it('rejects invalid uploaded package text before reading or writing the library', async () => {
    const adapter = new MemoryAdapter();

    expect(await installStoredPostPackage(adapter, '{')).toMatchObject({
      ok: false,
      error: {
        code: 'POST_PACKAGE_INVALID',
        diagnostics: [{ code: 'POST_PACKAGE_JSON_INVALID' }]
      }
    });
    expect(adapter.files.has(POST_LIBRARY_PATH)).toBe(false);
  });

  it('leaves the stored library unchanged when custom conformance fails', async () => {
    const adapter = new MemoryAdapter();
    await initializePostLibraryStorage(adapter);
    const storedBeforeInstall = adapter.files.get(POST_LIBRARY_PATH);
    const nonconforming = minimalPostPackage();
    nonconforming.fixtures[0].expectedProgram = 'DIFFERENT';

    expect(await installStoredPostPackage(adapter, JSON.stringify(nonconforming))).toMatchObject({
      ok: false,
      error: { code: 'POST_LIBRARY_CONFORMANCE_FAILED' }
    });
    expect(adapter.files.get(POST_LIBRARY_PATH)).toBe(storedBeforeInstall);
  });

  it('loads the authoritative machine index before removing a post installation', async () => {
    const adapter = new MemoryAdapter();
    await initializePostLibraryStorage(adapter);
    const installedPost = await installStoredPostPackage(adapter, JSON.stringify(minimalPostPackage()));
    if (!installedPost.ok) throw new Error(installedPost.error.message);
    await initializeMachineLibraryStorage(adapter, installedPost.library);

    const bound = await boundMachineFixture();
    const machineInstall = installMachineDefinition(createEmptyMachineLibrary(), bound.machine);
    if (!machineInstall.ok) throw new Error(machineInstall.error.message);
    await writeMachineLibraryStorage(adapter, machineInstall.library);

    expect(await removeStoredPostInstallation(adapter, installedPost.installation.ref)).toMatchObject({
      ok: false,
      error: { code: 'POST_LIBRARY_INSTALLATION_IN_USE' }
    });

    const unbound = removeMachinePostBinding(bound.machine, 'production');
    if (!unbound.ok) throw new Error(unbound.error.message);
    const unboundLibrary = installMachineDefinition(createEmptyMachineLibrary(), unbound.machine);
    if (!unboundLibrary.ok) throw new Error(unboundLibrary.error.message);
    await writeMachineLibraryStorage(adapter, unboundLibrary.library);
    expect(await removeStoredPostInstallation(adapter, installedPost.installation.ref)).toMatchObject({
      ok: true,
      library: { installations: [] }
    });
  });
});
