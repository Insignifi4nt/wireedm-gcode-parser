import { describe, expect, it } from 'vitest';

import { buildMachinePackageArchive } from '@/domain/machine-package';
import { machinePackageFixture } from '@/domain/machine-package/__tests__/machinePackageFixture';
import {
  commitStoredMachinePackageInstallation,
  prepareStoredMachinePackageInstallation
} from '@/domain/machine-package/machinePackageInstallation';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import { createBrowserDirectoryAdapter } from '../browserDirectoryAdapter';

class FakeFileHandle {
  constructor(
    readonly name: string,
    private getContents: () => string,
    private setContents: (contents: string) => void
  ) {}

  async getFile() {
    return new File([this.getContents()], this.name);
  }

  async createWritable() {
    return {
      write: async (contents: string) => this.setContents(contents),
      close: async () => undefined
    };
  }
}

class FakeDirectoryHandle {
  readonly kind = 'directory';
  readonly directories = new Map<string, FakeDirectoryHandle>();
  readonly files = new Map<string, string>();

  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (!options.create) throw new DOMException('Not found', 'NotFoundError');

    const directory = new FakeDirectoryHandle(name);
    this.directories.set(name, directory);
    return directory;
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    if (!this.files.has(name)) {
      if (!options.create) throw new DOMException('Not found', 'NotFoundError');
      this.files.set(name, '');
    }

    return new FakeFileHandle(
      name,
      () => this.files.get(name) || '',
      (contents) => this.files.set(name, contents)
    );
  }

  async removeEntry(name: string) {
    if (!this.files.delete(name)) {
      throw new DOMException('Not found', 'NotFoundError');
    }
  }
}

describe('createBrowserDirectoryAdapter', () => {
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
