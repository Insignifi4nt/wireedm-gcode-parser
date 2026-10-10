import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageAuthoringRequest, PackageAuthoringResult } from '@/domain/machine-package/packageAuthoringTools';
import { startPackageTool } from './packageToolsClient';

const request: PackageAuthoringRequest = { operation: 'check-post', text: '{}' };
const report: PackageAuthoringResult = {
  report: { ok: true, operation: 'check-post', appVersion: 'existing-app-version', details: { contentHash: 'existing-post-hash' } }
};

class PackageWorker {
  static instances: PackageWorker[] = [];
  static startError: Error | null = null;
  static postError: Error | null = null;
  onmessage: ((event: MessageEvent<PackageAuthoringResult>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn((_request: PackageAuthoringRequest) => {
    if (PackageWorker.postError) throw PackageWorker.postError;
  });
  constructor(readonly url: URL, readonly options: WorkerOptions) {
    if (PackageWorker.startError) throw PackageWorker.startError;
    PackageWorker.instances.push(this);
  }
  reply(result: PackageAuthoringResult) { this.onmessage?.(new MessageEvent('message', { data: result })); }
}

describe('cancellable package worker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    PackageWorker.instances = [];
    PackageWorker.startError = null;
    PackageWorker.postError = null;
    vi.stubGlobal('Worker', PackageWorker);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function expectReleased(worker: PackageWorker) {
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  }

  it.each([true, false])('returns an unchanged report with ok=%s and releases its worker', async ok => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const task = startPackageTool(request, controller.signal);
    const worker = PackageWorker.instances[0];
    const result = { ...report, report: { ...report.report, ok } };
    expect(worker.url.pathname).toContain('/packageTools.worker.ts');
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith(request);
    worker.reply(result);
    expect(await task.result).toBe(result);
    expectReleased(worker);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it.each([false, true])('terminates real work when already-aborted=%s', async alreadyAborted => {
    const controller = new AbortController();
    if (alreadyAborted) controller.abort();
    const task = startPackageTool(request, controller.signal);
    const failed = expect(task.result).rejects.toThrow('Check cancelled.');
    if (!alreadyAborted) controller.abort();
    await failed;
    const worker = PackageWorker.instances[0];
    expect(worker.postMessage).toHaveBeenCalledTimes(alreadyAborted ? 0 : 1);
    expectReleased(worker);
  });

  it('rejects a stalled check at the existing 90-second deadline', async () => {
    const task = startPackageTool(request);
    const failed = expect(task.result).rejects.toThrow('Check timed out. Reduce the package or review its post fixtures.');
    vi.advanceTimersByTime(89_999);
    expect(PackageWorker.instances[0].terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await failed;
    expectReleased(PackageWorker.instances[0]);
  });

  it('retains worker failures and releases the failed check', async () => {
    const task = startPackageTool(request);
    const failed = expect(task.result).rejects.toThrow('The package check could not run. Reload this page and try again.');
    PackageWorker.instances[0].onerror?.();
    await failed;
    expectReleased(PackageWorker.instances[0]);
  });

  it('retains the exact request cloning error and releases the worker', async () => {
    const error = new DOMException('Cannot clone the request', 'DataCloneError');
    PackageWorker.postError = error;
    const task = startPackageTool(request);
    await expect(task.result).rejects.toBe(error);
    expectReleased(PackageWorker.instances[0]);
  });

  it('preserves synchronous startup failures without creating a deadline', () => {
    const error = new Error('Worker unavailable');
    PackageWorker.startError = error;
    expect(() => startPackageTool(request)).toThrow(error);
    expect(PackageWorker.instances).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores repeated cancellation and queued replies after cancellation', async () => {
    const task = startPackageTool(request);
    const worker = PackageWorker.instances[0];
    const queuedReply = worker.onmessage;
    const queuedError = worker.onerror;
    const failed = expect(task.result).rejects.toThrow('Check cancelled.');
    task.cancel();
    task.cancel();
    queuedReply?.(new MessageEvent('message', { data: report }));
    queuedError?.();
    await failed;
    expectReleased(worker);
  });

  it('keeps a completed result when cancellation and queued events arrive later', async () => {
    const controller = new AbortController();
    const task = startPackageTool(request, controller.signal);
    const worker = PackageWorker.instances[0];
    const queuedReply = worker.onmessage;
    const queuedError = worker.onerror;
    worker.reply(report);
    expect(await task.result).toBe(report);
    controller.abort();
    task.cancel();
    queuedReply?.(new MessageEvent('message', { data: { ...report, report: { ...report.report, ok: false } } }));
    queuedError?.();
    vi.advanceTimersByTime(90_000);
    expect(await task.result).toBe(report);
    expectReleased(worker);
  });
});
