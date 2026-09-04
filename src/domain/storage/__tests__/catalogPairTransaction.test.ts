import { describe, expect, it } from 'vitest';

import { MACHINE_LIBRARY_PATH } from '@/domain/machine-definition/machineLibraryStorage';
import { POST_LIBRARY_PATH } from '@/domain/post-processor/postLibraryStorage';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import {
  beginCatalogPairTransaction,
  CATALOG_PAIR_TRANSACTION_PATH,
  recoverCatalogPairTransaction
} from '../catalogPairTransaction';
import type { WorkbenchStorageAdapter } from '../workbenchStorageAdapter';

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
