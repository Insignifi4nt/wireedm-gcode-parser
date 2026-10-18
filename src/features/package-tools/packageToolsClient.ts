import type { PackageAuthoringRequest, PackageAuthoringResult } from '@/domain/machine-package/packageAuthoringTools';
import { startOwnedWorkerTask } from '@/lib/ownedWorkerTask';

export function startPackageTool(request: PackageAuthoringRequest, signal?: AbortSignal) {
  const worker = new Worker(new URL('./packageTools.worker.ts', import.meta.url), { type: 'module' });
  return startOwnedWorkerTask<PackageAuthoringResult, PackageAuthoringResult>({
    worker, request, signal, timeoutMs: 90_000, receive: response => ({ kind: 'complete', value: response }),
    failure(cause) {
      if (cause.kind === 'abort') throw new Error('Check cancelled.');
      if (cause.kind === 'timeout') throw new Error('Check timed out. Reduce the package or review its post fixtures.');
      if (cause.kind === 'post-error') throw cause.error;
      throw new Error('The package check could not run. Reload this page and try again.');
    }
  });
}
