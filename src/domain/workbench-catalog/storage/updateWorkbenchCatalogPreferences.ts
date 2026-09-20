import { withWorkbenchMutationLock } from '@/domain/storage/workbenchMutationLock';
import { recoverProjectTrashTransaction, type ProjectTrashTransactionError } from '@/domain/storage/projectTrashTransaction';
import { recoverSavedRevisionTransaction, type SavedRevisionTransactionError } from '@/domain/storage/savedRevisionTransaction';

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
  readonly path: typeof WORKBENCH_CATALOG_PATH;
};

type PreferenceReadbackError = {
  readonly code: 'WORKBENCH_CATALOG_PREFERENCES_READBACK_MISMATCH';
  readonly message: string;
  readonly path: typeof WORKBENCH_CATALOG_PATH;
};

export type UpdateWorkbenchCatalogPreferencesError =
  | ProjectTrashTransactionError
  | SavedRevisionTransactionError
  | WorkbenchCatalogManifestError
  | PreferenceManifestStateError
  | PreferenceTimestampError
  | PreferenceStorageAccessError
  | PreferenceReadbackError;

type PreferenceRollbackError = {
  readonly code: 'WORKBENCH_CATALOG_PREFERENCES_ROLLBACK_FAILED';
  readonly message: string;
  readonly originalError: UpdateWorkbenchCatalogPreferencesError;
  readonly rollbackError: PreferenceStorageAccessError | PreferenceReadbackError;
};

export type UpdateWorkbenchCatalogPreferencesResult =
  | {
      readonly ok: true;
      readonly preferences: WorkbenchCatalogManifest['preferences'];
      readonly workbench: ConnectedWorkbenchCatalog;
    }
  | {
      readonly ok: false;
      readonly error: UpdateWorkbenchCatalogPreferencesError | PreferenceRollbackError;
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
    const currentRead = await readManifest(workbench);
    if (!currentRead.ok) return currentRead;
    if (currentRead.rawText === null) {
      return failure({
        code: 'WORKBENCH_CATALOG_PREFERENCES_MANIFEST_MISSING',
        message: 'Workbench manifest disappeared after this catalog snapshot was opened.',
        path: WORKBENCH_CATALOG_PATH
      });
    }
    const current = parseWorkbenchCatalogManifest(currentRead.rawText.replace(/^\uFEFF/, ''), workbench.machines);
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
    const validated = parseWorkbenchCatalogManifest(candidateText, workbench.machines);
    if (!validated.ok) return validated;
    const serialized = `${JSON.stringify(validated.manifest, null, 2)}\n`;

    const written = await writeManifest(workbench, serialized);
    if (!written.ok) {
      return rollbackManifest(workbench, currentRead.rawText, written.error);
    }
    const readback = await readManifest(workbench);
    if (!readback.ok) {
      return rollbackManifest(workbench, currentRead.rawText, readback.error);
    }
    if (readback.rawText !== serialized) {
      return rollbackManifest(workbench, currentRead.rawText, {
        code: 'WORKBENCH_CATALOG_PREFERENCES_READBACK_MISMATCH',
        message: `Workbench preference manifest did not read back byte-for-byte at ${WORKBENCH_CATALOG_PATH}.`,
        path: WORKBENCH_CATALOG_PATH
      });
    }

    return {
      ok: true,
      preferences: validated.manifest.preferences,
      workbench: Object.freeze({ ...workbench, manifest: validated.manifest })
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

async function writeManifest(workbench: ConnectedWorkbenchCatalog, rawText: string) {
  try {
    await workbench.adapter.writeText(WORKBENCH_CATALOG_PATH, rawText);
    return { ok: true as const };
  } catch (error) {
    return failure(storageAccessError('write', error));
  }
}

async function rollbackManifest(
  workbench: ConnectedWorkbenchCatalog,
  previousRawText: string,
  originalError: UpdateWorkbenchCatalogPreferencesError
): Promise<Extract<UpdateWorkbenchCatalogPreferencesResult, { readonly ok: false }>> {
  const restored = await writeManifest(workbench, previousRawText);
  const readback = restored.ok ? await readManifest(workbench) : restored;
  if (readback.ok && readback.rawText === previousRawText) return failure(originalError);
  const rollbackError: PreferenceStorageAccessError | PreferenceReadbackError = readback.ok ? {
    code: 'WORKBENCH_CATALOG_PREFERENCES_READBACK_MISMATCH',
    message: `Workbench preference rollback did not restore the exact previous manifest at ${WORKBENCH_CATALOG_PATH}.`,
    path: WORKBENCH_CATALOG_PATH
  } : readback.error;
  return {
    ok: false,
    error: {
      code: 'WORKBENCH_CATALOG_PREFERENCES_ROLLBACK_FAILED',
      message: 'Workbench preference mutation failed and the exact previous manifest could not be restored.',
      originalError,
      rollbackError
    }
  };
}

function storageAccessError(
  operation: PreferenceStorageAccessError['operation'],
  error: unknown
): PreferenceStorageAccessError {
  const cause = error instanceof Error ? error.message : String(error);
  return {
    code: 'WORKBENCH_CATALOG_PREFERENCES_ACCESS_FAILED',
    message: `Workbench preference manifest ${operation} failed at ${WORKBENCH_CATALOG_PATH}: ${cause}`,
    operation,
    path: WORKBENCH_CATALOG_PATH
  };
}

function failure<Error extends UpdateWorkbenchCatalogPreferencesError>(error: Error) {
  return { ok: false as const, error };
}
