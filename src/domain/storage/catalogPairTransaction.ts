import { MACHINE_LIBRARY_PATH } from '@/domain/machine-definition/machineLibraryStorage';
import { POST_LIBRARY_PATH } from '@/domain/post-processor/postLibraryStorage';

import type { WorkbenchStorageAdapter } from './workbenchStorageAdapter';

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

export async function beginCatalogPairTransaction(
  adapter: WorkbenchStorageAdapter,
  values: Omit<CatalogPairTransaction, 'format' | 'schemaVersion'>
): Promise<CatalogPairTransactionResult> {
  const transaction: CatalogPairTransaction = {
    format: 'wire-edm-catalog-pair-transaction',
    schemaVersion: 1,
    ...values
  };
  const text = JSON.stringify(transaction);
  if (new TextEncoder().encode(text).byteLength > MAX_TRANSACTION_BYTES) {
    return failure('CATALOG_PAIR_TRANSACTION_TOO_LARGE', 'Machine-package transaction recovery data is too large to store safely.');
  }
  let writeAttempted = false;
  try {
    await adapter.ensureDirectory(CATALOG_PAIR_TRANSACTION_DIRECTORY);
    writeAttempted = true;
    await adapter.writeText(CATALOG_PAIR_TRANSACTION_PATH, text);
    if (await adapter.readText(CATALOG_PAIR_TRANSACTION_PATH) !== text) {
      const result = failure('CATALOG_PAIR_TRANSACTION_READBACK_MISMATCH', 'Machine-package transaction recovery data did not read back exactly.');
      return cleanupFailedBegin(adapter, result);
    }
    return { ok: true };
  } catch (error) {
    const result = failure('CATALOG_PAIR_TRANSACTION_STORAGE_FAILED', `Could not create machine-package recovery data: ${errorMessage(error)}.`);
    return writeAttempted ? cleanupFailedBegin(adapter, result) : result;
  }
}

async function cleanupFailedBegin(
  adapter: WorkbenchStorageAdapter,
  original: { readonly ok: false; readonly error: CatalogPairTransactionError }
): Promise<CatalogPairTransactionResult> {
  try {
    await adapter.deleteText(CATALOG_PAIR_TRANSACTION_PATH);
    if (await adapter.readText(CATALOG_PAIR_TRANSACTION_PATH) === null) return original;
  } catch (error) {
    return failure(
      'CATALOG_PAIR_TRANSACTION_STORAGE_FAILED',
      `${original.error.message} Failed transaction data could not be removed: ${errorMessage(error)}.`
    );
  }
  return failure(
    'CATALOG_PAIR_TRANSACTION_STORAGE_FAILED',
    `${original.error.message} Failed transaction data could not be removed.`
  );
}

export async function finishCatalogPairTransaction(
  adapter: WorkbenchStorageAdapter
): Promise<CatalogPairTransactionResult> {
  try {
    await adapter.deleteText(CATALOG_PAIR_TRANSACTION_PATH);
    if (await adapter.readText(CATALOG_PAIR_TRANSACTION_PATH) !== null) {
      return failure('CATALOG_PAIR_TRANSACTION_READBACK_MISMATCH', 'Completed machine-package recovery data was not removed.');
    }
    return { ok: true };
  } catch (error) {
    return failure('CATALOG_PAIR_TRANSACTION_STORAGE_FAILED', `Could not remove completed machine-package recovery data: ${errorMessage(error)}.`);
  }
}

export async function recoverCatalogPairTransaction(
  adapter: WorkbenchStorageAdapter
): Promise<CatalogPairTransactionResult> {
  let raw: string | null;
  try {
    raw = await adapter.readText(CATALOG_PAIR_TRANSACTION_PATH);
  } catch (error) {
    return failure('CATALOG_PAIR_TRANSACTION_STORAGE_FAILED', `Could not read machine-package recovery data: ${errorMessage(error)}.`);
  }
  if (raw === null) return { ok: true };
  const parsed = parseTransaction(raw);
  if (!parsed.ok) return parsed;
  const transaction = parsed.transaction;
  try {
    const posts = await adapter.readText(POST_LIBRARY_PATH);
    const machines = await adapter.readText(MACHINE_LIBRARY_PATH);
    const committed = posts === transaction.nextPosts && machines === transaction.nextMachines;
    if (!committed) {
      await adapter.writeText(POST_LIBRARY_PATH, transaction.previousPosts);
      await adapter.writeText(MACHINE_LIBRARY_PATH, transaction.previousMachines);
      if (
        await adapter.readText(POST_LIBRARY_PATH) !== transaction.previousPosts ||
        await adapter.readText(MACHINE_LIBRARY_PATH) !== transaction.previousMachines
      ) {
        return failure('CATALOG_PAIR_TRANSACTION_RECOVERY_MISMATCH', 'Machine-package rollback did not restore both catalogs exactly.');
      }
    }
    return finishCatalogPairTransaction(adapter);
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
