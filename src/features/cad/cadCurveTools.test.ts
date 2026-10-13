import { describe, expect, it, vi } from 'vitest';
import { cadSiteTools } from './cadSiteTools';
import type { CadController } from './useCadController';
import { jsonByteLength } from '@/features/webmcp/diagnosticSummaries';

function constructor() {
  const controller = new Proxy({} as CadController, { get() { throw new Error('Construction touched application state'); } });
  const tool = cadSiteTools(() => controller).find(entry => entry.name === 'cad_construct_curve');
  if (!tool) throw new Error('Missing Curve construction tool');
  return tool;
}
describe('agent Curve construction', () => {
  it('returns exact open segments and length without material area, auto closure or application access', async () => {
    const tool = constructor();
    expect(tool.annotations.readOnlyHint).toBe(true);
    const result = await tool.execute({ start: [0, -10], steps: [{ kind: 'arc', end: [0, 10], through: [10, 0] }, { kind: 'line', end: [-10, 10] }] });
    expect(result).toMatchObject({ ok: true, data: { persisted: false, units: 'mm', segmentCount: 2,
      lengthMm: expect.closeTo(10 * Math.PI + 10, 9), startMm: [expect.closeTo(0), -10], endMm: [-10, 10],
      segments: [{ kind: 'arc', radius: 10, sweep: 180 }, { kind: 'line', start: [0, 10], end: [-10, 10] }] } });
    expect(result).not.toHaveProperty('data.areaMm2');
  });
  it('rejects complete closures, crossings and uncertain arcs while preserving cancellation and own-data guards', async () => {
    const tool = constructor(); const input = { start: [0, 0], steps: [{ kind: 'line', end: [10, 0] }] };
    for (const steps of [[{ kind: 'line', end: [10, 0] }, { kind: 'line', end: [0, 0] }],
      [{ kind: 'line', end: [10, 10] }, { kind: 'line', end: [0, 10] }, { kind: 'line', end: [10, 0] }],
      [{ kind: 'arc', end: [2, 0], through: [1, 0] }]]) {
      expect(await tool.execute({ ...input, steps })).toMatchObject({ ok: false, error: { message: expect.any(String) } });
    }
    let reads = 0;
    expect(await tool.execute({ ...input, get start() { reads++; return [0, 0]; } })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(reads).toBe(0);
    const abort = new AbortController(); abort.abort();
    expect(await tool.execute(input, { signal: abort.signal })).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
  });
  it('rejects oversized or expression-bearing construction before resolving a controller', async () => {
    const controller = vi.fn<() => CadController>(() => { throw new Error('Invalid input reached controller'); });
    const tool = cadSiteTools(controller).find(entry => entry.name === 'cad_construct_curve');
    if (!tool) throw new Error('Missing Curve construction');
    for (const input of [{ start: ['x', 0], steps: [{ kind: 'line', end: [10, 0] }] },
      { start: [0, 0], steps: Array(129).fill({ kind: 'line', end: [10, 0] }) }]) {
      expect(await tool.execute(input)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    }
    expect(controller).not.toHaveBeenCalled();
  });
  it('bounds the complete 128-arc construction receipt below the 32 KiB tool envelope', async () => {
    const center = [923456.123456789, -734567.987654321]; const radius = 1732.0123456789;
    const at = (angle: number) => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    const start = at(.123456789);
    const steps = Array.from({ length: 128 }, (_, index) => {
      const angle = .123456789 + index * Math.PI / 128;
      return { kind: 'arc', end: at(angle + Math.PI / 128), through: at(angle + Math.PI / 256) };
    });
    const result = await constructor().execute({ start, steps });
    expect(result).toMatchObject({ ok: true, data: { segmentCount: 128, persisted: false, lengthMm: expect.closeTo(Math.PI * radius, 5) } });
    expect(jsonByteLength(result)).toBeLessThanOrEqual(32 * 1024);
  });
});
