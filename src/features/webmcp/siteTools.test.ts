import { describe, expect, it, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import { object, registerSiteTools, siteTool, ToolError, type SiteTool, type SiteToolActivity } from './siteTools';

describe('site tool boundary', () => {
  it('reports bounded argument paths without returning input values', async () => {
    const tool = siteTool('read', 'Read', object({ count: Type.Integer({ minimum: 1 }) }), () => null);
    expect(await tool.execute({ count: 0 })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT', details: { issues: [{ path: '/count', message: expect.any(String) }] } } });
  });

  it('publishes human-visible action outcomes including domain failures and durable late-cancellation success', async () => {
    const registered: SiteTool[] = [];
    const activity: SiteToolActivity[] = [];
    const cancel = new AbortController();
    const tools = [
      siteTool('generate', 'Generate', object({}), () => ({ generated: false, error: { code: 'POST_FAILED', message: 'Post requires review.' } }), false),
      siteTool('save', 'Save', object({}), () => { cancel.abort(); return { saved: true }; }, false),
      siteTool('install', 'Install', object({}), () => ({ installed: false, status: 'installation-failed', error: { code: 'INSTALL_FAILED', message: 'Installation needs review.' } }), false)
    ];
    const registration = registerSiteTools({ registerTool: tool => { registered.push(tool); } }, tools, call => activity.push(call));
    await registration.ready;
    await registered[0].execute({});
    await registered[1].execute({}, { signal: cancel.signal });
    await registered[2].execute({});
    expect(activity).toMatchObject([
      { id: 1, toolName: 'generate', phase: 'running' },
      { id: 1, toolName: 'generate', phase: 'failed', errorCode: 'POST_FAILED', message: 'Post requires review.', completedAt: expect.any(Number) },
      { id: 2, toolName: 'save', phase: 'running' },
      { id: 2, toolName: 'save', phase: 'succeeded', completedAt: expect.any(Number) },
      { id: 3, toolName: 'install', phase: 'running' },
      { id: 3, toolName: 'install', phase: 'failed', errorCode: 'INSTALL_FAILED', message: 'Installation needs review.', completedAt: expect.any(Number) }
    ]);
    registration.dispose();
  });
  it('returns a mutation receipt when cancellation arrives after commit', async () => {
    const controller = new AbortController();
    const tool = siteTool('save', 'Save', object({}), () => { controller.abort(); return { saved: true }; }, false);
    expect(await tool.execute({}, { signal: controller.signal })).toEqual({ ok: true, data: { saved: true } });
    expect(await tool.execute({}, { signal: controller.signal })).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
  });
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

  it('bounds thrown diagnostics while retaining the error code and marking omitted detail', async () => {
    const message = 'Imported geometry requires review. 日本\u0000'.repeat(2_000);
    const tool = siteTool('check', 'Check', object({}), () => {
      throw new ToolError('IMPORT_REVIEW_REQUIRED', message, { report: message });
    });
    const result = await tool.execute({});
    expect(result).toMatchObject({ ok: false, error: {
      code: 'IMPORT_REVIEW_REQUIRED', message: expect.stringContaining('Imported geometry requires review.'),
      messageTruncated: true, omittedDetails: true
    } });
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(32 * 1024);
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
