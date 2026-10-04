import { DxfProcessingError, type DxfProcessor } from '@/domain/dxf/dxfProcessing';
import type { DxfProcessorRequest, DxfProcessorResponse } from './dxfProcessorTask';

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
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (result?: DxfProcessorResponse, error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate();
      if (result) resolve(result); else reject(error);
    };
    const abort = () => finish(undefined, signal?.reason);
    const timeout = setTimeout(() => finish(undefined, new DxfProcessingError('DXF_IMPORT_TIMEOUT',
      'DXF preparation reached its 90-second limit and was stopped. No project was written. Simplify the drawing or split it into smaller files.')), DXF_PROCESSING_TIMEOUT_MS);
    const failed = () => finish(undefined, new DxfProcessingError('DXF_IMPORT_WORKER_FAILED',
      'The local DXF worker stopped unexpectedly. No project was written. Try the import again or simplify the drawing.'));
    worker.onmessage = (event: MessageEvent<DxfProcessorResponse>) => {
      if (!event.data || (event.data.ok && event.data.kind !== request.kind)) { failed(); return; }
      finish(event.data);
    };
    worker.onerror = worker.onmessageerror = failed;
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { worker.postMessage(request); } catch { failed(); }
  });
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
