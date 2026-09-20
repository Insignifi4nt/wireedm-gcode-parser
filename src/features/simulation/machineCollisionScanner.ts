import type { SimulationPlan } from '@/domain/simulation';
import { MACHINE_COLLISION_LIMITATION, type MachineModel, type MachinePlacement } from '@/domain/simulation/machine-import';
import { runMachineCollisionScan, type MachineCollisionScanRequest, type MachineCollisionScanResponse } from './machineCollisionScanTask';

export const MACHINE_SCAN_TIMEOUT_MS = 60_000;

/** A worker per scan lets source changes interrupt placement/indexing as well as collision queries. */
export function scanMachineCollisionsAsync(
  plan: SimulationPlan, model: MachineModel, placement: MachinePlacement, signal: AbortSignal
): Promise<MachineCollisionScanResponse> {
  if (signal.aborted) return Promise.reject(signal.reason);
  const request: MachineCollisionScanRequest = { plan, model, placement };
  // Non-browser clients retain the real domain implementation and its cooperative scan budgets.
  if (typeof Worker === 'undefined') return Promise.resolve().then(() => runMachineCollisionScan(request, signal));
  let worker: Worker;
  try { worker = new Worker(new URL('./machineCollisionScanner.worker.ts', import.meta.url), { type: 'module' }); }
  catch { return Promise.resolve({ ok: false, message: 'The browser could not start local machine surface checking. Reload the app and try again. No clearance was verified.' }); }
  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      clearTimeout(timeout); signal.removeEventListener('abort', abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate();
    };
    const finish = (response: MachineCollisionScanResponse) => {
      if (finished) return;
      finished = true; cleanup(); resolve(response);
    };
    const abort = () => { if (finished) return; finished = true; cleanup(); reject(signal.reason); };
    const timeout = setTimeout(() => finish({ ok: true, result: {
      complete: false, cancelled: false, checkedSweeps: 0, testedTriangles: 0, warnings: [],
      message: 'Machine surface checking reached its 60-second limit. No scan result was returned; remaining motion was not checked.',
      limitations: [MACHINE_COLLISION_LIMITATION, 'The worker stopped before returning a result. Partial contacts and checked-geometry counts are unavailable.']
    } }), MACHINE_SCAN_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<MachineCollisionScanResponse>) => finish(event.data);
    worker.onerror = worker.onmessageerror = () => finish({ ok: false,
      message: 'Local machine surface checking stopped unexpectedly. No clearance was verified. Try the model again.' });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    // Do not transfer source buffers: the visible machine and later scans still own them.
    try { worker.postMessage(request); }
    catch { finish({ ok: false, message: 'The saved process or machine geometry could not be sent for surface checking. No clearance was verified.' }); }
  });
}
