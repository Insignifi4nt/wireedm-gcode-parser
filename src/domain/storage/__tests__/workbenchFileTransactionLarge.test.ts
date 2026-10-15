import { expect, it } from 'vitest';
import { commitWorkbenchFileTransaction, recoverWorkbenchFileTransaction, WORKBENCH_FILE_TRANSACTION_PATH } from '../workbenchFileTransaction';
import type { WorkbenchStorageAdapter } from '../workbenchStorageAdapter';

it('commits and recovers exact contents whose escaped journal exceeds the former 384 MiB policy', async () => {
  const data = new Map<string, string>(); let cleanupInterrupted = false, journalCharacters = 0;
  const adapter: WorkbenchStorageAdapter = { kind: 'memory', name: 'Large exact journal', ensureDirectory: async () => {},
    readText: async path => data.get(path) ?? null, readExactText: async path => data.get(path) ?? null,
    writeText: async (path, text) => { if (path === WORKBENCH_FILE_TRANSACTION_PATH) journalCharacters = text.length; data.set(path, text); },
    deleteText: async path => {
      if (path === WORKBENCH_FILE_TRANSACTION_PATH && !cleanupInterrupted) { cleanupInterrupted = true; throw new Error('Interrupted committed cleanup'); }
      data.delete(path);
    } };
  // JSON encodes each NUL as six ASCII bytes: a real >384 MiB envelope,
  // using only 64 MiB of logical text and an in-memory adapter (no disk quota claim).
  const original = '\u0000'.repeat(64 * 1024 * 1024), path = 'cad/documents/large.cad.json';
  await commitWorkbenchFileTransaction(adapter, [{ path, contents: original, expectedPrevious: null }]);
  expect(journalCharacters).toBeGreaterThan(384 * 1024 * 1024);
  expect(data.get(path)).toBe(original); expect(data.has(WORKBENCH_FILE_TRANSACTION_PATH)).toBe(true);
  await recoverWorkbenchFileTransaction(adapter);
  expect(data.get(path)).toBe(original); expect(data.has(WORKBENCH_FILE_TRANSACTION_PATH)).toBe(false);
  await expect(commitWorkbenchFileTransaction(adapter, [{ path, contents: 'EXTERNAL OVERWRITE', expectedPrevious: null }])).rejects.toMatchObject({ path });
  expect(data.get(path)).toBe(original);
}, 30_000);
