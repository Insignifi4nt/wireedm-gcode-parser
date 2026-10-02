import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { PostIdentifierSchema } from '@/domain/post-processor/postFormatPrimitives';
import type { WorkbenchStorageAdapter } from './workbenchStorageAdapter';
import { readExactTransactionText as readExact, transactionFileHash, verifyTransactionDeletions } from './transactionFileState';

export const PROJECT_TRASH_TRANSACTION_PATH = 'transactions/project-trash.json';
const manifestPath = 'workbench.json';
const schema = Type.Object({
  format: Type.Literal('wire-edm-project-trash-transaction'),
  schemaVersion: Type.Literal(1),
  previous: Type.String(), next: Type.String()
}, { additionalProperties: false });
const legacyPurgeSchema = Type.Object({
  format: Type.Literal('wire-edm-project-purge-transaction'),
  schemaVersion: Type.Literal(1),
  projectId: PostIdentifierSchema,
  ownedPaths: Type.Array(Type.String({ minLength: 1, maxLength: 1_024 }), { minItems: 1, uniqueItems: true }),
  previous: Type.String(), next: Type.String()
}, { additionalProperties: false });
const purgeSchema = Type.Object({
  ...legacyPurgeSchema.properties,
  schemaVersion: Type.Literal(2),
  ownedHashes: Type.Array(Type.Union([Type.String({ pattern: '^[0-9a-f]{64}$' }), Type.Null()]), { minItems: 1 })
}, { additionalProperties: false });
const maximumBytes = 8 * 1024 * 1024;
export interface ProjectTrashTransactionError {
  readonly code: 'PROJECT_TRASH_TRANSACTION_FAILED';
  readonly message: string;
}
type Result = { readonly ok: true } | { readonly ok: false; readonly error: ProjectTrashTransactionError };

/** The caller holds the workbench mutation lock. Owned files never change. */
export async function commitProjectTrashTransaction(
  adapter: WorkbenchStorageAdapter, next: string
): Promise<Result> {
  try {
    const previous = await readExact(adapter, manifestPath);
    if (previous === null) return failure('Workbench manifest is missing.');
    const raw = JSON.stringify({ format: 'wire-edm-project-trash-transaction', schemaVersion: 1, previous, next });
    if (new TextEncoder().encode(raw).byteLength > maximumBytes) return failure('Project recovery data is too large.');
    await adapter.ensureDirectory('transactions');
    try {
      await adapter.writeText(PROJECT_TRASH_TRANSACTION_PATH, raw);
      if (await readExact(adapter, PROJECT_TRASH_TRANSACTION_PATH) !== raw) throw new Error('Recovery data did not read back exactly.');
    } catch (error) {
      // The manifest is untouched until the journal has been verified.
      await adapter.deleteText(PROJECT_TRASH_TRANSACTION_PATH);
      return failure(message(error));
    }
    try {
      await adapter.writeText(manifestPath, next);
      if (await readExact(adapter, manifestPath) !== next) throw new Error('Project catalog did not read back exactly.');
    } catch (error) {
      // A reported failure restores the caller's snapshot, even if the write
      // completed before a later read failed. Crash recovery can finalize next.
      const current = await readExact(adapter, manifestPath);
      if (current !== previous && current !== next) return conflict();
      await adapter.writeText(manifestPath, previous);
      if (await readExact(adapter, manifestPath) !== previous) return failure('Project catalog rollback did not read back exactly.');
      await adapter.deleteText(PROJECT_TRASH_TRANSACTION_PATH);
      return failure(message(error));
    }
    // Once read back, the catalog move is committed. A cleanup failure leaves
    // a journal that every later catalog mutation must recover before writing.
    await recoverProjectTrashTransaction(adapter);
    return { ok: true };
  } catch (error) { return failure(message(error)); }
}

/** Commit archive removal before deleting owned files; recovery finishes an interrupted purge. */
export async function commitProjectPurgeTransaction(
  adapter: WorkbenchStorageAdapter,
  input: { readonly projectId: string; readonly ownedPaths: readonly string[]; readonly next: string }
): Promise<Result> {
  try {
    if (!input.ownedPaths.length || new Set(input.ownedPaths).size !== input.ownedPaths.length ||
        !input.ownedPaths.every((path) => isPurgePath(input.projectId, path))) {
      return failure('Project purge contains an invalid owned file path.');
    }
    const previous = await readExact(adapter, manifestPath);
    if (previous === null) return failure('Workbench manifest is missing.');
    const ownedHashes = await Promise.all(input.ownedPaths.map((path) => transactionFileHash(adapter, path)));
    const raw = JSON.stringify({ format: 'wire-edm-project-purge-transaction', schemaVersion: 2,
      projectId: input.projectId, ownedPaths: input.ownedPaths, ownedHashes, previous, next: input.next });
    if (new TextEncoder().encode(raw).byteLength > maximumBytes) return failure('Project purge recovery data is too large.');
    await adapter.ensureDirectory('transactions');
    try {
      await adapter.writeText(PROJECT_TRASH_TRANSACTION_PATH, raw);
      if (await readExact(adapter, PROJECT_TRASH_TRANSACTION_PATH) !== raw) throw new Error('Recovery data did not read back exactly.');
    } catch (error) {
      await adapter.deleteText(PROJECT_TRASH_TRANSACTION_PATH);
      return failure(message(error));
    }
    try {
      await adapter.writeText(manifestPath, input.next);
      if (await readExact(adapter, manifestPath) !== input.next) throw new Error('Project archive did not read back exactly.');
      const recovered = await recoverProjectTrashTransaction(adapter);
      if (!recovered.ok) return recovered;
      return { ok: true };
    } catch (error) {
      const recovered = await recoverProjectTrashTransaction(adapter);
      if (!recovered.ok) return failure(`${message(error)}; recovery failed: ${recovered.error.message}`);
      return await readExact(adapter, manifestPath) === input.next ? { ok: true } : failure(message(error));
    }
  } catch (error) { return failure(message(error)); }
}

/** Recover only recorded states; preserve unknown contents and their journal for recovery. */
export async function recoverProjectTrashTransaction(adapter: WorkbenchStorageAdapter): Promise<Result> {
  try {
    const raw = await readExact(adapter, PROJECT_TRASH_TRANSACTION_PATH);
    if (raw === null) return { ok: true };
    // Empty first-write handles precede every catalog or owned-file change.
    if (raw === '') {
      await adapter.deleteText(PROJECT_TRASH_TRANSACTION_PATH);
      return await adapter.readText(PROJECT_TRASH_TRANSACTION_PATH) === null
        ? { ok: true } : failure('Empty project recovery data could not be removed.');
    }
    if (new TextEncoder().encode(raw).byteLength > maximumBytes) return failure('Project recovery data is too large.');
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return failure('Project recovery data is invalid JSON.'); }
    if (!Value.Check(schema, value) && !Value.Check(purgeSchema, value) && !Value.Check(legacyPurgeSchema, value)) {
      return failure('Project recovery data has an invalid shape.');
    }
    const current = await readExact(adapter, manifestPath);
    if (current !== value.previous && current !== value.next) return conflict();
    if (value.format === 'wire-edm-project-purge-transaction') {
      if (!value.ownedPaths.every((path) => isPurgePath(value.projectId, path))) {
        return failure('Project purge recovery data has an invalid owned file path.');
      }
      if (value.schemaVersion === 2) {
        await verifyTransactionDeletions(adapter, value.ownedPaths, value.ownedHashes, current === value.next);
      }
      if (current === value.next) {
        if (value.schemaVersion === 1) await verifyTransactionDeletions(adapter, value.ownedPaths, undefined);
        for (const path of value.ownedPaths) {
          await adapter.deleteText(path);
          if (await readExact(adapter, path) !== null) return failure(`Could not remove ${path}.`);
        }
      }
      await adapter.deleteText(PROJECT_TRASH_TRANSACTION_PATH);
      if (await adapter.readText(PROJECT_TRASH_TRANSACTION_PATH) !== null) return failure('Project purge recovery data was not removed.');
      return { ok: true };
    }
    await adapter.deleteText(PROJECT_TRASH_TRANSACTION_PATH);
    if (await adapter.readText(PROJECT_TRASH_TRANSACTION_PATH) !== null) return failure('Project recovery data was not removed.');
    return { ok: true };
  } catch (error) { return failure(message(error)); }
}
function failure(message: string): Result {
  return { ok: false, error: { code: 'PROJECT_TRASH_TRANSACTION_FAILED', message } };
}
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
function conflict() { return failure('Project catalog changed outside the pending transaction. Preserve storage and its journal for recovery.'); }

function isPurgePath(projectId: string, path: string) {
  if (path.includes('\\') || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return false;
  return path === `projects/${projectId}.json` || path.startsWith(`projects/${projectId}/`) ||
    path.startsWith(`imports/${projectId}.`);
}
