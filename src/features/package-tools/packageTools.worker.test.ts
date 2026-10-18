import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PackageAuthoringRequest, PackageAuthoringResult } from '@/domain/machine-package/packageAuthoringTools';
import { machinePackageFixture } from '@/domain/machine-package/__tests__/machinePackageFixture';

describe('package check worker entry point', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('posts structured post exceptions and can check a valid package afterwards', async () => {
    const postMessage = vi.fn<(result: PackageAuthoringResult) => void>();
    const worker: {
      onmessage: ((event: MessageEvent<PackageAuthoringRequest>) => Promise<void>) | null;
      postMessage: typeof postMessage;
    } = { onmessage: null, postMessage };
    vi.stubGlobal('self', worker);
    await import('./packageTools.worker');
    const handleMessage = worker.onmessage;
    if (!handleMessage) throw new Error('Package worker did not register its message handler.');
    const fixture = await machinePackageFixture();
    const post = fixture.document.posts[0];
    const validText = JSON.stringify(post);
    const invalidPost = {
      ...post,
      source: { ...post.source, code: 'export function createPost() { return { onEvent() { throw 1n; } }; }' }
    };

    await handleMessage(new MessageEvent('message', {
      data: { operation: 'check-post', text: JSON.stringify(invalidPost) }
    }));
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      report: expect.objectContaining({
        ok: false,
        operation: 'check-post',
        details: expect.objectContaining({
          conformance: expect.objectContaining({
            ok: false,
            diagnostics: expect.arrayContaining([expect.objectContaining({
              code: 'POST_CONFORMANCE_RUNTIME_FAILED',
              message: '1',
              runtimeDiagnostic: expect.objectContaining({ code: 'POST_CUSTOM_RUNTIME_FAILED', message: '1' })
            })])
          })
        })
      })
    }));

    await handleMessage(new MessageEvent('message', {
      data: { operation: 'check-post', text: validText }
    }));
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      report: expect.objectContaining({ ok: true, operation: 'check-post' })
    }));
  });
});
