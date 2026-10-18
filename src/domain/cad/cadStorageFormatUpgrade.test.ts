import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '@/domain/storage/browserDirectoryAdapter';
import { FakeDirectoryHandle } from '@/domain/storage/__tests__/fakeDirectoryHandle';
import { WORKBENCH_FILE_TRANSACTION_PATH } from '@/domain/storage/workbenchFileTransaction';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import type { CadDocument } from './cadDocument';
import { createCadDocument, parseCadDocument } from './cadSchema';
import { cadDocumentPath, loadCadDocument, renameCadDocument, saveCadDocument } from './cadStorage';

afterEach(() => vi.restoreAllMocks());

function graphRevision(document: CadDocument) {
  return parseCadDocument({ ...document, schemaVersion: 2, parameters: { span: 20 }, features: [
    { id: 'section', name: 'Open constrained section', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [],
      graph: { points: [{ id: 'origin', position: [0, 0] }, { id: 'tip', position: ['span', 0] }],
        entities: [{ id: 'edge', kind: 'line', construction: false, startPointId: 'origin', endPointId: 'tip' }],
        relations: [{ id: 'level', kind: 'horizontal', pointIds: ['origin', 'tip'] },
          { id: 'length', kind: 'distance', pointIds: ['origin', 'tip'], value: 'span' }] } }
  ] });
}

describe.each(['browser-cache', 'directory'] as const)('CAD document-format preservation in %s', kind => {
  let adapter: WorkbenchStorageAdapter;
  beforeEach(() => {
    localStorage.clear();
    adapter = kind === 'browser-cache' ? createBrowserCacheAdapter(localStorage)
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('cad-format') as unknown as FileSystemDirectoryHandle);
  });

  async function originalSave() {
    const document = createCadDocument('Original Ω', 'cad_format_upgrade');
    const path = cadDocumentPath(document.id);
    const raw = '\uFEFF' + JSON.stringify({ format: 'wireedm-cad-save', schemaVersion: 1,
      updatedAt: '2026-10-16T00:00:00.000Z', document }, null, 2).replaceAll('\n', '\r\n') + '\r\n';
    await adapter.writeText(path, raw);
    const saved = await loadCadDocument(adapter, document.id);
    return { document, path, raw, saved,
      originalPath: `cad/originals/${document.id}/schema-1-${saved.savedVersion}.cad.json` };
  }

  it('preserves the exact older-format save before an explicit document-format upgrade', async () => {
    const { document, path, raw, saved, originalPath } = await originalSave();
    expect(saved.document.schemaVersion).toBe(1);
    expect(await adapter.readExactText?.(path)).toBe(raw);
    const next = graphRevision(document);
    const write = adapter.writeText.bind(adapter);
    vi.spyOn(adapter, 'writeText').mockImplementation(async (target, contents) => {
      if (target === path) expect(await adapter.readExactText?.(originalPath)).toBe(raw);
      return write(target, contents);
    });
    const upgraded = await saveCadDocument(adapter, next, { expectedSavedVersion: saved.savedVersion });
    expect(await adapter.readExactText?.(originalPath)).toBe(raw);
    expect(await loadCadDocument(adapter, document.id)).toEqual(upgraded);
    expect(upgraded.document.schemaVersion).toBe(2);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });

  it('loads and renames an old save without changing its document format or creating an upgrade backup', async () => {
    const { document, path, raw, saved, originalPath } = await originalSave();
    expect(await adapter.readExactText?.(path)).toBe(raw);
    const renamed = await renameCadDocument(adapter, document.id, 'Renamed', { expectedSavedVersion: saved.savedVersion });
    expect(renamed.document.schemaVersion).toBe(1);
    expect(renamed.document.name).toBe('Renamed');
    expect(await adapter.readExactText?.(originalPath)).toBeNull();
    expect(await loadCadDocument(adapter, document.id)).toEqual(renamed);
  });

  it('reuses an identical preserved original across a failed upgrade and retry', async () => {
    const { document, path, raw, saved, originalPath } = await originalSave();
    const next = graphRevision(document);
    await adapter.writeText(originalPath, raw);
    const write = adapter.writeText.bind(adapter);
    let failed = false;
    const writes = vi.spyOn(adapter, 'writeText').mockImplementation(async (target, contents) => {
      if (target === path && !failed) { failed = true; throw new Error('Interrupted replacement'); }
      return write(target, contents);
    });
    await expect(saveCadDocument(adapter, next, { expectedSavedVersion: saved.savedVersion })).rejects.toThrow('Interrupted replacement');
    expect(await adapter.readExactText?.(path)).toBe(raw);
    expect(await adapter.readExactText?.(originalPath)).toBe(raw);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    writes.mockRestore();
    const retry = await saveCadDocument(adapter, next, { expectedSavedVersion: saved.savedVersion });
    expect(await loadCadDocument(adapter, document.id)).toEqual(retry);
    expect(await adapter.readExactText?.(originalPath)).toBe(raw);
  });

  it('rejects conflicting preservation bytes before writing either document', async () => {
    const { document, path, raw, saved, originalPath } = await originalSave();
    const conflicting = raw + ' ';
    await adapter.writeText(originalPath, conflicting);
    const writes = vi.spyOn(adapter, 'writeText');
    await expect(saveCadDocument(adapter, graphRevision(document), {
      expectedSavedVersion: saved.savedVersion
    })).rejects.toMatchObject({ code: 'ORIGINAL_BACKUP_CONFLICT' });
    expect(writes).not.toHaveBeenCalled();
    expect(await adapter.readExactText?.(path)).toBe(raw);
    expect(await adapter.readExactText?.(originalPath)).toBe(conflicting);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });

  it('rejects an original backup changed outside the adapter lock before transaction capture', async () => {
    const { document, path, raw, saved, originalPath } = await originalSave();
    await adapter.writeText(originalPath, raw);
    const read = adapter.readExactText?.bind(adapter);
    if (!read) throw new Error('The real adapters must support exact reads.');
    let reads = 0;
    const conflicting = raw + ' ';
    vi.spyOn(adapter, 'readExactText').mockImplementation(async (target, signal) => {
      if (target === originalPath && ++reads === 2) await adapter.writeText(target, conflicting);
      return read(target, signal);
    });
    await expect(saveCadDocument(adapter, graphRevision(document), { expectedSavedVersion: saved.savedVersion }))
      .rejects.toMatchObject({ code: 'ORIGINAL_BACKUP_CONFLICT' });
    expect(await adapter.readExactText?.(path)).toBe(raw);
    expect(await adapter.readExactText?.(originalPath)).toBe(conflicting);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });

  it('keeps the older save intact when original preservation runs out of storage', async () => {
    const { document, path, raw, saved, originalPath } = await originalSave();
    const write = adapter.writeText.bind(adapter);
    vi.spyOn(adapter, 'writeText').mockImplementation(async (target, contents) => {
      if (target === originalPath) throw new DOMException('No room for original', 'QuotaExceededError');
      return write(target, contents);
    });
    await expect(saveCadDocument(adapter, graphRevision(document), { expectedSavedVersion: saved.savedVersion })).rejects.toThrow('No room for original');
    expect(await adapter.readExactText?.(path)).toBe(raw);
    expect(await loadCadDocument(adapter, document.id)).toEqual(saved);
    expect(await adapter.readExactText?.(originalPath)).toBeNull();
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });

  it('recovers an interrupted upgrade without losing the old save, then safely retries', async () => {
    const { document, path, raw, saved, originalPath } = await originalSave();
    const write = adapter.writeText.bind(adapter), remove = adapter.deleteText.bind(adapter);
    const writes = vi.spyOn(adapter, 'writeText').mockImplementation(async (target, contents) => {
      if (target === path) throw new Error('Replacement interrupted');
      return write(target, contents);
    });
    const removals = vi.spyOn(adapter, 'deleteText').mockImplementation(async target => {
      if (target === originalPath) throw new Error('Rollback interrupted');
      return remove(target);
    });
    const next = graphRevision(document);
    await expect(saveCadDocument(adapter, next, { expectedSavedVersion: saved.savedVersion })).rejects.toThrow('Recovery data is retained');
    expect(await adapter.readExactText?.(path)).toBe(raw);
    expect(await adapter.readExactText?.(originalPath)).toBe(raw);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).not.toBeNull();
    writes.mockRestore(); removals.mockRestore();
    expect(await loadCadDocument(adapter, document.id)).toEqual(saved);
    expect(await adapter.readExactText?.(originalPath)).toBeNull();
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    const retry = await saveCadDocument(adapter, next, { expectedSavedVersion: saved.savedVersion });
    expect(await loadCadDocument(adapter, document.id)).toEqual(retry);
    expect(await adapter.readExactText?.(originalPath)).toBe(raw);
  });

  it('retains both committed images when journal cleanup is interrupted', async () => {
    const { document, path, raw, saved, originalPath } = await originalSave();
    const remove = adapter.deleteText.bind(adapter);
    const removals = vi.spyOn(adapter, 'deleteText').mockImplementation(async target => {
      if (target === WORKBENCH_FILE_TRANSACTION_PATH) throw new Error('Cleanup interrupted');
      return remove(target);
    });
    const upgraded = await saveCadDocument(adapter, graphRevision(document), { expectedSavedVersion: saved.savedVersion });
    const committed = await adapter.readExactText?.(path);
    expect(committed).not.toBe(raw);
    expect(await adapter.readExactText?.(originalPath)).toBe(raw);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).not.toBeNull();
    removals.mockRestore();
    expect(await loadCadDocument(adapter, document.id)).toEqual(upgraded);
    expect(await adapter.readExactText?.(path)).toBe(committed);
    expect(await adapter.readExactText?.(originalPath)).toBe(raw);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });

  it('honors the save guard before starting original preservation', async () => {
    const { document, path, raw, saved, originalPath } = await originalSave();
    const controller = new AbortController(), writes = vi.spyOn(adapter, 'writeText');
    await expect(saveCadDocument(adapter, graphRevision(document), { expectedSavedVersion: saved.savedVersion,
      signal: controller.signal, beforeWrite: () => { controller.abort(); controller.signal.throwIfAborted(); }
    })).rejects.toMatchObject({ reason: { name: 'AbortError' } });
    expect(writes).not.toHaveBeenCalled();
    expect(await adapter.readExactText?.(path)).toBe(raw);
    expect(await adapter.readExactText?.(originalPath)).toBeNull();
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
});
