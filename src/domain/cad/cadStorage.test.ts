import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '@/domain/storage/browserDirectoryAdapter';
import { FakeDirectoryHandle } from '@/domain/storage/__tests__/fakeDirectoryHandle';
import { WORKBENCH_FILE_TRANSACTION_PATH } from '@/domain/storage/workbenchFileTransaction';
import { createWorkbenchBackup, removeUnreferencedWorkbenchFiles, restoreWorkbenchBackup } from '@/domain/storage/workbenchBackup';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { createCadDocument } from './cadSchema';
import { cadDocumentPath, listCadDocuments, loadCadDocument, saveCadDocument } from './cadStorage';

afterEach(() => vi.restoreAllMocks());

describe.each(['browser-cache', 'directory'] as const)('CAD persistence in %s', kind => {
  let adapter: WorkbenchStorageAdapter;
  beforeEach(() => {
    localStorage.clear();
    adapter = kind === 'browser-cache' ? createBrowserCacheAdapter(localStorage)
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('cad-test') as unknown as FileSystemDirectoryHandle);
  });
  it('round trips the exact parametric document and detects concurrent saved changes', async () => {
    const document = createCadDocument('Bracket', 'cad_bracket');
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    expect((await loadCadDocument(adapter, document.id)).document).toEqual(document);
    const next = await saveCadDocument(adapter, { ...document, name: 'Edited' }, { expectedSavedVersion: saved.savedVersion });
    await expect(saveCadDocument(adapter, { ...document, name: 'Stale' }, { expectedSavedVersion: saved.savedVersion })).rejects.toThrow('changed in storage');
    expect((await loadCadDocument(adapter, document.id)).savedVersion).toBe(next.savedVersion);
    expect((await listCadDocuments(adapter)).entries).toMatchObject([{ id: 'cad_bracket', name: 'Edited' }]);
  });
  it('rejects invalid data and prewrite cancellation without changing exact originals', async () => {
    const document = createCadDocument('Original', 'cad_original');
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const path = cadDocumentPath(document.id);
    const original = await adapter.readExactText?.(path);
    await expect(saveCadDocument(adapter, { ...document, parameters: { width: Infinity } }, { expectedSavedVersion: saved.savedVersion })).rejects.toThrow();
    const controller = new AbortController();
    await expect(saveCadDocument(adapter, { ...document, name: 'Cancelled' }, { expectedSavedVersion: saved.savedVersion,
      beforeWrite: () => { controller.abort(); controller.signal.throwIfAborted(); } })).rejects.toThrow();
    expect(await adapter.readExactText?.(path)).toBe(original);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
  it('rolls back an interrupted update before reopening and permits a safe retry', async () => {
    const document = createCadDocument('Original', 'cad_interrupted');
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const path = cadDocumentPath(document.id);
    const original = await adapter.readExactText?.(path);
    const next = JSON.stringify({ format: 'wireedm-cad-save', schemaVersion: 1, updatedAt: new Date().toISOString(), document: { ...document, name: 'Next' } });
    await adapter.ensureDirectory('transactions');
    await adapter.writeText(WORKBENCH_FILE_TRANSACTION_PATH, JSON.stringify({ format: 'wire-edm-file-transaction', schemaVersion: 1,
      files: [{ path, previous: original, next }, { path: 'cad/receipt.json', previous: null, next: 'receipt' }] }));
    await adapter.writeText(path, next);
    expect((await loadCadDocument(adapter, document.id)).document.name).toBe('Original');
    expect(await adapter.readExactText?.(path)).toBe(original);
    const retry = await saveCadDocument(adapter, { ...document, name: 'Retry' }, { expectedSavedVersion: saved.savedVersion });
    expect(retry.document.name).toBe('Retry');
  });
  it('prepares the save receipt before writing and makes no writes if hashing fails', async () => {
    const document = createCadDocument('Receipt', 'cad_receipt');
    const write = adapter.writeText.bind(adapter);
    const writes = vi.spyOn(adapter, 'writeText');
    const digest = vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('Hash unavailable'));
    await expect(saveCadDocument(adapter, document, { expectedSavedVersion: null })).rejects.toThrow('Hash unavailable');
    expect(writes).not.toHaveBeenCalled();
    digest.mockRestore();
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
    let started = false;
    writes.mockImplementation(async (path, text) => {
      if (path === WORKBENCH_FILE_TRANSACTION_PATH) started = true;
      await write(path, text);
    });
    vi.spyOn(crypto.subtle, 'digest').mockImplementation((algorithm, data) => {
      if (started) throw new Error('Receipt hashing happened after the write');
      return originalDigest(algorithm, data);
    });
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    expect(saved.savedVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(await adapter.readText(cadDocumentPath(document.id))).toContain('Receipt');
  });
  it.each([false, true])('reports the actual outcome after journal-start cancellation, write failure=%s', async failWrite => {
    const document = createCadDocument('Original', 'cad_late_cancel');
    const original = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const path = cadDocumentPath(document.id);
    const exact = await adapter.readExactText?.(path);
    const controller = new AbortController();
    const write = adapter.writeText.bind(adapter);
    let failed = false;
    vi.spyOn(adapter, 'writeText').mockImplementation(async (target, text) => {
      if (target === path && failWrite && !failed) { failed = true; throw new Error('Disk full'); }
      await write(target, text);
      if (target === WORKBENCH_FILE_TRANSACTION_PATH) controller.abort();
    });
    const pending = saveCadDocument(adapter, { ...document, name: 'Committed' }, {
      expectedSavedVersion: original.savedVersion, signal: controller.signal
    });
    if (failWrite) {
      await expect(pending).rejects.toThrow('Disk full');
      expect(await adapter.readExactText?.(path)).toBe(exact);
    } else {
      const receipt = await pending;
      expect(controller.signal.aborted).toBe(true);
      expect(receipt.document.name).toBe('Committed');
      expect((await loadCadDocument(adapter, document.id)).savedVersion).toBe(receipt.savedVersion);
    }
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
  it('returns the committed save when cleanup fails and recovers without reverting it', async () => {
    const document = createCadDocument('Committed', 'cad_cleanup');
    const remove = adapter.deleteText.bind(adapter);
    vi.spyOn(adapter, 'deleteText').mockRejectedValueOnce(new Error('Cleanup interrupted')).mockImplementation(remove);
    const receipt = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).not.toBeNull();
    const reopened = await loadCadDocument(adapter, document.id);
    expect(reopened).toEqual(receipt);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    const edited = await saveCadDocument(adapter, { ...document, name: 'Next' }, { expectedSavedVersion: receipt.savedVersion });
    expect(edited.document.name).toBe('Next');
  });
  it('retains malformed documents with diagnostics instead of hiding or rewriting them', async () => {
    await adapter.ensureDirectory('cad/documents');
    await adapter.writeText('cad/documents/cad_broken.cad.json', '{original broken bytes');
    const library = await listCadDocuments(adapter);
    expect(library.diagnostics).toHaveLength(1);
    expect(await adapter.readExactText?.('cad/documents/cad_broken.cad.json')).toBe('{original broken bytes');
  });
  it('includes CAD in full backup and excludes it from unreferenced-file cleanup', async () => {
    const opened = await initializeWorkbenchCatalog(adapter);
    if (!opened.ok) throw new Error(opened.error.message);
    const document = createCadDocument('Backed up', 'cad_backup');
    await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const retained = [
      { path: 'cad/documents/cad_broken.cad.json', text: '\ufeff{broken original\r\n' },
      { path: 'CAD/recovery/part.cad.json', text: 'unindexed original\r\n' }
    ];
    for (const file of retained) await adapter.writeText(file.path, file.text);
    const backup = await createWorkbenchBackup(opened.workbench);
    expect(backup.unreferencedPaths).not.toContain(cadDocumentPath(document.id));
    for (const file of retained) {
      expect(backup.unreferencedPaths).not.toContain(file.path);
      await expect(removeUnreferencedWorkbenchFiles(opened.workbench, backup, [file.path])).rejects.toThrow('explicitly selected');
    }
    const restoredAdapter = createBrowserCacheAdapter(localStorage, { namespace: 'restored-cad' });
    const restored = await initializeWorkbenchCatalog(restoredAdapter);
    if (!restored.ok) throw new Error(restored.error.message);
    await restoreWorkbenchBackup(restoredAdapter, backup);
    expect((await loadCadDocument(restoredAdapter, document.id)).document).toEqual(document);
    for (const file of retained) expect(await restoredAdapter.readExactText?.(file.path)).toBe(file.text);
  });
});
