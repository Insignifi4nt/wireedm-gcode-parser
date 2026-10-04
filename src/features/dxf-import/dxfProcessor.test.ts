import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserDxfProcessor, DXF_PROCESSING_TIMEOUT_MS } from './dxfProcessor';
import { runDxfProcessorTask, type DxfProcessorRequest, type DxfProcessorResponse } from './dxfProcessorTask';
import { prepareDxfImportSource, previewDxfProjectImport } from '@/domain/dxf/prepareDxfProjectImport';
import { dxfEntitiesToUpidDocument } from '@/domain/dxf/dxfToUpid';

const preference = { mode: 'fixed', unit: 'millimeters' } as const;
const text = '0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nLINE\r\n8\r\nMatriță 日本\r\n10\r\n0\r\n20\r\n0\r\n11\r\n10\r\n21\r\n0\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n';
const input = { fileName: 'units.dxf', text, now: new Date('2026-10-04T00:00:00Z') };

class DxfWorker {
  static instances: DxfWorker[] = [];
  static failPost = false;
  onmessage: ((event: MessageEvent<DxfProcessorResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn((_request: DxfProcessorRequest) => { if (DxfWorker.failPost) throw new Error('Cannot clone'); });
  constructor(readonly url: URL, readonly options: WorkerOptions) { DxfWorker.instances.push(this); }
  complete() {
    // Worker messages clone data and do not preserve Object.freeze.
    this.onmessage?.({ data: structuredClone(runDxfProcessorTask(this.postMessage.mock.calls[0][0])) } as MessageEvent<DxfProcessorResponse>);
  }
}

describe('cancellable local DXF processing', () => {
  beforeEach(() => { vi.useFakeTimers(); DxfWorker.instances = []; DxfWorker.failPost = false; vi.stubGlobal('Worker', DxfWorker); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  function released(worker: DxfWorker) {
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  }

  it('preserves source, unit interpretations, diagnostics and planned geometry through actual task serialization', async () => {
    const pending = browserDxfProcessor.prepare(preference, input);
    const worker = DxfWorker.instances[0];
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.url.pathname).toContain('/dxfProcessor.worker.ts');
    worker.complete();
    const result = await pending;
    const direct = prepareDxfImportSource(preference, input);
    if (!result.ok || !direct.ok) throw new Error('Fixture preparation failed');
    const { unitPreviews, ...preparation } = result.preparation;
    expect(preparation).toEqual(direct.preparation);
    expect(preparation.text).toBe(text);
    expect(Object.isFrozen(result.preparation.parseResult.entities)).toBe(true);
    for (const candidate of preparation.unitCandidates) {
      expect(unitPreviews?.[candidate.id]).toEqual(previewDxfProjectImport(direct.preparation, { unitCandidateId: candidate.id }));
    }
    released(worker);
    const metadata = { fileName: input.fileName, importedAt: preparation.preparedAt, units: preparation.unitCandidates[0].units };
    const plan = browserDxfProcessor.plan(preparation.parseResult.entities, metadata);
    const planner = DxfWorker.instances[1];
    planner.complete();
    expect(await plan).toEqual(JSON.parse(JSON.stringify(dxfEntitiesToUpidDocument(preparation.parseResult.entities, {}, metadata))));
    released(planner);
  });

  it('retains typed resource rejection through the worker task without partial geometry', async () => {
    const pending = browserDxfProcessor.prepare(preference, { ...input, text: '0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nB\n0\nENDBLK\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nINSERT\n2\nB\n70\n32767\n0\nENDSEC\n0\nEOF\n' });
    DxfWorker.instances[0].complete();
    expect(await pending).toMatchObject({ ok: false, error: { code: 'DXF_IMPORT_RESOURCE_LIMIT' } });
    released(DxfWorker.instances[0]);
  });

  it('starts no worker when already cancelled', async () => {
    const reason = new Error('Replaced');
    await expect(browserDxfProcessor.prepare(preference, input, AbortSignal.abort(reason))).rejects.toBe(reason);
    expect(DxfWorker.instances).toHaveLength(0);
  });

  it.each(['prepare', 'plan'] as const)('terminates %s CPU work on cancellation and ignores a queued reply', async kind => {
    const controller = new AbortController();
    const pending = kind === 'prepare' ? browserDxfProcessor.prepare(preference, input, controller.signal)
      : browserDxfProcessor.plan([], {}, controller.signal);
    const reason = new Error('Cancelled');
    const rejected = expect(pending).rejects.toBe(reason);
    const worker = DxfWorker.instances[0];
    const late = worker.onmessage;
    controller.abort(reason);
    late?.({ data: { ok: false, message: 'Too late' } } as MessageEvent<DxfProcessorResponse>);
    await rejected;
    released(worker);
  });

  it('rejects a stalled worker at its bounded deadline and releases it', async () => {
    const pending = browserDxfProcessor.prepare(preference, input);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'DXF_IMPORT_TIMEOUT' });
    vi.advanceTimersByTime(DXF_PROCESSING_TIMEOUT_MS);
    await rejected;
    released(DxfWorker.instances[0]);
  });

  it.each(['onerror', 'onmessageerror', 'post'] as const)('reports %s failure and releases the worker', async failure => {
    DxfWorker.failPost = failure === 'post';
    const pending = browserDxfProcessor.prepare(preference, input);
    if (failure !== 'post') DxfWorker.instances[0][failure]?.();
    await expect(pending).rejects.toMatchObject({ code: 'DXF_IMPORT_WORKER_FAILED' });
    released(DxfWorker.instances[0]);
  });

  it('reports unavailable workers in browsers without running a blocking fallback', async () => {
    vi.stubGlobal('Worker', undefined);
    await expect(browserDxfProcessor.prepare(preference, input)).rejects.toMatchObject({ code: 'DXF_IMPORT_WORKER_FAILED' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
