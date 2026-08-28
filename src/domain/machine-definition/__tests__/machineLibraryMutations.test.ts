import { describe, expect, it } from 'vitest';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { createEmptyPostLibrary } from '@/domain/post-processor/postLibrary';
import {
  installStoredPostPackage,
  removeStoredPostInstallation
} from '@/domain/post-processor/postLibraryMutations';
import { initializePostLibraryStorage } from '@/domain/post-processor/postLibraryStorage';
import { minimalPostPackage } from '@/domain/post-processor/__tests__/postPackageFixture';

import {
  serializeMachineDefinition,
  type MachineDefinitionValue
} from '../machineDefinition';
import {
  createStoredMachinePostBinding,
  installStoredMachineDefinition,
  removeStoredMachinePostBinding
} from '../machineLibraryMutations';
import {
  initializeMachineLibraryStorage,
  MACHINE_LIBRARY_PATH,
  readMachineLibraryStorage
} from '../machineLibraryStorage';
import { compatibilityFixture, machineDefinitionFixture } from './machineDefinitionFixture';

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  constructor(readonly name = 'machine-mutations') {}
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async writeText(path: string, contents: string) { this.files.set(path, contents); }
  async deleteText(path: string) { this.files.delete(path); }
}

function unboundMachineText() {
  return serializeMachineDefinition(machineDefinitionFixture());
}

describe('persisted machine library mutations', () => {
  it('installs a portable machine and persists exact binding add/remove operations', async () => {
    const adapter = new MemoryAdapter();
    await initializePostLibraryStorage(adapter);
    const post = await installStoredPostPackage(adapter, JSON.stringify(minimalPostPackage()));
    if (!post.ok) throw new Error(post.error.message);
    await initializeMachineLibraryStorage(adapter, post.library);

    expect(await installStoredMachineDefinition(adapter, unboundMachineText())).toMatchObject({
      ok: true,
      kind: 'installed',
      machine: { id: 'shop.robofil-100', bindings: [] }
    });
    expect(await createStoredMachinePostBinding(adapter, 'shop.robofil-100', post.installation.ref, {
      id: 'production',
      name: 'Production',
      properties: { coordinatePrecision: 3 },
      compatibility: compatibilityFixture()
    })).toMatchObject({ ok: true, binding: { id: 'production' } });

    expect(await removeStoredMachinePostBinding(adapter, 'shop.robofil-100', 'production')).toMatchObject({
      ok: true,
      removed: { id: 'production' }
    });
    expect(await readMachineLibraryStorage(adapter, post.library)).toMatchObject({
      ok: true,
      library: { machines: [{ id: 'shop.robofil-100', bindings: [] }] }
    });
  });

  it('rejects an imported machine with a dangling post and preserves stored bytes', async () => {
    const adapter = new MemoryAdapter();
    await initializePostLibraryStorage(adapter);
    await initializeMachineLibraryStorage(adapter, createEmptyPostLibrary());
    const installed = await installStoredMachineDefinition(adapter, unboundMachineText());
    if (!installed.ok) throw new Error(installed.error.message);
    const tampered = structuredClone(installed.machine) as MachineDefinitionValue;
    tampered.bindings.push({
      id: 'dangling',
      name: 'Dangling',
      post: { packageId: 'missing.post', version: '1.0.0', contentHash: '0'.repeat(64) },
      properties: {},
      compatibility: {
        status: 'acknowledged',
        acknowledgedAt: '2026-08-28T12:00:00.000Z',
        acknowledgedBy: 'Cristian',
        notes: 'Fixture.'
      },
      verification: { status: 'unverified' }
    });
    const before = adapter.files.get(MACHINE_LIBRARY_PATH);

    expect(await installStoredMachineDefinition(adapter, serializeMachineDefinition(tampered))).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_LIBRARY_MUTATION_DANGLING_POST_BINDING' }
    });
    expect(adapter.files.get(MACHINE_LIBRARY_PATH)).toBe(before);
  });

  it('serializes binding creation with post removal so persisted references cannot race', async () => {
    const adapter = new MemoryAdapter();
    await initializePostLibraryStorage(adapter);
    const post = await installStoredPostPackage(adapter, JSON.stringify(minimalPostPackage()));
    if (!post.ok) throw new Error(post.error.message);
    await initializeMachineLibraryStorage(adapter, post.library);
    const machine = await installStoredMachineDefinition(adapter, unboundMachineText());
    if (!machine.ok) throw new Error(machine.error.message);

    const [binding, removal] = await Promise.all([
      createStoredMachinePostBinding(adapter, machine.machine.id, post.installation.ref, {
        id: 'production',
        name: 'Production',
        properties: { coordinatePrecision: 3 },
        compatibility: compatibilityFixture()
      }),
      removeStoredPostInstallation(adapter, post.installation.ref)
    ]);

    expect(binding).toMatchObject({ ok: true, binding: { id: 'production' } });
    expect(removal).toMatchObject({
      ok: false,
      error: { code: 'POST_LIBRARY_INSTALLATION_IN_USE' }
    });
    expect(await readMachineLibraryStorage(adapter, post.library)).toMatchObject({
      ok: true,
      library: {
        machines: [{ id: 'shop.robofil-100', bindings: [{ id: 'production' }] }]
      }
    });
  });
});
