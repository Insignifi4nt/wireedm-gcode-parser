import {
  MACHINE_IMPORT_LIMITS, machineImportFailure, type MachineImportProgress, type MachineModelImportResult
} from '@/domain/simulation/machine-import/model';
import { validateMachineFile } from '@/domain/simulation/machine-import/stepInput';
import type { MachineImportWorkerRequest, MachineImportWorkerResponse } from './protocol';

export interface ImportMachineModelOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: MachineImportProgress) => void;
}

/** A fresh worker owns every import, including its WASM heap; cancellation actually stops parsing. */
export function importMachineModel(file: File, options: ImportMachineModelOptions = {}): Promise<MachineModelImportResult> {
  const cancelled = () => machineImportFailure('MACHINE_IMPORT_CANCELLED', 'Machine model import was cancelled.');
  if (options.signal?.aborted) return Promise.resolve(cancelled());
  const check = validateMachineFile(file);
  if (!check.ok) return Promise.resolve(check);
  let worker: Worker;
  try { worker = new Worker(new URL('./machineImport.worker.ts', import.meta.url), { type: 'module' }); }
  catch { return Promise.resolve(machineImportFailure('MACHINE_IMPORT_WORKER_FAILED', 'The browser could not start the local STEP parser.')); }
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result: MachineModelImportResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      resolve(result);
    };
    const abort = () => finish(cancelled());
    const timeout = setTimeout(() => finish(machineImportFailure('MACHINE_IMPORT_TIMED_OUT',
      'Machine model import exceeded 90 seconds and was stopped. Export a simpler assembly and try again.')), MACHINE_IMPORT_LIMITS.timeoutMs);
    worker.onmessage = (event: MessageEvent<MachineImportWorkerResponse>) => {
      if (finished) return;
      if (event.data.type === 'progress') options.onProgress?.(event.data.progress);
      else if (event.data.type === 'result') finish(event.data.result);
    };
    const failed = () => finish(machineImportFailure('MACHINE_IMPORT_WORKER_FAILED', 'The local STEP parser stopped unexpectedly. Try a smaller model.'));
    worker.onerror = failed;
    worker.onmessageerror = failed;
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) { abort(); return; }
    try { worker.postMessage({ file } satisfies MachineImportWorkerRequest); }
    catch { failed(); }
  });
}
