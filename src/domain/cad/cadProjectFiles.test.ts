import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '@/domain/storage/browserDirectoryAdapter';
import { FakeDirectoryHandle } from '@/domain/storage/__tests__/fakeDirectoryHandle';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { WORKBENCH_FILE_TRANSACTION_PATH } from '@/domain/storage/workbenchFileTransaction';
import { createWorkbenchBackup, restoreWorkbenchBackup } from '@/domain/storage/workbenchBackup';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { createCadDocument } from './cadSchema';
import { archiveCadDocument, cadDocumentPath, listCadProjectLibrary, loadCadDocument, renameCadDocument, restoreCadDocument, saveCadDocument } from './cadStorage';

describe.each(['browser-cache', 'directory'] as const)('CAD project lifecycle in %s', kind => {
  let adapter: WorkbenchStorageAdapter;
  beforeEach(() => {
    localStorage.clear();
    adapter = kind === 'browser-cache' ? createBrowserCacheAdapter(localStorage)
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('cad-projects') as unknown as FileSystemDirectoryHandle);
  });

  it('lists existing saves without a new index, renames optimistically and archives/restores exact originals', async () => {
    const document = createCadDocument('Module 3', 'cad_module3');
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const renamed = await renameCadDocument(adapter, document.id, 'Gear', { expectedSavedVersion: saved.savedVersion });
    await expect(renameCadDocument(adapter, document.id, 'Stale', { expectedSavedVersion: saved.savedVersion })).rejects.toMatchObject({ code: 'SAVED_DOCUMENT_CHANGED' });
    expect((await loadCadDocument(adapter, document.id)).document).toEqual({ ...document, name: 'Gear' });
    await expect(archiveCadDocument(adapter, document.id, { expectedSavedVersion: saved.savedVersion })).rejects.toMatchObject({ code: 'SAVED_DOCUMENT_CHANGED' });
    const currentText = await adapter.readText(cadDocumentPath(document.id));
    if (currentText === null) throw new Error('Missing saved project');
    const exact = `${JSON.stringify(JSON.parse(currentText), null, 2)}\r\n`;
    await adapter.writeText(cadDocumentPath(document.id), exact);
    const formatted = await loadCadDocument(adapter, document.id);
    expect(formatted.savedVersion).not.toBe(renamed.savedVersion);
    const archived = await archiveCadDocument(adapter, document.id, { expectedSavedVersion: formatted.savedVersion });
    expect(await adapter.readText(cadDocumentPath(document.id))).toBeNull();
    expect(await adapter.readExactText?.(archived.archivePath)).toBe(exact);
    expect(await listCadProjectLibrary(adapter)).toMatchObject({ entries: [], archivedEntries: [{ id: document.id, name: 'Gear', savedVersion: formatted.savedVersion }] });
    expect(await adapter.readText('workbench.json')).toBeNull();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const backup = await createWorkbenchBackup(initialized.workbench);
    expect(backup.unreferencedPaths).not.toContain(archived.archivePath);
    const restoredAdapter = kind === 'directory' ? createBrowserCacheAdapter(localStorage, { namespace: 'restored-cad-archive' })
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('restored-cad-archive') as unknown as FileSystemDirectoryHandle);
    const destination = await initializeWorkbenchCatalog(restoredAdapter);
    if (!destination.ok) throw new Error(destination.error.message);
    await restoreWorkbenchBackup(restoredAdapter, backup);
    expect(await restoredAdapter.readExactText?.(archived.archivePath)).toBe(exact);
    await restoreCadDocument(restoredAdapter, archived.archivePath);
    expect(await restoredAdapter.readExactText?.(cadDocumentPath(document.id))).toBe(exact);
    await restoreCadDocument(adapter, archived.archivePath);
    expect(await adapter.readExactText?.(cadDocumentPath(document.id))).toBe(exact);
    expect(await adapter.readText(archived.archivePath)).toBeNull();
    expect(await listCadProjectLibrary(adapter)).toMatchObject({ entries: [{ id: document.id, name: 'Gear' }], archivedEntries: [], diagnostics: [] });
  });

  it('rejects conflicting restores and invalid archives without replacing either original', async () => {
    const document = createCadDocument('Original', 'cad_conflict');
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const archived = await archiveCadDocument(adapter, document.id, { expectedSavedVersion: saved.savedVersion });
    const exact = await adapter.readExactText?.(archived.archivePath);
    await saveCadDocument(adapter, { ...document, name: 'New part' }, { expectedSavedVersion: null });
    await expect(restoreCadDocument(adapter, archived.archivePath)).rejects.toMatchObject({ code: 'RESTORE_CONFLICT' });
    expect(await adapter.readExactText?.(archived.archivePath)).toBe(exact);
    expect((await loadCadDocument(adapter, document.id)).document.name).toBe('New part');
    await adapter.writeText(archived.archivePath, '{malformed original');
    const library = await listCadProjectLibrary(adapter);
    expect(library.entries.map(entry => entry.name)).toEqual(['New part']);
    expect(library.archivedEntries).toEqual([]);
    expect(library.diagnostics).toMatchObject([{ path: archived.archivePath }]);
    await expect(restoreCadDocument(adapter, archived.archivePath)).rejects.toThrow();
    expect(await adapter.readExactText?.(archived.archivePath)).toBe('{malformed original');
  });

  it('rolls back an interrupted archive and keeps cancellation before writes reversible', async () => {
    const document = createCadDocument('Original', 'cad_interrupted');
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const exact = await adapter.readExactText?.(cadDocumentPath(document.id));
    const remove = adapter.deleteText.bind(adapter);
    const fail = vi.spyOn(adapter, 'deleteText').mockImplementationOnce(async () => { throw new Error('Interrupted'); }).mockImplementation(remove);
    await expect(archiveCadDocument(adapter, document.id, { expectedSavedVersion: saved.savedVersion })).rejects.toThrow('Interrupted');
    fail.mockRestore();
    expect(await adapter.readExactText?.(cadDocumentPath(document.id))).toBe(exact);
    expect((await listCadProjectLibrary(adapter)).archivedEntries).toEqual([]);
    const controller = new AbortController(); controller.abort();
    await expect(archiveCadDocument(adapter, document.id, { expectedSavedVersion: saved.savedVersion, signal: controller.signal })).rejects.toThrow();
    expect(await adapter.readExactText?.(cadDocumentPath(document.id))).toBe(exact);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
});
