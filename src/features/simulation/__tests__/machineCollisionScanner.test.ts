import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMachineCollisionIndex, IDENTITY_MACHINE_PLACEMENT, MACHINE_COLLISION_LIMITATION,
  scanSimulationMachineCollisions } from '@/domain/simulation/machine-import';
import { runMachineCollisionScan, type MachineCollisionScanResponse } from '../machineCollisionScanTask';
import { MACHINE_SCAN_TIMEOUT_MS, scanMachineCollisionsAsync } from '../machineCollisionScanner';
import { CollisionWorker, installCollisionWorker, scanInput } from './machineCollisionScannerTestSupport';

describe('machine collision worker lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); installCollisionWorker(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  function released(worker: CollisionWorker) {
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull(); expect(worker.onerror).toBeNull(); expect(worker.onmessageerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  }

  it('sends source geometry without detaching its buffers and preserves incomplete domain results', async () => {
    const { plan, model } = scanInput();
    const original = model.meshes[0].positions.slice();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = scanMachineCollisionsAsync(plan, model, IDENTITY_MACHINE_PLACEMENT, controller.signal);
    const worker = CollisionWorker.instances[0];
    expect(worker.url.pathname).toContain('/machineCollisionScanner.worker.ts');
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ plan, model, placement: IDENTITY_MACHINE_PLACEMENT });
    const incomplete = await scanSimulationMachineCollisions(plan, createMachineCollisionIndex(model), { maxSweeps: 1 });
    expect(incomplete.complete).toBe(false);
    const response: MachineCollisionScanResponse = { ok: true, result: incomplete };
    worker.reply(response);
    expect(await pending).toBe(response);
    expect(model.meshes[0].positions).toEqual(original);
    expect(incomplete.limitations).toContain(MACHINE_COLLISION_LIMITATION);
    released(worker);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('terminates placement or indexing on cancellation and ignores already-queued results', async () => {
    const { plan, model } = scanInput();
    const controller = new AbortController();
    const reason = new Error('Placement replaced');
    const pending = scanMachineCollisionsAsync(plan, model, IDENTITY_MACHINE_PLACEMENT, controller.signal);
    const rejected = expect(pending).rejects.toBe(reason);
    const worker = CollisionWorker.instances[0];
    const queued = worker.onmessage;
    controller.abort(reason);
    released(worker);
    queued?.({ data: { ok: false, message: 'Old worker failure' } } as MessageEvent<MachineCollisionScanResponse>);
    await rejected;
    released(worker);
    await expect(scanMachineCollisionsAsync(plan, model, IDENTITY_MACHINE_PLACEMENT, controller.signal)).rejects.toBe(reason);
    expect(CollisionWorker.instances).toHaveLength(1);
  });

  it('caps all worker phases and reports timeout as incomplete with unavailable partial results', async () => {
    const { plan, model } = scanInput();
    const pending = scanMachineCollisionsAsync(plan, model, IDENTITY_MACHINE_PLACEMENT, new AbortController().signal);
    const worker = CollisionWorker.instances[0];
    vi.advanceTimersByTime(MACHINE_SCAN_TIMEOUT_MS - 1);
    expect(worker.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    const response = await pending;
    expect(response).toMatchObject({ ok: true, result: { complete: false, cancelled: false, checkedSweeps: 0, testedTriangles: 0, warnings: [] } });
    if (!response.ok) throw new Error('Expected an incomplete scan');
    expect(response.result.message).toContain('60-second limit');
    expect(response.result.limitations).toContain(MACHINE_COLLISION_LIMITATION);
    expect(response.result.limitations.join(' ')).toContain('Partial contacts and checked-geometry counts are unavailable');
    released(worker);
  });

  it.each(['onerror', 'onmessageerror'] as const)('reports %s without claiming a clear machine', async event => {
    const { plan, model } = scanInput();
    const pending = scanMachineCollisionsAsync(plan, model, IDENTITY_MACHINE_PLACEMENT, new AbortController().signal);
    const worker = CollisionWorker.instances[0];
    worker[event]?.();
    expect(await pending).toMatchObject({ ok: false, message: expect.stringContaining('No clearance was verified') });
    released(worker);
  });

  it('cleans up message-copy failures and reports constructor failure without a timer', async () => {
    const { plan, model } = scanInput();
    CollisionWorker.failPost = true;
    expect(await scanMachineCollisionsAsync(plan, model, IDENTITY_MACHINE_PLACEMENT, new AbortController().signal)).toMatchObject({ ok: false });
    released(CollisionWorker.instances[0]);
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Worker blocked'); } });
    expect(await scanMachineCollisionsAsync(plan, model, IDENTITY_MACHINE_PLACEMENT, new AbortController().signal)).toMatchObject({
      ok: false, message: expect.stringContaining('could not start')
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs real placement, indexing and intersections without Worker while preserving source geometry', async () => {
    vi.stubGlobal('Worker', undefined);
    const { plan, model } = scanInput();
    const original = JSON.stringify(model);
    const response = await scanMachineCollisionsAsync(plan, model, IDENTITY_MACHINE_PLACEMENT, new AbortController().signal);
    expect(response).toMatchObject({ ok: true, result: { complete: true, warnings: [{ meshId: model.meshes[0].id, elapsedSeconds: 1 }] } });
    const translated = await scanMachineCollisionsAsync(plan, model, { translationMm: [20, 0, 0], rotationZDegrees: 0 }, new AbortController().signal);
    expect(translated).toMatchObject({ ok: true, result: { complete: true, warnings: [] } });
    expect(JSON.stringify(model)).toBe(original);
    expect(CollisionWorker.instances).toHaveLength(0);
  });

  it('retains invalid-placement errors and cancels fallback before any geometry work', async () => {
    vi.stubGlobal('Worker', undefined);
    const { plan, model } = scanInput();
    expect(await runMachineCollisionScan({ plan, model, placement: { translationMm: [NaN, 0, 0], rotationZDegrees: 0 } })).toMatchObject({
      ok: false, message: expect.stringContaining('finite millimetre coordinates')
    });
    const controller = new AbortController();
    const pending = scanMachineCollisionsAsync(plan, model, IDENTITY_MACHINE_PLACEMENT, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
