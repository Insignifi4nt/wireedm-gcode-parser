import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { WorkbenchStorageAdapter } from './workbenchStorageAdapter';
import {
  cleanupFailedTransactionJournalWrite,
  readExactTransactionText as readExact,
  removeTransactionJournal,
  verifyTransactionJournal,
  verifyTransactionJournalAbsent,
  type TransactionJournalWritePhase
} from './transactionFileState';

export const WORKBENCH_FILE_TRANSACTION_PATH = 'transactions/workbench-files.json';
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

/** Distinguish a rejected pre-write guard from a storage write failure. No journal exists yet. */
export class WorkbenchFileGuardError extends Error {
  constructor(readonly reason: unknown) { super('File transaction cancelled before writing.'); }
}

/** A caller's optimistic original must be the same image retained for recovery. */
export class WorkbenchFileConflictError extends Error {
  constructor(readonly path: string) { super(`File changed before transaction capture: ${path}`); }
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
    if (!isPortableStoragePath(file.path) || key === 'transactions' || key.startsWith('transactions/') || seen.has(key)) {
      throw new Error(`Invalid or duplicate recovery path: ${file.path}`);
    }
    seen.add(key);
  }
  for (const image of ['previous', 'next'] as const) {
    checkPathTree(files.filter((file) => file[image] !== null).map(({ path }) => path), seen);
  }
}

function checkPathTree(paths: readonly string[], affected: ReadonlySet<string>) {
  const byKey = new Map<string, string>();
  for (const path of paths) {
    const key = path.toLowerCase();
    const previous = byKey.get(key);
    if (previous !== undefined && previous !== path && affected.has(key)) {
      throw new Error(`File path collision: ${previous} and ${path}.`);
    }
    byKey.set(key, path);
  }
  for (const [key, path] of byKey) {
    for (let separator = key.indexOf('/'); separator >= 0; separator = key.indexOf('/', separator + 1)) {
      const parent = key.slice(0, separator);
      if (byKey.has(parent) && (affected.has(key) || affected.has(parent))) {
        throw new Error(`File/directory path collision: ${byKey.get(parent)} and ${path}.`);
      }
    }
  }
}

/** Only affected trees are checked; retained unrelated files never authorize deletion. */
async function checkResultingTrees(adapter: WorkbenchStorageAdapter, files: Transaction['files']) {
  const changed = new Set(files.map(({ path }) => path));
  const affected = new Set(files.map(({ path }) => path.toLowerCase()));
  // A folder can resolve a differently cased name to an existing physical file.
  const existingFolderAliases = new Set(adapter.kind === 'directory'
    ? files.filter(({ previous }) => previous !== null).map(({ path }) => path.toLowerCase()) : []);
  let inventory: Awaited<ReturnType<NonNullable<WorkbenchStorageAdapter['listFiles']>>> | undefined;
  try { inventory = await adapter.listFiles?.(); }
  catch { /* Optional inventory must not make an otherwise valid write unavailable. */ }
  const retained = (inventory?.paths ?? []).filter((path) => !changed.has(path) && !existingFolderAliases.has(path.toLowerCase()));
  for (const image of ['previous', 'next'] as const) {
    const proposed = files.filter((file) => file[image] !== null).map(({ path }) => path);
    const known = [...retained, ...proposed];
    if (!inventory || inventory.truncated) {
      // Partial inventories cannot prove descendants absent. Direct ancestors
      // still reveal parent files, without rejecting every large workbench.
      const parents = new Set<string>();
      for (const path of proposed) {
        for (let separator = path.indexOf('/'); separator >= 0; separator = path.indexOf('/', separator + 1)) {
          const parent = path.slice(0, separator);
          if (!changed.has(parent) && !existingFolderAliases.has(parent.toLowerCase())) parents.add(parent);
        }
      }
      for (const parent of parents) {
        try { if (await adapter.readText(parent) !== null) known.push(parent); }
        catch { /* Folder directory handles and inaccessible optional reads supply no file evidence. */ }
      }
    }
    checkPathTree(known, affected);
  }
}

// File System Access may create an empty handle before a failed first write.
function hasExpectedStates(files: Transaction['files'], current: readonly (string | null)[]) {
  let laterUnchanged = true;
  for (let index = files.length - 1; index >= 0; index--) {
    const file = files[index];
    // A failed first write may create an empty handle, but no later write can
    // have advanced yet. An empty earlier file after that point is unknown loss.
    if (current[index] !== file.previous && current[index] !== file.next &&
        !(file.previous === null && current[index] === '' && laterUnchanged)) return false;
    laterUnchanged = laterUnchanged && current[index] === file.previous;
  }
  return true;
}

async function put(adapter: WorkbenchStorageAdapter, path: string, text: string | null) {
  if (text === null) await adapter.deleteText(path);
  else {
    const separator = path.lastIndexOf('/');
    if (separator > 0) await adapter.ensureDirectory(path.slice(0, separator));
    await adapter.writeText(path, text);
  }
  if (await readExact(adapter, path) !== text) throw new Error(`Storage readback mismatch: ${path}`);
}

async function finish(adapter: WorkbenchStorageAdapter, expected: string) {
  await removeTransactionJournal(adapter, WORKBENCH_FILE_TRANSACTION_PATH, { kind: 'verified', text: expected });
}

/** Called under the workbench lock before any operation. Never overwrites unexpected external changes. */
export async function recoverWorkbenchFileTransaction(adapter: WorkbenchStorageAdapter) {
  const raw = await readExact(adapter, WORKBENCH_FILE_TRANSACTION_PATH);
  if (raw === null) return;
  // A new folder handle can exist before its atomic first write commits.
  // No owned files are changed until the nonempty journal has been verified.
  if (raw === '') { await finish(adapter, raw); return; }
  const value: unknown = JSON.parse(raw);
  if (!Value.Check(schema, value)) throw new Error('Invalid file recovery journal. Preserve storage for recovery.');
  checkFiles(value.files);
  const current: (string | null)[] = [];
  for (const file of value.files) current.push(await readExact(adapter, file.path));
  if (!hasExpectedStates(value.files, current)) {
    throw new Error('Files changed outside the pending transaction. Preserve storage and its journal for recovery.');
  }
  await checkResultingTrees(adapter, value.files);
  if (!value.files.every((file, index) => current[index] === file.next)) {
    await verifyTransactionJournal(adapter, WORKBENCH_FILE_TRANSACTION_PATH, raw);
    // Restore indexes last, after all their referenced files have been restored.
    for (const file of value.files) await put(adapter, file.path, file.previous);
  }
  await finish(adapter, raw);
}

/** Caller holds the lock. Write the catalog last; exact before/after images permit crash recovery. */
export async function commitWorkbenchFileTransaction(
  adapter: WorkbenchStorageAdapter, changes: readonly { path: string; contents: string | null; expectedPrevious?: string | null }[],
  beforeWrite?: () => void
) {
  if (!changes.length) return;
  await recoverWorkbenchFileTransaction(adapter);
  const ordered = [...changes].sort((a, b) => Number(a.path === 'workbench.json') - Number(b.path === 'workbench.json'));
  checkFiles(ordered.map(({ path, contents }) => ({ path, previous: null, next: contents })));
  const files: Transaction['files'] = [];
  for (const { path, contents, expectedPrevious } of ordered) {
    const previous = await readExact(adapter, path);
    if (expectedPrevious !== undefined && previous !== expectedPrevious) throw new WorkbenchFileConflictError(path);
    files.push({ path, previous, next: contents });
  }
  checkFiles(files);
  await checkResultingTrees(adapter, files);
  const transaction: Transaction = { format: 'wire-edm-file-transaction', schemaVersion: 1, files };
  if (!Value.Check(schema, transaction)) throw new Error('File transaction exceeds its file limit.');
  const raw = JSON.stringify(transaction);
  await adapter.ensureDirectory('transactions');
  await verifyTransactionJournalAbsent(adapter, WORKBENCH_FILE_TRANSACTION_PATH);
  // Cancellation is still reversible here. Once the journal starts, finish and report the durable result.
  try { beforeWrite?.(); }
  catch (error) { throw new WorkbenchFileGuardError(error); }
  let writePhase: TransactionJournalWritePhase = 'writing';
  try {
    await adapter.writeText(WORKBENCH_FILE_TRANSACTION_PATH, raw);
    writePhase = 'completed';
    if (await readExact(adapter, WORKBENCH_FILE_TRANSACTION_PATH) !== raw) throw new Error('Recovery journal did not read back exactly.');
  } catch (error) {
    // A failed first journal write has not touched owned files. Discard only
    // its known image or empty creation handle; retain unexpected evidence.
    await cleanupFailedTransactionJournalWrite(adapter, WORKBENCH_FILE_TRANSACTION_PATH, raw, writePhase);
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
      await verifyTransactionJournal(adapter, WORKBENCH_FILE_TRANSACTION_PATH, raw);
      const current: (string | null)[] = [];
      for (const file of files) current.push(await readExact(adapter, file.path));
      if (!hasExpectedStates(files, current)) throw new Error('Storage changed outside this transaction.');
      await checkResultingTrees(adapter, files);
      await verifyTransactionJournal(adapter, WORKBENCH_FILE_TRANSACTION_PATH, raw);
      for (const file of files) await put(adapter, file.path, file.previous);
      await finish(adapter, raw);
    } catch {
      throw new Error('Storage write and rollback failed. Recovery data is retained; reopen the workbench before editing.');
    }
    throw new WorkbenchFileWriteError(writingPath, error);
  }
  // Writes are committed. A failed journal cleanup is retried by the next locked operation.
  try { await finish(adapter, raw); } catch { /* Exact next images identify the committed state. */ }
}
