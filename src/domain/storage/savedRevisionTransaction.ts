import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import { PostIdentifierSchema } from '@/domain/post-processor/postFormatPrimitives';
import { workbenchProjectDocumentPath, workbenchProjectRevisionPath } from '@/domain/workbench-catalog/workbenchProjectStorage';
import type { WorkbenchStorageAdapter } from './workbenchStorageAdapter';
import { readExactTransactionText as readExact, transactionFileHash, verifyTransactionDeletions } from './transactionFileState';

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
const LegacyDeletionTransactionSchema = Type.Object({
  format: Type.Literal('wire-edm-revision-deletion-transaction'),
  schemaVersion: Type.Literal(1),
  projectId: PostIdentifierSchema,
  revisionIds: Type.Array(PostIdentifierSchema, { minItems: 1, maxItems: 100_000, uniqueItems: true }),
  previousProject: Type.String(),
  nextProject: Type.String(),
  previousManifest: Type.String(),
  nextManifest: Type.String()
}, { additionalProperties: false });
const DeletionTransactionSchema = Type.Object({
  ...LegacyDeletionTransactionSchema.properties,
  schemaVersion: Type.Literal(2),
  previousRevisionHashes: Type.Array(Type.Union([Type.String({ pattern: '^[0-9a-f]{64}$' }), Type.Null()]), { minItems: 1, maxItems: 100_000 })
}, { additionalProperties: false });
type DeletionTransaction = Static<typeof DeletionTransactionSchema>;

export interface SavedRevisionTransactionError {
  readonly code: 'SAVED_REVISION_TRANSACTION_INVALID' | 'SAVED_REVISION_TRANSACTION_STORAGE_FAILED';
  readonly message: string;
}
type Result = { readonly ok: true } | { readonly ok: false; readonly error: SavedRevisionTransactionError };

/** Call while holding the workbench mutation lock, before changing any owned file. */
export async function beginSavedRevisionTransaction(
  adapter: WorkbenchStorageAdapter,
  values: Omit<Transaction, 'format' | 'schemaVersion'>,
  options: { readonly beforeWrite?: () => void } = {}
): Promise<Result> {
  const transaction: Transaction = { format: 'wire-edm-saved-revision-transaction', schemaVersion: 1, ...values };
  const raw = JSON.stringify(transaction);
  if (new TextEncoder().encode(raw).byteLength > MAX_TRANSACTION_BYTES) {
    return invalid('Saved revision recovery data exceeds its size limit.');
  }
  try { await adapter.ensureDirectory('transactions'); }
  catch (error) { return storageFailure(message(error)); }
  options.beforeWrite?.();
  try {
    await adapter.writeText(SAVED_REVISION_TRANSACTION_PATH, raw);
    if (await readExact(adapter, SAVED_REVISION_TRANSACTION_PATH) !== raw) {
      throw new Error('Recovery data did not read back exactly');
    }
    return { ok: true };
  } catch (error) {
    // No owned file has changed yet, so a failed journal write can be discarded.
    const cleanup = await finishSavedRevisionTransaction(adapter);
    return storageFailure(`${message(error)}${cleanup.ok ? '' : `; ${cleanup.error.message}`}`);
  }
}

/** Journal the index change; revision files are removed only after both indexes commit. */
export async function beginRevisionDeletionTransaction(
  adapter: WorkbenchStorageAdapter,
  values: Omit<DeletionTransaction, 'format' | 'schemaVersion' | 'previousRevisionHashes'>
): Promise<Result> {
  let previousRevisionHashes: (string | null)[];
  try {
    previousRevisionHashes = await Promise.all(values.revisionIds.map((id) =>
      transactionFileHash(adapter, workbenchProjectRevisionPath(values.projectId, id))));
  } catch (error) { return storageFailure(message(error)); }
  const transaction: DeletionTransaction = {
    format: 'wire-edm-revision-deletion-transaction', schemaVersion: 2, ...values, previousRevisionHashes
  };
  const raw = JSON.stringify(transaction);
  if (new TextEncoder().encode(raw).byteLength > MAX_TRANSACTION_BYTES) {
    return invalid('Revision deletion recovery data exceeds its size limit.');
  }
  try {
    await adapter.ensureDirectory('transactions');
    await adapter.writeText(SAVED_REVISION_TRANSACTION_PATH, raw);
    if (await readExact(adapter, SAVED_REVISION_TRANSACTION_PATH) !== raw) {
      throw new Error('Recovery data did not read back exactly');
    }
    return { ok: true };
  } catch (error) {
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

/** Recover recognized exact states only; unknown contents retain the journal for manual recovery. */
export async function recoverSavedRevisionTransaction(adapter: WorkbenchStorageAdapter): Promise<Result> {
  try {
    const raw = await readExact(adapter, SAVED_REVISION_TRANSACTION_PATH);
    if (raw === null) return { ok: true };
    // Empty first-write handles precede every owned-file change.
    if (raw === '') return finishSavedRevisionTransaction(adapter);
    if (new TextEncoder().encode(raw).byteLength > MAX_TRANSACTION_BYTES) {
      return invalid('Saved revision recovery data exceeds its size limit.');
    }
    let transaction: unknown;
    try { transaction = JSON.parse(raw); } catch { return invalid('Saved revision recovery data is not valid JSON.'); }
    if (!Value.Check(TransactionSchema, transaction) && !Value.Check(DeletionTransactionSchema, transaction) &&
        !Value.Check(LegacyDeletionTransactionSchema, transaction)) {
      return invalid('Saved revision recovery data has an invalid shape.');
    }
    if (transaction.format === 'wire-edm-revision-deletion-transaction') {
      const projectPath = workbenchProjectDocumentPath(transaction.projectId);
      const project = await readExact(adapter, projectPath);
      const manifest = await readExact(adapter, 'workbench.json');
      if ((project !== transaction.previousProject && project !== transaction.nextProject) ||
          (manifest !== transaction.previousManifest && manifest !== transaction.nextManifest)) {
        return storageFailure('Revision indexes changed outside the pending transaction. Preserve storage and its journal for recovery');
      }
      const committed = project === transaction.nextProject && manifest === transaction.nextManifest;
      const paths = transaction.revisionIds.map((id) => workbenchProjectRevisionPath(transaction.projectId, id));
      if (transaction.schemaVersion === 2) {
        await verifyTransactionDeletions(adapter, paths, transaction.previousRevisionHashes, committed);
      }
      if (committed) {
        // Both indexes committed. Finish any remaining file deletions after a crash.
        if (transaction.schemaVersion === 1) await verifyTransactionDeletions(adapter, paths, undefined);
        for (const revisionId of transaction.revisionIds) {
          const path = workbenchProjectRevisionPath(transaction.projectId, revisionId);
          await adapter.deleteText(path);
          if (await readExact(adapter, path) !== null) throw new Error(`Could not remove ${path}`);
        }
      } else {
        // Files have not been touched until both index writes have read back.
        await adapter.writeText(projectPath, transaction.previousProject);
        await adapter.writeText('workbench.json', transaction.previousManifest);
        if (await readExact(adapter, projectPath) !== transaction.previousProject ||
            await readExact(adapter, 'workbench.json') !== transaction.previousManifest) {
          throw new Error('Rollback did not restore revision indexes exactly');
        }
      }
      return finishSavedRevisionTransaction(adapter);
    }
    // Paths are derived from validated identifiers, never taken from recovery-file paths.
    const files = [
      { path: workbenchProjectRevisionPath(transaction.projectId, transaction.revisionId), previous: null, next: transaction.nextRevision },
      { path: workbenchProjectDocumentPath(transaction.projectId), previous: transaction.previousProject, next: transaction.nextProject },
      { path: 'workbench.json', previous: transaction.previousManifest, next: transaction.nextManifest }
    ];
    const current = await Promise.all(files.map(({ path }) => readExact(adapter, path)));
    // An empty first-write handle can only precede both index writes. Once an
    // index advances, an empty revision is unknown loss, not a safe rollback.
    const emptyFirstWrite = current[0] === '' && current[1] === transaction.previousProject &&
      current[2] === transaction.previousManifest;
    if (files.some((file, index) => current[index] !== file.previous && current[index] !== file.next &&
        !(index === 0 && emptyFirstWrite))) {
      return storageFailure('Files changed outside the pending transaction. Preserve storage and its journal for recovery');
    }
    if (!files.every((file, index) => current[index] === file.next)) {
      for (const file of files) {
        if (file.previous === null) await adapter.deleteText(file.path);
        else await adapter.writeText(file.path, file.previous);
        if (await readExact(adapter, file.path) !== file.previous) {
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
