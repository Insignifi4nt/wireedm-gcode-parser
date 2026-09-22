import { compileSimulation, type SimulationCompileResult, type SimulationSettings } from '@/domain/simulation';
import type { PathPlanningDocument } from '@/domain/path-intel/types';

export interface SimulationCompileRequest { document: PathPlanningDocument; settings: SimulationSettings }
const failure = (code: string, message: string): SimulationCompileResult => ({ ok: false,
  diagnostics: [{ code, message, severity: 'error', operationId: null }] });

/** Every compilation owns a disposable worker; changing source/settings cancels CPU work as well as its reply. */
export function compileSimulationAsync(document: PathPlanningDocument, settings: SimulationSettings, signal: AbortSignal): Promise<SimulationCompileResult> {
  if (signal.aborted) return Promise.reject(signal.reason);
  // This pure fallback also serves non-browser clients and the domain/UI test environment.
  if (typeof Worker === 'undefined') return Promise.resolve().then(() => {
    signal.throwIfAborted(); return compileSimulation(document, settings);
  });
  let worker: Worker;
  try { worker = new Worker(new URL('./simulationCompiler.worker.ts', import.meta.url), { type: 'module' }); }
  catch { return Promise.resolve(failure('SIMULATION_WORKER_UNAVAILABLE', 'The browser could not start the local simulation worker. Reload the app and try again.')); }
  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      clearTimeout(timeout); signal.removeEventListener('abort', abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate();
    };
    const finish = (result: SimulationCompileResult) => { if (finished) return; finished = true; cleanup(); resolve(result); };
    const abort = () => { if (finished) return; finished = true; cleanup(); reject(signal.reason); };
    const timeout = setTimeout(() => finish(failure('SIMULATION_COMPILE_TIMEOUT',
      'Simulation preparation reached its 60-second limit. Reduce the active geometry or try a simpler process.')), 60_000);
    worker.onmessage = (event: MessageEvent<SimulationCompileResult>) => finish(event.data);
    worker.onerror = worker.onmessageerror = () => finish(failure('SIMULATION_WORKER_FAILED',
      'The local simulation worker stopped unexpectedly. Try the process again.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try { worker.postMessage({ document, settings } satisfies SimulationCompileRequest); }
    catch { finish(failure('SIMULATION_WORKER_FAILED', 'The saved process could not be sent to the simulation worker.')); }
  });
}
