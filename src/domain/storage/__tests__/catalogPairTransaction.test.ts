import { describe, expect, it, vi } from 'vitest';

import { MACHINE_LIBRARY_PATH } from '@/domain/machine-definition/machineLibraryStorage';
import { POST_LIBRARY_PATH } from '@/domain/post-processor/postLibraryStorage';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import {
  beginCatalogPairTransaction,
  CATALOG_PAIR_TRANSACTION_PATH,
  recoverCatalogPairTransaction
} from '../catalogPairTransaction';
import type { WorkbenchStorageAdapter } from '../workbenchStorageAdapter';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '../browserDirectoryAdapter';
import { FakeDirectoryHandle } from './fakeDirectoryHandle';

describe('catalog-pair transaction recovery', () => {
  it('restores both previous catalogs after an interrupted first catalog write', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-09-04T08:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const previousPosts = adapter.files.get(POST_LIBRARY_PATH) ?? '';
    const previousMachines = adapter.files.get(MACHINE_LIBRARY_PATH) ?? '';
    const nextPosts = previousPosts.replace('"installations": []', '"installations": [{"interrupted":true}]');
    const nextMachines = previousMachines.replace('"machines": []', '"machines": [{"interrupted":true}]');
    const begun = await beginCatalogPairTransaction(adapter, {
      previousPosts,
      previousMachines,
      nextPosts,
      nextMachines
    });
    if (!begun.ok) throw new Error(begun.error.message);
    await adapter.writeText(POST_LIBRARY_PATH, nextPosts);

    const reopened = await initializeWorkbenchCatalog(adapter);

    expect(reopened).toMatchObject({ ok: true, workbench: { posts: { installations: [] }, machines: { machines: [] } } });
    expect(adapter.files.get(POST_LIBRARY_PATH)).toBe(previousPosts);
    expect(adapter.files.get(MACHINE_LIBRARY_PATH)).toBe(previousMachines);
    expect(adapter.files.has(CATALOG_PAIR_TRANSACTION_PATH)).toBe(false);
  });

  it('finalizes a committed pair without rolling it back when its journal remains', async () => {
    const adapter = new MemoryAdapter();
    const previousPosts = 'previous posts';
    const previousMachines = 'previous machines';
    const nextPosts = 'committed posts';
    const nextMachines = 'committed machines';
    const begun = await beginCatalogPairTransaction(adapter, {
      previousPosts,
      previousMachines,
      nextPosts,
      nextMachines
    });
    if (!begun.ok) throw new Error(begun.error.message);
    await adapter.writeText(POST_LIBRARY_PATH, nextPosts);
    await adapter.writeText(MACHINE_LIBRARY_PATH, nextMachines);

    expect(await recoverCatalogPairTransaction(adapter)).toEqual({ ok: true });
    expect(adapter.files.get(POST_LIBRARY_PATH)).toBe(nextPosts);
    expect(adapter.files.get(MACHINE_LIBRARY_PATH)).toBe(nextMachines);
    expect(adapter.files.has(CATALOG_PAIR_TRANSACTION_PATH)).toBe(false);
  });

  it('removes malformed bytes when transaction-journal creation fails readback', async () => {
    const adapter = new MemoryAdapter();
    adapter.corruptNextJournalWrite = true;

    const begun = await beginCatalogPairTransaction(adapter, {
      previousPosts: 'previous posts',
      previousMachines: 'previous machines',
      nextPosts: 'next posts',
      nextMachines: 'next machines'
    });

    expect(begun).toMatchObject({
      ok: false,
      error: { code: 'CATALOG_PAIR_TRANSACTION_READBACK_MISMATCH' }
    });
    expect(adapter.files.has(CATALOG_PAIR_TRANSACTION_PATH)).toBe(false);
    expect(await recoverCatalogPairTransaction(adapter)).toEqual({ ok: true });
  });
});

describe.each(['cache', 'folder'] as const)('%s catalog-pair recovery conflicts', (kind) => {
  it.each([POST_LIBRARY_PATH, MACHINE_LIBRARY_PATH])('preserves an unrelated update at %s and retains recovery evidence', async (changedPath) => {
    const adapter = storage();
    const previousPosts = 'ORIGINAL POSTS\r\n';
    const previousMachines = 'ORIGINAL MACHINES\r\n';
    const nextPosts = 'NEXT POSTS\n';
    const nextMachines = 'NEXT MACHINES\n';
    await adapter.writeText(POST_LIBRARY_PATH, previousPosts);
    await adapter.writeText(MACHINE_LIBRARY_PATH, previousMachines);
    expect(await beginCatalogPairTransaction(adapter, { previousPosts, previousMachines, nextPosts, nextMachines })).toEqual({ ok: true });
    await adapter.writeText(POST_LIBRARY_PATH, nextPosts);
    await adapter.writeText(changedPath, 'UNRELATED CATALOG UPDATE\r\n');
    const before = await Promise.all([POST_LIBRARY_PATH, MACHINE_LIBRARY_PATH, CATALOG_PAIR_TRANSACTION_PATH].map(path => exact(adapter, path)));
    const write = vi.spyOn(adapter, 'writeText');
    const remove = vi.spyOn(adapter, 'deleteText');

    expect(await recoverCatalogPairTransaction(adapter)).toMatchObject({ ok: false,
      error: { code: 'CATALOG_PAIR_TRANSACTION_RECOVERY_MISMATCH' } });
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(await Promise.all([POST_LIBRARY_PATH, MACHINE_LIBRARY_PATH, CATALOG_PAIR_TRANSACTION_PATH].map(path => exact(adapter, path)))).toEqual(before);

    // Recovery can retry after the conflicting catalog is returned to its recorded state.
    await adapter.writeText(changedPath, changedPath === POST_LIBRARY_PATH ? nextPosts : previousMachines);
    expect(await recoverCatalogPairTransaction(adapter)).toEqual({ ok: true });
    expect(await exact(adapter, POST_LIBRARY_PATH)).toBe(previousPosts);
    expect(await exact(adapter, MACHINE_LIBRARY_PATH)).toBe(previousMachines);
    expect(await adapter.readText(CATALOG_PAIR_TRANSACTION_PATH)).toBeNull();
  });

  it('compares exact bytes when a folder decoder would hide an externally added BOM', async () => {
    const adapter = storage();
    const values = { previousPosts: 'ORIGINAL POSTS', previousMachines: 'ORIGINAL MACHINES',
      nextPosts: 'NEXT POSTS', nextMachines: 'NEXT MACHINES' };
    await adapter.writeText(MACHINE_LIBRARY_PATH, values.previousMachines);
    expect(await beginCatalogPairTransaction(adapter, values)).toEqual({ ok: true });
    await adapter.writeText(POST_LIBRARY_PATH, `\uFEFF${values.nextPosts}`);

    expect(await recoverCatalogPairTransaction(adapter)).toMatchObject({ ok: false });
    expect(await exact(adapter, POST_LIBRARY_PATH)).toBe(`\uFEFF${values.nextPosts}`);
    expect(await adapter.readText(CATALOG_PAIR_TRANSACTION_PATH)).not.toBeNull();
  });

  function storage() {
    return kind === 'cache' ? createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() })
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('catalog-recovery') as unknown as FileSystemDirectoryHandle);
  }

  function exact(adapter: WorkbenchStorageAdapter, path: string) {
    return adapter.readExactText?.(path) ?? adapter.readText(path);
  }
});

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly name = 'catalog-pair-transaction';
  readonly files = new Map<string, string>();
  corruptNextJournalWrite = false;
  async deleteText(path: string) { this.files.delete(path); }
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async writeText(path: string, contents: string) {
    if (path === CATALOG_PAIR_TRANSACTION_PATH && this.corruptNextJournalWrite) {
      this.corruptNextJournalWrite = false;
      this.files.set(path, '{');
      return;
    }
    this.files.set(path, contents);
  }
}
