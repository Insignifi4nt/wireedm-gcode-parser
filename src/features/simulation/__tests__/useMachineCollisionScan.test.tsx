import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulationPlan } from '@/domain/simulation';
import { IDENTITY_MACHINE_PLACEMENT, type MachineModel } from '@/domain/simulation/machine-import';
import { runMachineCollisionScan, type MachineCollisionScanResponse } from '../machineCollisionScanTask';
import { useMachineCollisionScan } from '../useMachineCollisionScan';
import { CollisionWorker, installCollisionWorker, scanInput } from './machineCollisionScannerTestSupport';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Input = { plan: SimulationPlan | null; model: MachineModel | null; placement: ReturnType<typeof scanInput>['placement'] };

describe('machine surface scan source lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;
  let current: ReturnType<typeof useMachineCollisionScan>;
  let renders: ReturnType<typeof useMachineCollisionScan>[];
  function Probe({ plan, model, placement }: Input) {
    current = useMachineCollisionScan(plan, model, placement); renders.push(current);
    return <span>{current.status}</span>;
  }
  async function render(input: Input) { await act(async () => { root.render(<Probe {...input} />); }); }
  beforeEach(() => {
    installCollisionWorker(); container = document.createElement('div'); document.body.append(container);
    root = createRoot(container); renders = [];
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it.each(['plan', 'model', 'placement'] as const)('terminates CPU work when %s changes and rejects stale replies', async changed => {
    const input = scanInput();
    await render(input);
    const old = CollisionWorker.instances[0];
    const queued = old.onmessage;
    const next = { ...input, [changed]: changed === 'placement' ? { ...input.placement, x: 20 } : structuredClone(input[changed]) };
    await render(next);
    expect(old.terminate).toHaveBeenCalledOnce();
    expect(current.status).toBe('scanning');
    const response = await runMachineCollisionScan({ plan: next.plan, model: next.model, placement: {
      translationMm: [next.placement.x, next.placement.y, next.placement.z], rotationZDegrees: next.placement.rotation
    } });
    await act(async () => { CollisionWorker.instances[1].reply(response); });
    expect(current.status).toBe('ready');
    const result = current;
    const renderCount = renders.length;
    await act(async () => { queued?.({ data: { ok: false, message: 'Old failure' } } as MessageEvent<MachineCollisionScanResponse>); });
    expect(current).toBe(result);
    expect(renders).toHaveLength(renderCount);
  });

  it('hides completed findings immediately on placement change and clears them when the model is removed', async () => {
    const input = scanInput();
    await render(input);
    const response = await runMachineCollisionScan({ ...input, placement: IDENTITY_MACHINE_PLACEMENT });
    await act(async () => { CollisionWorker.instances[0].reply(response); });
    expect(current.status).toBe('ready');
    renders = [];
    await render({ ...input, placement: { ...input.placement, x: 20 } });
    expect(renders.every(state => state.status === 'scanning')).toBe(true);
    await render({ ...input, model: null });
    expect(current.status).toBe('idle');
    expect(CollisionWorker.instances[1].terminate).toHaveBeenCalledOnce();
    expect(CollisionWorker.instances).toHaveLength(2);
  });

  it('presents worker failure as an error and starts a new scan after source replacement', async () => {
    const input = scanInput();
    await render(input);
    await act(async () => { CollisionWorker.instances[0].onerror?.(); });
    expect(current).toMatchObject({ status: 'error', message: expect.stringContaining('No clearance was verified') });
    await render(input);
    expect(CollisionWorker.instances).toHaveLength(1);
    await render({ ...input, plan: structuredClone(input.plan) });
    expect(current.status).toBe('scanning');
    expect(CollisionWorker.instances).toHaveLength(2);
  });

  it('does no work without a compiled source and terminates a pending scan on unmount', async () => {
    const input = scanInput();
    await render({ ...input, plan: null });
    expect(current.status).toBe('idle');
    expect(CollisionWorker.instances).toHaveLength(0);
    await render(input);
    const worker = CollisionWorker.instances[0];
    const queued = worker.onmessage;
    await act(async () => { root.render(null); });
    expect(worker.terminate).toHaveBeenCalledOnce();
    const renderCount = renders.length;
    await act(async () => { queued?.({ data: { ok: false, message: 'Old failure' } } as MessageEvent<MachineCollisionScanResponse>); });
    expect(renders).toHaveLength(renderCount);
  });
});
