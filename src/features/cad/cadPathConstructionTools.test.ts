import { describe, expect, it, vi } from 'vitest';
import { cadSiteTools } from './cadSiteTools';
import type { CadController } from './useCadController';
import { jsonByteLength } from '@/features/webmcp/diagnosticSummaries';

const semicircle = { start: [0, -10], steps: [{ kind: 'arc', end: [0, 10], through: [10, 0] }] };
function constructionTool() {
  const controller = new Proxy({} as CadController, { get() { throw new Error('Construction touched application state'); } });
  const tool = cadSiteTools(() => controller).find(entry => entry.name === 'cad_construct_path');
  if (!tool) throw new Error('Missing path construction tool');
  return tool;
}

describe('shared path construction discovery tool', () => {
  it('constructs and measures an exact D profile without reading or changing a draft', async () => {
    const tool = constructionTool();
    expect(tool.annotations.readOnlyHint).toBe(true);
    expect(await tool.execute(semicircle)).toMatchObject({ ok: true, data: {
      units: 'mm', persisted: false, segmentCount: 2,
      areaMm2: expect.closeTo(50 * Math.PI, 9), perimeterMm: expect.closeTo(10 * Math.PI + 20, 9),
      geometry: { kind: 'path', segments: [
        { kind: 'arc', center: [expect.closeTo(0, 12), expect.closeTo(0, 12)], radius: 10, sweep: 180 },
        { kind: 'line', start: [0, 10], end: [0, -10] }
      ] }
    } });
  });
  it('rejects malformed, executable-looking and oversized requests before controller access', async () => {
    const controller = vi.fn<() => CadController>(() => { throw new Error('Invalid arguments reached the controller'); });
    const tool = cadSiteTools(controller).find(entry => entry.name === 'cad_construct_path');
    if (!tool) throw new Error('Missing path construction tool');
    for (const input of [null, { ...semicircle, source: 'return 1' }, { ...semicircle, start: ['radius', 0] },
      { start: [0, 0], steps: [] }, { start: [0, 0], steps: [{ kind: 'arc', end: [1, 0] }] },
      { start: [Infinity, 0], steps: semicircle.steps }, { ...semicircle, steps: Array(129).fill(semicircle.steps[0]) }]) {
      expect(await tool.execute(input)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    }
    expect(controller).not.toHaveBeenCalled();
  });
  it('preserves cancellation and own-data guards and reports invalid geometry without mutation', async () => {
    const tool = constructionTool(); const abort = new AbortController(); abort.abort();
    expect(await tool.execute(semicircle, { signal: abort.signal })).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    let reads = 0;
    expect(await tool.execute({ ...semicircle, get start() { reads++; return [0, -10]; } }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(reads).toBe(0);
    expect(await tool.execute({ start: [0, 0], steps: [{ kind: 'arc', end: [2, 0], through: [1, 0] }] }))
      .toMatchObject({ ok: false, error: { message: expect.any(String) } });
    expect(await tool.execute({ start: [0, 0], steps: [{ kind: 'line', end: [10, 10] },
      { kind: 'line', end: [0, 10] }, { kind: 'line', end: [10, 0] }] }))
      .toMatchObject({ ok: false, error: { message: expect.any(String) } });
  });
  it('returns all 128 curved steps with varied decimal geometry inside the 32 KiB envelope', async () => {
    const tool = constructionTool(); const count = 128;
    const center = [923456.123456789, -734567.987654321]; const radius = 1732.0123456789;
    const at = (angle: number) => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    const start = at(.123456789);
    const steps = Array.from({ length: count }, (_, index) => {
      const angle = .123456789 + index * 2 * Math.PI / count;
      return { kind: 'arc', end: index === count - 1 ? start : at(angle + 2 * Math.PI / count), through: at(angle + Math.PI / count) };
    });
    const response = await tool.execute({ start, steps });
    expect(response).toMatchObject({ ok: true, data: { segmentCount: 128, geometry: { kind: 'path', segments: expect.any(Array) }, persisted: false } });
    // Include the success envelope and measurement fields, not only the geometry.
    expect(jsonByteLength(response)).toBeLessThanOrEqual(32 * 1024);
    expect(jsonByteLength(response)).toBeGreaterThan(18 * 1024);
  });
});
