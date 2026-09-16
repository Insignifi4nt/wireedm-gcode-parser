import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { PostIdentifierSchema } from '@/domain/post-processor/postFormatPrimitives';
import type { WorkbenchStorageAdapter } from './workbenchStorageAdapter';

export const PROJECT_TRASH_TRANSACTION_PATH = 'transactions/project-trash.json';
const manifestPath = 'workbench.json';
const schema = Type.Object({
  format: Type.Literal('wire-edm-project-trash-transaction'),
  schemaVersion: Type.Literal(1),
  previous: Type.String(), next: Type.String()
}, { additionalProperties: false });
const purgeSchema = Type.Object({
  format: Type.Literal('wire-edm-project-purge-transaction'),
  schemaVersion: Type.Literal(1),
  projectId: PostIdentifierSchema,
  ownedPaths: Type.Array(Type.String({ minLength: 1, maxLength: 1_024 }), { minItems: 1, uniqueItems: true }),
  previous: Type.String(), next: Type.String()
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
    const previous = await adapter.readText(manifestPath);
    if (previous === null) return failure('Workbench manifest is missing.');
    const raw = JSON.stringify({ format: 'wire-edm-project-trash-transaction', schemaVersion: 1, previous, next });
    if (new TextEncoder().encode(raw).byteLength > maximumBytes) return failure('Project recovery data is too large.');
    await adapter.ensureDirectory('transactions');
    try {
      await adapter.writeText(PROJECT_TRASH_TRANSACTION_PATH, raw);
      if (await adapter.readText(PROJECT_TRASH_TRANSACTION_PATH) !== raw) throw new Error('Recovery data did not read back exactly.');
    } catch (error) {
      // The manifest is untouched until the journal has been verified.
      await adapter.deleteText(PROJECT_TRASH_TRANSACTION_PATH);
      return failure(message(error));
    }
    try {
      await adapter.writeText(manifestPath, next);
      if (await adapter.readText(manifestPath) !== next) throw new Error('Project catalog did not read back exactly.');
    } catch (error) {
      // A reported failure restores the caller's snapshot, even if the write
      // completed before a later read failed. Crash recovery can finalize next.
      await adapter.writeText(manifestPath, previous);
      if (await adapter.readText(manifestPath) !== previous) return failure('Project catalog rollback did not read back exactly.');
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
    const previous = await adapter.readText(manifestPath);
    if (previous === null) return failure('Workbench manifest is missing.');
    const raw = JSON.stringify({ format: 'wire-edm-project-purge-transaction', schemaVersion: 1,
      projectId: input.projectId, ownedPaths: input.ownedPaths, previous, next: input.next });
    if (new TextEncoder().encode(raw).byteLength > maximumBytes) return failure('Project purge recovery data is too large.');
    await adapter.ensureDirectory('transactions');
    try {
      await adapter.writeText(PROJECT_TRASH_TRANSACTION_PATH, raw);
      if (await adapter.readText(PROJECT_TRASH_TRANSACTION_PATH) !== raw) throw new Error('Recovery data did not read back exactly.');
    } catch (error) {
      await adapter.deleteText(PROJECT_TRASH_TRANSACTION_PATH);
      return failure(message(error));
    }
    try {
      await adapter.writeText(manifestPath, input.next);
      if (await adapter.readText(manifestPath) !== input.next) throw new Error('Project archive did not read back exactly.');
      for (const path of input.ownedPaths) {
        await adapter.deleteText(path);
        if (await adapter.readText(path) !== null) throw new Error(`Could not remove ${path}.`);
      }
      await adapter.deleteText(PROJECT_TRASH_TRANSACTION_PATH);
      if (await adapter.readText(PROJECT_TRASH_TRANSACTION_PATH) !== null) throw new Error('Project purge recovery data was not removed.');
      return { ok: true };
    } catch (error) {
      const recovered = await recoverProjectTrashTransaction(adapter);
      if (!recovered.ok) return failure(`${message(error)}; recovery failed: ${recovered.error.message}`);
      return await adapter.readText(manifestPath) === input.next ? { ok: true } : failure(message(error));
    }
  } catch (error) { return failure(message(error)); }
}

/** Run before parsing the catalog, since an interrupted write can leave partial JSON. */
export async function recoverProjectTrashTransaction(adapter: WorkbenchStorageAdapter): Promise<Result> {
  try {
    const raw = await adapter.readText(PROJECT_TRASH_TRANSACTION_PATH);
    if (raw === null) return { ok: true };
    if (new TextEncoder().encode(raw).byteLength > maximumBytes) return failure('Project recovery data is too large.');
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return failure('Project recovery data is invalid JSON.'); }
    if (!Value.Check(schema, value) && !Value.Check(purgeSchema, value)) {
      return failure('Project recovery data has an invalid shape.');
    }
    if (value.format === 'wire-edm-project-purge-transaction') {
      if (!value.ownedPaths.every((path) => isPurgePath(value.projectId, path))) {
        return failure('Project purge recovery data has an invalid owned file path.');
      }
      if (await adapter.readText(manifestPath) === value.next) {
        for (const path of value.ownedPaths) {
          await adapter.deleteText(path);
          if (await adapter.readText(path) !== null) return failure(`Could not remove ${path}.`);
        }
      } else {
        await adapter.writeText(manifestPath, value.previous);
        if (await adapter.readText(manifestPath) !== value.previous) return failure('Project purge rollback did not read back exactly.');
      }
      await adapter.deleteText(PROJECT_TRASH_TRANSACTION_PATH);
      if (await adapter.readText(PROJECT_TRASH_TRANSACTION_PATH) !== null) return failure('Project purge recovery data was not removed.');
      return { ok: true };
    }
    if (await adapter.readText(manifestPath) !== value.next) {
      await adapter.writeText(manifestPath, value.previous);
      if (await adapter.readText(manifestPath) !== value.previous) return failure('Project catalog rollback did not read back exactly.');
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

function isPurgePath(projectId: string, path: string) {
  if (path.includes('\\') || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return false;
  return path === `projects/${projectId}.json` || path.startsWith(`projects/${projectId}/`) ||
    path.startsWith(`imports/${projectId}.`);
}
