import { describe, expect, it } from 'vitest';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { createEmptyPostLibrary, installPostPackage } from '@/domain/post-processor/postLibrary';

import { createEmptyMachineLibrary, installMachineDefinition } from '../machineLibrary';
import {
  initializeMachineLibraryStorage,
  MACHINE_LIBRARY_DIRECTORY,
  MACHINE_LIBRARY_PATH,
  readMachineLibraryStorage,
  writeMachineLibraryStorage
} from '../machineLibraryStorage';
import { boundMachineFixture } from './machineDefinitionFixture';

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  readonly directories: string[] = [];

  constructor(readonly name = 'machine-library-test') {}
  async ensureDirectory(path: string) { this.directories.push(path); }
  async readText(path: string) { return this.files.get(path) ?? null; }
  async writeText(path: string, contents: string) { this.files.set(path, contents); }
  async deleteText(path: string) { this.files.delete(path); }
}

async function fixture() {
  const bound = await boundMachineFixture();
  const post = await installPostPackage(createEmptyPostLibrary(), bound.installation.package);
  if (!post.ok) throw new Error(post.error.message);
  const machines = installMachineDefinition(createEmptyMachineLibrary(), bound.machine);
  if (!machines.ok) throw new Error(machines.error.message);
  return { machines: machines.library, posts: post.library };
}

describe('machine library storage', () => {
  it('initializes an empty library without creating a default machine', async () => {
    const adapter = new MemoryAdapter();

    expect(await initializeMachineLibraryStorage(adapter, createEmptyPostLibrary())).toEqual({
      ok: true,
      kind: 'created',
      library: createEmptyMachineLibrary()
    });
    expect(adapter.directories).toEqual([MACHINE_LIBRARY_DIRECTORY]);
    expect(JSON.parse(adapter.files.get(MACHINE_LIBRARY_PATH) ?? '')).toEqual({
      format: 'wire-edm-machine-library',
      schemaVersion: 1,
      machines: []
    });
  });

  it('round-trips machines only when every exact post reference resolves', async () => {
    const adapter = new MemoryAdapter();
    const { machines, posts } = await fixture();
    expect(await writeMachineLibraryStorage(adapter, machines)).toEqual({ ok: true });

    expect(await readMachineLibraryStorage(adapter, posts)).toEqual({ ok: true, library: machines });
    expect(await readMachineLibraryStorage(adapter, createEmptyPostLibrary())).toMatchObject({
      ok: false,
      error: {
        code: 'MACHINE_LIBRARY_STORAGE_DANGLING_POST_BINDING',
        path: '/machines/0/bindings/0/post'
      }
    });
  });

  it('rejects obsolete library schemas instead of normalizing them', async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set(MACHINE_LIBRARY_PATH, JSON.stringify({
      format: 'wire-edm-machine-library',
      schemaVersion: 0,
      machines: []
    }));

    expect(await readMachineLibraryStorage(adapter, createEmptyPostLibrary())).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_LIBRARY_STORAGE_SCHEMA_INVALID', path: '/schemaVersion' }
    });
  });

  it('rejects structurally invalid machine entries at the library schema boundary', async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set(MACHINE_LIBRARY_PATH, JSON.stringify({
      format: 'wire-edm-machine-library',
      schemaVersion: 1,
      machines: [42]
    }));

    expect(await readMachineLibraryStorage(adapter, createEmptyPostLibrary())).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_LIBRARY_STORAGE_SCHEMA_INVALID', path: '/machines/0' }
    });
  });
});
