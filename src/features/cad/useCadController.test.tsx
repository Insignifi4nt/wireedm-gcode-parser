import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { initializeWorkbenchCatalog, type ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import type { CadBuildResult } from '@/domain/cad/cadDocument';
import type { CadSectionResult } from '@/domain/cad/cadSection';
import { loadCadDocument } from '@/domain/cad/cadStorage';
import { CadSession } from './cadSession';
import { useCadController, type CadController } from './useCadController';
import { cadSiteTools } from './cadSiteTools';
import type { CadViewportCapture, CadViewportState } from './cadViewportControls';
import { loadEditorProgram } from '@/domain/editor/loadEditorProgram';

const kernel = vi.hoisted(() => ({ build: vi.fn(), section: vi.fn(), export: vi.fn(), dispose: vi.fn() }));
vi.mock('./kernel/cadKernelClient', () => ({ createCadKernelClient: () => kernel }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred not initialized'); };
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function openWorkbench(namespace: string) {
  const result = await initializeWorkbenchCatalog(createBrowserCacheAdapter(localStorage, { namespace }));
  if (!result.ok) throw new Error(result.error.message);
  return result.workbench;
}
async function harness(withGeometry = false, allowHandoff = false) {
  let workbench = await openWorkbench('cad-controller-a');
  const session = new CadSession(withGeometry ? parseCadDocument({ ...createCadDocument('Part', 'cad_part'), features: [{
    id: 'sketch', kind: 'sketch', name: 'Profile', plane: 'XY', offset: 0, suppressed: false,
    profiles: [{ id: 'circle', name: 'Circle', construction: false, role: 'outer', geometry: { kind: 'circle', x: 0, y: 0, radius: 10 } }]
  }] }) : createCadDocument());
  let current: CadController | undefined;
  function Harness() {
    const [open, setOpen] = useState(true);
    current = useCadController({ connectedWorkbench: workbench, workbenchInteractionLocked: false,
      runAgentWorkbenchOperation: async action => {
        if (!allowHandoff) throw new Error('Unexpected CAM handoff');
        const result = await action(workbench); workbench = result.workbench; return result.value;
      }
    }, session, open, setOpen, () => null);
    return null;
  }
  const cad = () => { if (!current) throw new Error('Hook not rendered'); return current; };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root?.render(<Harness />));
  return { cad, session, workbench: () => workbench, switchWorkbench: async (next: ConnectedWorkbenchCatalog) => { workbench = next; await act(async () => root?.render(<Harness />)); } };
}

describe('CAD controller asynchronous guards', () => {
  it('bounds context diagnostics so accepted edits still return a truthful success receipt', async () => {
    const h = await harness(true);
    await act(async () => h.session.edit(Array.from({ length: 128 }, (_, index) => ({ kind: 'set-parameter', name: `dimension_${index}_${'x'.repeat(45)}`, value: index }))));
    const diagnostics = Array.from({ length: 256 }, (_, index) => ({ code: 'kernel-failure', message: `Feature ${index}: ${'The current body is unavailable. '.repeat(10)}` }));
    kernel.build.mockResolvedValue({ meshes: [], diagnostics, durationMs: 1 });
    await act(async () => { await h.cad().inspectBuild(); });
    const tools = cadSiteTools(h.cad);
    const context = tools.find(tool => tool.name === 'cad_get_context');
    const edit = tools.find(tool => tool.name === 'cad_edit_document');
    if (!context || !edit) throw new Error('CAD context/edit tools missing.');
    expect(await context.execute({})).toMatchObject({ ok: true, data: { diagnostics: diagnostics.slice(0, 10), omittedDiagnostics: 246 } });
    let receipt: unknown;
    await act(async () => { receipt = await edit.execute({ expectedVersion: h.session.getSnapshot().version, edits: [{ kind: 'rename-document', name: 'Accepted edit' }] }); });
    expect(receipt).toMatchObject({ ok: true, data: { name: 'Accepted edit' } });
    expect(h.session.getSnapshot().document.name).toBe('Accepted edit');
    expect(new TextEncoder().encode(JSON.stringify(receipt)).length).toBeLessThan(32 * 1024);
  });
  it('captures bounded real-image data with CAD draft provenance and exposes only its local artifact receipt', async () => {
    const h = await harness(true); const snapshot = h.session.getSnapshot();
    const state: CadViewportState = { documentId: snapshot.document.id, documentVersion: snapshot.version, dirty: true,
      selectedFeatureId: null, selectedProfileId: null, sketchId: null, workflowOpen: false, busy: false, buildVersion: snapshot.version,
      buildState: 'ready', visibleBodyIds: [], view: { mode: 'solid', available: true, view: 'Top', gridVisible: true, zoom: 1, revision: 0 } };
    const capture: CadViewportCapture = { contentSource: 'cad-draft', documentId: snapshot.document.id, documentVersion: snapshot.version, dirty: true,
      sketchId: null, buildVersion: snapshot.version, viewState: state,
      image: { source: '3d', width: 1, height: 1, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDSkAAAAASUVORK5CYII=' } };
    h.cad().setViewportControls({ getState: () => state, apply: vi.fn(), capture: async () => capture });
    let receipt: unknown;
    await act(async () => { receipt = await h.cad().captureViewport(snapshot.version); });
    expect(receipt).toMatchObject({ documentId: snapshot.document.id, draftVersion: snapshot.version, dirty: true, contentSource: 'cad-draft', source: '3d', downloadRequested: false, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(receipt)).not.toContain('base64');
    expect(h.cad().previewArtifact?.previewUrl).toMatch(/^blob:/);
  });
  it('lets agents reconstruct large CAD definitions through versioned bounded text chunks', async () => {
    const h = await harness(true); const state = h.session.getSnapshot();
    const tools = cadSiteTools(h.cad); const read = tools.find(tool => tool.name === 'cad_read_document');
    const describe = tools.find(tool => tool.name === 'cad_describe_features');
    if (!read || !describe) throw new Error('CAD discovery tools missing');
    let offset: number | null = 0; let text = '';
    while (offset !== null) {
      const reply = await read.execute({ expectedVersion: state.version, offset, length: 53 });
      expect(reply).toMatchObject({ ok: true });
      const data = (reply as { data: { text: string; nextOffset: number | null } }).data;
      text += data.text; offset = data.nextOffset;
    }
    expect(JSON.parse(text)).toEqual(state.document);
    expect(await describe.execute({ kind: 'chamfer' })).toMatchObject({ ok: true, data: { kind: 'chamfer', schema: { required: expect.arrayContaining(['targetId', 'radius']) } } });
    await act(async () => h.session.edit([{ kind: 'rename-document', name: 'Next version' }]));
    await expect(read.execute({ expectedVersion: state.version })).resolves.toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
  });
  const section: CadSectionResult = { bodyId: 'pad', plane: 'XY', offset: 5, contourCount: 1,
    entities: [{ type: 'circle', layer: 'CAD_SECTION', center: { x: 0, y: 0 }, radius: 4 }] };
  it('hands a reviewed final-solid section through the ordinary saved CAD and portable CAM operations', async () => {
    const h = await harness(true, true); kernel.section.mockResolvedValue(section);
    const version = h.session.getSnapshot().version;
    await act(async () => h.session.setWorkflowOpen(true, 'section'));
    await expect(h.cad().sendSectionToCam({ bodyId: 'pad', plane: 'XY', offset: 5 }, version)).rejects.toMatchObject({ code: 'WORKFLOW_OPEN' });
    let receipt: unknown;
    await act(async () => { receipt = await h.cad().sendSectionToCam({ bodyId: 'pad', plane: 'XY', offset: 5 }, version, undefined, 'section'); });
    expect(receipt).toMatchObject({ opened: true, sourceDocumentId: 'cad_part', sourceSavedVersion: expect.any(String), section: { bodyId: 'pad', plane: 'XY', offset: 5, contourCount: 1 } });
    expect(h.session.getSnapshot()).toMatchObject({ dirty: false, workflowOpen: false });
    expect(h.workbench().manifest.projects).toHaveLength(1);
    expect(h.cad().isOpen()).toBe(false);
  });
  it('reports a created CAM project that cannot open and preserves both durable saves without retrying creation', async () => {
    const h = await harness(true, true); kernel.section.mockResolvedValue(section);
    const adapter = h.workbench().adapter;
    const originalRead = adapter.readText.bind(adapter);
    const failure = vi.spyOn(adapter, 'readText').mockImplementation(async path => {
      const text = await originalRead(path);
      // Exact transaction verification uses readExactText. Fail only the normal
      // editor read once a real project has already been durably committed.
      if (path.startsWith('projects/') && text !== null) throw new Error('Temporary editor read failure');
      return text;
    });
    await act(async () => h.session.setWorkflowOpen(true, 'section'));
    let receipt: Awaited<ReturnType<CadController['sendSectionToCam']>> | undefined;
    await act(async () => { receipt = await h.cad().sendSectionToCam({ bodyId: 'pad', plane: 'XY', offset: 5 }, h.session.getSnapshot().version, undefined, 'section'); });
    if (!receipt) throw new Error('Missing durable handoff receipt.');
    expect(receipt).toMatchObject({ opened: false, sourceDocumentId: 'cad_part', sourceSavedVersion: expect.any(String), error: expect.stringContaining('Temporary editor read failure') });
    expect(h.cad().errorMessage).toContain(receipt.projectId);
    expect(h.cad().errorMessage).toContain('was created, but could not open');
    expect(h.workbench().manifest.projects).toHaveLength(1);
    expect(h.session.getSnapshot()).toMatchObject({ dirty: false, workflowOpen: false });
    expect(h.cad().isOpen()).toBe(true);
    failure.mockRestore();
    expect(await loadEditorProgram(h.workbench(), receipt.projectId)).toMatchObject({ ok: true });
    expect((await loadCadDocument(adapter, 'cad_part')).document.name).toBe('Part');
  });
  it('holds the operation lock and restores the section workflow after a rejected section without saving', async () => {
    const h = await harness(true, true); kernel.section.mockRejectedValue(new Error('Unsupported ellipse section'));
    const before = h.session.getSnapshot();
    await act(async () => h.session.setWorkflowOpen(true, 'section'));
    await act(async () => {
      const operation = h.cad().sendSectionToCam({ bodyId: 'pad', plane: 'XY', offset: 5 }, before.version, undefined, 'section');
      expect(h.cad().isBusy()).toBe(true);
      expect(h.session.getSnapshot().workflowOpen).toBe(false);
      await expect(operation).rejects.toThrow('Unsupported ellipse');
    });
    expect(h.session.getSnapshot()).toMatchObject({ dirty: true, workflowOpen: true, savedVersion: null });
    expect(h.workbench().manifest.projects).toHaveLength(0);
    expect(h.cad().isBusy()).toBe(false);
  });
  it('rejects a section result after a draft edit while the kernel was running', async () => {
    const h = await harness(true); const result = deferred<CadSectionResult>(); kernel.section.mockReturnValue(result.promise);
    const before = h.session.getSnapshot(); let operation: Promise<unknown> | undefined;
    await act(async () => { operation = h.cad().inspectSection({ bodyId: 'pad', plane: 'XY', offset: 5 }, before.version); });
    await act(async () => h.session.edit([{ kind: 'rename-document', name: 'Changed' }]));
    await act(async () => { result.resolve(section); await expect(operation).rejects.toMatchObject({ code: 'STALE_STATE' }); });
  });
  it('starts a fresh CAD session after a deliberate clean storage switch and retains the original save', async () => {
    const h = await harness(true); const original = h.workbench();
    await act(async () => { await h.cad().save(); h.cad().back(); });
    expect(h.session.getSnapshot().savedVersion).not.toBeNull();
    await h.switchWorkbench(await openWorkbench('cad-controller-new-store'));
    expect(h.session.getSnapshot()).toMatchObject({ savedVersion: null, document: { name: 'Untitled part', features: [] } });
    expect((await loadCadDocument(original.adapter, 'cad_part')).document.name).toBe('Part');
    await act(async () => { h.cad().enter(); await h.cad().save(); });
    expect(h.session.getSnapshot().dirty).toBe(false);
  });
  it('imports an agent document as a fresh unsaved draft through the visible import operation', async () => {
    const h = await harness();
    const source = parseCadDocument({ ...createCadDocument('Parametric part', 'cad_source'), parameters: { diameter: 12 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Profile', plane: 'XY', offset: 0, suppressed: false,
      profiles: [{ id: 'circle', name: 'Circle', construction: false, role: 'outer', geometry: { kind: 'circle', x: 0, y: 0, radius: 'diameter / 2' } }]
    }] });
    const tool = cadSiteTools(h.cad).find(value => value.name === 'cad_import_document');
    if (!tool) throw new Error('Import document tool missing');
    const initial = h.session.getSnapshot();
    let receipt: unknown;
    await act(async () => { receipt = await tool.execute({ expectedVersion: initial.version, document: source }); });
    const imported = h.session.getSnapshot();
    expect(receipt).toMatchObject({ ok: true, data: { imported: true, sourceDocumentId: source.id, documentId: imported.document.id, open: true } });
    expect(imported.document.id).not.toBe(source.id); expect(imported.document.features).toEqual(source.features);
    expect(imported.document.parameters).toEqual(source.parameters); expect(imported.version).not.toBe(initial.version);
    expect(imported.dirty).toBe(true); expect(imported.savedVersion).toBeNull(); expect(imported.canUndo).toBe(false);
  });
  it('rejects malformed, cancelled, stale and unsaved-draft imports without changing the accepted draft', async () => {
    const h = await harness(); const before = h.session.getSnapshot();
    await act(async () => {
      await expect(h.cad().importDocumentValue({ ...createCadDocument(), units: 'inch' }, before.version)).rejects.toMatchObject({ code: 'invalid-document' });
      const abort = new AbortController(); abort.abort();
      await expect(h.cad().importDocumentValue(createCadDocument(), before.version, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
      await expect(h.cad().importDocumentValue(createCadDocument(), 'stale')).rejects.toMatchObject({ code: 'STALE_STATE' });
    });
    expect(h.session.getSnapshot()).toBe(before);
    await act(async () => h.session.edit([{ kind: 'set-parameter', name: 'width', value: 5 }]));
    const edited = h.session.getSnapshot();
    await act(async () => { await expect(h.cad().importDocumentValue(createCadDocument(), edited.version)).rejects.toMatchObject({ code: 'UNSAVED_DRAFT' }); });
    expect(h.session.getSnapshot()).toBe(edited);
  });
  it('measures sketch data through a paginated read-only agent operation with version and workflow guards', async () => {
    const h = await harness(true); const tool = cadSiteTools(h.cad).find(value => value.name === 'cad_measure_sketch');
    if (!tool) throw new Error('Measure sketch tool missing');
    const before = h.session.getSnapshot(); let receipt: unknown;
    await act(async () => { receipt = await tool.execute({ expectedVersion: before.version, sketchId: 'sketch', limit: 1 }); });
    expect(receipt).toMatchObject({ ok: true, data: { version: before.version, materialAreaMm2: 100 * Math.PI, boundaryLengthMm: 20 * Math.PI, profiles: { total: 1, items: [{ profileId: 'circle' }], nextOffset: null } } });
    expect(h.session.getSnapshot()).toBe(before);
    await expect(tool.execute({ expectedVersion: 'stale', sketchId: 'sketch' })).resolves.toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    await act(async () => h.session.setWorkflowOpen(true));
    await expect(tool.execute({ expectedVersion: before.version, sketchId: 'sketch' })).resolves.toMatchObject({ ok: false, error: { code: 'WORKFLOW_OPEN' } });
  });
  it('reports committed workspace opening in the same tool receipt before React rerenders', async () => {
    const h = await harness();
    await act(async () => h.cad().back());
    const tool = cadSiteTools(h.cad).find(value => value.name === 'cad_create_document');
    if (!tool) throw new Error('Create document tool missing');
    let result: unknown;
    await act(async () => { result = await tool.execute({ expectedVersion: h.session.getSnapshot().version, name: 'Part' }); });
    expect(result).toMatchObject({ ok: true, data: { open: true, name: 'Part' } });
  });
  it('preserves the draft if storage switches during a portable file read', async () => {
    const h = await harness(); const input = deferred<string>();
    const file = new File([], 'import.cad.json');
    Object.defineProperty(file, 'text', { value: () => input.promise });
    const initial = h.session.getSnapshot();
    let operation: Promise<unknown> | undefined;
    await act(async () => { operation = h.cad().importDocument(file); });
    await h.switchWorkbench(await openWorkbench('cad-controller-b'));
    await act(async () => {
      input.resolve(JSON.stringify(createCadDocument('Imported', 'cad_imported')));
      await expect(operation).rejects.toMatchObject({ code: 'STALE_STATE' });
    });
    expect(h.session.getSnapshot().document).toBe(initial.document);
  });
  it('guards unsaved CAD on page exit after returning to CAM', async () => {
    const h = await harness(true);
    await act(async () => h.cad().back());
    expect(h.cad().open).toBe(false);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
  it('blocks a solid download when an editor workflow starts during kernel export', async () => {
    const h = await harness(true); const result = deferred<Blob>(); kernel.export.mockReturnValue(result.promise);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    let operation: Promise<unknown> | undefined;
    await act(async () => { operation = h.cad().exportSolid('step'); });
    await vi.waitFor(() => expect(kernel.export).toHaveBeenCalled());
    await act(async () => h.session.setWorkflowOpen(true));
    await act(async () => { result.resolve(new Blob(['STEP'])); await expect(operation).rejects.toMatchObject({ code: 'WORKFLOW_OPEN' }); });
    expect(click).not.toHaveBeenCalled();
  });
  it('does not publish an inspected build after a visible workflow starts', async () => {
    const h = await harness(true); const result = deferred<CadBuildResult>(); kernel.build.mockReturnValue(result.promise);
    let operation: Promise<unknown> | undefined;
    await act(async () => { operation = h.cad().inspectBuild(); });
    await vi.waitFor(() => expect(kernel.build).toHaveBeenCalled());
    await act(async () => h.session.setWorkflowOpen(true));
    await act(async () => { result.resolve({ meshes: [], diagnostics: [], durationMs: 1 }); await expect(operation).rejects.toMatchObject({ code: 'WORKFLOW_OPEN' }); });
    expect(h.cad().build).toBeNull();
  });
  it('honors DXF tool cancellation before issuing a browser download', async () => {
    const h = await harness(true); const abort = new AbortController();
    const tool = cadSiteTools(h.cad).find(value => value.name === 'cad_export_dxf');
    if (!tool) throw new Error('DXF tool missing');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    let operation: Promise<unknown> | undefined;
    await act(async () => { operation = tool.execute({ expectedVersion: h.session.getSnapshot().version, sketchId: 'sketch' }, { signal: abort.signal }); abort.abort(); });
    await expect(operation).resolves.toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(click).not.toHaveBeenCalled();
  });
});
