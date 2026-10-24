import type { WorkbenchStorageAdapter } from './workbenchStorageAdapter';

const STORAGE_FULL_GUIDANCE: Record<WorkbenchStorageAdapter['kind'], string> = {
  'browser-cache': 'Browser storage for this site is full. In Settings → Storage → Backup & restore, download a backup of saved files. If verified backup fails, use Export readable recovery files in the same browser; folder access is not required. Keep the download and do not clear site data. Folder storage is optional in browsers that support it. Use Unreferenced file cleanup only after saving a backup and reviewing the selected files.',
  directory: 'The disk holding the workbench folder is full or over its quota. Free disk space, then try again.',
  memory: 'Temporary session storage is full. In Settings → Storage → Backup & restore, download a backup before closing this tab.'
};

/** A write the storage itself refused for lack of space; the original error is kept as the cause. */
export class WorkbenchStorageFullError extends Error {
  override readonly name = 'WorkbenchStorageFullError';

  constructor(
    readonly storageKind: WorkbenchStorageAdapter['kind'],
    readonly path: string,
    cause: unknown
  ) {
    super(STORAGE_FULL_GUIDANCE[storageKind], { cause });
  }
}

/** Browsers report full localStorage and File System Access quotas under these names and legacy codes. */
export function isStorageQuotaError(error: unknown) {
  if (error instanceof WorkbenchStorageFullError) return true;
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

export async function withStorageFullGuidance<Result>(
  storageKind: WorkbenchStorageAdapter['kind'],
  path: string,
  write: () => Result | Promise<Result>
): Promise<Result> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof WorkbenchStorageFullError || !isStorageQuotaError(error)) throw error;
    throw new WorkbenchStorageFullError(storageKind, path, error);
  }
}
