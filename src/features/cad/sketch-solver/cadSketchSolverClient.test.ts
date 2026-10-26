// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { parseCadSketchGraph } from '../../../domain/cad/cadSketchGraph';
import { CAD_SKETCH_SOLVE_TIMEOUT_MS, createCadSketchSolverClient, type CadSketchSolverTransport } from './cadSketchSolverClient';
import { cadSketchSolverWireResult, type CadSketchSolverRequest } from './cadSketchSolverProtocol';
import type { CadSketchSolveResult } from './cadSketchSolverTypes';

class Transport implements CadSketchSolverTransport {
  onmessage: CadSketchSolverTransport['onmessage'] = null;
  onerror: CadSketchSolverTransport['onerror'] = null;
  onmessageerror: CadSketchSolverTransport['onmessageerror'] = null;
  messages: CadSketchSolverRequest[] = [];
  terminated = false;
  postMessage(message: CadSketchSolverRequest) { this.messages.push(message); }
  terminate() { this.terminated = true; }
}
const graph = parseCadSketchGraph({ points: [{ id: 'point', position: [0, 0] }], entities: [], relations: [] });
const result: CadSketchSolveResult = { kind: 'solved', graph, diagnostics: { status: 'success', degreesOfFreedom: 2, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] } };
// The worker sends solved values; the client rebuilds the graph from its own request.
const reply = cadSketchSolverWireResult(result);

describe('sketch solver worker lifetime', () => {
  it('starts lazily, cancels an active solve without terminating the warm worker, and drops its stale reply', async () => {
    const transports: Transport[] = [], client = createCadSketchSolverClient(() => { const worker = new Transport(); transports.push(worker); return worker; });
    expect(transports).toHaveLength(0);
    const signal = new AbortController(), canceled = client.solve({ graph, parameters: {} }, signal.signal);
    const rejected = expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
    signal.abort(); await rejected;
    expect(transports).toHaveLength(1); expect(transports[0].terminated).toBe(false);
    const next = client.solve({ graph, parameters: {} });
    // The canceled request still owns the single in-flight slot until its reply arrives.
    expect(transports[0].messages.map(message => message.id)).toEqual([1]);
    transports[0].onmessage?.(new MessageEvent('message', { data: { id: 1, kind: 'result', result: reply } }));
    expect(transports[0].messages.map(message => message.id)).toEqual([1, 2]);
    transports[0].onmessage?.(new MessageEvent('message', { data: { id: 1, kind: 'result', result: reply } }));
    transports[0].onmessage?.(new MessageEvent('message', { data: { id: 2, kind: 'result', result: reply } }));
    expect(await next).toEqual(result); expect(transports).toHaveLength(1); expect(transports[0].terminated).toBe(false);
    client.dispose(); expect(transports[0].terminated).toBe(true);
  });
  it('still terminates a canceled solve that later exceeds its time limit', async () => {
    vi.useFakeTimers();
    const workers: Transport[] = [], client = createCadSketchSolverClient(() => { const worker = new Transport(); workers.push(worker); return worker; });
    try {
      const controller = new AbortController(), pending = client.solve({ graph, parameters: {} }, controller.signal);
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      controller.abort(); await rejected;
      await vi.advanceTimersByTimeAsync(CAD_SKETCH_SOLVE_TIMEOUT_MS);
      expect(workers[0].terminated).toBe(true); expect(vi.getTimerCount()).toBe(0);
    } finally { client.dispose(); vi.useRealTimers(); }
  });
  it('bounds queued work and rejects every outstanding request on disposal', async () => {
    const worker = new Transport(), client = createCadSketchSolverClient(() => worker);
    const pending = Array.from({ length: 5 }, () => client.solve({ graph, parameters: {} }));
    await expect(client.solve({ graph, parameters: {} })).rejects.toThrow('queue is full');
    expect(worker.messages).toHaveLength(1);
    client.dispose();
    const settled = await Promise.allSettled(pending);
    expect(settled.every(result => result.status === 'rejected' && result.reason instanceof Error && result.reason.name === 'AbortError')).toBe(true);
    expect(worker.terminated).toBe(true);
    await expect(client.solve({ graph, parameters: {} })).rejects.toThrow('disposed');
  });
  it('terminates a timed-out worker and only retries through a new explicit request', async () => {
    vi.useFakeTimers();
    const workers: Transport[] = [], client = createCadSketchSolverClient(() => { const worker = new Transport(); workers.push(worker); return worker; });
    try {
      const pending = client.solve({ graph, parameters: {} }), rejected = expect(pending).rejects.toThrow('time limit');
      await vi.advanceTimersByTimeAsync(CAD_SKETCH_SOLVE_TIMEOUT_MS); await rejected;
      expect(workers).toHaveLength(1); expect(workers[0].terminated).toBe(true);
      const retry = client.solve({ graph, parameters: {} });
      workers[1].onmessage?.(new MessageEvent('message', { data: { id: 2, kind: 'result', result: reply } }));
      expect(await retry).toEqual(result); expect(vi.getTimerCount()).toBe(0);
    } finally { client.dispose(); vi.useRealTimers(); }
  });
  it('rejects values for a changed expression driver at the worker boundary and restarts after worker errors', async () => {
    const workers: Transport[] = [], client = createCadSketchSolverClient(() => { const worker = new Transport(); workers.push(worker); return worker; });
    const driven = parseCadSketchGraph({ ...graph, points: [{ id: 'point', position: ['x', 0] }] });
    const pending = client.solve({ graph: driven, parameters: { x: 4 } }), rejected = expect(pending).rejects.toThrow('does not match');
    workers[0].onmessage?.(new MessageEvent('message', { data: { id: 1, kind: 'result', result: { ...reply, values: [4, 0] } } }));
    await rejected; expect(workers[0].terminated).toBe(true);
    const retry = client.solve({ graph, parameters: {} }), stopped = expect(retry).rejects.toThrow('worker stopped');
    workers[1].onerror?.(Object.assign(new Event('error'), { message: 'stopped', filename: '', lineno: 0, colno: 0, error: new Error('stopped') })); await stopped;
    expect(workers).toHaveLength(2); expect(workers[1].terminated).toBe(true);
    client.dispose();
  });
  it('cancels a waiting solve without disturbing the active worker', async () => {
    const worker = new Transport(), client = createCadSketchSolverClient(() => worker);
    const active = client.solve({ graph, parameters: {} });
    const controller = new AbortController(), waiting = client.solve({ graph, parameters: {} }, controller.signal);
    const canceled = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await canceled;
    expect(worker.terminated).toBe(false); expect(worker.messages).toHaveLength(1);
    worker.onmessage?.(new MessageEvent('message', { data: { id: 1, kind: 'result', result: reply } }));
    expect(await active).toEqual(result); client.dispose();
  });
});
