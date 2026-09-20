/// <reference lib="webworker" />
import { compileSimulation } from '@/domain/simulation';
import type { SimulationCompileRequest } from './simulationCompiler';

self.onmessage = (event: MessageEvent<SimulationCompileRequest>) => {
  try { self.postMessage(compileSimulation(event.data.document, event.data.settings)); }
  catch { self.postMessage({ ok: false, diagnostics: [{ code: 'SIMULATION_COMPILE_FAILED', severity: 'error', operationId: null,
    message: 'The saved process could not be compiled for simulation. Review its geometry and machining intent.' }] }); }
};
