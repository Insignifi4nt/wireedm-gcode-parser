import { compileSimulation, type SimulationCompileResult, type SimulationSettings } from '@/domain/simulation';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import { startOwnedWorkerTask } from '@/lib/ownedWorkerTask';

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
  return startOwnedWorkerTask<SimulationCompileResult, SimulationCompileResult>({
    worker, request: { document, settings } satisfies SimulationCompileRequest, signal, timeoutMs: 60_000,
    receive: response => ({ kind: 'complete', value: response }),
    failure(cause) {
      if (cause.kind === 'abort') throw cause.reason;
      if (cause.kind === 'timeout') return failure('SIMULATION_COMPILE_TIMEOUT',
        'Simulation preparation reached its 60-second limit. Reduce the active geometry or try a simpler process.');
      return failure('SIMULATION_WORKER_FAILED', cause.kind === 'post-error'
        ? 'The saved process could not be sent to the simulation worker.'
        : 'The local simulation worker stopped unexpectedly. Try the process again.');
    }
  }).result;
}
