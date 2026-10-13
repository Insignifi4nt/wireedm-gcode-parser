// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { importCadDxfSketch } from '../../../domain/cad/cadDxfImport';
import { cadSolidImportBytes, type CadSolidImportSource } from '../../../domain/cad/cadImports';
import { createCadKernelClient, type CadWorkerTransport } from './cadKernelClient';
import { createCadKernelRuntime } from './cadKernelRuntime';
import { isCadKernelReply, type CadKernelRequest } from './cadKernelProtocol';

const input = { fileName: 'original.dxf', sketchId: 'imported', name: 'Original', text: [
  '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES', '0', 'CIRCLE', '8', 'source', '10', '3', '20', '4', '40', '2', '0', 'ENDSEC', '0', 'EOF', '',
].join('\n') };
class ImportTransport implements CadWorkerTransport {
  onmessage: CadWorkerTransport['onmessage'] = null;
  onerror: CadWorkerTransport['onerror'] = null;
  onmessageerror: CadWorkerTransport['onmessageerror'] = null;
  messages: CadKernelRequest[] = [];
  terminated = false;
  postMessage(message: CadKernelRequest) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(data: unknown) { this.onmessage?.(new MessageEvent('message', { data })); }
}

describe('CAD import worker boundaries', () => {
  it('imports an exact editable DXF on a cold worker without initializing WASM', async () => {
    let initialized = 0;
    const runtime = createCadKernelRuntime(async () => { ++initialized; throw new Error('WASM must not initialize'); });
    try {
      const reply = await runtime.evaluate({ id: 1, kind: 'import-dxf', input });
      expect(reply.kind).toBe('dxf-imported'); expect(isCadKernelReply(reply)).toBe(true);
      if (reply.kind !== 'dxf-imported') throw new Error('Expected DXF import');
      expect(reply.result).toMatchObject({ contourCount: 1, sourceEntityCount: 1, scaleToMillimeters: 1,
        sketch: { id: 'imported', name: 'Original', source: { text: input.text, fileName: input.fileName } } });
      expect(await runtime.evaluate({ id: 2, kind: 'import-dxf', input: { ...input, units: 'inch' } })).toMatchObject({ kind: 'error', code: 'dxf-units-conflict' });
      expect(await runtime.evaluate({ id: 3, kind: 'import-dxf', input: { ...input, unexpected: true } })).toMatchObject({ kind: 'error' });
      expect(initialized).toBe(0);
    } finally { runtime.dispose(); }
  });
  it('copies DXF input, verifies exact source identity, and rejects a well-formed reply for another source', async () => {
    const transport = new ImportTransport(); const client = createCadKernelClient(() => transport);
    const changed = { ...input }; const pending = client.importDxf(changed); changed.text = 'changed after submit';
    expect(transport.messages[0]).toMatchObject({ kind: 'import-dxf', input });
    transport.reply({ id: 1, kind: 'dxf-imported', result: importCadDxfSketch(input) });
    expect((await pending).sketch.source?.text).toBe(input.text);
    const mismatch = client.importDxf(input); const rejected = expect(mismatch).rejects.toThrow('does not match');
    transport.reply({ id: 2, kind: 'dxf-imported', result: importCadDxfSketch({ ...input, fileName: 'another.dxf' }) });
    await rejected; expect(transport.terminated).toBe(true); client.dispose();
  });
  it('terminates active DXF import and ignores its late result after starting the queued import', async () => {
    const transports: ImportTransport[] = [];
    const client = createCadKernelClient(() => { const transport = new ImportTransport(); transports.push(transport); return transport; });
    const abort = new AbortController(); const canceled = client.importDxf(input, abort.signal);
    const rejected = expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
    const next = client.importDxf(input); abort.abort(); await rejected;
    expect(transports[0].terminated).toBe(true); expect(transports).toHaveLength(2);
    const result = importCadDxfSketch(input);
    transports[0].reply({ id: 1, kind: 'dxf-imported', result });
    transports[1].reply({ id: 1, kind: 'dxf-imported', result });
    transports[1].reply({ id: 2, kind: 'dxf-imported', result });
    expect((await next).sketch.id).toBe('imported'); client.dispose();
  });
  it('checks solid-import identity and cancels native imports through the same finite queue', async () => {
    const transport = new ImportTransport(); const client = createCadKernelClient(() => transport);
    const source: CadSolidImportSource = { format: 'step', fileName: 'original.step', encoding: 'utf8', data: 'ISO-10303-21;END-ISO-10303-21;' };
    const pending = client.importSolid(source); const rejected = expect(pending).rejects.toThrow('does not match');
    transport.reply({ id: 1, kind: 'solid-imported', result: { format: 'step', fileName: 'another.step', representation: 'exact-brep',
      volume: 1, bounds: { min: [0, 0, 0], max: [1, 1, 1] }, solidCount: 1, sourceBytes: cadSolidImportBytes(source).length } });
    await rejected; expect(transport.terminated).toBe(true); client.dispose();
    const cancelTransport = new ImportTransport(); const cancelClient = createCadKernelClient(() => cancelTransport); const abort = new AbortController();
    const canceled = cancelClient.importSolid(source, abort.signal); const cancelRejected = expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort(); await cancelRejected; expect(cancelTransport.terminated).toBe(true); cancelClient.dispose();
  });
});
