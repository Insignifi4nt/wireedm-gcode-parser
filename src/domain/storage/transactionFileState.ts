import type { WorkbenchStorageAdapter } from './workbenchStorageAdapter';

export const readExactTransactionText = (adapter: WorkbenchStorageAdapter, path: string) =>
  adapter.readExactText ? adapter.readExactText(path) : adapter.readText(path);

/** Hash exact UTF-8 contents, including any BOM; absence has its own state. */
export async function transactionFileHash(adapter: WorkbenchStorageAdapter, path: string): Promise<string | null> {
  const text = await readExactTransactionText(adapter, path);
  if (text === null) return null;
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
