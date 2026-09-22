import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulationCompileResult } from '@/domain/simulation';
import { useSimulationPlan } from '../useSimulationPlan';
import { CompilationWorker, compilationInput, compiledInput, installCompilationWorker } from './simulationCompilerTestSupport';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('simulation compilation source lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;
  let current: ReturnType<typeof useSimulationPlan>;
  let renders: (SimulationCompileResult | null)[];
  function Probe({ document, settings }: ReturnType<typeof compilationInput>) {
    current = useSimulationPlan(document, settings);
    renders.push(current.result);
    return <span>{current.result === null ? 'preparing' : current.result.ok ? 'ready' : 'failed'}</span>;
  }
  async function render(input: ReturnType<typeof compilationInput>) {
    await act(async () => { root.render(<Probe {...input} />); });
  }
  beforeEach(() => {
    installCompilationWorker();
    container = document.createElement('div'); document.body.append(container);
    root = createRoot(container); renders = [];
  });
  afterEach(() => {
    act(() => root.unmount()); container.remove();
    vi.unstubAllGlobals(); vi.restoreAllMocks();
  });

  it.each(['document', 'settings'] as const)('terminates the old worker on %s changes and ignores its queued reply', async changed => {
    const firstInput = compilationInput();
    await render(firstInput);
    const first = CompilationWorker.instances[0];
    const lateReply = first.onmessage;
    const nextInput = changed === 'document'
      ? { ...firstInput, document: structuredClone(firstInput.document) }
      : { ...firstInput, settings: { ...firstInput.settings, cutSpeedMmPerSecond: 12 } };
    await render(nextInput);
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(CompilationWorker.instances).toHaveLength(2);
    expect(current.result).toBeNull();
    const currentResult = compiledInput(nextInput);
    await act(async () => { CompilationWorker.instances[1].reply(currentResult); });
    expect(current.result).toBe(currentResult);
    const renderCount = renders.length;
    await act(async () => {
      lateReply?.({ data: compiledInput(firstInput) } as MessageEvent<SimulationCompileResult>);
    });
    expect(current.result).toBe(currentResult);
    expect(renders).toHaveLength(renderCount);
    expect(first.terminate).toHaveBeenCalledOnce();
  });

  it('hides an already-completed plan on the first render for different settings', async () => {
    const input = compilationInput();
    await render(input);
    await act(async () => { CompilationWorker.instances[0].reply(compiledInput(input)); });
    expect(current.result?.ok).toBe(true);
    renders = [];
    await render({ ...input, settings: { ...input.settings, rapidSpeedMmPerSecond: 50 } });
    // Even before the replacement effect runs, the saved result belongs to different inputs.
    expect(renders.length).toBeGreaterThan(0);
    expect(renders.every(result => result === null)).toBe(true);
    expect(container.textContent).toBe('preparing');
  });

  it('keeps a completed plan on unchanged references and retries a failed request with a fresh worker', async () => {
    const input = compilationInput();
    await render(input);
    await act(async () => { CompilationWorker.instances[0].onerror?.(); });
    expect(current.result).toMatchObject({ ok: false, diagnostics: [{ code: 'SIMULATION_WORKER_FAILED' }] });
    await render(input);
    expect(CompilationWorker.instances).toHaveLength(1);
    await act(async () => { current.retry(); });
    expect(current.result).toBeNull();
    expect(CompilationWorker.instances).toHaveLength(2);
    const result = compiledInput(input);
    await act(async () => { CompilationWorker.instances[1].reply(result); });
    expect(current.result).toBe(result);
    await render(input);
    expect(current.result).toBe(result);
    expect(CompilationWorker.instances).toHaveLength(2);
  });

  it('terminates in-progress work on unmount and does not consume a late result', async () => {
    const input = compilationInput();
    await render(input);
    const worker = CompilationWorker.instances[0];
    const lateReply = worker.onmessage;
    const renderCount = renders.length;
    await act(async () => { root.render(null); });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    await act(async () => { lateReply?.({ data: compiledInput(input) } as MessageEvent<SimulationCompileResult>); });
    expect(renders).toHaveLength(renderCount);
    expect(container.textContent).toBe('');
  });
});
