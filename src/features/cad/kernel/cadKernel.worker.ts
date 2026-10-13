import initOpenCascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { setOC } from 'replicad';
import { parseCadDocument } from '../../../domain/cad/cadSchema';
import { parseCadSectionRequest } from '../../../domain/cad/cadSection';
import { buildCadKernelModel, type CadKernelModel } from './cadKernelModel';
import { isCadKernelEnvelope, type CadKernelReply } from './cadKernelProtocol';

// This entire module is only loaded after the first explicit CAD operation.
let initialized: Promise<void> | undefined;
let cached: { key: string; model: CadKernelModel } | undefined;
function initialize() {
  initialized ??= initOpenCascade({ locateFile: () => wasmUrl, print: () => undefined, printErr: () => undefined }).then(setOC);
  return initialized;
}
let queue = Promise.resolve();
self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isCadKernelEnvelope(request)) return;
  queue = queue.then(async () => {
    let reply: CadKernelReply;
    try {
      if (request.kind !== 'build' && request.kind !== 'export' && request.kind !== 'section') throw new Error('Unsupported CAD worker operation.');
      if (request.kind === 'export' && request.format !== 'step' && request.format !== 'stl') throw new Error('Unsupported CAD export format.');
      const document = parseCadDocument(request.document);
      await initialize();
      const key = JSON.stringify(document);
      if (!cached || cached.key !== key) {
        cached?.model.dispose(); cached = undefined;
        cached = { key, model: buildCadKernelModel(document) };
      }
      switch (request.kind) {
        case 'build': reply = { id: request.id, kind: 'built', result: cached.model.result }; break;
        case 'export': reply = { id: request.id, kind: 'exported', blob: cached.model.export(request.format === 'step' ? 'step' : 'stl') }; break;
        case 'section': reply = { id: request.id, kind: 'sectioned', result: cached.model.section(parseCadSectionRequest(request.section)) }; break;
        default: throw new Error('Unsupported CAD worker operation.');
      }
    } catch (error) {
      reply = { id: request.id, kind: 'error', message: error instanceof Error ? error.message : 'The CAD kernel could not complete this operation.' };
    }
    self.postMessage(reply);
  });
});
