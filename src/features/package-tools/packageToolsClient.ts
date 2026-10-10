import type { PackageAuthoringRequest, PackageAuthoringResult } from '@/domain/machine-package/packageAuthoringTools';

export function startPackageTool(request: PackageAuthoringRequest, signal?: AbortSignal) {
  const worker = new Worker(new URL('./packageTools.worker.ts', import.meta.url), { type: 'module' });
  let cancel = () => {};
  const result = new Promise<PackageAuthoringResult>((resolve, reject) => {
    let finished = false;
    const finish = (complete: () => void) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate();
      signal?.removeEventListener('abort', abort);
      complete();
    };
    const timeout = setTimeout(() => finish(() => reject(new Error('Check timed out. Reduce the package or review its post fixtures.'))), 90_000);
    cancel = () => finish(() => reject(new Error('Check cancelled.')));
    const abort = () => cancel();
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<PackageAuthoringResult>) => finish(() => resolve(event.data));
    worker.onerror = () => finish(() => reject(new Error('The package check could not run. Reload this page and try again.')));
    try { worker.postMessage(request); }
    catch (error) { finish(() => reject(error)); }
  });
  return { result, cancel: () => cancel() };
}
