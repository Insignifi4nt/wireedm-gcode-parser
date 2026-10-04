import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildMachinePackageArchive, commitStoredMachinePackageInstallation, prepareStoredMachinePackageInstallation } from '@/domain/machine-package';
import { machinePackageFixture } from '@/domain/machine-package/__tests__/machinePackageFixture';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '@/domain/storage/browserDirectoryAdapter';
import { FakeDirectoryHandle } from '@/domain/storage/__tests__/fakeDirectoryHandle';
import { recoverWorkbenchFileTransaction, WORKBENCH_FILE_TRANSACTION_PATH } from '@/domain/storage/workbenchFileTransaction';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { initializeWorkbenchCatalog, type ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { activateStoredMachinePostBinding, removeStoredMachineDefinition } from '../machineLibraryMutations';
import { MACHINE_LIBRARY_PATH } from '../machineLibraryStorage';

afterEach(() => vi.restoreAllMocks());

describe.each(['cache', 'folder'] as const)('%s machine-library mutation integrity', (kind) => {
  async function fixture() {
    const adapter = kind === 'cache'
      ? createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() })
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('machine-integrity') as unknown as FileSystemDirectoryHandle);
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    let workbench = initialized.workbench;
    for (const version of ['1.0.0', '2.0.0']) {
      const built = await buildMachinePackageArchive(await machinePackageFixture({ packageVersion: version, postVersion: version, bindingId: `setup-${version[0]}` }));
      if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
      const prepared = await prepareStoredMachinePackageInstallation(workbench, built.archive);
      if (!prepared.ok) throw new Error(prepared.error.message);
      const installed = await commitStoredMachinePackageInstallation(prepared.prepared, version === '1.0.0'
        ? { kind: 'install-new' }
        : { kind: 'reuse-existing', machineId: 'shop.robofil-100', activate: 'keep-current' });
      if (!installed.ok) throw new Error(installed.error.message);
      workbench = installed.workbench;
    }
    const original = `${kind === 'folder' ? '\uFEFF' : ''}${JSON.stringify(JSON.parse((await adapter.readText(MACHINE_LIBRARY_PATH))!), null, '\t')}\r\n`;
    await adapter.writeText(MACHINE_LIBRARY_PATH, original);
    return { adapter, workbench, original };
  }

  function mutate(workbench: ConnectedWorkbenchCatalog, operation: 'activate' | 'remove') {
    return operation === 'activate'
      ? activateStoredMachinePostBinding(workbench.adapter, 'shop.robofil-100', 'setup-2')
      : removeStoredMachineDefinition(workbench, 'shop.robofil-100');
  }

  it.each(['activate', 'remove'] as const)('restores exact original bytes after a failed %s write', async (operation) => {
    const { adapter, workbench, original } = await fixture();
    const write = adapter.writeText.bind(adapter);
    let failed = false;
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      if (path === MACHINE_LIBRARY_PATH && !failed) { failed = true; throw new Error('Transient write failure'); }
      await write(path, text);
    });
    expect(await mutate(workbench, operation)).toMatchObject({ ok: false });
    expect(await exact(adapter, MACHINE_LIBRARY_PATH)).toBe(original);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    expect(await mutate(workbench, operation)).toMatchObject({ ok: true });
  });

  it.each(['activate', 'remove'] as const)('preserves an independent edit during %s and retains a retryable journal', async (operation) => {
    const { adapter, workbench, original } = await fixture();
    const write = adapter.writeText.bind(adapter);
    const independent = 'Independent machine catalog bytes\r\n';
    const writes = vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      if (path === MACHINE_LIBRARY_PATH) {
        await write(path, independent);
        throw new Error('External edit during failed write');
      }
      await write(path, text);
    });
    expect(await mutate(workbench, operation)).toMatchObject({ ok: false,
      error: { message: expect.stringContaining('Recovery data is retained') } });
    expect(await exact(adapter, MACHINE_LIBRARY_PATH)).toBe(independent);
    expect(writes.mock.calls.filter(([path]) => path === MACHINE_LIBRARY_PATH)).toHaveLength(1);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).not.toBeNull();
    writes.mockRestore();
    await expect(recoverWorkbenchFileTransaction(adapter)).rejects.toThrow('changed outside');
    expect(await exact(adapter, MACHINE_LIBRARY_PATH)).toBe(independent);
    await write(MACHINE_LIBRARY_PATH, original);
    await recoverWorkbenchFileTransaction(adapter);
    expect(await exact(adapter, MACHINE_LIBRARY_PATH)).toBe(original);
    expect(await mutate(workbench, operation)).toMatchObject({ ok: true });
  });

  it('recovers an interrupted write and rollback without losing exact originals', async () => {
    const { adapter, workbench, original } = await fixture();
    const write = adapter.writeText.bind(adapter);
    const writes = vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      if (path === MACHINE_LIBRARY_PATH) throw new Error('Access interrupted');
      await write(path, text);
    });
    expect(await mutate(workbench, 'activate')).toMatchObject({ ok: false });
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).not.toBeNull();
    writes.mockRestore();
    await recoverWorkbenchFileTransaction(adapter);
    expect(await exact(adapter, MACHINE_LIBRARY_PATH)).toBe(original);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    expect(await mutate(workbench, 'activate')).toMatchObject({ ok: true });
  });

  it('fails journal creation before changing the machine catalog', async () => {
    const { adapter, workbench, original } = await fixture();
    const write = adapter.writeText.bind(adapter);
    const writes = vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      if (path === WORKBENCH_FILE_TRANSACTION_PATH) throw new DOMException('Full storage', 'QuotaExceededError');
      await write(path, text);
    });
    expect(await mutate(workbench, 'remove')).toMatchObject({ ok: false });
    expect(writes.mock.calls.filter(([path]) => path === MACHINE_LIBRARY_PATH)).toHaveLength(0);
    expect(await exact(adapter, MACHINE_LIBRARY_PATH)).toBe(original);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
});

function exact(adapter: WorkbenchStorageAdapter, path: string) {
  return adapter.readExactText?.(path) ?? adapter.readText(path);
}
