import { MACHINE_LIBRARY_PATH } from '@/domain/machine-definition/machineLibraryStorage';
import { POST_LIBRARY_PATH } from '@/domain/post-processor/postLibraryStorage';

import type { WorkbenchStorageAdapter } from './workbenchStorageAdapter';
import {
  cleanupFailedTransactionJournalWrite,
  readExactTransactionText as readExact,
  removeTransactionJournal,
  TransactionJournalConflictError,
  TransactionJournalReadbackError,
  verifyTransactionJournal,
  verifyTransactionJournalAbsent,
  type TransactionJournalWritePhase
} from './transactionFileState';

export const CATALOG_PAIR_TRANSACTION_DIRECTORY = 'transactions';
export const CATALOG_PAIR_TRANSACTION_PATH = `${CATALOG_PAIR_TRANSACTION_DIRECTORY}/machine-package-install.json`;
const MAX_TRANSACTION_BYTES = 64 * 1024 * 1024;

interface CatalogPairTransaction {
  readonly format: 'wire-edm-catalog-pair-transaction';
  readonly schemaVersion: 1;
  readonly previousPosts: string;
  readonly previousMachines: string;
  readonly nextPosts: string;
  readonly nextMachines: string;
}

export interface CatalogPairTransactionError {
  readonly code:
    | 'CATALOG_PAIR_TRANSACTION_TOO_LARGE'
    | 'CATALOG_PAIR_TRANSACTION_READBACK_MISMATCH'
    | 'CATALOG_PAIR_TRANSACTION_STORAGE_FAILED'
    | 'CATALOG_PAIR_TRANSACTION_RECOVERY_MISMATCH'
    | 'CATALOG_PAIR_TRANSACTION_RECOVERY_FAILED'
    | 'CATALOG_PAIR_TRANSACTION_INVALID';
  readonly message: string;
}

export type CatalogPairTransactionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: CatalogPairTransactionError };

export function serializeCatalogPairTransaction(values: Omit<CatalogPairTransaction, 'format' | 'schemaVersion'>) {
  return JSON.stringify({ format: 'wire-edm-catalog-pair-transaction', schemaVersion: 1, ...values });
}

export async function beginCatalogPairTransaction(
  adapter: WorkbenchStorageAdapter,
  values: Omit<CatalogPairTransaction, 'format' | 'schemaVersion'>
): Promise<CatalogPairTransactionResult> {
  const text = serializeCatalogPairTransaction(values);
  if (new TextEncoder().encode(text).byteLength > MAX_TRANSACTION_BYTES) {
    return failure('CATALOG_PAIR_TRANSACTION_TOO_LARGE', 'Machine-package transaction recovery data is too large to store safely.');
  }
  let writePhase: TransactionJournalWritePhase = 'not-attempted';
  try {
    await adapter.ensureDirectory(CATALOG_PAIR_TRANSACTION_DIRECTORY);
    await verifyTransactionJournalAbsent(adapter, CATALOG_PAIR_TRANSACTION_PATH);
    writePhase = 'writing';
    await adapter.writeText(CATALOG_PAIR_TRANSACTION_PATH, text);
    writePhase = 'completed';
    if (await readExact(adapter, CATALOG_PAIR_TRANSACTION_PATH) !== text) {
      const result = failure('CATALOG_PAIR_TRANSACTION_READBACK_MISMATCH', 'Machine-package transaction recovery data did not read back exactly.');
      return cleanupFailedBegin(adapter, text, result, writePhase);
    }
    return { ok: true };
  } catch (error) {
    const result = failure('CATALOG_PAIR_TRANSACTION_STORAGE_FAILED', `Could not create machine-package recovery data: ${errorMessage(error)}.`);
    return cleanupFailedBegin(adapter, text, result, writePhase);
  }
}

async function cleanupFailedBegin(
  adapter: WorkbenchStorageAdapter,
  expected: string,
  original: { readonly ok: false; readonly error: CatalogPairTransactionError },
  phase: TransactionJournalWritePhase
): Promise<CatalogPairTransactionResult> {
  try {
    await cleanupFailedTransactionJournalWrite(adapter, CATALOG_PAIR_TRANSACTION_PATH, expected, phase);
    return original;
  } catch (error) {
    return failure(
      error instanceof TransactionJournalConflictError ? original.error.code : 'CATALOG_PAIR_TRANSACTION_STORAGE_FAILED',
      `${original.error.message} Failed transaction data could not be removed: ${errorMessage(error)}.`
    );
  }
}

export async function finishCatalogPairTransaction(
  adapter: WorkbenchStorageAdapter
): Promise<CatalogPairTransactionResult> {
  try {
    const raw = await readExact(adapter, CATALOG_PAIR_TRANSACTION_PATH);
    if (raw === null) return { ok: true };
    const parsed = parseTransaction(raw);
    if (!parsed.ok) return parsed;
    if (await readExact(adapter, POST_LIBRARY_PATH) !== parsed.transaction.nextPosts ||
        await readExact(adapter, MACHINE_LIBRARY_PATH) !== parsed.transaction.nextMachines) {
      return failure('CATALOG_PAIR_TRANSACTION_RECOVERY_MISMATCH',
        'Installed catalogs do not prove a completed transaction. Preserve storage and its journal; reopen the workbench for normal recovery.');
    }
    return finishExpectedCatalogPairTransaction(adapter, raw);
  } catch (error) {
    return failure('CATALOG_PAIR_TRANSACTION_STORAGE_FAILED', `Could not read completed machine-package recovery data: ${errorMessage(error)}.`);
  }
}

/** Internal installation/recovery callers retain their own exact journal image. */
export async function finishExpectedCatalogPairTransaction(
  adapter: WorkbenchStorageAdapter, expected: string
): Promise<CatalogPairTransactionResult> {
  try {
    await removeTransactionJournal(adapter, CATALOG_PAIR_TRANSACTION_PATH, { kind: 'verified', text: expected });
    return { ok: true };
  } catch (error) {
    if (error instanceof TransactionJournalReadbackError) {
      return failure('CATALOG_PAIR_TRANSACTION_READBACK_MISMATCH', 'Completed machine-package recovery data was not removed.');
    }
    return failure('CATALOG_PAIR_TRANSACTION_STORAGE_FAILED', `Could not remove completed machine-package recovery data: ${errorMessage(error)}.`);
  }
}

export async function recoverCatalogPairTransaction(
  adapter: WorkbenchStorageAdapter
): Promise<CatalogPairTransactionResult> {
  return settleCatalogPairTransaction(adapter);
}

/** Failed installation may restore only its own recorded exact catalog states. */
export async function rollbackCatalogPairTransaction(
  adapter: WorkbenchStorageAdapter,
  expected: Omit<CatalogPairTransaction, 'format' | 'schemaVersion'>
): Promise<CatalogPairTransactionResult> {
  return settleCatalogPairTransaction(adapter, expected);
}

async function settleCatalogPairTransaction(
  adapter: WorkbenchStorageAdapter,
  rollback?: Omit<CatalogPairTransaction, 'format' | 'schemaVersion'>
): Promise<CatalogPairTransactionResult> {
  let raw: string | null;
  try {
    raw = await readExact(adapter, CATALOG_PAIR_TRANSACTION_PATH);
  } catch (error) {
    return failure('CATALOG_PAIR_TRANSACTION_STORAGE_FAILED', `Could not read machine-package recovery data: ${errorMessage(error)}.`);
  }
  if (raw === null) return rollback
    ? failure('CATALOG_PAIR_TRANSACTION_RECOVERY_MISMATCH', 'Machine-package rollback has no recovery journal. Catalogs were preserved; reopen the workbench before further edits.')
    : { ok: true };
  // Empty first-write handles precede every catalog change.
  if (raw === '' && !rollback) return finishExpectedCatalogPairTransaction(adapter, raw);
  const parsed = parseTransaction(raw);
  if (!parsed.ok) return parsed;
  const transaction = parsed.transaction;
  if (rollback && Object.entries(rollback).some(([key, value]) => transaction[key as keyof typeof rollback] !== value)) {
    return failure('CATALOG_PAIR_TRANSACTION_RECOVERY_MISMATCH', 'Machine-package recovery journal changed outside this installation. Catalogs and journal were preserved for recovery.');
  }
  try {
    if (rollback) await verifyTransactionJournal(adapter, CATALOG_PAIR_TRANSACTION_PATH, serializeCatalogPairTransaction(rollback));
    const posts = await readExact(adapter, POST_LIBRARY_PATH);
    const machines = await readExact(adapter, MACHINE_LIBRARY_PATH);
    if ((posts !== transaction.previousPosts && posts !== transaction.nextPosts) ||
        (machines !== transaction.previousMachines && machines !== transaction.nextMachines)) {
      return failure('CATALOG_PAIR_TRANSACTION_RECOVERY_MISMATCH',
        'Installed post or machine catalogs changed outside the pending transaction. Both catalogs and the recovery journal were preserved; preserve this workbench for recovery before further edits.');
    }
    const committed = posts === transaction.nextPosts && machines === transaction.nextMachines;
    if (rollback || !committed) {
      await verifyTransactionJournal(adapter, CATALOG_PAIR_TRANSACTION_PATH, raw);
      await adapter.writeText(POST_LIBRARY_PATH, transaction.previousPosts);
      await adapter.writeText(MACHINE_LIBRARY_PATH, transaction.previousMachines);
      if (
        await readExact(adapter, POST_LIBRARY_PATH) !== transaction.previousPosts ||
        await readExact(adapter, MACHINE_LIBRARY_PATH) !== transaction.previousMachines
      ) {
        return failure('CATALOG_PAIR_TRANSACTION_RECOVERY_MISMATCH', 'Machine-package rollback did not restore both catalogs exactly.');
      }
    }
    return finishExpectedCatalogPairTransaction(adapter, raw);
  } catch (error) {
    return failure('CATALOG_PAIR_TRANSACTION_RECOVERY_FAILED', `Could not recover an interrupted machine-package installation: ${errorMessage(error)}.`);
  }
}

function parseTransaction(raw: string):
  | { readonly ok: true; readonly transaction: CatalogPairTransaction }
  | { readonly ok: false; readonly error: CatalogPairTransactionError } {
  if (new TextEncoder().encode(raw).byteLength > MAX_TRANSACTION_BYTES) {
    return failure('CATALOG_PAIR_TRANSACTION_TOO_LARGE', 'Machine-package recovery data exceeds its size limit.');
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return failure('CATALOG_PAIR_TRANSACTION_INVALID', 'Machine-package recovery data is not valid JSON.');
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) return failure('CATALOG_PAIR_TRANSACTION_INVALID', 'Machine-package recovery data has an invalid shape.');
  const record = value as Record<string, unknown>;
  const expectedKeys = ['format', 'schemaVersion', 'previousPosts', 'previousMachines', 'nextPosts', 'nextMachines'];
  if (
    Object.keys(record).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(record, key)) ||
    record.format !== 'wire-edm-catalog-pair-transaction' ||
    record.schemaVersion !== 1 ||
    typeof record.previousPosts !== 'string' ||
    typeof record.previousMachines !== 'string' ||
    typeof record.nextPosts !== 'string' ||
    typeof record.nextMachines !== 'string'
  ) return failure('CATALOG_PAIR_TRANSACTION_INVALID', 'Machine-package recovery data has an invalid shape.');
  return { ok: true, transaction: record as unknown as CatalogPairTransaction };
}

function failure(code: CatalogPairTransactionError['code'], message: string) {
  return { ok: false as const, error: { code, message } };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
