import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { workbenchProjectRevisionPath } from '@/domain/workbench-catalog/workbenchProjectStorage';

export interface SavedRevisionSummary {
  readonly revisionId: string;
  readonly savedAt: string | null;
  readonly machineName: string | null;
  readonly packageId: string | null;
  readonly loadError?: string;
}

/** Display metadata only. A selected revision must be fully parsed before use. */
export async function readSavedRevisionSummaryPage(
  adapter: WorkbenchStorageAdapter,
  projectId: string,
  revisionIds: readonly string[],
  page: number,
  pageSize = 20
): Promise<readonly SavedRevisionSummary[]> {
  if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new Error('Invalid saved revision page.');
  }
  const ids = [...revisionIds].reverse().slice(page * pageSize, (page + 1) * pageSize);
  const rows: SavedRevisionSummary[] = [];
  for (const revisionId of ids) {
    try {
      const raw = await adapter.readText(workbenchProjectRevisionPath(projectId, revisionId));
      if (raw === null) throw new Error('Saved revision file is missing.');
      const value: unknown = JSON.parse(raw);
      if (!isRecord(value) || value.format !== 'wire-edm-job-revision' || value.revisionId !== revisionId ||
        !isRecord(value.project) || value.project.id !== projectId ||
        typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt)) ||
        !isRecord(value.machine) || typeof value.machine.name !== 'string' ||
        !isRecord(value.post) || !isRecord(value.post.installation) ||
        !isRecord(value.post.installation.ref) || typeof value.post.installation.ref.packageId !== 'string') {
        throw new Error('Saved revision display metadata is invalid.');
      }
      rows.push({ revisionId, savedAt: value.savedAt, machineName: value.machine.name,
        packageId: value.post.installation.ref.packageId });
    } catch (error) {
      rows.push({ revisionId, savedAt: null, machineName: null, packageId: null,
        loadError: error instanceof Error ? error.message : String(error) });
    }
  }
  return rows;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
