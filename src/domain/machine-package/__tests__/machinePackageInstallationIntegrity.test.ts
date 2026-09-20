import { afterEach, describe, expect, it, vi } from 'vitest';

import { MACHINE_LIBRARY_PATH } from '@/domain/machine-definition/machineLibraryStorage';
import { POST_LIBRARY_PATH } from '@/domain/post-processor/postLibraryStorage';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '@/domain/storage/browserDirectoryAdapter';
import { CATALOG_PAIR_TRANSACTION_PATH, recoverCatalogPairTransaction } from '@/domain/storage/catalogPairTransaction';
import { FakeDirectoryHandle } from '@/domain/storage/__tests__/fakeDirectoryHandle';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import { buildMachinePackageArchive } from '../machinePackage';
import { commitStoredMachinePackageInstallation, prepareStoredMachinePackageInstallation } from '../machinePackageInstallation';
import { machinePackageFixture } from './machinePackageFixture';

afterEach(() => vi.restoreAllMocks());

describe.each(['cache', 'folder'] as const)('%s machine-package installation exact bytes', (kind) => {
  async function fixture() {
    const adapter = kind === 'cache'
      ? createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() })
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('installation-integrity') as unknown as FileSystemDirectoryHandle);
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const before = new Map<string, string>();
    for (const path of [POST_LIBRARY_PATH, MACHINE_LIBRARY_PATH]) {
      const original = `${kind === 'folder' ? '\uFEFF' : ''}${JSON.stringify(JSON.parse((await adapter.readText(path))!), null, '\t')}\r\n`;
      await adapter.writeText(path, original);
      before.set(path, original);
    }
    const built = await buildMachinePackageArchive(await machinePackageFixture());
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
    const prepared = await prepareStoredMachinePackageInstallation(initialized.workbench, built.archive);
    if (!prepared.ok) throw new Error(prepared.error.message);
    return { adapter, before, prepared: prepared.prepared };
  }

  it('restores original catalog text, including folder BOMs, when a catalog write fails', async () => {
    const { adapter, before, prepared } = await fixture();
    const write = adapter.writeText.bind(adapter);
    let failed = false;
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, contents) => {
      if (path === MACHINE_LIBRARY_PATH && !failed) {
        failed = true;
        throw new Error('Machine write failed');
      }
      await write(path, contents);
    });

    expect(await commitStoredMachinePackageInstallation(prepared, { kind: 'install-new' })).toMatchObject({ ok: false });
    for (const [path, original] of before) expect(await exact(adapter, path)).toBe(original);
    expect(await adapter.readText(CATALOG_PAIR_TRANSACTION_PATH)).toBeNull();
  });

  it('recovers recorded unchanged catalogs after installation and rollback writes are interrupted', async () => {
    const { adapter, before, prepared } = await fixture();
    const write = adapter.writeText.bind(adapter);
    let interrupted = false;
    const writes = vi.spyOn(adapter, 'writeText').mockImplementation(async (path, contents) => {
      if (path === MACHINE_LIBRARY_PATH) interrupted = true;
      if (interrupted && (path === POST_LIBRARY_PATH || path === MACHINE_LIBRARY_PATH)) {
        throw new Error('Folder access was interrupted');
      }
      await write(path, contents);
    });

    expect(await commitStoredMachinePackageInstallation(prepared, { kind: 'install-new' })).toMatchObject({
      ok: false, error: { code: 'MACHINE_PACKAGE_INSTALLATION_ROLLBACK_FAILED' }
    });
    expect(await adapter.readText(CATALOG_PAIR_TRANSACTION_PATH)).not.toBeNull();
    writes.mockRestore();
    expect(await recoverCatalogPairTransaction(adapter)).toEqual({ ok: true });
    for (const [path, original] of before) expect(await exact(adapter, path)).toBe(original);
    expect(await adapter.readText(CATALOG_PAIR_TRANSACTION_PATH)).toBeNull();
  });

  it('detects a BOM unexpectedly added during write readback and rolls back exactly', async () => {
    const { adapter, before, prepared } = await fixture();
    const write = adapter.writeText.bind(adapter);
    let changed = false;
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, contents) => {
      if (path === POST_LIBRARY_PATH && !changed) {
        changed = true;
        await write(path, `\uFEFF${contents}`);
        return;
      }
      await write(path, contents);
    });

    expect(await commitStoredMachinePackageInstallation(prepared, { kind: 'install-new' })).toMatchObject({
      ok: false, error: { code: 'MACHINE_PACKAGE_INSTALLATION_READBACK_MISMATCH' }
    });
    for (const [path, original] of before) expect(await exact(adapter, path)).toBe(original);
    expect(await adapter.readText(CATALOG_PAIR_TRANSACTION_PATH)).toBeNull();
  });
});

function exact(adapter: WorkbenchStorageAdapter, path: string) {
  return adapter.readExactText?.(path) ?? adapter.readText(path);
}
