import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MACHINE_IMPORT_LIMITS, machineImportFailure } from '@/domain/simulation/machine-import/model';
import { importMachineModel } from './importMachineModel';
import type { MachineImportWorkerResponse } from './protocol';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent<MachineImportWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { TestWorker.instances.push(this); }
  send(data: MachineImportWorkerResponse) { this.onmessage?.({ data } as MessageEvent<MachineImportWorkerResponse>); }
}

describe('local machine import lifecycle', () => {
  beforeEach(() => { TestWorker.instances = []; vi.stubGlobal('Worker', TestWorker); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

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
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
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
    TestWorker.instances[2].onmessageerror?.();
    expect(await unreadable).toMatchObject({ ok: false, error: { code: 'MACHINE_IMPORT_WORKER_FAILED' } });
    expect(vi.getTimerCount()).toBe(0);
  });
});
