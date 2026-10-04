import { initializeWorkbenchCatalog, type InitializeWorkbenchCatalogResult } from '@/domain/workbench-catalog/workbenchCatalog';
import { recoveryStorageSource, type RecoveryStorageSource } from './workbenchRecovery';
import type { WorkbenchStorageAdapter } from './workbenchStorageAdapter';

export type WorkbenchConnectionResult = (InitializeWorkbenchCatalogResult |
  { ok: false; error: { code: 'WORKBENCH_CONNECTION_FAILED'; message: string } }) & { recoverySource?: RecoveryStorageSource };

/** Keep the failed location readable without claiming its catalog is connected. */
export async function initializeWorkbenchConnection(adapter: WorkbenchStorageAdapter, now?: Date): Promise<WorkbenchConnectionResult> {
  try {
    const result = await initializeWorkbenchCatalog(adapter, { now });
    return result.ok ? result : { ...result, recoverySource: recoveryStorageSource(adapter, result.error) };
  } catch (failure) {
    const error = { code: 'WORKBENCH_CONNECTION_FAILED' as const,
      message: failure instanceof Error ? failure.message : 'Could not open workbench storage.' };
    return { ok: false, error, recoverySource: recoveryStorageSource(adapter, error) };
  }
}
