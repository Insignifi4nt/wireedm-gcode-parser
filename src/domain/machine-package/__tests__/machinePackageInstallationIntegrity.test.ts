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

  it('checks cancellation after exact catalog reads without creating a journal or changing originals', async () => {
    const { adapter, before, prepared } = await fixture();
    const abort = new AbortController();
    const read = adapter.readExactText!.bind(adapter);
    vi.spyOn(adapter, 'readExactText').mockImplementation(async path => {
      const text = await read(path);
      if (path === MACHINE_LIBRARY_PATH) abort.abort();
      return text;
    });
    const writes = vi.spyOn(adapter, 'writeText');
    await expect(commitStoredMachinePackageInstallation(prepared, { kind: 'install-new' }, { beforeWrite: () => abort.signal.throwIfAborted() }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(writes).not.toHaveBeenCalled();
    for (const [path, original] of before) expect(await exact(adapter, path)).toBe(original);
    expect(await adapter.readText(CATALOG_PAIR_TRANSACTION_PATH)).toBeNull();
  });

  it('finishes a transaction after late cancellation instead of interrupting catalog recovery', async () => {
    const { adapter, prepared } = await fixture();
    const abort = new AbortController();
    const write = adapter.writeText.bind(adapter);
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      await write(path, text);
      if (path === CATALOG_PAIR_TRANSACTION_PATH) abort.abort();
    });
    expect(await commitStoredMachinePackageInstallation(prepared, { kind: 'install-new' }, { beforeWrite: () => abort.signal.throwIfAborted() }))
      .toMatchObject({ ok: true });
    expect(abort.signal.aborted).toBe(true);
    expect(await adapter.readText(CATALOG_PAIR_TRANSACTION_PATH)).toBeNull();
    const reopened = await initializeWorkbenchCatalog(adapter);
    expect(reopened).toMatchObject({ ok: true, workbench: { machines: { machines: [{ id: prepared.package.document.machine.id }] } } });
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

  it('detects an unexpected BOM at readback and preserves the unknown exact bytes for recovery', async () => {
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
      ok: false, error: { code: 'MACHINE_PACKAGE_INSTALLATION_ROLLBACK_FAILED',
        message: expect.stringContaining('did not read back byte-for-byte') }
    });
    // A decoder-hidden BOM is still an unknown state, as in restart recovery.
    // Immediate rollback must not erase it or its journal as the old contract did.
    const journal = JSON.parse((await adapter.readText(CATALOG_PAIR_TRANSACTION_PATH))!);
    expect(await exact(adapter, POST_LIBRARY_PATH)).toBe(`\uFEFF${journal.nextPosts}`);
    expect(await exact(adapter, MACHINE_LIBRARY_PATH)).toBe(journal.nextMachines);
    expect(await recoverCatalogPairTransaction(adapter)).toMatchObject({ ok: false });
    expect(await exact(adapter, POST_LIBRARY_PATH)).not.toBe(before.get(POST_LIBRARY_PATH));
    expect(await adapter.readText(CATALOG_PAIR_TRANSACTION_PATH)).not.toBeNull();
  });

  it.each([POST_LIBRARY_PATH, MACHINE_LIBRARY_PATH])('preserves an independent edit at %s before any rollback write and permits a reviewed retry', async (changedPath) => {
    const { adapter, before, prepared } = await fixture();
    const write = adapter.writeText.bind(adapter);
    const external = 'Independent catalog change\r\n';
    let interrupted = false;
    const writes = vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      if (path === MACHINE_LIBRARY_PATH && !interrupted) {
        interrupted = true;
        await write(changedPath, external);
        throw new Error('Machine write interrupted');
      }
      await write(path, text);
    });
    expect(await commitStoredMachinePackageInstallation(prepared, { kind: 'install-new' })).toMatchObject({
      ok: false, error: { code: 'MACHINE_PACKAGE_INSTALLATION_ROLLBACK_FAILED',
        message: expect.stringContaining('preserved') }
    });
    expect(await exact(adapter, changedPath)).toBe(external);
    expect(writes.mock.calls.filter(([path]) => path === POST_LIBRARY_PATH)).toHaveLength(1);
    expect(await adapter.readText(CATALOG_PAIR_TRANSACTION_PATH)).not.toBeNull();
    writes.mockRestore();
    expect(await recoverCatalogPairTransaction(adapter)).toMatchObject({ ok: false });

    // Only a deliberate restoration of known bytes resolves the conflict.
    await write(changedPath, before.get(changedPath)!);
    expect(await recoverCatalogPairTransaction(adapter)).toEqual({ ok: true });
    for (const [path, original] of before) expect(await exact(adapter, path)).toBe(original);
    expect(await adapter.readText(CATALOG_PAIR_TRANSACTION_PATH)).toBeNull();
    expect(await commitStoredMachinePackageInstallation(prepared, { kind: 'install-new' })).toMatchObject({ ok: true });
  });
});

function exact(adapter: WorkbenchStorageAdapter, path: string) {
  return adapter.readExactText?.(path) ?? adapter.readText(path);
}
