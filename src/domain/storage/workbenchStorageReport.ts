import { APP_VERSION } from '@/domain/release/appRelease';
import { parseWorkbenchCatalogManifest, WORKBENCH_CATALOG_PATH, type ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { readIndexedWorkbenchProjectStorage, workbenchProjectOwnedPaths } from '@/domain/workbench-catalog/workbenchProjectStorage';
import { POST_LIBRARY_PATH } from '@/domain/post-processor/postLibraryStorage';
import { MACHINE_LIBRARY_PATH } from '@/domain/machine-definition/machineLibraryStorage';
import { withWorkbenchMutationLock } from './workbenchMutationLock';

export interface WorkbenchStorageReport {
  readonly appVersion: string;
  readonly scannedAt: string;
  readonly storage: string;
  readonly complete: boolean;
  readonly problems: readonly string[];
  readonly files: readonly { path: string; category: 'referenced' | 'retained-backup' | 'transaction' | 'unreferenced' }[];
}

/** Metadata only. Unreferenced files can be exports, unrelated files or recoverable user data. */
export async function inspectWorkbenchStorage(workbench: ConnectedWorkbenchCatalog): Promise<WorkbenchStorageReport> {
  const { adapter } = workbench;
  return withWorkbenchMutationLock(adapter, async () => {
    if (!adapter.listFiles) throw new Error('Storage inventory is unavailable for this connection.');
    const inventory = await adapter.listFiles();
    const problems: string[] = [];
    if (inventory.truncated) problems.push('The inventory limit was reached; some files or folders were not scanned.');
    const referenced = new Set([WORKBENCH_CATALOG_PATH, POST_LIBRARY_PATH, MACHINE_LIBRARY_PATH]);
    const raw = await adapter.readText(WORKBENCH_CATALOG_PATH);
    const parsed = raw === null ? null : parseWorkbenchCatalogManifest(raw, workbench.machines);
    if (!parsed?.ok) problems.push(parsed ? parsed.error.message : 'The workbench manifest is missing.');
    else {
      const entries = [...parsed.manifest.projects, ...(parsed.manifest.deletedProjects ?? []).map(({ project }) => project)];
      for (const entry of entries) {
        referenced.add(entry.path);
        const read = await readIndexedWorkbenchProjectStorage(adapter, entry);
        if (!read.ok) { problems.push(read.error.message); continue; }
        for (const path of workbenchProjectOwnedPaths(read.project)) referenced.add(path);
      }
    }
    const present = new Set(inventory.paths);
    if (!inventory.truncated) {
      for (const path of referenced) if (!present.has(path)) problems.push(`Referenced file is missing: ${path}`);
    }
    if (inventory.paths.some((path) => path.startsWith('transactions/'))) {
      problems.push('Transaction files are present. Reopen the workbench to let normal recovery check them; do not delete them.');
    }
    return {
      appVersion: APP_VERSION, scannedAt: new Date().toISOString(), storage: adapter.kind,
      complete: problems.length === 0, problems,
      files: inventory.paths.map((path) => ({
        path,
        category: referenced.has(path) ? 'referenced' as const
          : path.startsWith('legacy/') ? 'retained-backup' as const
          : path.startsWith('transactions/') ? 'transaction' as const
          : 'unreferenced' as const
      }))
    };
  });
}
