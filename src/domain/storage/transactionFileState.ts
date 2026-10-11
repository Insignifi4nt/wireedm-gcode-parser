import type { WorkbenchStorageAdapter } from './workbenchStorageAdapter';
import { isWellFormedText } from './boundedExactText';

export const readExactTransactionText = (adapter: WorkbenchStorageAdapter, path: string) =>
  adapter.readExactText ? adapter.readExactText(path) : adapter.readText(path);

export class TransactionJournalConflictError extends Error {
  constructor(path: string) {
    super(`Recovery journal changed outside this transaction: ${path}. Preserve storage and its journal for recovery.`);
  }
}

export class TransactionJournalReadbackError extends Error {
  constructor(path: string) {
    super(`Recovery journal could not be removed: ${path}. Reopen the workbench before further edits.`);
  }
}

/** A caller's verified journal image is the authority for immediate recovery. */
export async function verifyTransactionJournal(adapter: WorkbenchStorageAdapter, path: string, expected: string) {
  if (await readExactTransactionText(adapter, path) !== expected) {
    throw new TransactionJournalConflictError(path);
  }
}

/** Begin only after normal recovery has removed any prior journal. */
export async function verifyTransactionJournalAbsent(adapter: WorkbenchStorageAdapter, path: string) {
  if (await readExactTransactionText(adapter, path) !== null) {
    throw new TransactionJournalConflictError(path);
  }
}

/** Unknown journal bytes are evidence, even when its first write reported failure. */
export async function removeTransactionJournal(
  adapter: WorkbenchStorageAdapter, path: string,
  expected: { kind: 'verified' | 'failed-begin'; text: string }
) {
  const current = await readExactTransactionText(adapter, path);
  if (current === null) return;
  if (current !== expected.text && !(expected.kind === 'failed-begin' && current === '')) {
    throw new TransactionJournalConflictError(path);
  }
  await adapter.deleteText(path);
  if (await readExactTransactionText(adapter, path) !== null) throw new TransactionJournalReadbackError(path);
}

export type TransactionJournalWritePhase = 'not-attempted' | 'writing' | 'completed';

/** A thrown initial write can leave an empty handle; completed writes require exact ownership. */
export async function cleanupFailedTransactionJournalWrite(
  adapter: WorkbenchStorageAdapter, path: string, text: string, phase: TransactionJournalWritePhase
) {
  if (phase === 'not-attempted') return;
  await removeTransactionJournal(adapter, path, { kind: phase === 'writing' ? 'failed-begin' : 'verified', text });
}

/** Hash exact UTF-8 contents, including any BOM; absence has its own state. */
export async function transactionFileHash(adapter: WorkbenchStorageAdapter, path: string): Promise<string | null> {
  const text = await readExactTransactionText(adapter, path);
  if (text === null) return null;
  // Plain browser cache can retain malformed UTF-16. Encoding it would replace
  // distinct unknown strings with identical bytes and authorize a false match.
  if (!isWellFormedText(text)) {
    throw new Error(`Cannot verify exact UTF-8 contents at ${path}. Preserve this file and any recovery journal.`);
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Preflight the entire deletion set before removing any file. Missing files permit interrupted retries. */
export async function verifyTransactionDeletions(
  adapter: WorkbenchStorageAdapter, paths: readonly string[], hashes: readonly (string | null)[] | undefined,
  allowMissing = true
) {
  if (hashes && hashes.length !== paths.length) throw new Error('Invalid deletion recovery fingerprints. Preserve storage and its journal for recovery.');
  for (const [index, path] of paths.entries()) {
    const current = await transactionFileHash(adapter, path);
    if (!(allowMissing && current === null) && (!hashes || current !== hashes[index])) {
      throw new Error(`Cannot verify pending deletion of ${path}. Preserve storage and its journal for recovery.`);
    }
  }
}
