import { describe, expect, it, vi } from 'vitest';

import { buildMachinePackageArchive } from '@/domain/machine-package';
import { machinePackageFixture } from '@/domain/machine-package/__tests__/machinePackageFixture';
import {
  commitStoredMachinePackageInstallation,
  prepareStoredMachinePackageInstallation
} from '@/domain/machine-package/machinePackageInstallation';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import { createBrowserDirectoryAdapter } from '../browserDirectoryAdapter';

import { FakeDirectoryHandle } from './fakeDirectoryHandle';

describe('createBrowserDirectoryAdapter', () => {
  it.each(['write', 'close'])('aborts a stream after %s fails so a rollback or retry can reopen the file', async (failure) => {
    let open = false;
    let stored = 'ORIGINAL';
    let shouldFail = true;
    const abort = vi.fn(async () => { open = false; });
    const file = {
      createWritable: async () => {
        if (open) throw new Error('File still locked');
        open = true;
        let pending = stored;
        return {
          write: async (text: string) => { if (shouldFail && failure === 'write') { shouldFail = false; throw new Error('Disk write failed'); } pending = text; },
          close: async () => { if (shouldFail && failure === 'close') { shouldFail = false; throw new Error('Disk write failed'); } stored = pending; open = false; }, abort
        };
      }
    };
    const root = { name: 'jobs', getFileHandle: async () => file } as unknown as FileSystemDirectoryHandle;
    const adapter = createBrowserDirectoryAdapter(root);
    await expect(adapter.writeText('program.nc', 'FAILED')).rejects.toThrow('Disk write failed');
    expect(abort).toHaveBeenCalledOnce();
    expect(stored).toBe('ORIGINAL');
    await adapter.writeText('program.nc', 'RETRY');
    expect(stored).toBe('RETRY');
  });

  it('reads and writes nested text files through a directory handle', async () => {
    const root = new FakeDirectoryHandle('jobs');
    const adapter = createBrowserDirectoryAdapter(root as unknown as FileSystemDirectoryHandle);

    await adapter.ensureDirectory('templates');
    await adapter.writeText('templates/header.gcode', 'HEADER');

    expect(adapter.name).toBe('jobs');
    expect(await adapter.readText('templates/header.gcode')).toBe('HEADER');
  });

  it('returns null when a text file does not exist', async () => {
    const root = new FakeDirectoryHandle('jobs');
    const adapter = createBrowserDirectoryAdapter(root as unknown as FileSystemDirectoryHandle);

    await expect(adapter.readText('templates/missing.gcode')).resolves.toBeNull();
  });

  it('deletes nested text files through a directory handle', async () => {
    const root = new FakeDirectoryHandle('jobs');
    const adapter = createBrowserDirectoryAdapter(root as unknown as FileSystemDirectoryHandle);

    await adapter.writeText('projects/example/project.json', '{}');
    await adapter.deleteText('projects/example/project.json');

    await expect(adapter.readText('projects/example/project.json')).resolves.toBeNull();
  });

  it('atomically persists a complete machine package through the folder-backed adapter', async () => {
    const root = new FakeDirectoryHandle('jobs');
    const adapter = createBrowserDirectoryAdapter(root as unknown as FileSystemDirectoryHandle);
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-09-04T08:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const built = await buildMachinePackageArchive(await machinePackageFixture());
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
    const prepared = await prepareStoredMachinePackageInstallation(
      initialized.workbench,
      built.archive
    );
    if (!prepared.ok) throw new Error(prepared.error.message);

    const committed = await commitStoredMachinePackageInstallation(
      prepared.prepared,
      { kind: 'install-new' }
    );

    expect(committed).toMatchObject({
      ok: true,
      workbench: {
        machines: { machines: [{ id: 'shop.robofil-100' }] },
        posts: { installations: [{ ref: { packageId: 'example.robofil-classic' } }] }
      }
    });
    expect(JSON.parse(await adapter.readText('machines/library.json') ?? '{}')).toMatchObject({
      machines: [{ id: 'shop.robofil-100', activeBindingId: 'production' }]
    });
    expect(JSON.parse(await adapter.readText('posts/library.json') ?? '{}')).toMatchObject({
      installations: [{ package: { manifest: { id: 'example.robofil-classic' } } }]
    });
  });
});
