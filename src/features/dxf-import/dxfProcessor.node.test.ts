// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { browserDxfProcessor } from './dxfProcessor';

describe('non-browser DXF CPU fallback', () => {
  it('uses the pure processor when no browser or Worker exists', async () => {
    const result = await browserDxfProcessor.prepare({ mode: 'fixed', unit: 'millimeters' }, {
      fileName: 'node.dxf', text: '0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n10\n21\n0\n0\nENDSEC\n0\nEOF\n'
    });
    expect(result).toMatchObject({ ok: true, preparation: { entityCount: 1 } });
    if (!result.ok) throw new Error(result.error.message);
    expect(await browserDxfProcessor.plan(result.preparation.parseResult.entities, {})).toMatchObject({ segments: [{ length: 10 }] });
  });

  it('checks cancellation before lazily loaded CPU work begins', async () => {
    const controller = new AbortController();
    const pending = browserDxfProcessor.prepare({ mode: 'fixed', unit: 'millimeters' }, { fileName: 'node.dxf', text: '' }, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
  });
});
