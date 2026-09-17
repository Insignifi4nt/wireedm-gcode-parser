import { Type } from '@sinclair/typebox';
import { APP_VERSION } from '@/domain/release/appRelease';
import type { PackageAuthoringRequest, PackageAuthoringResult } from '@/domain/machine-package/packageAuthoringTools';
import { object, siteTool, ToolError } from '@/features/webmcp/siteTools';

interface PackageToolState {
  version: string;
  postText: string;
  documentText: string;
  evidence: readonly { path: string; bytes: Uint8Array; hash: string }[];
  archive: File | null;
  result: PackageAuthoringResult | null;
  isCurrent(version: string): boolean;
  run(request: PackageAuthoringRequest, signal: AbortSignal): Promise<PackageAuthoringResult>;
  addText(path: string, text: string, signal: AbortSignal): Promise<void>;
  reuse(signal: AbortSignal): Promise<void>;
  download(): void;
}
const version = { expectedInputVersion: Type.String({ minLength: 1, maxLength: 100 }) };
const text = Type.String({ minLength: 1, maxLength: 1024 * 1024 });

export function packageSiteTools(state: PackageToolState) {
  function check(expected: string) {
    if (!state.isCurrent(expected)) throw new ToolError('STALE_STATE', 'Inputs changed. Read edm_package_context again.');
  }
  const summarize = (value: PackageAuthoringResult) => {
    // Full fixture output remains visible/downloadable; keep tool responses small.
    const details = value.report.details;
    if (details && typeof details === 'object' && 'conformance' in details) {
      const conformance = details.conformance as { ok: boolean; fixtures?: readonly { fixtureId: string; diagnostics?: unknown }[]; diagnostics?: unknown };
      return { ...value.report, details: { ...details, conformance: { ok: conformance.ok,
        fixtures: conformance.fixtures?.map(({ fixtureId, diagnostics }) => ({ fixtureId, diagnostics })), diagnostics: conformance.diagnostics } } };
    }
    return value.report;
  };
  return [
    siteTool('edm_package_context', 'Read this package authoring page’s input version, selected evidence hashes, archive and latest check status. Files belong to this browser session.', object({}), () => ({
      appVersion: APP_VERSION, inputVersion: state.version,
      postLoaded: Boolean(state.postText), documentLoaded: Boolean(state.documentText),
      evidence: state.evidence.slice(0, 50).map(({ path, hash, bytes }) => ({ path, sha256: hash, size: bytes.byteLength })),
      evidenceCount: state.evidence.length,
      archive: state.archive ? { name: state.archive.name, size: state.archive.size } : null,
      lastCheck: state.result ? { ok: state.result.report.ok, operation: state.result.report.operation, packageAvailable: Boolean(state.result.output?.archive) } : null
    })),
    siteTool('edm_check_post', 'Check supplied text or the visible Post JSON using sandboxed conformance and return its canonical hash. Shows the full report on this page. Does not install a post.', object({ ...version, text: Type.Optional(text) }), async (input, signal) => {
      check(input.expectedInputVersion);
      return summarize(await state.run({ operation: 'check-post', text: input.text ?? state.postText }, signal));
    }, false),
    siteTool('edm_build_package', 'Validate supplied documentText or the visible package document with staged evidence and sandboxed conformance. Prepare a downloadable archive; does not install or save a machine.', object({ ...version, documentText: Type.Optional(text) }), async (input, signal) => {
      check(input.expectedInputVersion);
      return summarize(await state.run({ operation: 'build-package', text: input.documentText ?? state.documentText, files: state.evidence }, signal));
    }, false),
    siteTool('edm_inspect_package', 'Inspect the archive selected through Machine package file, including sandboxed post conformance. Show its report and safely decoded repair inputs. Does not install it.', object(version), async (input, signal) => {
      check(input.expectedInputVersion);
      if (!state.archive) throw new ToolError('FILE_REQUIRED', 'Choose a Machine package file on this page first.');
      if (state.archive.size > 32 * 1024 * 1024) throw new ToolError('INPUT_TOO_LARGE', 'Archive exceeds 32 MiB.');
      const bytes = new Uint8Array(await state.archive.arrayBuffer());
      signal.throwIfAborted();
      check(input.expectedInputVersion);
      return summarize(await state.run({ operation: 'inspect-package', bytes }, signal));
    }, false),
    siteTool('edm_add_text_evidence', 'Stage supplied UTF-8 evidence text in this authoring page. Hashes its bytes and clears previous results. Use actual supplied evidence; this does not verify its truth.', object({ ...version, path: Type.String({ minLength: 1, maxLength: 200 }), text }), async (input, signal) => {
      check(input.expectedInputVersion);
      if (!/^evidence\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(input.path) || input.path.split('/').some((part) => !part || part === '.' || part === '..')) throw new ToolError('INVALID_PATH', 'Use a relative evidence/ path without empty or traversal components.');
      if (state.evidence.some(({ path }) => path === input.path)) throw new ToolError('DUPLICATE_PATH', 'That evidence path already exists.');
      await state.addText(input.path, input.text, signal);
      return { staged: true, refresh: 'Read edm_package_context for its hash and new input version.' };
    }, false),
    siteTool('edm_reuse_package', 'Load the last inspected archive’s decoded document and evidence into the visible builder. Failed inspection contents remain unvalidated until a successful new build.', object(version), async (input, signal) => {
      check(input.expectedInputVersion);
      if (state.result?.report.operation !== 'inspect-package' || !state.result.output) throw new ToolError('INSPECTION_REQUIRED', 'Inspect a safely readable archive first.');
      await state.reuse(signal); return { loaded: true };
    }, false),
    siteTool('edm_download_package', 'Request a browser download of the successful current build. Returns download-requested, not an on-disk save receipt.', object(version), (input) => {
      check(input.expectedInputVersion);
      if (!state.result?.report.ok || !state.result.output?.archive) throw new ToolError('BUILD_REQUIRED', 'Build the current inputs successfully first.');
      state.download(); return { status: 'download-requested', fileName: state.result.output.fileName };
    }, false)
  ];
}
