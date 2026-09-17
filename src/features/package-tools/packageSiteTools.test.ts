import { describe, expect, it, vi } from 'vitest';
import { packageSiteTools } from './packageSiteTools';

function fixture() {
  let current = 'v1';
  const state = { version: 'v1', isCurrent: (value: string) => value === current,
    postText: '{"staged":"post"}', documentText: '{"staged":"package"}', evidence: [], archive: null, result: null,
    run: vi.fn().mockResolvedValue({ report: { ok: false, operation: 'check-post', appVersion: '0.0.686', details: { diagnostics: [{ code: 'TEST_INVALID' }] } } }),
    addText: vi.fn(), reuse: vi.fn(), download: vi.fn() };
  const tools = packageSiteTools(state);
  return { state, change: () => { current = 'v2'; }, call: (name: string, input: unknown) => tools.find((tool) => tool.name === name)!.execute(input) };
}

describe('package site tools', () => {
  it('checks staged input without echoing it and preserves validation failure in the report', async () => {
    const { state, call } = fixture();
    expect(await call('edm_check_post', { expectedInputVersion: 'v1' })).toMatchObject({ ok: true, data: { ok: false, details: { diagnostics: [{ code: 'TEST_INVALID' }] } } });
    expect(state.run).toHaveBeenCalledWith({ operation: 'check-post', text: state.postText }, expect.any(AbortSignal));
  });
  it('rejects stale calls before work and cannot download an unchecked artifact', async () => {
    const { state, call, change } = fixture();
    expect(await call('edm_download_package', { expectedInputVersion: 'v1' })).toMatchObject({ ok: false, error: { code: 'BUILD_REQUIRED' } });
    change();
    expect(await call('edm_build_package', { expectedInputVersion: 'v1' })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    expect(state.run).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
  });
  it('rejects unsafe evidence paths and rechecks inputs after an asynchronous file read', async () => {
    const { state, call } = fixture();
    expect(await call('edm_add_text_evidence', { expectedInputVersion: 'v1', path: 'evidence/../escape', text: 'text' })).toMatchObject({ ok: false, error: { code: 'INVALID_PATH' } });
    expect(state.addText).not.toHaveBeenCalled();
    let current = true;
    const tools = packageSiteTools({ ...state, isCurrent: () => current, archive: {
      size: 3, arrayBuffer: async () => { current = false; return new ArrayBuffer(3); }
    } as File });
    expect(await tools.find(({ name }) => name === 'edm_inspect_package')!.execute({ expectedInputVersion: 'v1' })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    expect(state.run).not.toHaveBeenCalled();
  });
});
