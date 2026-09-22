import { vi } from 'vitest';
import { compileSimulation, type SimulationCompileResult } from '@/domain/simulation';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { defaultSimulationSettings } from '../simulationDefaults';

export class CompilationWorker {
  static instances: CompilationWorker[] = [];
  static failPost = false;
  onmessage: ((event: MessageEvent<SimulationCompileResult>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn(() => { if (CompilationWorker.failPost) throw new DOMException('Cannot clone', 'DataCloneError'); });
  constructor(readonly url: URL, readonly options: WorkerOptions) { CompilationWorker.instances.push(this); }
  reply(data: SimulationCompileResult) { this.onmessage?.({ data } as MessageEvent<SimulationCompileResult>); }
}

export function compilationInput() {
  const document = createUpidFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
  ], { operationOrderStrategy: 'source-order' });
  document.geometryBasis = 'wire-centre';
  document.setup = {
    initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' }
  };
  document.plan.operations[0].transitions = {
    entry: { strategy: 'none', review: 'reviewed' }, exit: { strategy: 'none', review: 'reviewed' }
  };
  return { document, settings: defaultSimulationSettings(document) };
}

export function compiledInput(input = compilationInput()) {
  const result = compileSimulation(input.document, input.settings);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
}

export function installCompilationWorker() {
  CompilationWorker.instances = []; CompilationWorker.failPost = false;
  vi.stubGlobal('Worker', CompilationWorker);
}
