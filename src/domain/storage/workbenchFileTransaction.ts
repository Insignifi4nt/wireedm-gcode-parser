import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { WorkbenchStorageAdapter } from './workbenchStorageAdapter';

export const WORKBENCH_FILE_TRANSACTION_PATH = 'transactions/workbench-files.json';
const maximumBytes = 384 * 1024 * 1024;
const schema = Type.Object({
  format: Type.Literal('wire-edm-file-transaction'), schemaVersion: Type.Literal(1),
  files: Type.Array(Type.Object({ path: Type.String({ minLength: 1, maxLength: 1024 }),
    previous: Type.Union([Type.String(), Type.Null()]), next: Type.Union([Type.String(), Type.Null()])
  }, { additionalProperties: false }), { minItems: 1, maxItems: 10_000 })
}, { additionalProperties: false });
type Transaction = Static<typeof schema>;

export class WorkbenchFileWriteError extends Error {
  constructor(readonly path: string, detail: unknown) {
    super(detail instanceof Error ? detail.message : String(detail));
  }
}

export function isPortableStoragePath(path: string) {
  return path.length <= 1024 && path.split('/').length <= 17 && path.split('/').every((part) =>
    part.length > 0 && part !== '.' && part !== '..' && !/[<>:"\\|?*\u0000-\u001f]/.test(part)
    && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

function checkFiles(files: Transaction['files']) {
  const seen = new Set<string>();
  for (const file of files) {
    const key = file.path.toLowerCase();
    if (!isPortableStoragePath(file.path) || key.startsWith('transactions/') || seen.has(key)) {
      throw new Error(`Invalid or duplicate recovery path: ${file.path}`);
    }
    seen.add(key);
  }
}

async function put(adapter: WorkbenchStorageAdapter, path: string, text: string | null) {
  if (text === null) await adapter.deleteText(path);
  else {
    const separator = path.lastIndexOf('/');
    if (separator > 0) await adapter.ensureDirectory(path.slice(0, separator));
    await adapter.writeText(path, text);
  }
  if (await adapter.readText(path) !== text) throw new Error(`Storage readback mismatch: ${path}`);
}

async function finish(adapter: WorkbenchStorageAdapter) {
  await adapter.deleteText(WORKBENCH_FILE_TRANSACTION_PATH);
  if (await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH) !== null) throw new Error('Recovery journal could not be removed. Reopen the workbench before further edits.');
}

/** Called under the workbench lock before any operation. Never overwrites unexpected external changes. */
export async function recoverWorkbenchFileTransaction(adapter: WorkbenchStorageAdapter) {
  const raw = await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH);
  if (raw === null) return;
  if (new TextEncoder().encode(raw).byteLength > maximumBytes) throw new Error('File recovery journal exceeds its size limit.');
  const value: unknown = JSON.parse(raw);
  if (!Value.Check(schema, value)) throw new Error('Invalid file recovery journal. Preserve storage for recovery.');
  checkFiles(value.files);
  const current = await Promise.all(value.files.map(({ path }) => adapter.readText(path)));
  if (value.files.some((file, index) => current[index] !== file.previous && current[index] !== file.next)) {
    throw new Error('Files changed outside the pending transaction. Preserve storage and its journal for recovery.');
  }
  if (!value.files.every((file, index) => current[index] === file.next)) {
    // Restore indexes last, after all their referenced files have been restored.
    for (const file of value.files) await put(adapter, file.path, file.previous);
  }
  await finish(adapter);
}

/** Caller holds the lock. Write the catalog last; exact before/after images permit crash recovery. */
export async function commitWorkbenchFileTransaction(
  adapter: WorkbenchStorageAdapter, changes: readonly { path: string; contents: string | null }[]
) {
  if (!changes.length) return;
  await recoverWorkbenchFileTransaction(adapter);
  const ordered = [...changes].sort((a, b) => Number(a.path === 'workbench.json') - Number(b.path === 'workbench.json'));
  checkFiles(ordered.map(({ path, contents }) => ({ path, previous: null, next: contents })));
  const files = await Promise.all(ordered.map(async ({ path, contents }) => ({ path, previous: await adapter.readText(path), next: contents })));
  checkFiles(files);
  const transaction: Transaction = { format: 'wire-edm-file-transaction', schemaVersion: 1, files };
  if (!Value.Check(schema, transaction)) throw new Error('File transaction exceeds its file limit.');
  const raw = JSON.stringify(transaction);
  if (new TextEncoder().encode(raw).byteLength > maximumBytes) throw new Error('File recovery data exceeds its size limit.');
  await adapter.ensureDirectory('transactions');
  try {
    await adapter.writeText(WORKBENCH_FILE_TRANSACTION_PATH, raw);
    if (await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH) !== raw) throw new Error('Recovery journal did not read back exactly.');
  } catch (error) {
    await finish(adapter);
    throw error;
  }
  let writingPath = WORKBENCH_FILE_TRANSACTION_PATH;
  try {
    for (const file of files) {
      writingPath = file.path;
      await put(adapter, file.path, file.next);
    }
  } catch (error) {
    try {
      for (const file of files) {
        const current = await adapter.readText(file.path);
        if (current !== file.previous && current !== file.next) throw new Error('Storage changed outside this transaction.');
      }
      for (const file of files) await put(adapter, file.path, file.previous);
      await finish(adapter);
    } catch {
      throw new Error('Storage write and rollback failed. Recovery data is retained; reopen the workbench before editing.');
    }
    throw new WorkbenchFileWriteError(writingPath, error);
  }
  // Writes are committed. A failed journal cleanup is retried by the next locked operation.
  try { await finish(adapter); } catch { /* Exact next images identify the committed state. */ }
}
