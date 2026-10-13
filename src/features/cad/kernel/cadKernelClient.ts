import type { CadBuildResult, CadDocument } from '../../../domain/cad/cadDocument';
import { parseCadDocument } from '../../../domain/cad/cadSchema';
import { parseCadSectionRequest, type CadSectionRequest, type CadSectionResult } from '../../../domain/cad/cadSection';
import { isCadKernelReply, type CadKernelReply, type CadKernelRequest } from './cadKernelProtocol';

export interface CadKernelClient {
  build(document: CadDocument, signal?: AbortSignal): Promise<CadBuildResult>;
  export(document: CadDocument, format: 'step' | 'stl', signal?: AbortSignal): Promise<Blob>;
  section(document: CadDocument, request: CadSectionRequest, signal?: AbortSignal): Promise<CadSectionResult>;
  dispose(): void;
}
export interface CadWorkerTransport {
  postMessage(message: CadKernelRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}
interface PendingJob {
  request: CadKernelRequest;
  resolve(reply: CadKernelReply): void;
  reject(error: Error): void;
  cleanup(): void;
}
type CadKernelCommand = Omit<Extract<CadKernelRequest, { kind: 'build' }>, 'id'> | Omit<Extract<CadKernelRequest, { kind: 'export' }>, 'id'> | Omit<Extract<CadKernelRequest, { kind: 'section' }>, 'id'>;
const abortError = () => new DOMException('CAD operation canceled.', 'AbortError');

/** A single finite queue bounds kernel memory; active cancellation terminates WASM. */
export function createCadKernelClient(makeWorker: () => CadWorkerTransport = () => new Worker(new URL('./cadKernel.worker.ts', import.meta.url), { type: 'module', name: 'wireedm-cad-kernel' })): CadKernelClient {
  let worker: CadWorkerTransport | undefined;
  let active: PendingJob | undefined;
  const queue: PendingJob[] = [];
  let disposed = false;
  let id = 0;
  let jobs = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  function terminate() { if (deadline) clearTimeout(deadline); deadline = undefined; worker?.terminate(); worker = undefined; jobs = 0; }
  function finish(reply: CadKernelReply | Error) {
    const job = active;
    if (!job) return;
    active = undefined;
    if (deadline) clearTimeout(deadline); deadline = undefined;
    job.cleanup();
    if ('kind' in reply) job.resolve(reply); else job.reject(reply);
    if (++jobs >= 16) terminate();
    pump();
  }
  function fail(error: Error) { terminate(); finish(error); }
  function pump() {
    if (disposed || active || !queue.length) return;
    active = queue.shift();
    if (!active) return;
    try {
      if (!worker) {
        const transport = makeWorker(); worker = transport;
        transport.onmessage = event => {
          if (worker !== transport) return;
          if (!isCadKernelReply(event.data)) { fail(new Error('Invalid CAD worker response.')); return; }
          if (event.data.id !== active?.request.id) return; // A stale worker can never overwrite a newer request.
          finish(event.data.kind === 'error' ? new Error(event.data.message) : event.data);
        };
        transport.onerror = () => { if (worker === transport) fail(new Error('The CAD worker stopped. Retry the operation to restart it.')); };
        transport.onmessageerror = () => { if (worker === transport) fail(new Error('The CAD worker response could not be read.')); };
      }
      deadline = setTimeout(() => fail(new Error('The CAD operation exceeded two minutes. Simplify the model and retry.')), 120_000);
      worker.postMessage(active.request);
    } catch (error) { fail(error instanceof Error ? error : new Error('Unable to start the CAD worker.')); }
  }
  function request(command: CadKernelCommand, signal?: AbortSignal): Promise<CadKernelReply> {
    if (disposed) return Promise.reject(new Error('CAD kernel client has been disposed.'));
    if (signal?.aborted) return Promise.reject(abortError());
    if (queue.length >= 4) return Promise.reject(new Error('The CAD queue is full. Wait for the current operations to finish.'));
    const document = structuredClone(parseCadDocument(command.document));
    return new Promise((resolve, reject) => {
      const payload: CadKernelRequest = { ...command, id: ++id, document };
      const job: PendingJob = { request: payload, resolve, reject, cleanup: () => signal?.removeEventListener('abort', cancel) };
      const cancel = () => {
        if (active === job) { fail(abortError()); return; }
        const index = queue.indexOf(job);
        if (index >= 0) { queue.splice(index, 1); job.cleanup(); job.reject(abortError()); }
      };
      signal?.addEventListener('abort', cancel, { once: true });
      queue.push(job); pump();
    });
  }
  return {
    async build(document, signal) {
      const reply = await request({ kind: 'build', document }, signal);
      if (reply.kind !== 'built') throw new Error('Unexpected CAD build response.');
      return reply.result;
    },
    async export(document, format, signal) {
      const reply = await request({ kind: 'export', document, format }, signal);
      if (reply.kind !== 'exported') throw new Error('Unexpected CAD export response.');
      return reply.blob;
    },
    async section(document, section, signal) {
      const reply = await request({ kind: 'section', document, section: structuredClone(parseCadSectionRequest(section)) }, signal);
      if (reply.kind !== 'sectioned') throw new Error('Unexpected CAD section response.');
      return reply.result;
    },
    dispose() {
      if (disposed) return;
      disposed = true; terminate();
      if (active) { active.cleanup(); active.reject(abortError()); active = undefined; }
      for (const job of queue.splice(0)) { job.cleanup(); job.reject(abortError()); }
    }
  };
}
