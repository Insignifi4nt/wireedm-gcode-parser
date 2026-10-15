import type { Page } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { captureCadPreview } from '../../e2e/cad-tool-helpers';

const version = 'accepted-version';
const image = { documentId: 'cad_part', draftVersion: version, source: '3d', previewUrl: 'blob:accepted-image',
  viewState: { documentVersion: version, buildVersion: version, view: { mode: 'solid', revision: 8 } } };
const success = (data: Record<string, unknown>) => ({ ok: true, data });
const failure = (code: string) => ({ ok: false, error: { code, message: `Rejected ${code}` } });

// Only replace the unavailable browser transport, not CAD operations or geometry.
function transport(...replies: unknown[]) {
  const evaluate = vi.fn(async (_callback: unknown, _input: { name: string; input: unknown }) => {
    if (!replies.length) throw new Error('Unexpected extra tool request');
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { page: { evaluate } as unknown as Page, evaluate,
    requests: () => evaluate.mock.calls.map(([, request]) => request) };
}

describe('E2E public CAD capture client', () => {
  it('returns a normal capture without reading context or retrying', async () => {
    const client = transport(success(image));
    expect(await captureCadPreview(client.page, version)).toBe(image);
    expect(client.requests()).toEqual([{ name: 'cad_capture_preview', input: { expectedVersion: version } }]);
  });

  it('refreshes only the public viewport after STALE_VIEW and captures once more at the same version', async () => {
    const currentViewport = { documentId: 'cad_part', documentVersion: version, buildVersion: version,
      view: { mode: 'solid', revision: 8 } };
    const client = transport(failure('STALE_VIEW'), success(currentViewport), success(image));
    expect(await captureCadPreview(client.page, version)).toBe(image);
    expect(client.requests()).toEqual([
      { name: 'cad_capture_preview', input: { expectedVersion: version } },
      { name: 'cad_get_viewport', input: { expectedVersion: version } },
      { name: 'cad_capture_preview', input: { expectedVersion: version } },
    ]);
  });

  it('does not adopt a changed document version when the guarded viewport refresh fails', async () => {
    const client = transport(failure('STALE_VIEW'), failure('STALE_STATE'));
    await expect(captureCadPreview(client.page, version)).rejects.toThrow('STALE_STATE');
    expect(client.requests()).toEqual([
      { name: 'cad_capture_preview', input: { expectedVersion: version } },
      { name: 'cad_get_viewport', input: { expectedVersion: version } },
    ]);
  });

  it('propagates a second STALE_VIEW without an unbounded retry loop', async () => {
    const client = transport(failure('STALE_VIEW'), success({ documentVersion: version }), failure('STALE_VIEW'));
    await expect(captureCadPreview(client.page, version)).rejects.toThrow('STALE_VIEW');
    expect(client.requests()).toEqual([
      { name: 'cad_capture_preview', input: { expectedVersion: version } },
      { name: 'cad_get_viewport', input: { expectedVersion: version } },
      { name: 'cad_capture_preview', input: { expectedVersion: version } },
    ]);
  });

  it.each(['STALE_STATE', 'BUSY', 'WORKFLOW_OPEN', 'CAPTURE_UNAVAILABLE', 'INVALID_INPUT'])('does not retry %s', async code => {
    const client = transport(failure(code));
    await expect(captureCadPreview(client.page, version)).rejects.toThrow(code);
    expect(client.requests()).toEqual([{ name: 'cad_capture_preview', input: { expectedVersion: version } }]);
  });

  it('propagates transport errors without inspecting their message as a stale-view code', async () => {
    const error = new Error('Transport closed while reporting STALE_VIEW');
    const client = transport(error);
    await expect(captureCadPreview(client.page, version)).rejects.toBe(error);
    expect(client.evaluate).toHaveBeenCalledTimes(1);
  });

  it('does not mistake a successful payload with an error-shaped field for a rejected capture', async () => {
    const data = { ...image, error: { code: 'STALE_VIEW' } };
    const client = transport(success(data));
    expect(await captureCadPreview(client.page, version)).toBe(data);
    expect(client.evaluate).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed transport replies without a new capture request', async () => {
    const client = transport({ ok: false, error: { message: 'STALE_VIEW' } });
    await expect(captureCadPreview(client.page, version)).rejects.toThrow();
    expect(client.evaluate).toHaveBeenCalledTimes(1);
  });
});
