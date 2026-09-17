import { describe, expect, it, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import { object, registerSiteTools, siteTool, type SiteTool } from './siteTools';

describe('site tool boundary', () => {
  it('rejects invalid or extra arguments before execution and bounds output', async () => {
    const run = vi.fn(() => 'done');
    const tool = siteTool('check', 'Test', object({ count: Type.Integer({ minimum: 1, maximum: 5 }) }), run);
    for (const input of [{ count: 0 }, { count: Infinity }, { count: 1, approved: true }, null]) {
      expect(await tool.execute(input)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    }
    expect(run).not.toHaveBeenCalled();
    expect(await tool.execute({ count: 1 })).toEqual({ ok: true, data: 'done' });
    expect(await siteTool('large', 'Test', object({}), () => 'x'.repeat(33000)).execute({})).toMatchObject({ ok: false, error: { code: 'OUTPUT_TOO_LARGE' } });
  });

  it('disposes registrations and cancels running calls independently', async () => {
    const registered: SiteTool[] = [];
    const signals: AbortSignal[] = [];
    const tool = siteTool('slow', 'Test', object({}), (_, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve('late'))));
    const registration = registerSiteTools({ registerTool: (tool, { signal }) => { registered.push(tool); signals.push(signal); } }, [tool]);
    await registration.ready;
    const pending = registered[0].execute({});
    registration.dispose();
    expect(signals[0].aborted).toBe(true);
    expect(await pending).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(await registered[0].execute({})).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
  });

  it('cleans up partial registration failures without changing the ordinary application', async () => {
    let first: AbortSignal | undefined;
    const registerTool = vi.fn().mockImplementationOnce((_: SiteTool, options: { signal: AbortSignal }) => { first = options.signal; }).mockRejectedValueOnce(new Error('unsupported'));
    const tool = siteTool('one', 'Test', object({}), () => ({}));
    const registration = registerSiteTools({ registerTool }, [tool, { ...tool, name: 'two' }]);
    await expect(registration.ready).rejects.toThrow('unsupported');
    expect(first?.aborted).toBe(true);
  });
});
