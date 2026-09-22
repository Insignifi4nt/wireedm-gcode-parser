import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulationCompileResult } from '@/domain/simulation';
import { compileSimulationAsync } from '../simulationCompiler';
import { CompilationWorker, compilationInput, compiledInput, installCompilationWorker } from './simulationCompilerTestSupport';

describe('local simulation compilation lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); installCompilationWorker(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function expectReleased(worker: CompilationWorker) {
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  }

  it('compiles through a local module worker and frees it after a successful result', async () => {
    const { document, settings } = compilationInput();
    const signal = new AbortController().signal;
    const removeListener = vi.spyOn(signal, 'removeEventListener');
    const result = compiledInput({ document, settings });
    const pending = compileSimulationAsync(document, settings, signal);
    const worker = CompilationWorker.instances[0];
    expect(worker.url.pathname).toContain('/simulationCompiler.worker.ts');
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ document, settings });
    worker.reply(result);
    expect(await pending).toBe(result);
    expectReleased(worker);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('does not start a worker for an already-aborted request', async () => {
    const { document, settings } = compilationInput();
    const reason = new Error('Source already replaced');
    await expect(compileSimulationAsync(document, settings, AbortSignal.abort(reason))).rejects.toBe(reason);
    expect(CompilationWorker.instances).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('terminates pending CPU work immediately on abort and ignores already-queued replies', async () => {
    const { document, settings } = compilationInput();
    const controller = new AbortController();
    const pending = compileSimulationAsync(document, settings, controller.signal);
    const reason = new Error('Source replaced');
    const rejected = expect(pending).rejects.toBe(reason);
    const worker = CompilationWorker.instances[0];
    const lateReply = worker.onmessage;
    const lateError = worker.onerror;
    controller.abort(reason);
    expectReleased(worker);
    // A browser event already queued before terminate must not resolve or dispose twice.
    lateReply?.({ data: compiledInput({ document, settings }) } as MessageEvent<SimulationCompileResult>);
    lateError?.();
    await rejected;
    expectReleased(worker);
  });

  it('terminates a stuck worker at the 60-second limit and accepts no later success', async () => {
    const { document, settings } = compilationInput();
    const pending = compileSimulationAsync(document, settings, new AbortController().signal);
    const worker = CompilationWorker.instances[0];
    const lateReply = worker.onmessage;
    vi.advanceTimersByTime(59_999);
    expect(worker.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(await pending).toMatchObject({ ok: false, diagnostics: [{ code: 'SIMULATION_COMPILE_TIMEOUT' }] });
    lateReply?.({ data: compiledInput({ document, settings }) } as MessageEvent<SimulationCompileResult>);
    expectReleased(worker);
  });

  it.each(['onerror', 'onmessageerror'] as const)('cleans up when the worker reports %s', async event => {
    const { document, settings } = compilationInput();
    const pending = compileSimulationAsync(document, settings, new AbortController().signal);
    const worker = CompilationWorker.instances[0];
    worker[event]?.();
    expect(await pending).toMatchObject({ ok: false, diagnostics: [{ code: 'SIMULATION_WORKER_FAILED' }] });
    expectReleased(worker);
  });

  it('reports constructor failure without leaving a timer or abort listener', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new DOMException('Blocked', 'SecurityError'); } });
    const { document, settings } = compilationInput();
    const signal = new AbortController().signal;
    const addListener = vi.spyOn(signal, 'addEventListener');
    expect(await compileSimulationAsync(document, settings, signal)).toMatchObject({
      ok: false, diagnostics: [{ code: 'SIMULATION_WORKER_UNAVAILABLE' }]
    });
    expect(addListener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('terminates the worker when sending the saved process throws', async () => {
    CompilationWorker.failPost = true;
    const { document, settings } = compilationInput();
    expect(await compileSimulationAsync(document, settings, new AbortController().signal)).toMatchObject({
      ok: false, diagnostics: [{ code: 'SIMULATION_WORKER_FAILED' }]
    });
    expectReleased(CompilationWorker.instances[0]);
  });

  it('uses the real pure compiler without Worker and preserves the saved source', async () => {
    vi.stubGlobal('Worker', undefined);
    const { document, settings } = compilationInput();
    const before = structuredClone({ document, settings });
    const result = await compileSimulationAsync(document, settings, new AbortController().signal);
    expect(result).toEqual(compiledInput({ document, settings }));
    expect({ document, settings }).toEqual(before);
    const incomplete = structuredClone(document);
    delete incomplete.setup;
    expect(await compileSimulationAsync(incomplete, settings, new AbortController().signal)).toMatchObject({ ok: false });
    expect(CompilationWorker.instances).toHaveLength(0);
  });

  it('honors cancellation before the no-Worker fallback begins compiling', async () => {
    vi.stubGlobal('Worker', undefined);
    const { document, settings } = compilationInput();
    const controller = new AbortController();
    const reason = new Error('Settings changed');
    const pending = compileSimulationAsync(document, settings, controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});
