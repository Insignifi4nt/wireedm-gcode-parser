import { canonicalJson } from '@/domain/post-processor/canonicalJson';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import type { PreparedMachinePackageInstallation } from './machinePackageInstallation';

export function machinePackageCatalogFingerprint(workbench: ConnectedWorkbenchCatalog) {
  return canonicalJson({ machines: workbench.machines, posts: workbench.posts });
}

/** In-memory context hint only; commit checks the fingerprint against storage under its lock. */
export function isPreparedMachinePackageInstallationCurrent(
  prepared: PreparedMachinePackageInstallation,
  workbench: ConnectedWorkbenchCatalog | null
): boolean {
  return workbench !== null && prepared.workbench.adapter === workbench.adapter &&
    prepared.preparedCatalogFingerprint === machinePackageCatalogFingerprint(workbench);
}
