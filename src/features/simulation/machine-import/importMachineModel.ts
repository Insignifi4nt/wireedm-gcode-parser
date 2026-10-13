import {
  MACHINE_IMPORT_LIMITS, machineImportFailure, type MachineImportProgress, type MachineModelImportResult
} from '@/domain/simulation/machine-import/model';
import { validateMachineFile } from '@/domain/simulation/machine-import/stepInput';
import type { MachineImportWorkerRequest, MachineImportWorkerResponse } from './protocol';
import { startOwnedWorkerTask } from '@/lib/ownedWorkerTask';

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
  return startOwnedWorkerTask<MachineImportWorkerResponse, MachineModelImportResult>({
    worker, request: { file } satisfies MachineImportWorkerRequest, signal: options.signal, timeoutMs: MACHINE_IMPORT_LIMITS.timeoutMs,
    receive(response) {
      if (response.type === 'progress') options.onProgress?.(response.progress);
      return response.type === 'result' ? { kind: 'complete', value: response.result } : { kind: 'continue' };
    },
    failure(cause) {
      if (cause.kind === 'abort') return cancelled();
      if (cause.kind === 'timeout') return machineImportFailure('MACHINE_IMPORT_TIMED_OUT',
        'Machine model import exceeded 90 seconds and was stopped. Export a simpler assembly and try again.');
      return machineImportFailure('MACHINE_IMPORT_WORKER_FAILED', 'The local STEP parser stopped unexpectedly. Try a smaller model.');
    }
  }).result;
}
