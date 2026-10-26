import { createCadSketchSolverRuntime } from './cadSketchSolverRuntime';
import { initializeCadSketchSolverModule, resetCadSketchSolverModule } from './cadSketchSolverModule';
import type { CadSketchSolveInput } from './cadSketchSolverTypes';
import { cadSketchSolverWireResult, isCadSketchSolverEnvelope, type CadSketchSolverWireReply } from './cadSketchSolverProtocol';

const runtime = createCadSketchSolverRuntime(initializeCadSketchSolverModule, { discard: resetCadSketchSolverModule });
let queue = Promise.resolve();
self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const value = event.data;
  if (!isCadSketchSolverEnvelope(value)) return;
  queue = queue.then(async () => {
    let reply: CadSketchSolverWireReply;
    try {
      // The runtime owns input parsing; an invalid graph returns its invalid-input rejection.
      if (value.kind !== 'solve' || !('input' in value)) throw new Error('Invalid sketch solver request.');
      reply = { id: value.id, kind: 'result', result: cadSketchSolverWireResult(await runtime.solve(value.input as CadSketchSolveInput)) };
    } catch (error) { reply = { id: value.id, kind: 'error', message: error instanceof Error ? error.message.slice(0, 8192) : 'Sketch solving failed.' }; }
    try { self.postMessage(reply); }
    catch { self.postMessage({ id: value.id, kind: 'error', message: 'The sketch solver reply could not be sent.' } satisfies CadSketchSolverWireReply); }
  }).catch(() => undefined); // One failed reply must never wedge later requests.
});
