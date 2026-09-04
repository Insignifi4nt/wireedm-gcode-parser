import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import { PostIdentifierSchema } from '@/domain/post-processor/postFormatPrimitives';
import { workbenchProjectDocumentPath, workbenchProjectRevisionPath } from '@/domain/workbench-catalog/workbenchProjectStorage';
import type { WorkbenchStorageAdapter } from './workbenchStorageAdapter';

export const SAVED_REVISION_TRANSACTION_PATH = 'transactions/saved-revision.json';
const MAX_TRANSACTION_BYTES = 384 * 1024 * 1024;
const TransactionSchema = Type.Object({
  format: Type.Literal('wire-edm-saved-revision-transaction'),
  schemaVersion: Type.Literal(1),
  projectId: PostIdentifierSchema,
  revisionId: PostIdentifierSchema,
  previousProject: Type.String(),
  previousManifest: Type.String(),
  nextRevision: Type.String(),
  nextProject: Type.String(),
  nextManifest: Type.String()
}, { additionalProperties: false });
type Transaction = Static<typeof TransactionSchema>;

export interface SavedRevisionTransactionError {
  readonly code: 'SAVED_REVISION_TRANSACTION_INVALID' | 'SAVED_REVISION_TRANSACTION_STORAGE_FAILED';
  readonly message: string;
}
type Result = { readonly ok: true } | { readonly ok: false; readonly error: SavedRevisionTransactionError };

/** Call while holding the workbench mutation lock, before changing any owned file. */
export async function beginSavedRevisionTransaction(
  adapter: WorkbenchStorageAdapter,
  values: Omit<Transaction, 'format' | 'schemaVersion'>
): Promise<Result> {
  const transaction: Transaction = { format: 'wire-edm-saved-revision-transaction', schemaVersion: 1, ...values };
  const raw = JSON.stringify(transaction);
  if (new TextEncoder().encode(raw).byteLength > MAX_TRANSACTION_BYTES) {
    return invalid('Saved revision recovery data exceeds its size limit.');
  }
  try {
    await adapter.ensureDirectory('transactions');
    await adapter.writeText(SAVED_REVISION_TRANSACTION_PATH, raw);
    if (await adapter.readText(SAVED_REVISION_TRANSACTION_PATH) !== raw) {
      throw new Error('Recovery data did not read back exactly');
    }
    return { ok: true };
  } catch (error) {
    // No owned file has changed yet, so a failed journal write can be discarded.
    const cleanup = await finishSavedRevisionTransaction(adapter);
    return storageFailure(`${message(error)}${cleanup.ok ? '' : `; ${cleanup.error.message}`}`);
  }
}

export async function finishSavedRevisionTransaction(adapter: WorkbenchStorageAdapter): Promise<Result> {
  try {
    await adapter.deleteText(SAVED_REVISION_TRANSACTION_PATH);
    if (await adapter.readText(SAVED_REVISION_TRANSACTION_PATH) !== null) {
      throw new Error('Recovery data was not removed');
    }
    return { ok: true };
  } catch (error) {
    return storageFailure(message(error));
  }
}

/** Recover before reading the manifest: an interrupted manifest write can itself be partial. */
export async function recoverSavedRevisionTransaction(adapter: WorkbenchStorageAdapter): Promise<Result> {
  try {
    const raw = await adapter.readText(SAVED_REVISION_TRANSACTION_PATH);
    if (raw === null) return { ok: true };
    if (new TextEncoder().encode(raw).byteLength > MAX_TRANSACTION_BYTES) {
      return invalid('Saved revision recovery data exceeds its size limit.');
    }
    let transaction: unknown;
    try { transaction = JSON.parse(raw); } catch { return invalid('Saved revision recovery data is not valid JSON.'); }
    if (!Value.Check(TransactionSchema, transaction)) return invalid('Saved revision recovery data has an invalid shape.');
    // Paths are derived from validated identifiers, never taken from recovery-file paths.
    const files = [
      { path: workbenchProjectRevisionPath(transaction.projectId, transaction.revisionId), previous: null, next: transaction.nextRevision },
      { path: workbenchProjectDocumentPath(transaction.projectId), previous: transaction.previousProject, next: transaction.nextProject },
      { path: 'workbench.json', previous: transaction.previousManifest, next: transaction.nextManifest }
    ];
    const current = await Promise.all(files.map(({ path }) => adapter.readText(path)));
    if (!files.every((file, index) => current[index] === file.next)) {
      for (const file of files) {
        if (file.previous === null) await adapter.deleteText(file.path);
        else await adapter.writeText(file.path, file.previous);
        if (await adapter.readText(file.path) !== file.previous) {
          throw new Error(`Rollback did not restore ${file.path} exactly`);
        }
      }
    }
    return finishSavedRevisionTransaction(adapter);
  } catch (error) {
    return storageFailure(message(error));
  }
}

function invalid(message: string): Result {
  return { ok: false, error: { code: 'SAVED_REVISION_TRANSACTION_INVALID', message } };
}
function storageFailure(detail: string): Result {
  return { ok: false, error: { code: 'SAVED_REVISION_TRANSACTION_STORAGE_FAILED', message: `Saved revision recovery failed: ${detail}.` } };
}
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
