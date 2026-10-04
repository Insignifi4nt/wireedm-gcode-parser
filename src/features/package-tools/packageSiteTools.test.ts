import { describe, expect, it, vi } from 'vitest';
import { packageSiteTools } from './packageSiteTools';
import { machinePackageFixture } from '@/domain/machine-package/__tests__/machinePackageFixture';
import { runPackageAuthoringTool, type PackageAuthoringResult } from '@/domain/machine-package/packageAuthoringTools';

function fixture() {
  let current = 'v1';
  const state = { version: 'v1', isCurrent: (value: string) => value === current, isBusy: vi.fn(() => false),
    postText: '{"staged":"post"}', documentText: '{"staged":"package"}', evidence: [], archive: null, result: null,
    run: vi.fn().mockResolvedValue({ report: { ok: false, operation: 'check-post', appVersion: '0.0.686', details: { diagnostics: [{ code: 'TEST_INVALID' }] } } }),
    addText: vi.fn(), reuse: vi.fn(), download: vi.fn() };
  const tools = packageSiteTools(state);
  return { state, change: () => { current = 'v2'; }, call: (name: string, input: unknown) => tools.find((tool) => tool.name === name)!.execute(input) };
}

describe('package site tools', () => {
  it('returns a successful exact build receipt for many referenced evidence files and pages every staged hash', async () => {
    const input = await machinePackageFixture();
    const bytes = new Uint8Array([65]);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    const machineEvidence = Array.from({ length: 120 }, (_, index) => ({ id: `evidence-${index}`, name: `Evidence ${index}`,
      uri: `evidence/${index}-${'x'.repeat(400)}.txt`, contentSha256: hash }));
    const files = { ...input.files, ...Object.fromEntries(machineEvidence.map(item => [item.uri, bytes])) };
    const result = await runPackageAuthoringTool({ operation: 'build-package', text: JSON.stringify({ ...input.document,
      manifest: { ...input.document.manifest, description: '界\u0000'.repeat(2000) },
      machine: { ...input.document.machine, evidence: machineEvidence } }), files: Object.entries(files).map(([path, bytes]) => ({ path, bytes })) });
    expect(result.report.ok).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(result.report)).length).toBeGreaterThan(32 * 1024);
    const { state } = fixture();
    const evidence = Object.entries(files).map(([path, bytes]) => ({ path, bytes, hash }));
    const tools = packageSiteTools({ ...state, evidence, result, run: async () => result });
    const call = (name: string, args: unknown) => tools.find(tool => tool.name === name)!.execute(args) as Promise<{ ok: boolean; data: any }>;
    const built = await call('edm_build_package', { expectedInputVersion: 'v1' });
    expect(built).toMatchObject({ ok: true, data: { ok: true, detailsSummarized: true, fullReportAvailable: true, details: {
      archiveHash: (result.report.details as { archiveHash: string }).archiveHash,
      omittedEvidencePathCount: expect.any(Number), manifest: { descriptionTruncated: true }
    } } });
    expect(new TextEncoder().encode(JSON.stringify(built)).length).toBeLessThan(32 * 1024);
    const received: unknown[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const context = await call('edm_package_context', { expectedInputVersion: 'v1', offset, limit: 50 });
      expect(context.ok).toBe(true);
      received.push(...context.data.evidence);
      offset = context.data.nextOffset;
    }
    expect(received).toEqual(evidence.map(({ path, bytes, hash }) => ({ path, sha256: hash, size: bytes.byteLength })));
  });

  it('keeps failure summaries usable and reads every original report character without repeating the check', async () => {
    const { state } = fixture();
    const result: PackageAuthoringResult = { report: { ok: false, appVersion: '0.0.689', operation: 'check-post', details: {
      post: { packageId: 'shop.post', version: '1.0.0', contentHash: 'a'.repeat(64) },
      conformance: { ok: false, diagnostics: Array.from({ length: 40 }, (_, index) => ({ code: 'POST_CONFORMANCE_EXPECTED_PROGRAM_MISMATCH', fixtureId: `fixture-${index}`,
        message: 'Review expected output. 界\u0000😀'.repeat(300), expectedProgram: 'N10 X0\r\n'.repeat(1000), actualProgram: 'N10 X1\r\n'.repeat(1000) })) }
    } } };
    const run = vi.fn(async () => result);
    const tools = packageSiteTools({ ...state, result, run });
    const call = (name: string, args: unknown) => tools.find(tool => tool.name === name)!.execute(args) as Promise<{ ok: boolean; data: any }>;
    const checked = await call('edm_check_post', { expectedInputVersion: 'v1' });
    expect(checked).toMatchObject({ ok: true, data: { ok: false, details: { post: { contentHash: 'a'.repeat(64) }, conformance: { ok: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'POST_CONFORMANCE_EXPECTED_PROGRAM_MISMATCH', messageTruncated: true, omittedDetails: true })]),
      omittedDiagnosticCount: expect.any(Number)
    } } } });
    expect(new TextEncoder().encode(JSON.stringify(checked)).length).toBeLessThan(32 * 1024);
    const context = await call('edm_package_context', {});
    const reportVersion = context.data.lastCheck.reportVersion;
    const chunks: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const chunk = await call('edm_read_package_report', { expectedInputVersion: 'v1', reportVersion, offset, length: 4000 });
      expect(chunk).toMatchObject({ ok: true, data: { reportOk: false, reportVersion } });
      expect(new TextEncoder().encode(JSON.stringify(chunk)).length).toBeLessThan(32 * 1024);
      chunks.push(chunk.data.text); offset = chunk.data.nextOffset;
    }
    expect(chunks.join('')).toBe(JSON.stringify(result.report, null, 2));
    expect(run).toHaveBeenCalledOnce();
    const next = packageSiteTools({ ...state, result: { ...result, report: { ...result.report } } });
    expect(await next.find(tool => tool.name === 'edm_read_package_report')!.execute({ expectedInputVersion: 'v1', reportVersion })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
  });

  it('explicitly marks projected successful fixture details while retaining fixture identity and post hash', async () => {
    const input = await machinePackageFixture();
    const result = await runPackageAuthoringTool({ operation: 'check-post', text: JSON.stringify(input.document.posts[0]) });
    expect(result.report.ok).toBe(true);
    const { state } = fixture();
    const tools = packageSiteTools({ ...state, result, run: async () => result });
    const checked = await tools.find(tool => tool.name === 'edm_check_post')!.execute({ expectedInputVersion: 'v1' });
    const original = result.report.details as { post: { contentHash: string }; conformance: { fixtures: { fixtureId: string }[] } };
    expect(original.conformance.fixtures.length).toBeGreaterThan(0);
    expect(checked).toMatchObject({ ok: true, data: { ok: true, details: {
      post: { contentHash: original.post.contentHash },
      conformance: { ok: true, omittedFixtureCount: 0, fixtures: original.conformance.fixtures.map(({ fixtureId }) => ({ fixtureId, omittedDetails: true })) }
    } } });
  });

  it('rejects stale evidence/report continuations and blocks actions while ordinary page work is running', async () => {
    const { state, call, change } = fixture();
    state.isBusy.mockReturnValue(true);
    expect(await call('edm_package_context', {})).toMatchObject({ ok: true, data: { busy: true } });
    expect(await call('edm_add_text_evidence', { expectedInputVersion: 'v1', path: 'evidence/note.txt', text: 'note' })).toMatchObject({ ok: false, error: { code: 'BUSY' } });
    expect(await call('edm_download_package', { expectedInputVersion: 'v1' })).toMatchObject({ ok: false, error: { code: 'BUSY' } });
    expect(state.addText).not.toHaveBeenCalled(); expect(state.download).not.toHaveBeenCalled();
    change();
    expect(await call('edm_package_context', { expectedInputVersion: 'v1', offset: 50 })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    expect(await call('edm_read_package_report', { expectedInputVersion: 'v1', reportVersion: 'old' })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
  });

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
