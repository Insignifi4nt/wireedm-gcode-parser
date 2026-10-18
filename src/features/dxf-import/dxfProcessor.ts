import { DxfProcessingError, type DxfProcessor } from '@/domain/dxf/dxfProcessing';
import type { DxfProcessorRequest, DxfProcessorResponse } from './dxfProcessorTask';
import { startOwnedWorkerTask } from '@/lib/ownedWorkerTask';

/** Every CPU task owns a fresh worker. The deadline is an acceptance limit, not a speed guarantee. */
export const DXF_PROCESSING_TIMEOUT_MS = 90_000;

function process(request: DxfProcessorRequest, signal?: AbortSignal): Promise<DxfProcessorResponse> {
  signal?.throwIfAborted();
  // Only non-browser clients use synchronous pure operations. Browsers never silently block on worker failure.
  if (typeof Worker === 'undefined' && typeof window === 'undefined') return import('./dxfProcessorTask').then(({ runDxfProcessorTask }) => {
    signal?.throwIfAborted();
    return runDxfProcessorTask(request);
  });
  let worker: Worker;
  try { worker = new Worker(new URL('./dxfProcessor.worker.ts', import.meta.url), { type: 'module' }); }
  catch { return Promise.reject(new DxfProcessingError('DXF_IMPORT_WORKER_FAILED', 'The browser could not start the local DXF worker. Reload the app and try again.')); }
  const failed = () => new DxfProcessingError('DXF_IMPORT_WORKER_FAILED',
    'The local DXF worker stopped unexpectedly. No project was written. Try the import again or simplify the drawing.');
  return startOwnedWorkerTask<DxfProcessorResponse, DxfProcessorResponse>({
    worker, request, signal, timeoutMs: DXF_PROCESSING_TIMEOUT_MS,
    receive(response) {
      if (!response || (response.ok && response.kind !== request.kind)) throw failed();
      return { kind: 'complete', value: response };
    },
    failure(cause) {
      if (cause.kind === 'abort') throw cause.reason;
      if (cause.kind === 'timeout') throw new DxfProcessingError('DXF_IMPORT_TIMEOUT',
        'DXF preparation reached its 90-second limit and was stopped. No project was written. Simplify the drawing or split it into smaller files.');
      throw failed();
    }
  }).result;
}

export const browserDxfProcessor: DxfProcessor = {
  async prepare(preference, input, signal) {
    const response = await process({ kind: 'prepare', preference, input }, signal);
    if (!response.ok) throw new DxfProcessingError('DXF_IMPORT_WORKER_FAILED', response.message);
    if (response.kind !== 'prepare') throw new Error('DXF worker returned the wrong task.');
    return deepFreeze(response.result);
  },
  async plan(entities, metadata, signal) {
    const response = await process({ kind: 'plan', entities, metadata }, signal);
    if (!response.ok) throw new DxfProcessingError('DXF_IMPORT_WORKER_FAILED', response.message);
    if (response.kind !== 'plan') throw new Error('DXF worker returned the wrong task.');
    return response.result;
  }
};

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
