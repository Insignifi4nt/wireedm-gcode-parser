import { act, useRef } from 'react';
import { File as NodeFile } from 'node:buffer';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkbenchAppController } from '@/app/useWorkbenchAppController';
import { defaultAppServices, type AppServices } from '@/app/appServices';
import { createDxfImportServices } from '@/app/dxfImportServices';
import { directDxfProcessor } from '@/features/dxf-import/dxfProcessorTestSupport';
import { DxfProcessingError } from '@/domain/dxf/dxfProcessing';
import { buildMachinePackageArchive, prepareStoredMachinePackageInstallation } from '@/domain/machine-package';
import { machinePackageFixture } from '@/domain/machine-package/__tests__/machinePackageFixture';
import { MACHINE_LIBRARY_PATH } from '@/domain/machine-definition/machineLibraryStorage';
import { CATALOG_PAIR_TRANSACTION_PATH } from '@/domain/storage/catalogPairTransaction';
import { SAVED_REVISION_TRANSACTION_PATH } from '@/domain/storage/savedRevisionTransaction';
import { WORKBENCH_FILE_TRANSACTION_PATH } from '@/domain/storage/workbenchFileTransaction';
import { withWorkbenchMutationLock } from '@/domain/storage/workbenchMutationLock';
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
beforeEach(() => vi.stubGlobal('File', NodeFile));
afterEach(() => { act(() => root?.unmount()); container?.remove(); window.localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function harness(overrides: Partial<AppServices> = {}) {
  let tools: SiteTool[] = [];
  let app!: ReturnType<typeof useWorkbenchAppController>;
  let draft!: { current: DraftReadSnapshot | null };
  const generate = vi.fn(defaultAppServices.generateControllerArtifact);
  const download = vi.fn<AppServices['downloadTextFile']>();
  function Harness() {
    draft = useRef<DraftReadSnapshot | null>(null);
    app = useWorkbenchAppController({ ...createDxfImportServices(directDxfProcessor), connectRememberedWorkbenchDirectory: async () => ({ status: 'missing' }), generateControllerArtifact: generate, downloadTextFile: download, ...overrides }, () => draft.current);
    const actions = useWorkbenchActions(app, draft);
    tools = [...workbenchSiteTools(() => ({ workbench: app.connectedWorkbench, draft: draft.current, busy: actions.isBusy() })), ...actions.tools];
    return actions.previewControl;
  }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<Harness />));
  async function call(name: string, input: unknown, signal?: AbortSignal) {
    let result: unknown;
    await act(async () => { result = await tools.find(t => t.name === name)!.execute(input, { signal }); });
    return result as { ok: boolean; data: Record<string, any>; error?: { code: string } };
  }
  const execute = (name: string, input: unknown, signal?: AbortSignal) => tools.find(tool => tool.name === name)!.execute(input, { signal });
  return { call, execute, app: () => app, draft: () => draft, generate, download };
}

async function packageSource() {
  const built = await buildMachinePackageArchive(await machinePackageFixture());
  if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
  return { bytes: built.archive, source: { fileName: 'machine.wireedm-package', base64: Buffer.from(built.archive).toString('base64') } };
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
  it.each(['DXF_IMPORT_WORKER_FAILED', 'DXF_IMPORT_TIMEOUT'] as const)('preserves the actionable %s preparation diagnostic', async code => {
    const h = await harness({ prepareDxfProjectImport: async () => { throw new DxfProcessingError(code, 'Local DXF worker stopped.'); } });
    const context = await h.call('edm_workflow_context', {});
    expect(await h.call('edm_prepare_dxf', { expectedVersion: context.data.version, source: { fileName: 'part.dxf', text } }))
      .toMatchObject({ ok: false, error: { code, message: 'Local DXF worker stopped.' } });
    expect((await h.call('edm_workflow_context', {})).data.dxfPreparationId).toBeNull();
  });
  it('keeps a package preparation across preference changes but clears it after machine storage changes', async () => {
    const prepare = vi.fn(defaultAppServices.prepareStoredMachinePackageInstallation);
    const h = await harness({ prepareStoredMachinePackageInstallation: prepare });
    const { source } = await packageSource();
    const context = await h.call('edm_workflow_context', {});
    const receipt = await h.call('edm_prepare_machine_package', { expectedVersion: context.data.version, source });
    expect(receipt.ok).toBe(true);
    await act(async () => { await h.app().handleSaveCatalogPreferences(h.app().connectedWorkbench!.manifest.preferences); });
    expect((await h.call('edm_workflow_context', {})).data.packagePreparationId).toBe(receipt.data.preparationId);
    const prepared = await prepare.mock.results[0].value;
    if (!prepared.ok) throw new Error(prepared.error.message);
    await act(async () => { expect(await h.app().handleCommitMachinePackage(prepared.prepared, { kind: 'install-new' })).toBe(true); });
    const fresh = await h.call('edm_workflow_context', {});
    expect(fresh.data.packagePreparationId).toBeNull();
    expect(await h.call('edm_install_machine_package', { expectedVersion: fresh.data.version, preparationId: receipt.data.preparationId, resolution: { kind: 'install-new' } })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
  });

  it('removes a DXF preparation from context when its captured workbench changes', async () => {
    const h = await harness();
    const context = await h.call('edm_workflow_context', {});
    const prepared = await h.call('edm_prepare_dxf', { expectedVersion: context.data.version, source: { fileName: 'part.dxf', text } });
    expect(prepared.ok).toBe(true);
    expect((await h.call('edm_workflow_context', {})).data.dxfPreparationId).toBe(prepared.data.preparationId);
    await act(async () => { await h.app().handleSaveCatalogPreferences(h.app().connectedWorkbench!.manifest.preferences); });
    const fresh = await h.call('edm_workflow_context', {});
    expect(fresh.data.version).not.toBe(context.data.version);
    expect(fresh.data.dxfPreparationId).toBeNull();
    expect(await h.call('edm_import_dxf', { expectedVersion: fresh.data.version, preparationId: prepared.data.preparationId, unitCandidateId: 'millimeters', declaredUnitOverrideAcknowledged: false })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
  });

  it('distinguishes unavailable history from a retained history with no undo step', async () => {
    const h = await harness();
    await importCircle(h);
    expect(await h.call('edm_draft_history', { draftVersion: 'draft', direction: 'undo' })).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
    h.draft().current = { ...h.draft().current!, history: () => false };
    expect(await h.call('edm_draft_history', { draftVersion: 'draft', direction: 'undo' })).toMatchObject({ ok: true, data: { changed: false } });
  });

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

  it.each(['cancel', 'draft-change'] as const)('rejects %s while controller generation waits for the storage lock', async change => {
    let entered!: () => void;
    const queued = new Promise<void>(resolve => { entered = resolve; });
    const h = await harness({ saveStoredWireEdmJobRevision: (...args) => {
      entered();
      return defaultAppServices.saveStoredWireEdmJobRevision(...args);
    } });
    const input = await prepareControllerJob(h);
    const adapter = h.app().connectedWorkbench!.adapter;
    let acquired!: () => void;
    let release!: () => void;
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const holder = withWorkbenchMutationLock(adapter, async () => { acquired(); await gate; });
    await locked;
    const write = vi.spyOn(adapter, 'writeText');
    const abort = new AbortController();
    let result: unknown;
    await act(async () => {
      const pending = h.execute('edm_export_controller', input, abort.signal);
      await queued;
      if (change === 'cancel') abort.abort();
      else h.draft().current = { ...h.draft().current!, version: 'changed-while-queued' };
      release();
      await holder;
      result = await pending;
    });
    expect(result).toMatchObject({ ok: false, error: { code: change === 'cancel' ? 'CANCELLED' : 'STALE_STATE' } });
    expect(write).not.toHaveBeenCalled();
    expect(h.app().loadedEditorProgram?.project.savedRevisionIds).toEqual([]);
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.download).not.toHaveBeenCalled();
  });

  it.each(['before-journal', 'after-journal'] as const)('handles cancellation at %s with a truthful persistence receipt', async boundary => {
    const h = await harness();
    const input = await prepareControllerJob(h);
    const adapter = h.app().connectedWorkbench!.adapter;
    const abort = new AbortController();
    if (boundary === 'before-journal') {
      const ensure = adapter.ensureDirectory.bind(adapter);
      vi.spyOn(adapter, 'ensureDirectory').mockImplementation(async path => {
        await ensure(path);
        if (path === 'transactions') abort.abort();
      });
    } else {
      const write = adapter.writeText.bind(adapter);
      vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
        await write(path, text);
        if (path === SAVED_REVISION_TRANSACTION_PATH) abort.abort();
      });
    }
    const result = await h.call('edm_export_controller', input, abort.signal);
    if (boundary === 'before-journal') {
      expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
      expect(h.app().loadedEditorProgram?.project.savedRevisionIds).toEqual([]);
      expect(h.generate).not.toHaveBeenCalled();
    } else {
      expect(result).toMatchObject({ ok: true, data: { generated: true, status: 'generated-download-not-requested' } });
      expect(h.app().loadedEditorProgram?.project.savedRevisionIds).toEqual([result.data.artifactId]);
      expect(h.generate).toHaveBeenCalledOnce();
    }
    expect(await adapter.readText(SAVED_REVISION_TRANSACTION_PATH)).toBeNull();
    expect(h.download).not.toHaveBeenCalled();
  });

  it('rejects an active setup changed in storage after controller revision preparation', async () => {
    let update: (() => Promise<void>) | undefined;
    const h = await harness({ createSavedWireEdmJobRevision: async input => {
      const candidate = await defaultAppServices.createSavedWireEdmJobRevision(input);
      await update?.();
      return candidate;
    } });
    const input = await prepareControllerJob(h);
    const adapter = h.app().connectedWorkbench!.adapter;
    update = async () => {
      const library = JSON.parse((await adapter.readText(MACHINE_LIBRARY_PATH))!);
      library.machines[0].bindings.push({ ...library.machines[0].bindings[0], id: 'alternate', name: 'Alternate' });
      library.machines[0].activeBindingId = 'alternate';
      await adapter.writeText(MACHINE_LIBRARY_PATH, JSON.stringify(library));
    };
    const result = await h.call('edm_export_controller', input);
    expect(result).toMatchObject({ ok: true, data: { generated: false, error: {
      message: expect.stringContaining('active setup')
    } } });
    expect(h.app().loadedEditorProgram?.project.savedRevisionIds).toEqual([]);
    expect(await adapter.readText(SAVED_REVISION_TRANSACTION_PATH)).toBeNull();
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.download).not.toHaveBeenCalled();
  });

  it('returns the committed revision and artifact when only recovery cleanup fails', async () => {
    const h = await harness();
    const input = await prepareControllerJob(h);
    const adapter = h.app().connectedWorkbench!.adapter;
    const remove = adapter.deleteText.bind(adapter);
    const deletion = vi.spyOn(adapter, 'deleteText').mockImplementation(async path => {
      if (path === SAVED_REVISION_TRANSACTION_PATH) throw new Error('Injected journal cleanup failure');
      return remove(path);
    });
    const result = await h.call('edm_export_controller', input);
    expect(result).toMatchObject({ ok: true, data: { generated: true, artifactId: expect.any(String),
      cleanupPending: { code: 'SAVED_REVISION_TRANSACTION_STORAGE_FAILED' } } });
    expect(h.app().loadedEditorProgram?.project.savedRevisionIds).toEqual([result.data.artifactId]);
    expect(await adapter.readText(SAVED_REVISION_TRANSACTION_PATH)).not.toBeNull();
    expect(h.generate).toHaveBeenCalledOnce();
    deletion.mockRestore();
    expect(await h.call('edm_download_artifact', { artifactId: result.data.artifactId })).toMatchObject({ ok: true });
    expect(h.generate).toHaveBeenCalledOnce();
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

  it('rejects DXF expansion through the agent tool and invalidates an older preparation after failure', async () => {
    const h = await harness();
    const { data: { version: expectedVersion } } = await h.call('edm_workflow_context', {});
    const first = await h.call('edm_prepare_dxf', { expectedVersion, source: { fileName: 'first.dxf', text } });
    expect(first.ok).toBe(true);
    const amplified = '0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nB\n0\nLINE\n10\n0\n20\n0\n11\n1\n21\n0\n0\nENDBLK\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nINSERT\n2\nB\n70\n1000\n71\n1000\n0\nENDSEC\n0\nEOF\n';
    expect(await h.call('edm_prepare_dxf', { expectedVersion, source: { fileName: 'second.dxf', text: amplified } }))
      .toMatchObject({ ok: false, error: { code: 'DXF_IMPORT_RESOURCE_LIMIT' } });
    expect(h.app().connectedWorkbench?.manifest.projects).toHaveLength(0);
    expect((await h.call('edm_workflow_context', {})).data.dxfPreparationId).toBeNull();
    expect(await h.call('edm_import_dxf', {
      expectedVersion, preparationId: first.data.preparationId, unitCandidateId: 'millimeters', declaredUnitOverrideAcknowledged: false
    })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    expect(h.app().connectedWorkbench?.manifest.projects).toHaveLength(0);
  });

  it('passes direct package bytes through the ordinary validator and preserves explicit collision review', async () => {
    const prepare = vi.fn(defaultAppServices.prepareStoredMachinePackageInstallation);
    const h = await harness({ prepareStoredMachinePackageInstallation: prepare });
    const { bytes, source } = await packageSource();
    const context = await h.call('edm_workflow_context', {});
    const prepared = await h.call('edm_prepare_machine_package', { expectedVersion: context.data.version, source });
    expect(prepared).toMatchObject({ ok: true, data: { preview: { machine: { kind: 'new' } } } });
    expect(prepare.mock.calls[0][1]).toEqual(bytes);
    const validated = await prepare.mock.results[0].value;
    if (!validated.ok) throw new Error(validated.error.message);
    expect(prepared.data.preview).toEqual(validated.preview);
    expect(h.app().connectedWorkbench!.machines.machines).toHaveLength(0);
    expect(await h.call('edm_install_machine_package', { expectedVersion: context.data.version, preparationId: prepared.data.preparationId, resolution: { kind: 'install-new' } }))
      .toMatchObject({ ok: true, data: { installed: true, packageHash: validated.preview.packageHash } });
    expect((await h.call('edm_workflow_context', {})).data.packagePreparationId).toBeNull();
    expect(h.app().connectedWorkbench!.machines.machines).toHaveLength(1);

    const next = await h.call('edm_workflow_context', {});
    expect(await h.call('edm_prepare_machine_package', { expectedVersion: context.data.version, source })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    const collision = await h.call('edm_prepare_machine_package', { expectedVersion: next.data.version, source });
    expect(collision).toMatchObject({ ok: true, data: { preview: { machine: { kind: 'exact' } } } });
    const input = { expectedVersion: next.data.version, preparationId: collision.data.preparationId };
    expect(await h.call('edm_install_machine_package', { ...input, resolution: { kind: 'install-new' } })).toMatchObject({ ok: false, error: { code: 'INSTALL_FAILED' } });
    expect(await h.call('edm_install_machine_package', { ...input, resolution: { kind: 'reuse-existing', machineId: collision.data.preview.machine.existing.id, activate: 'keep-current' } })).toMatchObject({ ok: true });
    expect(h.app().connectedWorkbench!.machines.machines).toHaveLength(1);
  });

  it('rejects malformed direct package input and requires explicit text without a selected-file fallback', async () => {
    const prepare = vi.fn(defaultAppServices.prepareStoredMachinePackageInstallation);
    const h = await harness({ prepareStoredMachinePackageInstallation: prepare });
    const { data: { version: expectedVersion } } = await h.call('edm_workflow_context', {});
    expect(await h.call('edm_prepare_machine_package', { expectedVersion, source: { fileName: 'test.wireedm-package', base64: 'AB==' } })).toMatchObject({ ok: false, error: { code: 'INVALID_ENCODING' } });
    expect(await h.call('edm_prepare_machine_package', { expectedVersion, source: { fileName: 'post.json', base64: 'e30=' } })).toMatchObject({ ok: false, error: { code: 'WRONG_FILE' } });
    expect(prepare).not.toHaveBeenCalled();
    expect(await h.call('edm_prepare_machine_package', { expectedVersion, source: { fileName: 'test.wireedm-package', base64: 'e30=' } })).toMatchObject({ ok: false, error: { code: 'MACHINE_PACKAGE_INVALID' } });
    expect(await h.call('edm_prepare_dxf', { expectedVersion })).toMatchObject({ ok: false, error: { code: 'FILE_REQUIRED' } });
    expect(await h.call('edm_import_upid', { expectedVersion })).toMatchObject({ ok: false, error: { code: 'FILE_REQUIRED' } });
    expect(await h.call('edm_prepare_dxf', { expectedVersion, source: { fileName: 'text.dxf', text: '界'.repeat(400_000) } })).toMatchObject({ ok: false, error: { code: 'INPUT_TOO_LARGE' } });
  });

  it('invalidates the previous package handle when a replacement preview fails', async () => {
    const h = await harness();
    const { source } = await packageSource();
    const { data: { version: expectedVersion } } = await h.call('edm_workflow_context', {});
    const prepared = await h.call('edm_prepare_machine_package', { expectedVersion, source });
    expect(prepared.ok).toBe(true);
    expect((await h.call('edm_workflow_context', {})).data.packagePreparationId).toBe(prepared.data.preparationId);

    const replacement = await h.call('edm_prepare_machine_package', {
      expectedVersion, source: { fileName: 'replacement.wireedm-package', base64: 'e30=' }
    });
    expect(replacement).toMatchObject({ ok: false, error: { code: 'MACHINE_PACKAGE_INVALID' } });
    expect((await h.call('edm_workflow_context', {})).data.packagePreparationId).toBeNull();
    expect(await h.call('edm_install_machine_package', {
      expectedVersion, preparationId: prepared.data.preparationId, resolution: { kind: 'install-new' }
    })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    expect(h.app().connectedWorkbench!.machines.machines).toHaveLength(0);
  });

  it.each(['cancel', 'workbench-change'] as const)('discards a pending package preparation after %s and blocks overlapping calls', async reason => {
    let finish!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const h = await harness({ prepareStoredMachinePackageInstallation: async (...args) => {
      entered(); await gate; return defaultAppServices.prepareStoredMachinePackageInstallation(...args);
    } });
    await importCircle(h);
    h.draft().current = { ...h.draft().current!, edit: () => undefined };
    expect(await h.call('edm_get_context', {})).toMatchObject({ ok: true, data: { busy: false, draft: { editsAvailable: true } } });
    const { source } = await packageSource();
    const context = await h.call('edm_workflow_context', {});
    const abort = new AbortController();
    let pending!: Promise<unknown>;
    await act(async () => { pending = h.execute('edm_prepare_machine_package', { expectedVersion: context.data.version, source }, abort.signal); await started; });
    expect(await h.call('edm_workflow_context', {})).toMatchObject({ ok: true, data: { busy: true, nextSteps: ['Wait for the running operation, then read edm_workflow_context again.'] } });
    expect(await h.call('edm_get_context', {})).toMatchObject({ ok: true, data: { busy: true, draft: { editsAvailable: false } } });
    expect(await h.call('edm_import_upid', { expectedVersion: context.data.version, source: { fileName: 'x.json', text: '{}' } })).toMatchObject({ ok: false, error: { code: 'BUSY' } });
    if (reason === 'cancel') abort.abort();
    else await act(async () => { await h.app().handleSaveCatalogPreferences(h.app().connectedWorkbench!.manifest.preferences); });
    let result: unknown;
    await act(async () => { finish(); result = await pending; });
    expect(result).toMatchObject({ ok: false, error: { code: reason === 'cancel' ? 'CANCELLED' : 'STALE_STATE' } });
    expect((await h.call('edm_workflow_context', {})).data.packagePreparationId).toBeNull();
    expect(h.app().connectedWorkbench!.machines.machines).toHaveLength(0);
    expect(await h.call('edm_get_context', {})).toMatchObject({ ok: true, data: { busy: false, draft: { editsAvailable: true } } });
  });

  it('cancels after installation preflight reads before any package write and allows a reviewed retry', async () => {
    const h = await harness();
    const { source } = await packageSource();
    const context = await h.call('edm_workflow_context', {});
    const prepared = await h.call('edm_prepare_machine_package', { expectedVersion: context.data.version, source });
    const adapter = h.app().connectedWorkbench!.adapter;
    const read = adapter.readExactText!.bind(adapter);
    const abort = new AbortController();
    const interrupted = vi.spyOn(adapter, 'readExactText').mockImplementation(async path => {
      const text = await read(path); if (path === MACHINE_LIBRARY_PATH) abort.abort(); return text;
    });
    const writes = vi.spyOn(adapter, 'writeText');
    const input = { expectedVersion: context.data.version, preparationId: prepared.data.preparationId, resolution: { kind: 'install-new' } };
    expect(await h.call('edm_install_machine_package', input, abort.signal)).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(writes).not.toHaveBeenCalled();
    expect(h.app().workbenchInteractionLocked).toBe(false);
    interrupted.mockRestore();
    expect(await h.call('edm_install_machine_package', input)).toMatchObject({ ok: true, data: { installed: true } });
  });

  it.each([false, true])('preserves the installation outcome after late cancellation, write failure=%s', async writeFailure => {
    const h = await harness();
    const { source } = await packageSource();
    const context = await h.call('edm_workflow_context', {});
    const prepared = await h.call('edm_prepare_machine_package', { expectedVersion: context.data.version, source });
    const adapter = h.app().connectedWorkbench!.adapter;
    const write = adapter.writeText.bind(adapter);
    const abort = new AbortController();
    let failNextMachineWrite = writeFailure;
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      if (path === MACHINE_LIBRARY_PATH && failNextMachineWrite) { failNextMachineWrite = false; throw new Error('Machine catalog write failed'); }
      await write(path, text); if (path === CATALOG_PAIR_TRANSACTION_PATH) abort.abort();
    });
    const result = await h.call('edm_install_machine_package', { expectedVersion: context.data.version, preparationId: prepared.data.preparationId, resolution: { kind: 'install-new' } }, abort.signal);
    expect(result).toMatchObject(writeFailure
      ? { ok: true, data: { installed: false, status: 'installation-failed', error: { code: 'INSTALL_FAILED' } } }
      : { ok: true, data: { installed: true, packageHash: prepared.data.preview.packageHash } });
    expect(h.app().connectedWorkbench!.machines.machines).toHaveLength(writeFailure ? 0 : 1);
    expect(await adapter.readText(CATALOG_PAIR_TRANSACTION_PATH)).toBeNull();
  });
});

function deferredGate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function holdMutationLock(adapter: Parameters<typeof withWorkbenchMutationLock>[0]) {
  const entered = deferredGate(), release = deferredGate();
  const pending = withWorkbenchMutationLock(adapter, async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  return { release: async () => { release.resolve(); await pending; } };
}
async function prepareSetupActivation(h: Awaited<ReturnType<typeof harness>>) {
  await prepareControllerJob(h);
  const input = await machinePackageFixture({ bindingId: 'spare' });
  const built = await buildMachinePackageArchive({ ...input, document: { ...input.document,
    machine: { ...input.document.machine, limits: { ...input.document.machine.limits, yTravel: { status: 'known', millimeters: 200 } } }
  } });
  if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
  const machine = h.app().connectedWorkbench!.machines.machines[0];
  const prepared = await prepareStoredMachinePackageInstallation(h.app().connectedWorkbench!, built.archive);
  if (!prepared.ok) throw new Error(prepared.error.message);
  await act(async () => { expect(await h.app().handleCommitMachinePackage(prepared.prepared,
    { kind: 'reuse-existing', machineId: machine.id, activate: 'keep-current' })).toBe(true); });
  return { expectedVersion: (await h.call('edm_workflow_context', {})).data.version, machineId: machine.id, bindingId: 'spare' };
}

describe('agent final save/open/setup guards', () => {
  it('keeps ordinary Save available with an unchanged view-only workflow', async () => {
    const h = await harness(), program = await importCircle(h);
    const document = applyProjectEdits(program.pathDocument, [{ kind: 'translate', delta: { x: 1, y: 0 } }]);
    h.draft().current = { ...h.draft().current!, document, dirty: true, workflowOpen: true, workflowCommand: 'export.preview' };
    let saved: unknown;
    await act(async () => { saved = await h.app().handleSaveEditorDraft({ model: 'upid-document', pathDocument: document }); });
    expect(saved).toMatchObject({ model: 'upid-document', project: { id: program.project.id } });
    expect(await h.call('edm_save_project', { draftVersion: 'draft' })).toMatchObject({ ok: false, error: { code: 'WORKFLOW_OPEN' } });
  });
  it.each(['cancel', 'draft-change', 'workflow'] as const)('rejects %s while saving waits for the actual storage lock, retains draft and allows retry', async reason => {
    const h = await harness();
    const program = await importCircle(h);
    const document = applyProjectEdits(program.pathDocument, [{ kind: 'translate', delta: { x: 1, y: 0 } }]);
    h.draft().current = { ...h.draft().current!, document, dirty: true };
    const adapter = h.app().connectedWorkbench!.adapter;
    const original = await adapter.readExactText!(program.filePath);
    const lock = await holdMutationLock(adapter);
    const writes = vi.spyOn(adapter, 'writeText');
    const abort = new AbortController();
    let pending!: Promise<unknown>;
    await act(async () => { pending = h.execute('edm_save_project', { draftVersion: 'draft' }, abort.signal); });
    expect(writes).not.toHaveBeenCalled();
    if (reason === 'cancel') abort.abort();
    else h.draft().current = { ...h.draft().current!, ...(reason === 'draft-change'
      ? { version: 'new-draft', document: applyProjectEdits(document, [{ kind: 'translate', delta: { x: 2, y: 0 } }]) }
      : { workflowOpen: true }) };
    const latest = h.draft().current;
    let result: unknown;
    await act(async () => { await lock.release(); result = await pending; });
    expect(result).toMatchObject({ ok: false, error: { code: reason === 'cancel' ? 'CANCELLED' : 'STALE_STATE' } });
    expect(writes).not.toHaveBeenCalled();
    expect(await adapter.readExactText!(program.filePath)).toBe(original);
    expect(h.app().loadedEditorProgram).toBe(program);
    expect(h.draft().current).toBe(latest);
    expect(h.app().workbenchInteractionLocked).toBe(false);
    h.draft().current = { ...latest!, workflowOpen: false };
    expect(await h.call('edm_save_project', { draftVersion: h.draft().current!.version })).toMatchObject({ ok: true, data: { saved: true } });
  });

  it.each([false, true])('reports actual save outcome after journal-start cancellation, write failure=%s', async failWrite => {
    const h = await harness();
    const program = await importCircle(h);
    h.draft().current = { ...h.draft().current!, dirty: true,
      document: applyProjectEdits(program.pathDocument, [{ kind: 'translate', delta: { x: 1, y: 0 } }]) };
    const adapter = h.app().connectedWorkbench!.adapter, abort = new AbortController();
    const original = await adapter.readExactText!(program.filePath);
    const write = adapter.writeText.bind(adapter);
    let failing = failWrite;
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      if (path === program.filePath && failing) { failing = false; throw new Error('Project write interrupted'); }
      await write(path, text);
      if (path === WORKBENCH_FILE_TRANSACTION_PATH) abort.abort();
    });
    expect(await h.call('edm_save_project', { draftVersion: 'draft' }, abort.signal)).toMatchObject(failWrite
      ? { ok: true, data: { saved: false, status: 'save-failed', error: { code: 'SAVE_FAILED' } } }
      : { ok: true, data: { saved: true, projectId: program.project.id } });
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    expect(h.app().workbenchInteractionLocked).toBe(false);
    if (failWrite) expect(await adapter.readExactText!(program.filePath)).toBe(original);
    else expect(h.app().loadedEditorProgram).not.toBe(program);
  });

  it.each(['cancel', 'draft-change'] as const)('rejects %s after a real project read before opening replaces visible state', async reason => {
    const h = await harness();
    const program = await importCircle(h);
    await act(async () => h.app().handleBackToDashboard());
    h.draft().current = null;
    const context = await h.call('edm_workflow_context', {});
    const adapter = h.app().connectedWorkbench!.adapter, read = adapter.readText.bind(adapter);
    const waiting = deferredGate(), reading = deferredGate(), abort = new AbortController();
    const paused = vi.spyOn(adapter, 'readText').mockImplementation(async path => {
      if (path === program.filePath) { reading.resolve(); await waiting.promise; }
      return read(path);
    });
    let pending!: Promise<unknown>;
    await act(async () => { pending = h.execute('edm_open_project', { expectedVersion: context.data.version, projectId: program.project.id }, abort.signal); await reading.promise; });
    if (reason === 'cancel') abort.abort();
    else h.draft().current = { projectId: program.project.id, version: 'new-draft', document: program.pathDocument, dirty: true, workflowOpen: false };
    const latest = h.draft().current;
    let result: unknown;
    await act(async () => { waiting.resolve(); result = await pending; });
    expect(result).toMatchObject({ ok: false, error: { code: reason === 'cancel' ? 'CANCELLED' : 'STALE_STATE' } });
    expect(h.app().activeView).toBe('dashboard');
    expect(h.app().loadedEditorProgram).toBeNull();
    expect(h.draft().current).toBe(latest);
    expect(h.app().workbenchInteractionLocked).toBe(false);
    paused.mockRestore(); h.draft().current = null;
    expect(await h.call('edm_open_project', { expectedVersion: context.data.version, projectId: program.project.id })).toMatchObject({ ok: true, data: { opened: true } });
  });

  it('cancels setup activation while waiting for the actual storage lock, then permits retry', async () => {
    const h = await harness(), input = await prepareSetupActivation(h);
    const adapter = h.app().connectedWorkbench!.adapter;
    const original = await adapter.readExactText!(MACHINE_LIBRARY_PATH), lock = await holdMutationLock(adapter);
    const writes = vi.spyOn(adapter, 'writeText'), abort = new AbortController();
    let pending!: Promise<unknown>;
    await act(async () => { pending = h.execute('edm_activate_setup', input, abort.signal); });
    expect(writes).not.toHaveBeenCalled(); abort.abort();
    let result: unknown;
    await act(async () => { await lock.release(); result = await pending; });
    expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(writes).not.toHaveBeenCalled(); expect(await adapter.readExactText!(MACHINE_LIBRARY_PATH)).toBe(original);
    expect(h.app().workbenchInteractionLocked).toBe(false);
    expect(await h.call('edm_activate_setup', input)).toMatchObject({ ok: true, data: { activated: true, bindingId: 'spare' } });
  });

  it.each([false, true])('reports actual setup outcome after journal-start cancellation, write failure=%s', async failWrite => {
    const h = await harness(), input = await prepareSetupActivation(h);
    const adapter = h.app().connectedWorkbench!.adapter, abort = new AbortController();
    const original = await adapter.readExactText!(MACHINE_LIBRARY_PATH), write = adapter.writeText.bind(adapter);
    let failing = failWrite;
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      if (path === MACHINE_LIBRARY_PATH && failing) { failing = false; throw new Error('Machine write interrupted'); }
      await write(path, text); if (path === WORKBENCH_FILE_TRANSACTION_PATH) abort.abort();
    });
    expect(await h.call('edm_activate_setup', input, abort.signal)).toMatchObject(failWrite
      ? { ok: true, data: { activated: false, status: 'activation-failed', error: { code: 'ACTIVATION_FAILED' } } }
      : { ok: true, data: { activated: true, bindingId: 'spare' } });
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    expect(h.app().workbenchInteractionLocked).toBe(false);
    if (failWrite) expect(await adapter.readExactText!(MACHINE_LIBRARY_PATH)).toBe(original);
    else expect(h.app().connectedWorkbench!.machines.machines[0].activeBindingId).toBe('spare');
  });
});
