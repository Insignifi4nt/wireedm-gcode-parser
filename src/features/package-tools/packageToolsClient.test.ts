import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPackageTool } from './packageToolsClient';

describe('cancellable package worker', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([false, true])('terminates real work for an %s already-aborted signal', async (alreadyAborted) => {
    const terminate = vi.fn();
    const postMessage = vi.fn();
    vi.stubGlobal('Worker', class { terminate = terminate; postMessage = postMessage; });
    const controller = new AbortController();
    if (alreadyAborted) controller.abort();
    const task = startPackageTool({ operation: 'check-post', text: '{}' }, controller.signal);
    const failed = expect(task.result).rejects.toThrow('cancelled');
    if (!alreadyAborted) controller.abort();
    await failed;
    expect(terminate).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledTimes(alreadyAborted ? 0 : 1);
  });
});
