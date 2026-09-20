import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkbenchAppController } from '@/app/useWorkbenchAppController';
import { defaultAppServices, type AppServices } from '@/app/appServices';
import { buildMachinePackageArchive, prepareStoredMachinePackageInstallation } from '@/domain/machine-package';
import { machinePackageFixture } from '@/domain/machine-package/__tests__/machinePackageFixture';
import { workbenchSiteTools } from './workbenchSiteTools';
import { applyProjectEdits } from './projectEdits';
import { useWorkbenchActions } from './useWorkbenchActions';
import type { DraftReadSnapshot } from './workbenchSiteTools';
import type { SiteTool } from './siteTools';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const text = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'CIRCLE', '8', '0', '10', '0', '20', '0', '40', '10', '0', 'ENDSEC', '0', 'EOF'].join('\n');
const rectangleText = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '8', '0', '90', '4', '70', '1', '10', '0', '20', '0', '10', '10', '20', '0', '10', '10', '20', '10', '10', '0', '20', '10', '0', 'ENDSEC', '0', 'EOF'].join('\n');
let root: Root;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); container?.remove(); window.localStorage.clear(); vi.restoreAllMocks(); });

async function harness(overrides: Partial<AppServices> = {}) {
  let tools: SiteTool[] = [];
  let app!: ReturnType<typeof useWorkbenchAppController>;
  let draft!: { current: DraftReadSnapshot | null };
  const generate = vi.fn(defaultAppServices.generateControllerArtifact);
  const download = vi.fn<AppServices['downloadTextFile']>();
  function Harness() {
    draft = useRef<DraftReadSnapshot | null>(null);
    app = useWorkbenchAppController({ connectRememberedWorkbenchDirectory: async () => ({ status: 'missing' }), generateControllerArtifact: generate, downloadTextFile: download, ...overrides }, () => draft.current);
    const actions = useWorkbenchActions(app, draft);
    tools = [...workbenchSiteTools(() => ({ workbench: app.connectedWorkbench, draft: draft.current, busy: app.workbenchInteractionLocked })), ...actions.tools];
    return actions.fileControl;
  }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<Harness />));
  async function call(name: string, input: unknown, signal?: AbortSignal) {
    let result: unknown;
    await act(async () => { result = await tools.find(t => t.name === name)!.execute(input, { signal }); });
    return result as { ok: boolean; data: Record<string, any>; error?: { code: string } };
  }
  return { call, app: () => app, draft: () => draft, generate, download };
}

async function importCircle(h: Awaited<ReturnType<typeof harness>>, sourceText = text) {
  const context = await h.call('edm_workflow_context', {});
  const prepared = await h.call('edm_prepare_dxf', { expectedVersion: context.data.version, source: { fileName: 'circle.dxf', text: sourceText } });
  const imported = await h.call('edm_import_dxf', { expectedVersion: context.data.version, preparationId: prepared.data.preparationId, unitCandidateId: 'millimeters', declaredUnitOverrideAcknowledged: false });
  expect(imported.ok).toBe(true);
  const program = h.app().loadedEditorProgram!;
  if (program.model !== 'upid-document') throw new Error('Wrong model');
  h.draft().current = { projectId: program.project.id, version: 'draft', document: program.pathDocument, dirty: false, workflowOpen: false };
  return program;
}

async function prepareControllerJob(h: Awaited<ReturnType<typeof harness>>) {
  const program = await importCircle(h, rectangleText);
  const operation = program.pathDocument.plan.operations[0];
  const document = applyProjectEdits(program.pathDocument, [
    { kind: 'geometry-basis', basis: 'wire-centre' },
    { kind: 'compensation', operationId: operation.id, selection: 'centerline' },
    { kind: 'initial-wire', point: operation.startPoint },
    { kind: 'entry', operationId: operation.id, from: null },
    { kind: 'exit', operationId: operation.id, to: null }
  ]);
  h.draft().current = { ...h.draft().current!, document, dirty: true };
  expect(await h.call('edm_save_project', { draftVersion: 'draft' })).toMatchObject({ ok: true, data: { saved: true } });
  h.draft().current = { ...h.draft().current!, dirty: false, version: 'saved-draft' };
  const packageInput = await machinePackageFixture();
  const built = await buildMachinePackageArchive({ ...packageInput, document: { ...packageInput.document,
    machine: { ...packageInput.document.machine, limits: { ...packageInput.document.machine.limits, yTravel: { status: 'known', millimeters: 200 } } }
  } });
  if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
  const prepared = await prepareStoredMachinePackageInstallation(h.app().connectedWorkbench!, built.archive);
  if (!prepared.ok) throw new Error(prepared.error.message);
  await act(async () => { expect(await h.app().handleCommitMachinePackage(prepared.prepared, { kind: 'install-new' })).toBe(true); });
  const machine = h.app().connectedWorkbench!.machines.machines[0];
  const context = await h.call('edm_workflow_context', {});
  return { expectedVersion: context.data.version, draftVersion: 'saved-draft', machineId: machine.id, bindingId: machine.activeBindingId! };
}

describe('workbench agent actions', () => {
  it('captures the actual editor callback as a small artifact receipt and keeps the draft unchanged', async () => {
    const h = await harness();
    await importCircle(h);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:editor-preview');
    const image = { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDSkAAAAASUVORK5CYII=', width: 1, height: 1, source: '3d' as const };
    const capture = vi.fn(async () => image);
    const draft = { ...h.draft().current!, dirty: true, workflowOpen: true, capture };
    h.draft().current = draft;
    const result = await h.call('edm_capture_preview', { draftVersion: 'draft' });
    expect(result).toMatchObject({ ok: true, data: { status: 'captured', source: '3d', dirty: true, previewUrl: 'blob:editor-preview', byteLength: 68 } });
    expect(capture).toHaveBeenCalledOnce();
    expect(h.draft().current).toBe(draft);
    expect(h.download).not.toHaveBeenCalled();
    expect(container.querySelector('a[download]')?.getAttribute('href')).toBe('blob:editor-preview');
    expect(JSON.stringify(result)).not.toContain('base64');
  });

  it('discards a capture if its draft changes while rendering and reports unavailable previews', async () => {
    const h = await harness();
    await importCircle(h);
    expect(await h.call('edm_capture_preview', { draftVersion: 'draft' })).toMatchObject({ ok: false, error: { code: 'CAPTURE_UNAVAILABLE' } });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stale-preview');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    h.draft().current!.capture = async () => {
      h.draft().current = { ...h.draft().current!, version: 'edited-draft' };
      return { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDSkAAAAASUVORK5CYII=', width: 1, height: 1, source: '2d' };
    };
    expect(await h.call('edm_capture_preview', { draftVersion: 'draft', download: true })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    expect(revoke).toHaveBeenCalledWith('blob:stale-preview');
    expect((await h.call('edm_workflow_context', {})).data.capture).toBeNull();
    expect(container.querySelector('a[download]')).toBeNull();
  });

  it('exports an explicit saved project without opening it or including an unrelated dirty draft', async () => {
    const h = await harness();
    const program = await importCircle(h);
    const saved = await h.call('edm_get_project', { target: { kind: 'saved-project', projectId: program.project.id } });
    await act(async () => h.app().handleBackToDashboard());
    const otherDraft = { ...h.draft().current!, projectId: 'other-project', dirty: true };
    h.draft().current = otherDraft;
    const context = await h.call('edm_workflow_context', {});
    const input = { expectedVersion: context.data.version, projectId: program.project.id, savedProjectVersion: saved.data.version };
    expect(await h.call('edm_export_saved_upid', { ...input, savedProjectVersion: 'stale' })).toMatchObject({ ok: false, error: { code: 'PORTABLE_UPID_PROJECT_CHANGED' } });
    expect(h.download).not.toHaveBeenCalled();
    expect(await h.call('edm_export_saved_upid', input)).toMatchObject({ ok: true, data: { status: 'download-requested', projectId: program.project.id, fileName: 'circle.upid.json' } });
    expect(h.download).toHaveBeenCalledOnce();
    expect(JSON.parse(h.download.mock.calls[0][0].text).document.segments).toEqual(program.pathDocument.segments);
    expect(h.app().activeView).toBe('dashboard');
    expect(h.draft().current).toBe(otherDraft);
  });

  it('cancels a pending UPID export before requesting a download and unlocks the next action', async () => {
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const h = await harness({ exportPortableUpidProject: async (...args) => { await gate; return defaultAppServices.exportPortableUpidProject(...args); } });
    await importCircle(h);
    const abort = new AbortController();
    const exporting = h.call('edm_export_upid', { draftVersion: 'draft' }, abort.signal);
    abort.abort();
    finish();
    expect(await exporting).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(h.download).not.toHaveBeenCalled();
    expect(h.app().workbenchInteractionLocked).toBe(false);
    expect(await h.call('edm_export_upid', { draftVersion: 'draft' })).toMatchObject({ ok: true });
    expect(h.download).toHaveBeenCalledOnce();
  });

  it('exports controller output once and reads/downloads that exact artifact without another revision', async () => {
    const h = await harness();
    const input = await prepareControllerJob(h);
    const exported = await h.call('edm_export_controller', input);
    expect(exported, JSON.stringify(exported)).toMatchObject({ ok: true, data: { generated: true, status: 'download-requested', artifactId: expect.any(String) } });
    expect(h.download).toHaveBeenCalledOnce();
    const downloaded = h.download.mock.calls[0][0];
    const read = await h.call('edm_read_artifact', { artifactId: exported.data.artifactId, length: 4000 });
    expect(read).toMatchObject({ ok: true, data: { text: downloaded.text, fileName: downloaded.fileName, sha256: exported.data.sha256 } });
    expect(await h.call('edm_download_artifact', { artifactId: exported.data.artifactId })).toMatchObject({ ok: true });
    expect(h.download).toHaveBeenLastCalledWith(downloaded);
    expect(h.generate).toHaveBeenCalledOnce();
    expect(h.app().loadedEditorProgram?.project.savedRevisionIds).toEqual([exported.data.artifactId]);
  });

  it('checks cancellation and draft freshness after preparing a controller revision but before any write', async () => {
    let stop: (() => void) | undefined;
    const save = vi.fn(defaultAppServices.saveStoredWireEdmJobRevision);
    const h = await harness({ createSavedWireEdmJobRevision: async input => {
      const result = await defaultAppServices.createSavedWireEdmJobRevision(input);
      stop?.();
      return result;
    }, saveStoredWireEdmJobRevision: save });
    const input = await prepareControllerJob(h);
    const abort = new AbortController();
    stop = () => abort.abort();
    expect(await h.call('edm_generate_controller', input, abort.signal)).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(save).not.toHaveBeenCalled();
    expect(h.app().workbenchInteractionLocked).toBe(false);
    stop = () => { h.draft().current = { ...h.draft().current!, version: 'changed' }; };
    expect(await h.call('edm_generate_controller', input)).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    expect(save).not.toHaveBeenCalled();
  });

  it('returns the committed artifact after late cancellation without starting its download', async () => {
    const abort = new AbortController();
    const h = await harness({ saveStoredWireEdmJobRevision: async (...args) => {
      const saved = await defaultAppServices.saveStoredWireEdmJobRevision(...args);
      abort.abort();
      return saved;
    } });
    const input = await prepareControllerJob(h);
    const exported = await h.call('edm_export_controller', input, abort.signal);
    expect(exported).toMatchObject({ ok: true, data: { generated: true, status: 'generated-download-not-requested' } });
    expect(h.app().loadedEditorProgram?.project.savedRevisionIds).toEqual([exported.data.artifactId]);
    expect(h.download).not.toHaveBeenCalled();
    expect(await h.call('edm_download_artifact', { artifactId: exported.data.artifactId })).toMatchObject({ ok: true, data: { status: 'download-requested' } });
  });

  it('retains an audited artifact when the browser download fails so retry does not create a revision', async () => {
    const h = await harness();
    const input = await prepareControllerJob(h);
    h.download.mockImplementationOnce(() => { throw new Error('Browser download failed'); });
    const exported = await h.call('edm_export_controller', input);
    expect(exported).toMatchObject({ ok: true, data: { generated: true, status: 'generated-download-failed', error: { code: 'DOWNLOAD_FAILED' } } });
    expect(await h.call('edm_download_artifact', { artifactId: exported.data.artifactId })).toMatchObject({ ok: true });
    expect(h.generate).toHaveBeenCalledOnce();
  });

  it('reports the persisted revision ID when the post rejects generation after a successful save', async () => {
    const h = await harness({ generateControllerArtifact: async () => ({ ok: false, error: {
      code: 'CONTROLLER_ARTIFACT_POST_FAILED', message: 'Fixture post could not emit the program.', diagnostics: []
    } }) });
    const input = await prepareControllerJob(h);
    const result = await h.call('edm_export_controller', input);
    expect(result).toMatchObject({ ok: true, data: { generated: false, savedRevisionId: expect.any(String), error: { code: 'CONTROLLER_ARTIFACT_POST_FAILED' } } });
    expect(h.app().loadedEditorProgram?.project.savedRevisionIds).toEqual([result.data.savedRevisionId]);
    expect(h.download).not.toHaveBeenCalled();
  });

  it('preserves the persisted revision receipt when a post returns oversized diagnostics', async () => {
    const message = 'Post could not resolve the requested machining sequence. 日本\u0000'.repeat(2_000);
    const h = await harness({ generateControllerArtifact: async () => ({ ok: false, error: {
      code: 'CONTROLLER_ARTIFACT_POST_FAILED', message: 'The saved post could not generate the program.',
      diagnostics: Array.from({ length: 25 }, (_, index) => ({ code: 'POST_CUSTOM_RUNTIME_FAILED', message,
        eventId: `event-${index}`, commandId: null }))
    } }) });
    const input = await prepareControllerJob(h);
    const result = await h.call('edm_export_controller', input);
    expect(result).toMatchObject({ ok: true, data: { generated: false, savedRevisionId: expect.any(String),
      error: { code: 'CONTROLLER_ARTIFACT_POST_FAILED', omittedDiagnosticCount: 5 }
    } });
    expect(result.data.error.diagnostics).toHaveLength(20);
    expect(result.data.error.diagnostics[0]).toMatchObject({ code: 'POST_CUSTOM_RUNTIME_FAILED', eventId: 'event-0', messageTruncated: true });
    expect(h.app().loadedEditorProgram?.project.savedRevisionIds).toEqual([result.data.savedRevisionId]);
    expect(h.download).not.toHaveBeenCalled();
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(32 * 1024);
  });

  it('returns actionable execution diagnostics when one compiler message exceeds the response limit', async () => {
    const h = await harness();
    await importCircle(h, rectangleText);
    const document = structuredClone(h.draft().current!.document!);
    document.plan.operations[0].segmentRefs = Array.from({ length: 600 }, (_, index) => ({ segmentId: `missing-source-segment-${index}`, reversed: false }));
    h.draft().current = { ...h.draft().current!, document, dirty: true };
    const result = await h.call('edm_review_execution', { draftVersion: 'draft', limit: 1 });
    expect(result).toMatchObject({ ok: true, data: { executablePlan: false,
      items: [{ code: 'EXECUTION_PLAN_INVALID_UPID', messageTruncated: true }] } });
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(32 * 1024);
  });
  it('previews then imports exact DXF units, consumes the preparation and blocks stale or destructive draft replacement', async () => {
    const h = await harness();
    const context = await h.call('edm_workflow_context', {});
    const prepared = await h.call('edm_prepare_dxf', { expectedVersion: context.data.version, source: { fileName: 'tool-test.dxf', text } });
    expect(prepared).toMatchObject({ ok: true, data: { entityCount: 1, defaultUnitCandidateId: 'millimeters' } });
    const input = { expectedVersion: context.data.version, preparationId: prepared.data.preparationId, unitCandidateId: 'inches', declaredUnitOverrideAcknowledged: false };
    expect(await h.call('edm_import_dxf', input)).toMatchObject({ ok: false, error: { code: 'DXF_IMPORT_DECLARED_UNIT_OVERRIDE_UNACKNOWLEDGED' } });
    expect(h.app().connectedWorkbench?.manifest.projects).toHaveLength(0);
    const imported = await h.call('edm_import_dxf', { ...input, unitCandidateId: 'millimeters' });
    expect(imported).toMatchObject({ ok: true, data: { imported: true, opened: true } });
    expect(await h.call('edm_import_dxf', input)).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    expect(h.app().connectedWorkbench?.manifest.projects).toHaveLength(1);
    const program = h.app().loadedEditorProgram!;
    if (program.model !== 'upid-document') throw new Error('Wrong model');
    h.draft().current = { projectId: program.project.id, version: 'draft', document: program.pathDocument, dirty: true, workflowOpen: false };
    const next = await h.call('edm_workflow_context', {});
    expect(await h.call('edm_open_project', { expectedVersion: next.data.version, projectId: program.project.id })).toMatchObject({ ok: false, error: { code: 'DRAFT_IN_USE' } });
    expect(await h.call('edm_generate_controller', { expectedVersion: next.data.version, draftVersion: 'draft', machineId: 'unknown', bindingId: 'unknown' })).toMatchObject({ ok: false, error: { code: 'UNSAVED_DRAFT' } });
    expect(await h.app().handleGenerateControllerArtifact({ machineId: 'unknown' })).toMatchObject({ ok: false, error: { message: expect.stringContaining('Save the draft') } });
    expect(h.generate).not.toHaveBeenCalled();
    h.draft().current!.workflowOpen = true;
    expect(await h.call('edm_save_project', { draftVersion: 'draft' })).toMatchObject({ ok: false, error: { code: 'WORKFLOW_OPEN' } });
    expect(await h.call('edm_save_project', { draftVersion: 'old' })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    h.draft().current = { ...h.draft().current!, dirty: false, workflowCommand: 'export.preview' };
    // The human export dialog is itself a view workflow; it must still reach machine validation.
    expect(await h.app().handleGenerateControllerArtifact({ machineId: 'unknown' })).toMatchObject({ ok: false, error: { message: 'Machine not found: unknown.' } });
  });

  it('rejects overlapping writes and changed uploads while file reading is pending', async () => {
    const h = await harness();
    let finish!: (value: string) => void;
    const file = new File([], 'delayed.dxf');
    Object.defineProperty(file, 'text', { value: () => new Promise<string>(resolve => { finish = resolve; }) });
    const input = container.querySelector('input')!;
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const context = await h.call('edm_workflow_context', {});
    let pending!: Promise<unknown>;
    // Start directly to keep the asynchronous read open while exercising a second call.
    pending = h.call('edm_prepare_dxf', { expectedVersion: context.data.version });
    expect(await h.call('edm_import_upid', { expectedVersion: context.data.version, source: { fileName: 'x.json', text: '{}' } })).toMatchObject({ ok: false, error: { code: 'BUSY' } });
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [new File([], 'replacement.dxf')] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => finish(text));
    expect(await pending).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    expect(h.app().connectedWorkbench?.manifest.projects).toHaveLength(0);
  });
});
