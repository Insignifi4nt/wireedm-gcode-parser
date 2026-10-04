import { withWorkbenchMutationLock } from '@/domain/storage/workbenchMutationLock';
import { recoverProjectTrashTransaction, type ProjectTrashTransactionError } from '@/domain/storage/projectTrashTransaction';
import { recoverSavedRevisionTransaction, type SavedRevisionTransactionError } from '@/domain/storage/savedRevisionTransaction';
import { recoverCatalogPairTransaction, type CatalogPairTransactionError } from '@/domain/storage/catalogPairTransaction';
import { commitWorkbenchFileTransaction, WORKBENCH_FILE_TRANSACTION_PATH, WorkbenchFileWriteError } from '@/domain/storage/workbenchFileTransaction';
import { readPostLibraryStorage, type PostLibraryStorageError } from '@/domain/post-processor/postLibraryStorage';
import { readMachineLibraryStorage, type MachineLibraryStorageError } from '@/domain/machine-definition/machineLibraryStorage';

import {
  parseWorkbenchCatalogManifest,
  WORKBENCH_CATALOG_PATH,
  type ConnectedWorkbenchCatalog,
  type WorkbenchCatalogManifest,
  type WorkbenchCatalogManifestError
} from '../workbenchCatalog';

export interface UpdateWorkbenchCatalogPreferencesInput {
  readonly preferences: WorkbenchCatalogManifest['preferences'];
  readonly updatedAt: Date;
}

type PreferenceManifestStateError = {
  readonly code:
    | 'WORKBENCH_CATALOG_PREFERENCES_MANIFEST_MISSING'
    | 'WORKBENCH_CATALOG_PREFERENCES_MANIFEST_STALE';
  readonly message: string;
  readonly path: typeof WORKBENCH_CATALOG_PATH;
};

type PreferenceTimestampError = {
  readonly code: 'WORKBENCH_CATALOG_PREFERENCES_TIMESTAMP_INVALID';
  readonly message: string;
};

type PreferenceStorageAccessError = {
  readonly code: 'WORKBENCH_CATALOG_PREFERENCES_ACCESS_FAILED';
  readonly message: string;
  readonly operation: 'read' | 'write';
  readonly path: string;
};

export type UpdateWorkbenchCatalogPreferencesError =
  | ProjectTrashTransactionError
  | SavedRevisionTransactionError
  | CatalogPairTransactionError
  | PostLibraryStorageError
  | MachineLibraryStorageError
  | WorkbenchCatalogManifestError
  | PreferenceManifestStateError
  | PreferenceTimestampError
  | PreferenceStorageAccessError;

export type UpdateWorkbenchCatalogPreferencesResult =
  | {
      readonly ok: true;
      readonly preferences: WorkbenchCatalogManifest['preferences'];
      readonly workbench: ConnectedWorkbenchCatalog;
    }
  | {
      readonly ok: false;
      readonly error: UpdateWorkbenchCatalogPreferencesError;
    };

export function updateWorkbenchCatalogPreferences(
  workbench: ConnectedWorkbenchCatalog,
  input: UpdateWorkbenchCatalogPreferencesInput
): Promise<UpdateWorkbenchCatalogPreferencesResult> {
  return withWorkbenchMutationLock(workbench.adapter, async () => {
    const recoveredTrash = await recoverProjectTrashTransaction(workbench.adapter);
    if (!recoveredTrash.ok) return recoveredTrash;
    const recovered = await recoverSavedRevisionTransaction(workbench.adapter);
    if (!recovered.ok) return recovered;
    const recoveredPackages = await recoverCatalogPairTransaction(workbench.adapter);
    if (!recoveredPackages.ok) return recoveredPackages;
    const posts = await readPostLibraryStorage(workbench.adapter);
    if (!posts.ok) return posts;
    const machines = await readMachineLibraryStorage(workbench.adapter, posts.library);
    if (!machines.ok) return machines;
    const currentRead = await readManifest(workbench);
    if (!currentRead.ok) return currentRead;
    if (currentRead.rawText === null) {
      return failure({
        code: 'WORKBENCH_CATALOG_PREFERENCES_MANIFEST_MISSING',
        message: 'Workbench manifest disappeared after this catalog snapshot was opened.',
        path: WORKBENCH_CATALOG_PATH
      });
    }
    const current = parseWorkbenchCatalogManifest(currentRead.rawText.replace(/^\uFEFF/, ''), machines.library);
    if (!current.ok) return current;
    if (JSON.stringify(current.manifest) !== JSON.stringify(workbench.manifest)) {
      return failure({
        code: 'WORKBENCH_CATALOG_PREFERENCES_MANIFEST_STALE',
        message: 'Workbench manifest changed after this catalog snapshot was opened.',
        path: WORKBENCH_CATALOG_PATH
      });
    }
    if (!Number.isFinite(input.updatedAt.getTime())) {
      return failure({
        code: 'WORKBENCH_CATALOG_PREFERENCES_TIMESTAMP_INVALID',
        message: 'Workbench preference mutation requires a valid timestamp.'
      });
    }

    const candidate = {
      ...workbench.manifest,
      updatedAt: input.updatedAt.toISOString(),
      preferences: input.preferences,
      projects: [...workbench.manifest.projects]
    } satisfies WorkbenchCatalogManifest;
    const candidateText = `${JSON.stringify(candidate, null, 2)}\n`;
    const validated = parseWorkbenchCatalogManifest(candidateText, machines.library);
    if (!validated.ok) return validated;
    const serialized = `${JSON.stringify(validated.manifest, null, 2)}\n`;

    try {
      await commitWorkbenchFileTransaction(workbench.adapter, [{ path: WORKBENCH_CATALOG_PATH, contents: serialized }]);
    } catch (error) {
      return failure(storageAccessError('write', error,
        error instanceof WorkbenchFileWriteError ? error.path : WORKBENCH_FILE_TRANSACTION_PATH));
    }

    return {
      ok: true,
      preferences: validated.manifest.preferences,
      workbench: Object.freeze({ ...workbench, posts: posts.library, machines: machines.library, manifest: validated.manifest })
    };
  });
}

async function readManifest(workbench: ConnectedWorkbenchCatalog) {
  try {
    return {
      ok: true as const,
      rawText: await (workbench.adapter.readExactText?.(WORKBENCH_CATALOG_PATH)
        ?? workbench.adapter.readText(WORKBENCH_CATALOG_PATH))
    };
  } catch (error) {
    return failure(storageAccessError('read', error));
  }
}

function storageAccessError(
  operation: PreferenceStorageAccessError['operation'],
  error: unknown,
  path = WORKBENCH_CATALOG_PATH
): PreferenceStorageAccessError {
  const cause = error instanceof Error ? error.message : String(error);
  return {
    code: 'WORKBENCH_CATALOG_PREFERENCES_ACCESS_FAILED',
    message: `Workbench preference manifest ${operation} failed at ${path}: ${cause}`,
    operation,
    path
  };
}

function failure<Error extends UpdateWorkbenchCatalogPreferencesError>(error: Error) {
  return { ok: false as const, error };
}
