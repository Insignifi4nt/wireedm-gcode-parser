import { createCadSketchSolverRuntime } from './cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from './cadSketchSolverModule';
import { isCadSketchSolverEnvelope, parseCadSketchSolverRequest, type CadSketchSolverReply } from './cadSketchSolverProtocol';

const runtime = createCadSketchSolverRuntime(initializeCadSketchSolverModule);
let queue = Promise.resolve();
self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const value = event.data;
  if (!isCadSketchSolverEnvelope(value)) return;
  queue = queue.then(async () => {
    let reply: CadSketchSolverReply;
    try {
      const request = parseCadSketchSolverRequest(value);
      reply = { id: request.id, kind: 'result', result: await runtime.solve(request.input) };
    } catch (error) { reply = { id: value.id, kind: 'error', message: error instanceof Error ? error.message.slice(0, 8192) : 'Sketch solving failed.' }; }
    self.postMessage(reply);
  });
});
