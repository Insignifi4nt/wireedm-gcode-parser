import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '@/domain/storage/browserDirectoryAdapter';
import { FakeDirectoryHandle } from '@/domain/storage/__tests__/fakeDirectoryHandle';
import { WORKBENCH_FILE_TRANSACTION_PATH } from '@/domain/storage/workbenchFileTransaction';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { createCadDocument, parseCadDocument } from './cadSchema';
import { cadDocumentPath, listCadDocuments, loadCadDocument, saveCadDocument } from './cadStorage';
import { CAD_BUDGET_ISO_TIME, CAD_FORMER_DOCUMENT_BYTES, cadBudgetFixture, cadBudgetOriginals, utf8Bytes, utf8Hash } from './__tests__/cadBudgetFixture';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe.each(['browser-cache', 'directory'] as const)('CAD large exact serialization in %s', kind => {
  let adapter: WorkbenchStorageAdapter;
  beforeEach(() => {
    localStorage.clear();
    adapter = kind === 'browser-cache' ? createBrowserCacheAdapter(localStorage)
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('cad-budget') as unknown as FileSystemDirectoryHandle);
  });
  it.each([CAD_FORMER_DOCUMENT_BYTES - 1, CAD_FORMER_DOCUMENT_BYTES, CAD_FORMER_DOCUMENT_BYTES + 1, CAD_FORMER_DOCUMENT_BYTES + 64 * 1024])('saves and reopens a %i-byte semantic payload with exact originals and receipt', async bytes => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(CAD_BUDGET_ISO_TIME));
    const document = parseCadDocument(cadBudgetFixture(bytes));
    const originalHashes = await Promise.all(cadBudgetOriginals(document).map(utf8Hash));
    expect(utf8Bytes(JSON.stringify(document))).toBe(bytes);
    expect(JSON.stringify(document).length).toBeLessThan(bytes);
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const path = cadDocumentPath(document.id), raw = await adapter.readExactText?.(path);
    if (raw === null || raw === undefined) throw new Error('Missing saved original.');
    expect(utf8Bytes(raw)).toBe(bytes + 101);
    expect(saved.updatedAt).toBe(CAD_BUDGET_ISO_TIME);
    expect(saved.savedVersion).toBe(await utf8Hash(raw));
    const reopened = await loadCadDocument(adapter, document.id);
    expect(reopened).toEqual(saved);
    expect(reopened.document).toEqual(document);
    expect(await Promise.all(cadBudgetOriginals(reopened.document).map(utf8Hash))).toEqual(originalHashes);
    expect((await listCadDocuments(adapter)).entries).toMatchObject([{ id: document.id, savedVersion: saved.savedVersion }]);
    expect(await adapter.readExactText?.(path)).toBe(raw);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
  it.each([-1, 0, 1])('preserves saved originals across the former wrapper boundary at offset %i', async delta => {
    const document = parseCadDocument(cadBudgetFixture(CAD_FORMER_DOCUMENT_BYTES + Math.min(delta, 0)));
    const path = cadDocumentPath(document.id);
    const raw = JSON.stringify({ format: 'wireedm-cad-save', schemaVersion: 1, updatedAt: CAD_BUDGET_ISO_TIME, document }) + (delta > 0 ? ' ' : '');
    expect(utf8Bytes(raw)).toBe(CAD_FORMER_DOCUMENT_BYTES + 101 + delta);
    await adapter.writeText(path, raw);
    const writes = vi.spyOn(adapter, 'writeText');
    expect((await loadCadDocument(adapter, document.id)).savedVersion).toBe(await utf8Hash(raw));
    expect((await listCadDocuments(adapter)).entries).toHaveLength(1);
    const fallback = { ...adapter, readBoundedExactText: undefined };
    expect((await loadCadDocument(fallback, document.id)).document).toEqual(document);
    expect(writes).not.toHaveBeenCalled();
    expect(await adapter.readExactText?.(path)).toBe(raw);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
  it('rejects an invalid large semantic revision before writes and preserves its earlier saved receipt', async () => {
    const original = createCadDocument('Earlier exact save', 'cad_original');
    const saved = await saveCadDocument(adapter, original, { expectedSavedVersion: null });
    const path = cadDocumentPath(original.id), exact = await adapter.readExactText?.(path);
    const writes = vi.spyOn(adapter, 'writeText');
    const document = cadBudgetFixture(CAD_FORMER_DOCUMENT_BYTES + 1, original.id);
    const invalid = { ...document, features: document.features.map(feature => feature.kind !== 'sketch' ? feature : { ...feature,
      profiles: feature.profiles.map(profile => ({ ...profile, geometry: { ...profile.geometry, width: 0 } })) }) };
    await expect(saveCadDocument(adapter, invalid,
      { expectedSavedVersion: saved.savedVersion })).rejects.toMatchObject({ code: 'invalid-profile' });
    expect(writes).not.toHaveBeenCalled();
    expect(await adapter.readExactText?.(path)).toBe(exact);
    expect(await loadCadDocument(adapter, original.id)).toEqual(saved);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
  describe('large saved-original recovery', () => {
    let saved: Awaited<ReturnType<typeof saveCadDocument>>;
    let path: string, exact: string;
    beforeEach(async () => {
      const document = parseCadDocument(cadBudgetFixture(CAD_FORMER_DOCUMENT_BYTES + 64 * 1024));
      saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
      path = cadDocumentPath(document.id);
      const raw = await adapter.readExactText?.(path);
      if (raw === null || raw === undefined) throw new Error('Missing saved original.');
      exact = raw;
    }, 5000);
    it('cancels a large save before writing and retains its exact saved original', async () => {
      const next = { ...saved.document, name: 'Limită Ω edit' };
      const abort = new AbortController();
      await expect(saveCadDocument(adapter, next, { expectedSavedVersion: saved.savedVersion, signal: abort.signal,
        beforeWrite: () => { abort.abort(); abort.signal.throwIfAborted(); } })).rejects.toMatchObject({ reason: { name: 'AbortError' } });
      expect(await adapter.readExactText?.(path)).toBe(exact);
      expect(await loadCadDocument(adapter, saved.document.id)).toEqual(saved);
      expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    });
    it('restores a large interrupted write, retries it and rejects its stale saved version', async () => {
      const document = saved.document, next = { ...document, name: 'Limită Ω edit' };
      const write = adapter.writeText.bind(adapter); let failed = false;
      const writes = vi.spyOn(adapter, 'writeText').mockImplementation(async (target, contents) => {
        if (target === path && !failed) { failed = true; throw new Error('Interrupted large save'); }
        return write(target, contents);
      });
      await expect(saveCadDocument(adapter, next, { expectedSavedVersion: saved.savedVersion })).rejects.toThrow('Interrupted large save');
      expect(await adapter.readExactText?.(path)).toBe(exact);
      expect(await loadCadDocument(adapter, document.id)).toEqual(saved);
      writes.mockRestore();
      const retry = await saveCadDocument(adapter, next, { expectedSavedVersion: saved.savedVersion });
      expect(await loadCadDocument(adapter, document.id)).toEqual(retry);
      await expect(saveCadDocument(adapter, document, { expectedSavedVersion: saved.savedVersion })).rejects.toMatchObject({ code: 'SAVED_DOCUMENT_CHANGED' });
      expect((await loadCadDocument(adapter, document.id)).savedVersion).toBe(retry.savedVersion);
      expect(cadBudgetOriginals(retry.document)).toEqual(cadBudgetOriginals(document));
      expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    // Five exact multi-MiB saves and loads; shared CI runners need more than the default budget.
    }, 20_000);
  });
  it.each(['load', 'save', 'list'] as const)('cancels %s during an exact read without publishing or overwriting the original', async operation => {
    const document = parseCadDocument(cadBudgetFixture(CAD_FORMER_DOCUMENT_BYTES + 64 * 1024));
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const path = cadDocumentPath(document.id), raw = await adapter.readExactText?.(path);
    if (raw === undefined || raw === null) throw new Error('Missing exact source.');
    const abort = new AbortController();
    let release: () => void = () => { throw new Error('No read started.'); };
    let started: () => void = () => { throw new Error('No read started.'); };
    const reading = new Promise<void>(resolve => { started = resolve; });
    const pause = new Promise<void>(resolve => { release = resolve; });
    const exact = adapter.readExactText!.bind(adapter);
    // Recovery journal checks read exactly too; only the document read pauses.
    const reads = vi.spyOn(adapter, 'readExactText').mockImplementation(async (target, signal) => {
      if (target !== path) return exact(target, signal);
      expect(signal).toBe(abort.signal);
      started(); await pause; return raw;
    });
    const writes = vi.spyOn(adapter, 'writeText');
    const pending = operation === 'load' ? loadCadDocument(adapter, document.id, abort.signal)
      : operation === 'list' ? listCadDocuments(adapter, abort.signal)
      : saveCadDocument(adapter, { ...document, name: 'Limită Ω edit' }, { expectedSavedVersion: saved.savedVersion, signal: abort.signal });
    await reading; abort.abort(); release();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(writes).not.toHaveBeenCalled(); reads.mockRestore();
    expect(await adapter.readExactText?.(path)).toBe(raw);
    expect(await loadCadDocument(adapter, document.id)).toEqual(saved);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
});
