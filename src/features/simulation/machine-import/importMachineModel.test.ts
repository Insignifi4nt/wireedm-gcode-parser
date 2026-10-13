import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MACHINE_IMPORT_LIMITS, machineImportFailure } from '@/domain/simulation/machine-import/model';
import { triangleModel } from '@/domain/simulation/machine-import/__tests__/machineTestModel';
import { importMachineModel } from './importMachineModel';
import type { MachineImportWorkerResponse } from './protocol';

class TestWorker extends EventTarget {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent<MachineImportWorkerResponse | { readonly type: 'unknown' }>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { super(); TestWorker.instances.push(this); }
  send(data: MachineImportWorkerResponse | { readonly type: 'unknown' }) { this.onmessage?.(new MessageEvent('message', { data })); }
}

describe('local machine import lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); TestWorker.instances = []; vi.stubGlobal('Worker', TestWorker); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

  function expectReleased(worker: TestWorker) {
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  }

  it('rejects invalid size, format and already-cancelled imports without starting WASM', async () => {
    const signal = AbortSignal.abort();
    expect(await importMachineModel(new File(['step'], 'model.step'), { signal })).toMatchObject({ ok: false, error: { code: 'MACHINE_IMPORT_CANCELLED' } });
    expect(await importMachineModel(new File(['brep'], 'model.brep'))).toMatchObject({ ok: false, error: { code: 'MACHINE_IMPORT_UNSUPPORTED_FORMAT' } });
    expect(await importMachineModel({ name: 'huge.step', size: MACHINE_IMPORT_LIMITS.fileBytes + 1 } as File)).toMatchObject({ ok: false, error: { code: 'MACHINE_IMPORT_TOO_LARGE' } });
    expect(TestWorker.instances).toHaveLength(0);
  });

  it('forwards a local File and progress, then frees the worker after completion', async () => {
    const file = new File(['step'], 'fixture.step');
    const progress = vi.fn();
    const promise = importMachineModel(file, { onProgress: progress });
    const worker = TestWorker.instances[0];
    expect(worker.postMessage).toHaveBeenCalledWith({ file });
    worker.send({ type: 'progress', progress: { stage: 'triangulating' } });
    expect(progress).toHaveBeenCalledWith({ stage: 'triangulating' });
    const failure = machineImportFailure('MACHINE_IMPORT_PARSE_FAILED', 'Malformed model');
    worker.send({ type: 'result', result: failure });
    expect(await promise).toEqual(failure);
    expectReleased(worker);
  });

  it('keeps the exact completed model when cancellation and queued progress arrive later', async () => {
    const signal = new AbortController();
    const progress = vi.fn();
    const promise = importMachineModel(new File(['step'], 'fixture.step'), { signal: signal.signal, onProgress: progress });
    const worker = TestWorker.instances[0];
    const queued = worker.onmessage;
    const result = { ok: true, model: triangleModel() } as const;
    worker.send({ type: 'result', result });
    expect(await promise).toBe(result);
    signal.abort();
    queued?.(new MessageEvent('message', { data: { type: 'progress', progress: { stage: 'triangulating' } } }));
    queued?.(new MessageEvent('message', { data: { type: 'result', result: machineImportFailure('MACHINE_IMPORT_PARSE_FAILED', 'Late') } }));
    vi.advanceTimersByTime(MACHINE_IMPORT_LIMITS.timeoutMs);
    expect(progress).not.toHaveBeenCalled();
    expect(await promise).toBe(result);
    expectReleased(worker);
  });

  it('continues after progress and unknown message types until a terminal reply arrives', async () => {
    const progress = vi.fn();
    const promise = importMachineModel(new File(['step'], 'fixture.step'), { onProgress: progress });
    const worker = TestWorker.instances[0];
    let settled = false;
    void promise.then(() => { settled = true; });
    worker.send({ type: 'progress', progress: { stage: 'reading' } });
    worker.send({ type: 'unknown' });
    await Promise.resolve();
    expect(progress).toHaveBeenCalledExactlyOnceWith({ stage: 'reading' });
    expect(settled).toBe(false);
    expect(worker.terminate).not.toHaveBeenCalled();
    const result = { ok: true, model: triangleModel() } as const;
    worker.send({ type: 'result', result });
    expect(await promise).toBe(result);
    expectReleased(worker);
  });

  it('releases the worker when a progress receiver throws and ignores queued replies', async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const progress = vi.fn(() => { throw new Error('Progress display failed'); });
    const promise = importMachineModel(new File(['step'], 'fixture.step'), { signal: controller.signal, onProgress: progress });
    const worker = TestWorker.instances[0];
    const queued = worker.onmessage;
    const queuedError = worker.onerror;
    worker.send({ type: 'progress', progress: { stage: 'reading' } });
    expect(await promise).toMatchObject({ ok: false, error: { code: 'MACHINE_IMPORT_WORKER_FAILED' } });
    queued?.(new MessageEvent('message', { data: { type: 'progress', progress: { stage: 'triangulating' } } }));
    queued?.(new MessageEvent('message', { data: { type: 'result', result: { ok: true, model: triangleModel() } } }));
    queuedError?.();
    controller.abort();
    expect(progress).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expectReleased(worker);
  });

  it('preserves cancellation when a progress receiver aborts and then throws', async () => {
    const controller = new AbortController();
    const promise = importMachineModel(new File(['step'], 'fixture.step'), { signal: controller.signal,
      onProgress: () => { controller.abort(); throw new Error('Progress failed after cancellation'); }
    });
    const worker = TestWorker.instances[0];
    worker.send({ type: 'progress', progress: { stage: 'reading' } });
    expect(await promise).toMatchObject({ ok: false, error: { code: 'MACHINE_IMPORT_CANCELLED' } });
    expectReleased(worker);
  });

  it('retains startup and request-copy failures without a leaked task', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Worker blocked'); } });
    expect(await importMachineModel(new File(['step'], 'fixture.step'))).toMatchObject({
      ok: false, error: { code: 'MACHINE_IMPORT_WORKER_FAILED', message: 'The browser could not start the local STEP parser.' }
    });
    expect(vi.getTimerCount()).toBe(0);
    class CopyFailureWorker extends TestWorker {
      postMessage = vi.fn(() => { throw new DOMException('Cannot clone', 'DataCloneError'); });
    }
    vi.stubGlobal('Worker', CopyFailureWorker);
    expect(await importMachineModel(new File(['step'], 'fixture.step'))).toMatchObject({
      ok: false, error: { code: 'MACHINE_IMPORT_WORKER_FAILED', message: 'The local STEP parser stopped unexpectedly. Try a smaller model.' }
    });
    expectReleased(TestWorker.instances[0]);
  });

  it('terminates an in-progress parse on abort and ignores late replies', async () => {
    const controller = new AbortController();
    const promise = importMachineModel(new File(['step'], 'fixture.step'), { signal: controller.signal });
    const worker = TestWorker.instances[0];
    const lateReply = worker.onmessage;
    controller.abort();
    expect(await promise).toMatchObject({ ok: false, error: { code: 'MACHINE_IMPORT_CANCELLED' } });
    lateReply?.({ data: { type: 'result', result: machineImportFailure('MACHINE_IMPORT_PARSE_FAILED', 'Late reply') } } as MessageEvent<MachineImportWorkerResponse>);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('times out runaway work and disposes crashed or unreadable workers', async () => {
    vi.useFakeTimers();
    const timed = importMachineModel(new File(['step'], 'fixture.step'));
    vi.advanceTimersByTime(MACHINE_IMPORT_LIMITS.timeoutMs);
    expect(await timed).toMatchObject({ ok: false, error: { code: 'MACHINE_IMPORT_TIMED_OUT' } });
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
    const crashed = importMachineModel(new File(['step'], 'fixture.step'));
    TestWorker.instances[1].onerror?.();
    expect(await crashed).toMatchObject({ ok: false, error: { code: 'MACHINE_IMPORT_WORKER_FAILED' } });
    expect(TestWorker.instances[1].terminate).toHaveBeenCalledOnce();
    const unreadable = importMachineModel(new File(['step'], 'fixture.step'));
    TestWorker.instances[2].dispatchEvent(new MessageEvent('messageerror'));
    expect(await unreadable).toMatchObject({ ok: false, error: { code: 'MACHINE_IMPORT_WORKER_FAILED' } });
    expect(vi.getTimerCount()).toBe(0);
  });
});
