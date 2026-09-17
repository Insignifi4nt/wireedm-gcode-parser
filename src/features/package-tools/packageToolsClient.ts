import type { PackageAuthoringRequest, PackageAuthoringResult } from '@/domain/machine-package/packageAuthoringTools';

export function startPackageTool(request: PackageAuthoringRequest) {
  const worker = new Worker(new URL('./packageTools.worker.ts', import.meta.url), { type: 'module' });
  let cancel = () => {};
  const result = new Promise<PackageAuthoringResult>((resolve, reject) => {
    const finish = () => { clearTimeout(timeout); worker.terminate(); };
    const timeout = setTimeout(() => { finish(); reject(new Error('Check timed out. Reduce the package or review its post fixtures.')); }, 90_000);
    cancel = () => { finish(); reject(new Error('Check cancelled.')); };
    worker.onmessage = (event: MessageEvent<PackageAuthoringResult>) => { finish(); resolve(event.data); };
    worker.onerror = () => { finish(); reject(new Error('The package check could not run. Reload this page and try again.')); };
    try { worker.postMessage(request); }
    catch (error) { finish(); reject(error); }
  });
  return { result, cancel: () => cancel() };
}
