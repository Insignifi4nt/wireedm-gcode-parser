import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { initializeWorkbenchCatalog, type ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import type { CadBuildResult, CadFeature } from '@/domain/cad/cadDocument';
import type { CadSectionResult } from '@/domain/cad/cadSection';
import type { CadTopologyDescriptor, CadTopologyInspectRequest } from '@/domain/cad/cadTopology';
import { cadDocumentPath, loadCadDocument } from '@/domain/cad/cadStorage';
import { CAD_BUDGET_APP_ID, CAD_FORMER_DOCUMENT_BYTES, cadBudgetFixture, cadBudgetOriginals, utf8Bytes, utf8Hash } from '@/domain/cad/__tests__/cadBudgetFixture';
import { CadSession } from './cadSession';
import { useCadController, type CadController } from './useCadController';
import { cadSiteTools } from './cadSiteTools';
import { CAD_STAR_PLUGIN, CAD_GEAR_V2_PLUGIN, createCadPluginProfile, fingerprintCadPluginPackage } from '@/domain/cad/plugins/cadPlugins';
import type { CadViewportCapture, CadViewportState } from './cadViewportControls';
import { cadReferencePlanes, prepareCadViewportReferences } from './cadViewportReferences';
import { loadEditorProgram } from '@/domain/editor/loadEditorProgram';
import { importCadDxfSketch, type CadDxfImportInput, type CadDxfImportResult } from '@/domain/cad/cadDxfImport';
import { importCadDxfCurve, type CadDxfCurveImportInput, type CadDxfCurveImportResult } from '@/domain/cad/cadCurveDxf';
import { parseDxf } from '@/domain/dxf/parseDxf';

const kernel = vi.hoisted(() => ({ build: vi.fn(), section: vi.fn(), export: vi.fn(), importSolid: vi.fn(), importDxf: vi.fn(), importDxfCurve: vi.fn(), inspectTopology: vi.fn(), resolveTopologyPicks: vi.fn(), dispose: vi.fn() }));
const createClient = vi.hoisted(() => vi.fn());
vi.mock('./kernel/cadKernelClient', () => ({ createCadKernelClient: createClient }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); createClient.mockReset().mockReturnValue(kernel); });
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred not initialized'); };
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function sourceTextFile(text: string, name: string) {
  const file = new File([text], name), bytes = new TextEncoder().encode(text);
  Object.defineProperty(file, 'stream', { value: () => {
    let offset = 0;
    return new ReadableStream<Uint8Array>({ pull(controller) {
      if (offset === bytes.length) { controller.close(); return; }
      const end = Math.min(offset + 64 * 1024, bytes.length); controller.enqueue(bytes.subarray(offset, end)); offset = end;
    } });
  } });
  return file;
}
async function openWorkbench(namespace: string) {
  const result = await initializeWorkbenchCatalog(createBrowserCacheAdapter(localStorage, { namespace }));
  if (!result.ok) throw new Error(result.error.message);
  return result.workbench;
}
function largeGroupedParameterDocument() {
  const names = Array.from({ length: 1001 }, (_, index) => `p_${String(index).padStart(5, '0')}_${'x'.repeat(56)}`);
  const groups = Array.from({ length: 8 }, (_, index) => ({ id: `group_${index}_${'x'.repeat(87)}`, name: `${'孔'.repeat(154)}_${index}` }));
  const parameters = Object.fromEntries(names.map((name, index) => [name, (index + 1) / 7]));
  const document = parseCadDocument({ ...createCadDocument('Grouped parameters', 'cad_context_source'), parameters, parameterGroups: groups,
    parameterMetadata: Object.fromEntries(names.map((name, index) => [name, { groupId: groups[Math.floor(index / 128)].id, source: { kind: 'manual' } }])),
    features: [{ id: 'section', kind: 'sketch', name: 'Linked section', suppressed: false, plane: 'XY', offset: 0,
      profiles: [{ id: 'circle', name: 'Linked radius', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: names[1000] } }] }],
  });
  return { document, names, groups };
}
async function harness(withGeometry = false, allowHandoff = false) {
  let workbench: ConnectedWorkbenchCatalog | null = await openWorkbench('cad-controller-a');
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
        if (!workbench) throw new Error('Workbench disconnected');
        const result = await action(workbench); workbench = result.workbench; return result.value;
      }
    }, session, open, setOpen, () => null);
    return null;
  }
  const cad = () => { if (!current) throw new Error('Hook not rendered'); return current; };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root?.render(<Harness />));
  return { cad, session, workbench: () => { if (!workbench) throw new Error('Workbench disconnected'); return workbench; }, switchWorkbench: async (next: ConnectedWorkbenchCatalog | null) => { workbench = next; await act(async () => root?.render(<Harness />)); } };
}

describe('CAD controller asynchronous guards', () => {
  it('returns truthful bounded context for 1001 parameters and full member groups while every exact value remains readable', async () => {
    const h = await harness(), source = largeGroupedParameterDocument();
    await act(async () => { await h.cad().importDocumentValue(source.document); });
    const before = h.session.getSnapshot(), tools = cadSiteTools(h.cad);
    const context = tools.find(tool => tool.name === 'cad_get_context'), inspect = tools.find(tool => tool.name === 'cad_inspect_parameters');
    const read = tools.find(tool => tool.name === 'cad_read_document');
    if (!context || !inspect || !read) throw new Error('Missing parameter read tools.');
    const result = await context.execute({});
    expect(result).toMatchObject({ ok: true, data: { version: before.version, documentId: before.document.id,
      parameterCount: 1001, omittedParameters: true, parameterGroupCount: 8, omittedParameterGroups: true,
      dirty: true, savedVersion: null, workflowOpen: false } });
    const data = (result as { data: { parameters: Record<string, number>; parameterGroups: typeof source.groups; omittedParameterCount: number; omittedParameterGroupCount: number } }).data;
    expect(Object.keys(data.parameters).length + data.omittedParameterCount).toBe(1001);
    expect(data.parameterGroups.length + data.omittedParameterGroupCount).toBe(8);
    expect(utf8Bytes(JSON.stringify(data.parameters))).toBeLessThanOrEqual(4096);
    expect(utf8Bytes(JSON.stringify(data.parameterGroups))).toBeLessThanOrEqual(4096);
    for (const [name, value] of Object.entries(data.parameters)) expect(value).toBe(source.document.parameters[name]);
    expect(data.parameterGroups).toEqual(source.groups.slice(0, data.parameterGroups.length));
    expect(utf8Bytes(JSON.stringify(result))).toBeLessThan(32768);
    const parameters: Record<string, number> = {}; let offset: number | null = 0;
    while (offset !== null) {
      const page = await inspect.execute({ expectedVersion: before.version, offset, limit: 50 });
      expect(page).toMatchObject({ ok: true, data: { version: before.version, total: 1001 } });
      const pageData = (page as { data: { items: { name: string; value: number; groupId: string }[]; nextOffset: number | null } }).data;
      expect(pageData.items.length).toBeGreaterThan(0);
      for (const parameter of pageData.items) {
        expect(parameters).not.toHaveProperty(parameter.name); parameters[parameter.name] = parameter.value;
        expect(parameter.groupId).toBe(source.document.parameterMetadata?.[parameter.name].groupId);
      }
      if (pageData.nextOffset !== null) expect(pageData.nextOffset).toBeGreaterThan(offset);
      offset = pageData.nextOffset;
    }
    expect(parameters).toEqual(source.document.parameters);
    let text = ''; offset = 0;
    while (offset !== null) {
      const chunk = await read.execute({ expectedVersion: before.version, offset, length: 4096 });
      expect(chunk).toMatchObject({ ok: true });
      const chunkData = (chunk as { data: { text: string; nextOffset: number | null } }).data;
      text += chunkData.text; offset = chunkData.nextOffset;
    }
    expect(JSON.parse(text)).toEqual(before.document);
    expect(h.session.getSnapshot()).toBe(before);
  });
  it('returns a fresh bounded receipt after a real large-parameter edit and rejects stale retries without duplicate history', async () => {
    const h = await harness(), source = largeGroupedParameterDocument();
    await act(async () => { await h.cad().importDocumentValue(source.document); });
    const before = h.session.getSnapshot(), tools = cadSiteTools(h.cad);
    const edit = tools.find(tool => tool.name === 'cad_edit_document'), context = tools.find(tool => tool.name === 'cad_get_context'), history = tools.find(tool => tool.name === 'cad_history');
    if (!edit || !context || !history) throw new Error('Missing guarded mutation tools.');
    const request = { expectedVersion: before.version, edits: [{ kind: 'set-parameter', name: source.names[1000], value: 20.123456789012345 }] };
    let result: unknown;
    await act(async () => { result = await edit.execute(request); });
    const after = h.session.getSnapshot();
    expect(after.document.parameters[source.names[1000]]).toBe(20.123456789012345);
    expect(after.document.features).toEqual(before.document.features);
    expect(result).toMatchObject({ ok: true, data: { version: after.version, documentId: after.document.id,
      parameterCount: 1001, omittedParameters: true, dirty: true, savedVersion: null, workflowOpen: false, canUndo: true } });
    expect(utf8Bytes(JSON.stringify(result))).toBeLessThan(32768);
    expect(await context.execute({})).toMatchObject({ ok: true, data: { version: after.version, documentId: after.document.id } });
    await act(async () => { expect(await edit.execute(request)).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } }); });
    expect(h.session.getSnapshot()).toBe(after);
    await act(async () => { expect(await edit.execute({ ...request, expectedVersion: after.version })).toMatchObject({ ok: true, data: { version: after.version } }); });
    expect(h.session.getSnapshot()).toBe(after);
    await act(async () => { expect(await history.execute({ expectedVersion: after.version, direction: 'undo' })).toMatchObject({ ok: true }); });
    expect(h.session.getSnapshot().document).toEqual(before.document);
    expect(h.session.getSnapshot().canUndo).toBe(false);
    const undone = h.session.getSnapshot();
    await act(async () => { expect(await history.execute({ expectedVersion: undone.version, direction: 'redo' })).toMatchObject({ ok: true,
      data: { parameterCount: 1001, omittedParameters: true, canUndo: true, canRedo: false } }); });
    expect(h.session.getSnapshot().document).toEqual(after.document);
  });
  it('returns complete small summaries and bounded large import/open receipts with exact saved state', async () => {
    const h = await harness(), tools = cadSiteTools(h.cad);
    const context = tools.find(tool => tool.name === 'cad_get_context'), imported = tools.find(tool => tool.name === 'cad_import_document');
    const save = tools.find(tool => tool.name === 'cad_save_document'), open = tools.find(tool => tool.name === 'cad_open_document'), workspace = tools.find(tool => tool.name === 'cad_open_workspace');
    if (!context || !imported || !save || !open || !workspace) throw new Error('Missing document receipt tools.');
    expect(await context.execute({})).toMatchObject({ ok: true, data: { parameters: {}, parameterCount: 0, omittedParameters: false,
      omittedParameterCount: 0, parameterGroups: [], parameterGroupCount: 0, omittedParameterGroups: false, omittedParameterGroupCount: 0 } });
    const small = parseCadDocument({ ...createCadDocument('Small dimensions', 'cad_small_context'), parameters: { width: 12.123456789012345, depth: .125 },
      parameterGroups: [{ id: 'dimensions', name: 'Dimensions' }] });
    let smallReceipt: unknown;
    await act(async () => { smallReceipt = await imported.execute({ expectedVersion: h.session.getSnapshot().version, document: small }); });
    expect(smallReceipt).toMatchObject({ ok: true, data: { parameters: small.parameters, parameterCount: 2, omittedParameters: false,
      omittedParameterCount: 0, parameterGroups: small.parameterGroups, parameterGroupCount: 1, omittedParameterGroups: false, omittedParameterGroupCount: 0 } });
    await act(async () => { expect(await save.execute({ expectedVersion: h.session.getSnapshot().version })).toMatchObject({ ok: true, data: { saved: true } }); });
    const source = largeGroupedParameterDocument(); let largeReceipt: unknown;
    await act(async () => { largeReceipt = await imported.execute({ expectedVersion: h.session.getSnapshot().version, document: source.document }); });
    const accepted = h.session.getSnapshot();
    expect(largeReceipt).toMatchObject({ ok: true, data: { imported: true, sourceDocumentId: source.document.id, version: accepted.version,
      documentId: accepted.document.id, parameterCount: 1001, omittedParameters: true, dirty: true, savedVersion: null, canUndo: false } });
    expect(utf8Bytes(JSON.stringify(largeReceipt))).toBeLessThan(32768);
    expect(accepted.document.parameters).toEqual(source.document.parameters);
    expect(accepted.document.parameterMetadata).toEqual(source.document.parameterMetadata);
    let savedReceipt: unknown;
    await act(async () => { savedReceipt = await save.execute({ expectedVersion: accepted.version }); });
    const saved = await loadCadDocument(h.workbench().adapter, accepted.document.id);
    expect(savedReceipt).toMatchObject({ ok: true, data: { saved: true, draftMarkedSaved: true, documentId: accepted.document.id, savedVersion: saved.savedVersion, version: accepted.version } });
    await act(async () => { h.cad().back(); expect(await workspace.execute({})).toMatchObject({ ok: true, data: { open: true,
      documentId: accepted.document.id, version: accepted.version, dirty: false, savedVersion: saved.savedVersion, parameterCount: 1001 } }); });
    let reopenedReceipt: unknown;
    await act(async () => { reopenedReceipt = await open.execute({ expectedVersion: accepted.version, documentId: accepted.document.id }); });
    const reopened = h.session.getSnapshot();
    expect(reopenedReceipt).toMatchObject({ ok: true, data: { open: true, version: reopened.version, documentId: accepted.document.id,
      dirty: false, savedVersion: saved.savedVersion, workflowOpen: false, parameterCount: 1001, omittedParameters: true } });
    expect(reopened.document).toEqual(accepted.document);
    expect(utf8Bytes(JSON.stringify(reopenedReceipt))).toBeLessThan(32768);
  });
  it.each([CAD_FORMER_DOCUMENT_BYTES - 1, CAD_FORMER_DOCUMENT_BYTES, CAD_FORMER_DOCUMENT_BYTES + 1, CAD_FORMER_DOCUMENT_BYTES + 64 * 1024])('exports, imports and saves a %i-byte document with fixed-length fresh identity and exact payload', async bytes => {
    const h = await harness();
    const source = parseCadDocument(cadBudgetFixture(bytes));
    const originalHashes = await Promise.all(cadBudgetOriginals(source).map(utf8Hash));
    await act(async () => { await h.cad().importDocumentValue(source); });
    const imported = h.session.getSnapshot();
    expect(imported.document.id).toHaveLength(CAD_BUDGET_APP_ID.length);
    expect(utf8Bytes(JSON.stringify(imported.document))).toBe(bytes);
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { if (blob instanceof Blob) blobs.push(blob); return 'blob:cad-budget'; });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const receipt = h.cad().exportDocument(imported.version);
    expect(receipt).toMatchObject({ downloadRequested: true, fileName: 'Limită Ω part.cad.json', version: imported.version });
    expect(click).toHaveBeenCalledOnce(); expect(blobs).toHaveLength(1);
    expect(blobs[0].size).toBe(bytes);
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blobs[0]);
    });
    expect(text).toBe(JSON.stringify(imported.document));
    expect(JSON.parse(text)).toEqual(imported.document);
    expect(h.session.getSnapshot()).toBe(imported);
    let savedReceipt: unknown;
    await act(async () => { savedReceipt = await h.cad().save(imported.version); });
    const saved = await loadCadDocument(h.workbench().adapter, imported.document.id);
    expect(savedReceipt).toMatchObject({ saved: true, draftMarkedSaved: true, documentId: imported.document.id, savedVersion: saved.savedVersion, version: imported.version });
    const path = cadDocumentPath(imported.document.id), savedOriginal = await h.workbench().adapter.readExactText?.(path);
    const file = new File([text], 'part.cad.json');
    await act(async () => { await h.cad().importDocument(file); });
    const roundTrip = h.session.getSnapshot();
    expect(roundTrip.document.id).not.toBe(imported.document.id);
    expect(roundTrip.document.features).toEqual(source.features);
    expect(roundTrip.document.parameters).toEqual(source.parameters);
    expect(await Promise.all(cadBudgetOriginals(roundTrip.document).map(utf8Hash))).toEqual(originalHashes);
    expect(roundTrip).toMatchObject({ dirty: true, savedVersion: null, canUndo: false, canRedo: false });
    expect(await h.workbench().adapter.readExactText?.(path)).toBe(savedOriginal);
    expect((await loadCadDocument(h.workbench().adapter, imported.document.id)).savedVersion).toBe(saved.savedVersion);
    await act(async () => { await h.cad().save(roundTrip.version); });
    expect((await loadCadDocument(h.workbench().adapter, roundTrip.document.id)).document).toEqual(roundTrip.document);
  });
  it.each(['file', 'agent'] as const)('imports a large short-identity %s document as a fresh draft without replacing its earlier saved original', async mode => {
    const h = await harness(true);
    await act(async () => { await h.cad().save(); });
    const before = h.session.getSnapshot(), adapter = h.workbench().adapter;
    const path = cadDocumentPath(before.document.id), original = await adapter.readExactText?.(path);
    const saved = await loadCadDocument(adapter, before.document.id);
    const source = parseCadDocument(cadBudgetFixture(CAD_FORMER_DOCUMENT_BYTES + 1, 'a'));
    let receipt: unknown;
    if (mode === 'file') {
      const text = JSON.stringify(source);
      const file = new File([text], 'part.cad.json');
      await act(async () => { receipt = await h.cad().importDocument(file); });
    } else {
      await act(async () => { receipt = await h.cad().importDocumentValue(source, before.version); });
    }
    const imported = h.session.getSnapshot();
    expect(receipt).toMatchObject({ imported: true, sourceDocumentId: 'a', documentId: imported.document.id, version: imported.version });
    expect(utf8Bytes(JSON.stringify(imported.document))).toBe(CAD_FORMER_DOCUMENT_BYTES + CAD_BUDGET_APP_ID.length);
    expect(imported.document.features).toEqual(source.features);
    expect(imported.document.parameters).toEqual(source.parameters);
    expect(imported).toMatchObject({ dirty: true, savedVersion: null, canUndo: false, canRedo: false });
    expect(await adapter.readExactText?.(path)).toBe(original);
    expect(await loadCadDocument(adapter, before.document.id)).toEqual(saved);
  });
  it('validates the final fresh-identity document while retaining exact source geometry', async () => {
    const h = await harness();
    const source = parseCadDocument(cadBudgetFixture(CAD_FORMER_DOCUMENT_BYTES - (CAD_BUDGET_APP_ID.length - 1), 'a'));
    let receipt: unknown;
    await act(async () => { receipt = await h.cad().importDocumentValue(source); });
    const accepted = h.session.getSnapshot();
    expect(receipt).toMatchObject({ imported: true, sourceDocumentId: 'a', documentId: accepted.document.id, version: accepted.version });
    expect(utf8Bytes(JSON.stringify(accepted.document))).toBe(CAD_FORMER_DOCUMENT_BYTES);
    expect(accepted.document.features).toEqual(source.features);
    expect(accepted).toMatchObject({ dirty: true, savedVersion: null, canUndo: false });
  });
  it('uses a separately owned native preview and restores the accepted build identity on Cancel without changing history', async () => {
    const h = await harness(true), acceptedBuild: CadBuildResult = { buildId: 'accepted-build', meshes: [], diagnostics: [], durationMs: 1 };
    kernel.build.mockResolvedValue(acceptedBuild);
    await act(async () => { await h.cad().inspectBuild(); });
    const before = h.session.getSnapshot(), pending = deferred<CadBuildResult>(), previewClient = { build: vi.fn(() => pending.promise), dispose: vi.fn() };
    createClient.mockReturnValueOnce(previewClient);
    await act(async () => {
      h.session.setWorkflowOpen(true, 'editor');
      h.cad().previewFeature({ kind: 'candidate', owner: 'pad-editor', expectedVersion: before.version,
        edits: [{ kind: 'add-feature', feature: { id: 'pad', name: 'Provisional Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 20, operation: 'new', symmetric: false, targetId: null } }] });
    });
    await act(async () => { await vi.waitFor(() => expect(previewClient.build).toHaveBeenCalledOnce()); });
    expect(h.session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false });
    await act(async () => { pending.resolve({ buildId: 'candidate-build', meshes: [], diagnostics: [], durationMs: 1 }); });
    expect(h.cad().featurePreview).toMatchObject({ kind: 'ready', result: { buildId: 'candidate-build' } });
    expect(h.cad().build).toBe(acceptedBuild); expect(h.cad().buildVersion).toBe(before.version);
    await act(async () => { h.cad().previewFeature({ kind: 'clear', owner: 'pad-editor' }); h.session.setWorkflowOpen(false, 'editor'); });
    expect(previewClient.dispose).toHaveBeenCalledOnce(); expect(kernel.dispose).not.toHaveBeenCalled();
    expect(h.cad().featurePreview).toEqual({ kind: 'idle' }); expect(h.cad().build).toBe(acceptedBuild); expect(h.session.getSnapshot()).toEqual(before); expect(h.session.getSnapshot().document).toBe(before.document);
  });
  it('keeps agent edits and history blocked while the document library owns the UI, then opens its chosen saved part', async () => {
    const h = await harness(true);
    await act(async () => { await h.cad().save(); await h.cad().showLibrary(); });
    const before = h.session.getSnapshot();
    expect(before.workflowOpen).toBe(true);
    const edit = cadSiteTools(h.cad).find(tool => tool.name === 'cad_edit_document'); if (!edit) throw new Error('Missing edit tool');
    await expect(edit.execute({ expectedVersion: before.version, edits: [{ kind: 'rename-document', name: 'Unexpected background edit' }] })).resolves.toMatchObject({ ok: false, error: { code: 'WORKFLOW_OPEN' } });
    expect(() => h.cad().undo(before.version)).toThrow('Finish or cancel');
    await expect(h.cad().openDocument(before.document.id, before.version)).rejects.toMatchObject({ code: 'WORKFLOW_OPEN' });
    await act(async () => h.cad().closeLibrary());
    expect(h.session.getSnapshot().workflowOpen).toBe(false);
    await act(async () => { await h.cad().showLibrary(); await h.cad().openDocument(before.document.id, before.version, undefined, 'library'); });
    expect(h.session.getSnapshot()).toMatchObject({ dirty: false, workflowOpen: false, document: before.document });
  });
  it('does not reopen a closed library after its delayed inventory finishes', async () => {
    const h = await harness(true);
    await act(async () => { await h.cad().save(); });
    const adapter = h.workbench().adapter, originalList = adapter.listFiles;
    if (!originalList) throw new Error('Missing storage inventory');
    const started = deferred<void>(), finish = deferred<void>();
    vi.spyOn(adapter, 'listFiles').mockImplementation(async signal => { started.resolve(); await finish.promise; return originalList(signal); });
    let listing: ReturnType<CadController['showLibrary']> | undefined;
    await act(async () => { listing = h.cad().showLibrary(); await started.promise; });
    await act(async () => { h.cad().closeLibrary(); finish.resolve(); await listing; });
    expect(h.cad().library).toBeNull(); expect(h.session.getSnapshot().workflowOpen).toBe(false);
  });
  it('refuses new/open/import replacements while a dirty draft contains only an empty parameter group', async () => {
    const h = await harness();
    await act(async () => h.session.edit([{ kind: 'set-parameter-group', group: { id: 'settings', name: 'Gear settings' } }]));
    const before = h.session.getSnapshot();
    expect(() => h.cad().newDocument('Replacement', before.version)).toThrow('Save the current CAD draft');
    await expect(h.cad().openDocument('other', before.version)).rejects.toMatchObject({ code: 'UNSAVED_DRAFT' });
    await expect(h.cad().importDocumentValue(createCadDocument('Imported'), before.version)).rejects.toMatchObject({ code: 'UNSAVED_DRAFT' });
    await expect(h.cad().importDocument(new File(['{}'], 'new.cad.json'))).rejects.toMatchObject({ code: 'UNSAVED_DRAFT' });
    expect(h.session.getSnapshot()).toBe(before);
  });
  it('exports an exact final-solid section from the unsaved draft without a CAD save or CAM handoff', async () => {
    const h = await harness(true);
    const before = h.session.getSnapshot();
    const section: CadSectionResult = { bodyId: 'pad', plane: 'XY', offset: 5, contourCount: 2, entities: [
      { type: 'circle', layer: 'CAD', center: { x: 4, y: -7 }, radius: 10 },
      { type: 'circle', layer: 'CAD', center: { x: 4, y: -7 }, radius: 2 }
    ] };
    kernel.section.mockResolvedValue(section);
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { if (blob instanceof Blob) blobs.push(blob); return 'blob:dxf'; });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const tool = cadSiteTools(h.cad).find(entry => entry.name === 'cad_export_section_dxf');
    if (!tool) throw new Error('Section export tool missing');
    expect(await tool.execute({ expectedVersion: before.version, section: { bodyId: 'pad', plane: 'XY', offset: '5' } }))
      .toMatchObject({ ok: true, data: { downloadRequested: true, version: before.version, section: { offset: 5, entityCount: 2 } } });
    expect(kernel.section).toHaveBeenCalledWith(before.document, { bodyId: 'pad', plane: 'XY', offset: '5' }, expect.any(AbortSignal));
    const text = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blobs[0]); });
    expect(parseDxf(text).entities).toMatchObject(section.entities);
    expect(click).toHaveBeenCalledOnce();
    expect(h.session.getSnapshot()).toBe(before);
    await expect(loadCadDocument(h.workbench().adapter, before.document.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it.each(['cancel', 'version', 'workflow', 'close', 'substitution'] as const)('rejects section DXF after %s while exact geometry is being computed', async change => {
    const h = await harness(true), before = h.session.getSnapshot(), abort = new AbortController();
    const result = deferred<CadSectionResult>(); kernel.section.mockReturnValue(result.promise);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const operation = h.cad().exportSectionDxf({ bodyId: 'pad', plane: 'XZ', offset: 5 }, before.version, abort.signal);
    await vi.waitFor(() => expect(kernel.section).toHaveBeenCalled());
    await act(async () => {
      if (change === 'cancel') abort.abort();
      if (change === 'version') h.session.edit([{ kind: 'rename-document', name: 'Changed' }]);
      if (change === 'workflow') h.session.setWorkflowOpen(true, 'editor');
      if (change === 'close') h.cad().back();
      result.resolve({ bodyId: 'pad', plane: 'XZ', offset: change === 'substitution' ? 6 : 5, contourCount: 1,
        entities: [{ type: 'circle', layer: 'CAD', center: { x: 0, y: 0 }, radius: 10 }] });
      await expect(operation).rejects.toMatchObject(change === 'cancel' ? { name: 'AbortError' } : {
        code: change === 'version' ? 'STALE_STATE' : change === 'workflow' ? 'WORKFLOW_OPEN' : change === 'close' ? 'CAD_NOT_OPEN' : 'INVALID_SECTION_RESULT'
      });
    });
    expect(click).not.toHaveBeenCalled();
  });
  it('permits the owning DXF dialog scope while rejecting external exports and concurrent editor scopes', async () => {
    const h = await harness(true), version = h.session.getSnapshot().version;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:dxf');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await act(async () => h.session.setWorkflowOpen(true, 'dxf-export'));
    await expect(h.cad().exportDxf('sketch', version)).rejects.toMatchObject({ code: 'WORKFLOW_OPEN' });
    await expect(h.cad().exportDxf('sketch', version, undefined, 'dxf-export')).resolves.toMatchObject({ downloadRequested: true });
    await act(async () => h.session.setWorkflowOpen(true, 'editor'));
    await expect(h.cad().exportDxf('sketch', version, undefined, 'dxf-export')).rejects.toMatchObject({ code: 'WORKFLOW_OPEN' });
  });
  it('inspects correlated profiles with draft/version/workflow/cancellation guards and rejects unsafe agent edits atomically', async () => {
    const h = await harness(), tools = cadSiteTools(h.cad);
    const inspect = tools.find(tool => tool.name === 'cad_inspect_plugin'), edit = tools.find(tool => tool.name === 'cad_edit_document');
    if (!inspect || !edit) throw new Error('Missing plugin operations');
    await act(async () => h.session.edit([{ kind: 'add-feature', feature: { id: 'gear', kind: 'sketch', name: 'Gear', plane: 'XY', offset: 0, suppressed: false,
      profiles: [{ id: 'tooth_profile', name: 'Teeth', construction: false, geometry: { ...createCadPluginProfile(CAD_GEAR_V2_PLUGIN), inputs: { ...createCadPluginProfile(CAD_GEAR_V2_PLUGIN).inputs, teeth: 12 } } }] } }]));
    const snapshot = h.session.getSnapshot(), request = { expectedVersion: snapshot.version, sketchId: 'gear', profileId: 'tooth_profile' };
    expect(await inspect.execute(request)).toMatchObject({ ok: true, data: { apiVersion: 2, persisted: false,
      inputs: expect.arrayContaining([expect.objectContaining({ name: 'profileShift', enabled: false })]),
      derived: expect.arrayContaining([expect.objectContaining({ name: 'pitchDiameter', value: 36 })]), issues: [] } });
    expect(await inspect.execute({ ...request, expectedVersion: 'stale' })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    expect(await inspect.execute({ ...request, profileId: 'missing' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    await act(async () => h.session.setWorkflowOpen(true));
    expect(await inspect.execute(request)).toMatchObject({ ok: false, error: { code: 'WORKFLOW_OPEN' } });
    await act(async () => h.session.setWorkflowOpen(false));
    const abort = new AbortController(); abort.abort();
    expect(await inspect.execute(request, { signal: abort.signal })).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    const before = h.session.getSnapshot();
    const sketch = before.document.features[0];
    if (sketch.kind !== 'sketch' || sketch.profiles[0].geometry.kind !== 'plugin') throw new Error('Expected plugin sketch');
    const unsafe = { ...sketch, profiles: [{ ...sketch.profiles[0], geometry: { ...sketch.profiles[0].geometry, inputs: { ...sketch.profiles[0].geometry.inputs, shiftMode: 1, profileShift: 0 } } }] };
    await act(async () => expect(await edit.execute({ expectedVersion: before.version, edits: [{ kind: 'update-feature', feature: unsafe }] })).toMatchObject({ ok: false }));
    expect(h.session.getSnapshot().document).toBe(before.document);
  });
  it('shares atomic grouped plugin insertion and bounded current parameter usage inspection with guarded agent tools', async () => {
    const h = await harness(), tools = cadSiteTools(h.cad);
    const edit = tools.find(tool => tool.name === 'cad_edit_document'), inspect = tools.find(tool => tool.name === 'cad_inspect_parameters');
    if (!edit || !inspect) throw new Error('Missing parameter tools');
    const before = h.session.getSnapshot();
    await act(async () => { expect(await edit.execute({ expectedVersion: before.version, edits: [
      { kind: 'add-feature', feature: { id: 'section', name: 'Section', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [] } },
      { kind: 'add-plugin-profile', sketchId: 'section', profileId: 'gear', name: 'Gear', package: CAD_GEAR_V2_PLUGIN, groupId: 'dimensions' }
    ] })).toMatchObject({ ok: true }); });
    const snapshot = h.session.getSnapshot(), request = { expectedVersion: snapshot.version, name: 'p_gear_module', limit: 1 };
    expect(snapshot.document.parameters).toHaveProperty('p_gear_module', 3);
    expect(await inspect.execute(request)).toMatchObject({ ok: true, data: { persisted: false,
      parameter: { name: 'p_gear_module', groupName: 'Gear', source: { kind: 'plugin', profileId: 'gear' }, activeUsageCount: 1 },
      usages: { total: 1, items: [{ featureId: 'section', inputName: 'module', active: true }], nextOffset: null } } });
    expect(await inspect.execute({ expectedVersion: snapshot.version, limit: 2 })).toMatchObject({ ok: true, data: { total: 4, items: expect.any(Array), nextOffset: 2 } });
    expect(await inspect.execute({ ...request, name: 'missing' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await inspect.execute({ ...request, expectedVersion: before.version })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    await act(async () => h.session.setWorkflowOpen(true));
    expect(await inspect.execute(request)).toMatchObject({ ok: false, error: { code: 'WORKFLOW_OPEN' } });
    await act(async () => h.session.setWorkflowOpen(false));
    const cancelled = new AbortController(); cancelled.abort();
    expect(await inspect.execute(request, { signal: cancelled.signal })).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(h.session.getSnapshot().document).toBe(snapshot.document);
    await act(async () => h.cad().undo(snapshot.version));
    expect(h.session.getSnapshot().document).toEqual(before.document);
  });
  it('keeps grouped parameter context and summaries bounded at the complete document limits', async () => {
    const h = await harness();
    const names = Array.from({ length: 128 }, (_, index) => `dimension_${index}_${'x'.repeat(45)}`);
    await act(async () => h.session.edit([
      ...names.map((name, index) => ({ kind: 'set-parameter' as const, name, value: index })),
      ...Array.from({ length: 64 }, (_, index) => ({ kind: 'set-parameter-group' as const, group: { id: `group_${index}_${'x'.repeat(75)}`, name: `${index} ${'Group '.repeat(24)}` } }))
    ]));
    const tools = cadSiteTools(h.cad), context = tools.find(tool => tool.name === 'cad_get_context'), inspect = tools.find(tool => tool.name === 'cad_inspect_parameters');
    if (!context || !inspect) throw new Error('Parameter tools missing');
    const result = await context.execute({});
    expect(result).toMatchObject({ ok: true, data: { parameterGroupCount: 64, omittedParameterGroups: true, parameterGroups: expect.any(Array) } });
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(32768);
    expect(await inspect.execute({ expectedVersion: h.session.getSnapshot().version, limit: 50 })).toMatchObject({ ok: true, data: { total: 128, nextOffset: 50 } });
  });
  it('installs plugins through the guarded tool and exposes bounded hash-pinned reads', async () => {
    const h = await harness(), tools = cadSiteTools(h.cad);
    const install = tools.find(tool => tool.name === 'cad_install_plugin'), read = tools.find(tool => tool.name === 'cad_read_plugin');
    if (!install || !read) throw new Error('Missing plugin tools');
    const plugin = { ...CAD_STAR_PLUGIN, id: 'user.plugin-controller' }, expectedVersion = h.session.getSnapshot().version;
    await act(async () => { expect(await install.execute({ package: plugin, expectedVersion })).toMatchObject({ ok: true, data: { installed: true, id: plugin.id } }); });
    expect(await h.workbench().adapter.readText('cad/plugins/user.plugin-controller/1.0.0.cad-plugin.json')).toBe(JSON.stringify(plugin));
    const packageHash = await fingerprintCadPluginPackage(plugin);
    const result = await read.execute({ id: plugin.id, version: plugin.version, packageHash, length: 128 });
    expect(result).toMatchObject({ ok: true, data: { text: JSON.stringify(plugin).slice(0, 128), nextOffset: 128 } });
    expect(await read.execute({ id: plugin.id, version: plugin.version, packageHash: '0'.repeat(64) })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    expect(h.session.getSnapshot().document.features).toHaveLength(0);
  });
  it('refuses stale or active-workflow plugin installs before writing', async () => {
    const h = await harness(), install = cadSiteTools(h.cad).find(tool => tool.name === 'cad_install_plugin');
    if (!install) throw new Error('Missing plugin installation');
    const plugin = { ...CAD_STAR_PLUGIN, id: 'user.plugin-guard' };
    expect(await install.execute({ package: plugin, expectedVersion: 'stale' })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    await act(async () => h.session.setWorkflowOpen(true));
    expect(await install.execute({ package: plugin, expectedVersion: h.session.getSnapshot().version })).toMatchObject({ ok: false, error: { code: 'WORKFLOW_OPEN' } });
    expect(await h.workbench().adapter.readText('cad/plugins/user.plugin-guard/1.0.0.cad-plugin.json')).toBeNull();
  });
  async function loftHarness() {
    const h = await harness(true);
    await act(async () => h.cad().edit([{ kind: 'add-feature', feature: {
      id: 'upper', kind: 'sketch', name: 'Upper section', plane: 'XY', offset: 20, suppressed: false,
      profiles: [{ id: 'upper_circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 6 } }],
    } }]));
    const tool = cadSiteTools(h.cad).find(entry => entry.name === 'cad_inspect_loft');
    if (!tool) throw new Error('Loft inspection tool missing');
    return { ...h, tool };
  }
  it('preflights an ordered Loft through the shared read-only operation without building or saving', async () => {
    const h = await loftHarness(); const before = h.session.getSnapshot();
    const input = { expectedVersion: before.version, sketchIds: ['sketch', 'upper'] };
    expect(await h.tool.execute(input)).toMatchObject({ ok: true, data: {
      version: before.version, eligible: true, nativeBuildRequired: true, persisted: false,
      scope: 'new-feature-at-end', stationOrigin: 'principal-origin',
      sections: [{ sketchId: 'sketch', stationMm: 0 }, { sketchId: 'upper', stationMm: 20 }] } });
    expect(await h.tool.execute({ ...input, sketchIds: ['sketch', 'missing'] }))
      .toMatchObject({ ok: true, data: { eligible: false, code: 'invalid-reference', persisted: false } });
    expect(await h.tool.execute({ ...input, expectedVersion: 'old' })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    expect(await h.tool.execute({ ...input, repair: true })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    const abort = new AbortController(); abort.abort();
    expect(await h.tool.execute(input, { signal: abort.signal })).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    await act(async () => h.session.setWorkflowOpen(true));
    expect(await h.tool.execute(input)).toMatchObject({ ok: false, error: { code: 'WORKFLOW_OPEN' } });
    await act(async () => h.session.setWorkflowOpen(false));
    expect(h.session.getSnapshot().document).toBe(before.document); expect(h.session.getSnapshot().version).toBe(before.version);
    expect(before.savedVersion).toBeNull(); expect(kernel.build).not.toHaveBeenCalled();
    expect(h.workbench().manifest.projects).toHaveLength(0);
  });
  it.each(['close', 'workflow', 'version', 'cancel', 'busy'] as const)('rechecks %s while loading Loft preflight', async change => {
    const h = await loftHarness(); const before = h.session.getSnapshot();
    const abort = new AbortController(); const competingAbort = new AbortController();
    const exported = deferred<Blob>(); kernel.export.mockReturnValue(exported.promise);
    await act(async () => {
      const pending = h.cad().inspectLoft(['sketch', 'upper'], before.version, abort.signal);
      let competing: Promise<unknown> | undefined;
      if (change === 'close') h.cad().back();
      if (change === 'workflow') h.session.setWorkflowOpen(true);
      if (change === 'version') h.session.edit([{ kind: 'rename-document', name: 'Newer Loft' }]);
      if (change === 'cancel') abort.abort();
      if (change === 'busy') competing = h.cad().exportSolid('step', before.version, competingAbort.signal);
      try {
        await expect(pending).rejects.toMatchObject(change === 'cancel' ? { name: 'AbortError' }
          : { code: { close: 'CAD_NOT_OPEN', workflow: 'WORKFLOW_OPEN', version: 'STALE_STATE', busy: 'BUSY' }[change] });
      } finally {
        if (competing) {
          competingAbort.abort(); exported.resolve(new Blob(['STEP']));
          await expect(competing).rejects.toMatchObject({ name: 'AbortError' });
        }
      }
    });
    expect(kernel.build).not.toHaveBeenCalled();
  });
  async function planeHarness() {
    const h = await harness();
    await act(async () => h.cad().edit([
      { kind: 'add-feature', feature: { kind: 'datum-plane', id: 'mount', name: 'Mount', suppressed: false,
        definition: { kind: 'world', basePlane: 'XY', origin: [10, -20, 30], rotation: [90, 0, 0] } } },
      { kind: 'add-feature', feature: { kind: 'sketch', id: 'profile', name: 'Profile', suppressed: false,
        plane: { kind: 'datum-plane', featureId: 'mount' }, offset: 3, profiles: [] } },
    ]));
    const tool = cadSiteTools(h.cad).find(entry => entry.name === 'cad_inspect_plane');
    if (!tool) throw new Error('Plane inspection tool missing');
    return { ...h, tool };
  }
  it('inspects accepted datum and sketch placement without native evaluation, saving or changing the draft', async () => {
    const h = await planeHarness(); const before = h.session.getSnapshot();
    expect(await h.tool.execute({ expectedVersion: before.version, featureId: 'profile' })).toMatchObject({ ok: true, data: {
      version: before.version, featureId: 'profile', featureKind: 'sketch', units: 'mm', persisted: false,
      datumId: 'mount', offsetMm: 3, placedOriginMm: [10, -23, 30],
      frame: { origin: [10, -20, 30], normal: [0, -1, 0] } } });
    expect(await h.tool.execute({ expectedVersion: before.version, featureId: 'mount' })).toMatchObject({ ok: true, data: {
      featureKind: 'datum-plane', placedOriginMm: [10, -20, 30], offsetMm: 0 } });
    expect(h.session.getSnapshot()).toBe(before);
    expect(kernel.build).not.toHaveBeenCalled(); expect(h.workbench().manifest.projects).toHaveLength(0);
    expect(before.savedVersion).toBeNull();
  });
  it('guards plane inspection with current version, workflow, cancellation and strict input', async () => {
    const h = await planeHarness(); const before = h.session.getSnapshot();
    const input = { expectedVersion: before.version, featureId: 'mount' };
    expect(await h.tool.execute({ ...input, expectedVersion: 'old' })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    expect(await h.tool.execute({ ...input, includeGeometry: true })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    const abort = new AbortController(); abort.abort();
    expect(await h.tool.execute(input, { signal: abort.signal })).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    await act(async () => h.session.setWorkflowOpen(true));
    expect(await h.tool.execute(input)).toMatchObject({ ok: false, error: { code: 'WORKFLOW_OPEN' } });
    await act(async () => h.session.setWorkflowOpen(false));
    expect(h.session.getSnapshot().version).toBe(before.version);
    expect(kernel.build).not.toHaveBeenCalled();
  });
  it.each(['close', 'workflow', 'version', 'cancel', 'busy'] as const)('rechecks %s changes while loading plane inspection', async change => {
    const h = await planeHarness(); const before = h.session.getSnapshot();
    const abort = new AbortController(); const competingAbort = new AbortController();
    const exported = deferred<Blob>(); kernel.export.mockReturnValue(exported.promise);
    await act(async () => {
      const pending = h.cad().inspectPlane('mount', before.version, abort.signal);
      let competing: Promise<unknown> | undefined;
      if (change === 'close') h.cad().back();
      if (change === 'workflow') h.session.setWorkflowOpen(true);
      if (change === 'version') h.session.edit([{ kind: 'rename-document', name: 'Newer plane' }]);
      if (change === 'cancel') abort.abort();
      if (change === 'busy') competing = h.cad().exportSolid('step', before.version, competingAbort.signal);
      try {
        await expect(pending).rejects.toMatchObject(change === 'cancel' ? { name: 'AbortError' }
          : { code: { close: 'CAD_NOT_OPEN', workflow: 'WORKFLOW_OPEN', version: 'STALE_STATE', busy: 'BUSY' }[change] });
      } finally {
        if (competing) {
          competingAbort.abort(); exported.resolve(new Blob(['STEP']));
          await expect(competing).rejects.toMatchObject({ name: 'AbortError' });
        }
      }
    });
    expect(kernel.build).not.toHaveBeenCalled();
  });
  async function sweepHarness() {
    const h = await harness(true);
    await act(async () => h.cad().edit([{ kind: 'add-feature', feature: {
      kind: 'curve', id: 'rail', name: 'Rail', plane: 'XZ', offset: 0, suppressed: false,
      segments: [{ kind: 'line', start: [0, 0], end: [0, 40] }],
      source: { format: 'dxf', fileName: 'rail.dxf', units: 'mm', text: '999\n' + 'Original annotation '.repeat(80_000) + '\n0\nEOF\n' },
    } }]));
    const tool = cadSiteTools(h.cad).find(entry => entry.name === 'cad_inspect_sweep');
    if (!tool) throw new Error('Sweep inspection tool missing');
    return { ...h, tool };
  }
  it('shares a bounded read-only Sweep preflight without native work or imported-source duplication', async () => {
    const h = await sweepHarness(); const before = h.session.getSnapshot();
    const result = await h.tool.execute({ expectedVersion: before.version, sketchId: 'sketch', curveId: 'rail' });
    expect(result).toMatchObject({ ok: true, data: { version: before.version, eligible: true, nativeBuildRequired: true,
      scope: 'new-feature-at-end', persisted: false, sketchId: 'sketch', curveId: 'rail', nativeWork: 1,
      limits: { curveSegments: 64, sectionEdgesTimesCurveSegments: 2048 }, section: { plane: 'XY', offsetMm: 0, edgeCount: 1 },
      curve: { plane: 'XZ', offsetMm: 0, segmentCount: 1, lengthMm: 40, startWorldMm: [0, 0, 0], startTangentWorld: [0, 0, 1] },
      clearance: { profileRadiusMm: expect.closeTo(10, 8), envelopeEdgeCount: 4 } } });
    expect(JSON.stringify(result).length).toBeLessThan(2048);
    expect(JSON.stringify(result)).not.toContain('Original annotation');
    expect(h.session.getSnapshot()).toBe(before); expect(kernel.build).not.toHaveBeenCalled();
    expect(await h.tool.execute({ expectedVersion: before.version, sketchId: 'rail', curveId: 'sketch' }))
      .toMatchObject({ ok: true, data: { eligible: false, code: 'invalid-reference', persisted: false } });
    expect(h.session.getSnapshot()).toBe(before);
  });
  it('keeps Sweep preflight behind current version, workflow, cancellation and strict tool arguments', async () => {
    const h = await sweepHarness(); const before = h.session.getSnapshot();
    const input = { expectedVersion: before.version, sketchId: 'sketch', curveId: 'rail' };
    expect(await h.tool.execute({ ...input, repair: true })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(await h.tool.execute({ ...input, expectedVersion: 'stale' })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    const abort = new AbortController(); abort.abort();
    expect(await h.tool.execute(input, { signal: abort.signal })).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    await act(async () => h.session.setWorkflowOpen(true));
    expect(await h.tool.execute(input)).toMatchObject({ ok: false, error: { code: 'WORKFLOW_OPEN' } });
    await act(async () => h.session.setWorkflowOpen(false));
    expect(h.session.getSnapshot().document).toBe(before.document); expect(h.session.getSnapshot().version).toBe(before.version);
    expect(kernel.build).not.toHaveBeenCalled();
  });
  it('shares datum Sweep placement with agents without fitting, relocating or saving sources', async () => {
    const h = await harness();
    const plane = (id: string, basePlane: 'XY' | 'YZ') => ({ kind: 'datum-plane' as const, id, name: id, suppressed: false,
      definition: { kind: 'world' as const, basePlane, origin: [30, -20, 12] as const, rotation: [30, 0, 15] as const } });
    await act(async () => h.cad().edit([
      { kind: 'add-feature', feature: plane('section_plane', 'YZ') },
      { kind: 'add-feature', feature: plane('rail_plane', 'XY') },
      { kind: 'add-feature', feature: { kind: 'sketch', id: 'section', name: 'Section', suppressed: false,
        plane: { kind: 'datum-plane', featureId: 'section_plane' }, offset: 0,
        profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 1 } }] } },
      { kind: 'add-feature', feature: { kind: 'curve', id: 'rail', name: 'Rail', suppressed: false,
        plane: { kind: 'datum-plane', featureId: 'rail_plane' }, offset: 0,
        segments: [{ kind: 'line', start: [0, 0], end: [20, 0] }] } },
    ]));
    const before = h.session.getSnapshot(); const tool = cadSiteTools(h.cad).find(entry => entry.name === 'cad_inspect_sweep');
    if (!tool) throw new Error('Missing Sweep tool');
    expect(await tool.execute({ expectedVersion: before.version, sketchId: 'section', curveId: 'rail' }))
      .toMatchObject({ ok: true, data: { eligible: true, version: before.version, persisted: false, nativeBuildRequired: true,
        section: { plane: { kind: 'datum-plane', featureId: 'section_plane' }, originWorldMm: [30, -20, 12] },
        curve: { plane: { kind: 'datum-plane', featureId: 'rail_plane' }, startWorldMm: [30, -20, 12], lengthMm: 20 } } });
    expect(h.session.getSnapshot()).toBe(before); expect(before.savedVersion).toBeNull();
    expect(kernel.build).not.toHaveBeenCalled();
  });
  it.each(['close', 'workflow', 'version', 'cancel', 'busy'] as const)('rechecks %s changes while loading Sweep inspection', async change => {
    const h = await sweepHarness(); const before = h.session.getSnapshot();
    const abort = new AbortController(); const competingAbort = new AbortController();
    const exported = deferred<Blob>(); kernel.export.mockReturnValue(exported.promise);
    await act(async () => {
      const pending = h.cad().inspectSweep('sketch', 'rail', before.version, abort.signal);
      let competing: Promise<unknown> | undefined;
      if (change === 'close') h.cad().back();
      if (change === 'workflow') h.session.setWorkflowOpen(true);
      if (change === 'version') h.session.edit([{ kind: 'rename-document', name: 'Newer Sweep' }]);
      if (change === 'cancel') abort.abort();
      if (change === 'busy') competing = h.cad().exportSolid('step', before.version, competingAbort.signal);
      try {
        await expect(pending).rejects.toMatchObject(change === 'cancel' ? { name: 'AbortError' }
          : { code: { close: 'CAD_NOT_OPEN', workflow: 'WORKFLOW_OPEN', version: 'STALE_STATE', busy: 'BUSY' }[change] });
      } finally {
        if (competing) {
          competingAbort.abort(); exported.resolve(new Blob(['STEP']));
          await expect(competing).rejects.toMatchObject({ name: 'AbortError' });
        }
      }
    });
    expect(kernel.build).not.toHaveBeenCalled();
  });
  const curveDxf = '0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n20\n21\n0\n0\nENDSEC\n0\nEOF\n';
  const curveSource = { format: 'dxf' as const, fileName: 'Rail.dxf', text: curveDxf, units: 'mm' as const };
  const curveInput = { fileName: curveSource.fileName, text: curveSource.text, units: curveSource.units };
  it.each(['sketch', 'curve'] as const)('keeps committed %s import receipts bounded when malformed unit metadata is very large', async kind => {
    const h = await harness(); const before = h.session.getSnapshot();
    const raw = 'x'.repeat(40_000);
    const header = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', raw, '0', 'ENDSEC', ''].join('\n');
    const source = { ...curveSource, text: header + (kind === 'curve' ? curveDxf : dxfText) };
    kernel.importDxfCurve.mockImplementation(async (input: CadDxfCurveImportInput) => importCadDxfCurve(input));
    kernel.importDxf.mockImplementation(async (input: CadDxfImportInput) => importCadDxfSketch(input));
    const tool = cadSiteTools(h.cad).find(tool => tool.name === (kind === 'curve' ? 'cad_import_curve_dxf' : 'cad_import_dxf'));
    if (!tool) throw new Error('Import tool missing');
    await act(async () => {
      expect(await tool.execute({ expectedVersion: before.version, source })).toMatchObject({ ok: true, data: {
        imported: true, unitDeclaration: { status: 'malformed', rawValue: raw.slice(0, 160), rawValueTruncated: true, rawValueLength: 40_000 }
      } });
    });
    expect(h.session.getSnapshot().document.features[0]).toMatchObject({ kind, source });
    await act(async () => { await h.cad().save(); });
    expect((await loadCadDocument(h.workbench().adapter, h.session.getSnapshot().document.id)).document.features[0]).toMatchObject({ source });
  });
  it('imports, measures, saves and reloads an independent curve without automatic solid work or CAM writes', async () => {
    const h = await harness(); const before = h.session.getSnapshot();
    kernel.importDxfCurve.mockImplementation(async (input: CadDxfCurveImportInput) => importCadDxfCurve(input));
    const tool = cadSiteTools(h.cad).find(tool => tool.name === 'cad_import_curve_dxf');
    const measure = cadSiteTools(h.cad).find(tool => tool.name === 'cad_measure_curve');
    if (!tool || !measure) throw new Error('Missing Curve tools');
    await act(async () => { expect(await tool.execute({ expectedVersion: before.version, source: curveSource })).toMatchObject({ ok: true, data: { imported: true, curveId: expect.any(String), scaleToMillimeters: 1 } }); });
    const accepted = h.session.getSnapshot(); const curve = accepted.document.features[0];
    expect(curve).toMatchObject({ kind: 'curve', source: curveSource });
    expect(accepted.document.id).not.toBe(before.document.id);
    expect(accepted.savedVersion).toBeNull(); expect(accepted.dirty).toBe(true);
    await expect(measure.execute({ expectedVersion: accepted.version, curveId: curve.id })).resolves.toMatchObject({ ok: true, data: { version: accepted.version, curveId: curve.id, lengthMm: 20, startMm: [0, 0], endMm: [20, 0] } });
    expect(h.session.getSnapshot()).toBe(accepted);
    await act(async () => { await h.cad().save(); });
    expect((await loadCadDocument(h.workbench().adapter, accepted.document.id)).document).toEqual(accepted.document);
    expect(kernel.build).not.toHaveBeenCalled(); expect(h.workbench().manifest.projects).toHaveLength(0);
    await expect(measure.execute({ expectedVersion: before.version, curveId: curve.id })).resolves.toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    await act(async () => h.session.setWorkflowOpen(true));
    await expect(measure.execute({ expectedVersion: accepted.version, curveId: curve.id })).resolves.toMatchObject({ ok: false, error: { code: 'WORKFLOW_OPEN' } });
  });
  it.each(['cancelled', 'changed', 'workflow', 'storage'] as const)('rejects a late curve import after %s without replacing accepted work', async cause => {
    const h = await harness(); const before = h.session.getSnapshot();
    const pending = deferred<CadDxfCurveImportResult>(); kernel.importDxfCurve.mockReturnValueOnce(pending.promise);
    const abort = new AbortController(); let operation: Promise<unknown> | undefined;
    await act(async () => { operation = h.cad().importDxfCurveSource(curveSource, before.version, abort.signal); });
    await vi.waitFor(() => expect(kernel.importDxfCurve).toHaveBeenCalled());
    if (cause === 'cancelled') abort.abort();
    if (cause === 'changed') await act(async () => h.session.edit([{ kind: 'rename-document', name: 'Keep this' }]));
    if (cause === 'workflow') await act(async () => h.session.setWorkflowOpen(true));
    if (cause === 'storage') await h.switchWorkbench(await openWorkbench('curve-other-store'));
    const retained = h.session.getSnapshot();
    await act(async () => {
      pending.resolve(importCadDxfCurve(curveInput));
      await expect(operation).rejects.toMatchObject(cause === 'cancelled' ? { name: 'AbortError' } : { code: cause === 'workflow' ? 'WORKFLOW_OPEN' : 'STALE_STATE' });
    });
    expect(h.session.getSnapshot()).toBe(retained); expect(h.workbench().manifest.projects).toHaveLength(0);
  });
  it('rejects substituted curve originals and closed DXF without changing the draft', async () => {
    const h = await harness(); const before = h.session.getSnapshot();
    const imported = importCadDxfCurve(curveInput);
    kernel.importDxfCurve.mockResolvedValueOnce({ ...imported, curve: { ...imported.curve, source: { ...curveSource, text: `${curveDxf} ` } } });
    await act(async () => { await expect(h.cad().importDxfCurveSource(curveSource, before.version)).rejects.toMatchObject({ code: 'INVALID_IMPORT_RESULT' }); });
    kernel.importDxfCurve.mockImplementation(async (input: CadDxfCurveImportInput) => importCadDxfCurve(input));
    await act(async () => { await expect(h.cad().importDxfCurveSource({ ...curveSource, text: dxfText }, before.version)).rejects.toThrow(); });
    expect(h.session.getSnapshot()).toBe(before);
  });
  it('routes the visible explicit Curve import choice through the same worker and cancels curve exports before downloads', async () => {
    const h = await harness();
    kernel.importDxfCurve.mockImplementation(async (input: CadDxfCurveImportInput) => importCadDxfCurve(input));
    const file = sourceTextFile(curveDxf, 'Rail.dxf');
    await act(async () => { await h.cad().importDocument(file); });
    expect(h.session.getSnapshot().workflowOpen).toBe(true);
    await act(async () => { await h.cad().confirmImport('mm', 'curve'); });
    const accepted = h.session.getSnapshot();
    expect(accepted.workflowOpen).toBe(false); expect(accepted.document.features[0].kind).toBe('curve');
    expect(kernel.importDxf).not.toHaveBeenCalled();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const abort = new AbortController(); const tool = cadSiteTools(h.cad).find(tool => tool.name === 'cad_export_curve_dxf');
    if (!tool) throw new Error('Curve export missing');
    let operation: Promise<unknown> | undefined;
    await act(async () => { operation = tool.execute({ expectedVersion: accepted.version, curveId: accepted.document.features[0].id }, { signal: abort.signal }); abort.abort(); });
    await expect(operation).resolves.toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(click).not.toHaveBeenCalled(); expect(h.session.getSnapshot()).toBe(accepted);
  });
  it('edits and saves circular patterns through the shared versioned tool boundary', async () => {
    const h = await harness(true);
    const tools = cadSiteTools(h.cad);
    const edit = tools.find(tool => tool.name === 'cad_edit_document');
    const context = tools.find(tool => tool.name === 'cad_get_context');
    if (!edit || !context) throw new Error('Missing CAD tools');
    const before = h.session.getSnapshot();
    const pattern: CadFeature = { id: 'radial', name: 'Circular pattern', kind: 'circular-pattern', suppressed: false,
      sourceId: 'pad', count: 4, axis: 'z', center: ['pitch', 0, 0], angle: '-extent' };
    const edits = [{ kind: 'set-parameter', name: 'pitch', value: 30 }, { kind: 'set-parameter', name: 'extent', value: 360 },
      { kind: 'add-feature', feature: { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false,
        sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null } },
      { kind: 'add-feature', feature: pattern }];
    await act(async () => h.session.setWorkflowOpen(true));
    await expect(edit.execute({ expectedVersion: before.version, edits })).resolves.toMatchObject({ ok: false, error: { code: 'WORKFLOW_OPEN' } });
    expect(h.session.getSnapshot().document).toBe(before.document);
    await act(async () => h.session.setWorkflowOpen(false));
    const cancellation = new AbortController(); cancellation.abort();
    await expect(edit.execute({ expectedVersion: before.version, edits }, { signal: cancellation.signal })).resolves.toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    await act(async () => { expect(await edit.execute({ expectedVersion: before.version, edits })).toMatchObject({ ok: true,
      data: { supported: { solids: expect.arrayContaining(['linear-pattern', 'circular-pattern']) }, featureCount: 3 } }); });
    const accepted = h.session.getSnapshot();
    expect(accepted.document.features[2]).toEqual(pattern);
    await expect(edit.execute({ expectedVersion: before.version, edits })).resolves.toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    await act(async () => { expect(await edit.execute({ expectedVersion: accepted.version, edits: [
      { kind: 'set-parameter', name: 'pitch', value: 99 }, { kind: 'set-parameter', name: 'extent', value: 361 }
    ] })).toMatchObject({ ok: false }); });
    expect(h.session.getSnapshot()).toBe(accepted);
    await act(async () => h.cad().undo(accepted.version));
    expect(h.session.getSnapshot().document).toEqual(before.document);
    await act(async () => h.cad().redo(h.session.getSnapshot().version));
    expect(h.session.getSnapshot().document).toEqual(accepted.document);
    await act(async () => { await h.cad().save(); });
    expect((await loadCadDocument(h.workbench().adapter, before.document.id)).document).toEqual(accepted.document);
    expect(await context.execute({})).toMatchObject({ ok: true, data: { dirty: false, savedVersion: expect.any(String) } });
  });
  const dxfText = '0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n10\n0\n20\n0\n40\n2\n0\nENDSEC\n0\nEOF\n';
  it('imports a unitless DXF through worker validation only after explicit units are supplied', async () => {
    const h = await harness(); const before = h.session.getSnapshot();
    kernel.importDxf.mockImplementation(async (input: CadDxfImportInput) => importCadDxfSketch(input));
    const tool = cadSiteTools(h.cad).find(tool => tool.name === 'cad_import_dxf');
    if (!tool) throw new Error('DXF import tool missing');
    await act(async () => { expect(await tool.execute({ expectedVersion: before.version, source: { text: dxfText, fileName: 'circle.dxf', format: 'dxf' } })).toMatchObject({ ok: false, error: { code: 'dxf-units-required' } }); });
    expect(h.session.getSnapshot()).toBe(before);
    await act(async () => { expect(await tool.execute({ expectedVersion: before.version, source: { units: 'inch', text: dxfText, fileName: 'circle.dxf', format: 'dxf' } })).toMatchObject({ ok: true, data: { imported: true, contourCount: 1, scaleToMillimeters: 25.4 } }); });
    const sketch = h.session.getSnapshot().document.features[0];
    expect(sketch).toMatchObject({ kind: 'sketch', profiles: [{ geometry: { kind: 'circle', radius: 50.8 } }], source: { text: dxfText, units: 'inch' } });
    expect(h.workbench().manifest.projects).toHaveLength(0);
  });
  it('rejects cancelled and substituted DXF source results without replacing the draft', async () => {
    const h = await harness(); const before = h.session.getSnapshot();
    const source = { format: 'dxf', fileName: 'circle.dxf', text: dxfText, units: 'mm' as const };
    const result = importCadDxfSketch({ fileName: source.fileName, text: source.text, units: source.units });
    kernel.importDxf.mockResolvedValueOnce({ ...result, sketch: { ...result.sketch, source: { ...source, text: `${dxfText} ` } } });
    await act(async () => { await expect(h.cad().importDxfSource(source, before.version)).rejects.toMatchObject({ code: 'INVALID_IMPORT_RESULT' }); });
    expect(h.session.getSnapshot()).toBe(before);
    const pending = deferred<CadDxfImportResult>(); kernel.importDxf.mockReturnValue(pending.promise);
    const abort = new AbortController(); let operation: Promise<unknown> | undefined;
    await act(async () => { operation = h.cad().importDxfSource(source, before.version, abort.signal); });
    abort.abort();
    await act(async () => { pending.resolve(result); await expect(operation).rejects.toMatchObject({ name: 'AbortError' }); });
    expect(h.session.getSnapshot()).toBe(before);
  });
  const solidSource = { format: 'step' as const, fileName: 'Valve.step', encoding: 'utf8' as const, data: 'ISO-10303-21;\r\nEND-ISO-10303-21;\r\n' };
  const solidAnalysis = { format: 'step' as const, fileName: solidSource.fileName, representation: 'exact-brep' as const, volume: 1000, solidCount: 1,
    sourceBytes: new TextEncoder().encode(solidSource.data).length, bounds: { min: [0, 0, 0] as const, max: [10, 10, 10] as const } };
  it.each(['step', 'dxf'] as const)('reads exact local %s text through bounded Blob slices instead of a full byte buffer', async format => {
    const h = await harness(), text = format === 'step' ? '\uFEFF' + solidSource.data + '/* 名😀 */\r\n' + ' '.repeat(100_000)
      : '\uFEFF0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nCIRCLE\r\n10\r\n0\r\n20\r\n0\r\n40\r\n2\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n' + ' '.repeat(100_000);
    const bytes = new TextEncoder().encode(text), fileName = `source.${format}`, file = new File([text], fileName), originalSlice = file.slice.bind(file);
    const fullRead = vi.fn(() => { throw new Error('A full source byte buffer was requested'); });
    Object.defineProperty(file, 'stream', { value: undefined }); Object.defineProperty(file, 'arrayBuffer', { value: fullRead });
    const slices = vi.fn((start = 0, end = file.size) => {
      const slice = originalSlice(start, end); Object.defineProperty(slice, 'arrayBuffer', { value: async () => bytes.buffer.slice(start, end) }); return slice;
    }); Object.defineProperty(file, 'slice', { value: slices });
    if (format === 'step') kernel.importSolid.mockResolvedValue({ ...solidAnalysis, fileName, sourceBytes: bytes.length });
    else kernel.importDxf.mockResolvedValue(importCadDxfSketch({ fileName, text, units: 'mm' }));
    await act(async () => { await h.cad().importDocument(file); await h.cad().confirmImport(format === 'step' ? 'file' : 'mm'); });
    expect(slices).toHaveBeenCalledTimes(2); expect(fullRead).not.toHaveBeenCalled();
    const feature = h.session.getSnapshot().document.features[0];
    expect(feature).toMatchObject({ source: format === 'step' ? { data: text } : { text } });
    await act(async () => { await h.cad().save(); });
    expect((await loadCadDocument(h.workbench().adapter, h.session.getSnapshot().document.id)).document.features[0]).toEqual(feature);
  });
  it('cancels a pending textual slice immediately and rejects invalid UTF-8 without accepting partial source or late data', async () => {
    const h = await harness(), before = h.session.getSnapshot(), input = deferred<ArrayBuffer>(), started = deferred<void>(), file = new File(['STEP'], 'pending.step');
    Object.defineProperty(file, 'stream', { value: undefined });
    Object.defineProperty(file, 'arrayBuffer', { value: () => { throw new Error('Full read'); } });
    Object.defineProperty(file, 'slice', { value: () => { const slice = new Blob(['STEP']); Object.defineProperty(slice, 'arrayBuffer', { value: () => { started.resolve(); return input.promise; } }); return slice; } });
    await act(async () => { await h.cad().importDocument(file); });
    let operation: Promise<unknown> | undefined, rejected: Promise<void> | undefined;
    await act(async () => { operation = h.cad().confirmImport('file'); rejected = expect(operation).rejects.toMatchObject({ name: 'AbortError' }); await started.promise; });
    await act(async () => { h.cad().cancelImport(); await rejected; });
    await act(async () => input.resolve(new TextEncoder().encode(solidSource.data).buffer));
    expect(kernel.importSolid).not.toHaveBeenCalled(); expect(h.session.getSnapshot()).toEqual(before);
    const invalid = new File([new Uint8Array([0xff, 0xfe])], 'invalid.step');
    Object.defineProperty(invalid, 'stream', { value: () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([0xff, 0xfe])); controller.close(); } }) });
    await act(async () => { await h.cad().importDocument(invalid); await expect(h.cad().confirmImport('file')).rejects.toMatchObject({ code: 'INVALID_ENCODING' }); });
    expect(h.session.getSnapshot().document).toBe(before.document); expect(kernel.importSolid).not.toHaveBeenCalled();
    await act(async () => h.cad().cancelImport());
  });
  it('reviews and imports a local STEP above the former byte cap through the same exact-source agent boundary, then saves its original', async () => {
    const h = await harness(), before = h.session.getSnapshot(), text = solidSource.data + ' '.repeat(2 * 1024 * 1024), bytes = new TextEncoder().encode(text);
    const file = sourceTextFile(text, solidSource.fileName);
    kernel.importSolid.mockResolvedValue({ ...solidAnalysis, sourceBytes: bytes.length, solidCount: 257 });
    await act(async () => { await h.cad().importDocument(file); });
    expect(h.cad().importFile?.file).toBe(file); expect(h.session.getSnapshot().document).toBe(before.document);
    await act(async () => { await h.cad().confirmImport('file'); });
    const imported = h.session.getSnapshot();
    expect(imported.document.features[0]).toMatchObject({ kind: 'imported', source: { ...solidSource, data: text } });
    expect(kernel.importSolid).toHaveBeenCalledWith({ ...solidSource, data: text }, expect.any(AbortSignal));
    await act(async () => { await h.cad().save(); });
    expect((await loadCadDocument(h.workbench().adapter, imported.document.id)).document).toEqual(imported.document);
  });
  it('imports a validated native solid through the shared agent operation and preserves its original on save', async () => {
    const h = await harness(); const before = h.session.getSnapshot();
    kernel.importSolid.mockResolvedValue(solidAnalysis);
    const tool = cadSiteTools(h.cad).find(tool => tool.name === 'cad_import_solid');
    if (!tool) throw new Error('Solid import tool missing');
    let receipt: unknown;
    await act(async () => { receipt = await tool.execute({ expectedVersion: before.version, source: solidSource }); });
    const imported = h.session.getSnapshot();
    expect(receipt).toMatchObject({ ok: true, data: { imported: true, documentId: imported.document.id, representation: 'exact-brep', volume: 1000 } });
    expect(imported.document.id).not.toBe(before.document.id);
    expect(imported.document.features).toEqual([expect.objectContaining({ kind: 'imported', source: solidSource })]);
    expect(imported.dirty).toBe(true); expect(imported.savedVersion).toBeNull();
    await act(async () => { await h.cad().save(); });
    expect((await loadCadDocument(h.workbench().adapter, imported.document.id)).document).toEqual(imported.document);
  });
  it('leaves the draft intact for failed, mismatched, stale and cancelled native imports', async () => {
    const h = await harness(); const before = h.session.getSnapshot();
    kernel.importSolid.mockRejectedValueOnce(new Error('Open shell'));
    await act(async () => { await expect(h.cad().importSolidSource(solidSource, before.version)).rejects.toThrow('Open shell'); });
    kernel.importSolid.mockResolvedValueOnce({ ...solidAnalysis, fileName: 'other.step' });
    await act(async () => { await expect(h.cad().importSolidSource(solidSource, before.version)).rejects.toMatchObject({ code: 'INVALID_IMPORT_RESULT' }); });
    expect(h.session.getSnapshot()).toBe(before);
    const pending = deferred<typeof solidAnalysis>(); kernel.importSolid.mockReturnValue(pending.promise);
    const abort = new AbortController(); let operation: Promise<unknown> | undefined;
    await act(async () => { operation = h.cad().importSolidSource(solidSource, before.version, abort.signal); });
    abort.abort();
    await act(async () => { pending.resolve(solidAnalysis); await expect(operation).rejects.toMatchObject({ name: 'AbortError' }); });
    expect(h.session.getSnapshot()).toBe(before);
    const late = deferred<typeof solidAnalysis>(); kernel.importSolid.mockReturnValue(late.promise);
    await act(async () => { operation = h.cad().importSolidSource(solidSource, before.version); });
    await act(async () => h.session.edit([{ kind: 'rename-document', name: 'Keep this edit' }]));
    await act(async () => { late.resolve(solidAnalysis); await expect(operation).rejects.toMatchObject({ code: 'STALE_STATE' }); });
    expect(h.session.getSnapshot().document.name).toBe('Keep this edit');
  });
  it('locks the file-unit review and cancels a delayed file read without creating a model', async () => {
    const h = await harness(); const before = h.session.getSnapshot();
    const read = deferred<ArrayBuffer>(); const file = new File(['binary STL'], 'part.stl');
    Object.defineProperty(file, 'arrayBuffer', { value: () => read.promise });
    await act(async () => { await h.cad().importDocument(file); });
    expect(h.cad().importFile?.file).toBe(file); expect(h.session.getSnapshot().workflowOpen).toBe(true);
    await act(async () => { await expect(h.cad().importSolidSource(solidSource, before.version)).rejects.toMatchObject({ code: 'WORKFLOW_OPEN' }); });
    let confirmation: Promise<unknown> | undefined;
    await act(async () => { confirmation = h.cad().confirmImport('inch'); });
    await act(async () => h.cad().cancelImport());
    await act(async () => { read.resolve(new ArrayBuffer(8)); await expect(confirmation).rejects.toMatchObject({ name: 'AbortError' }); });
    expect(kernel.importSolid).not.toHaveBeenCalled(); expect(h.cad().importFile).toBeNull();
    expect(h.session.getSnapshot().document).toBe(before.document); expect(h.session.getSnapshot().workflowOpen).toBe(false);
  });
  it('cancels native parsing without changing the draft or publishing a failure banner', async () => {
    const h = await harness(); const before = h.session.getSnapshot();
    const file = sourceTextFile(solidSource.data, solidSource.fileName);
    const parsed = deferred<typeof solidAnalysis>(); kernel.importSolid.mockReturnValue(parsed.promise);
    await act(async () => { await h.cad().importDocument(file); });
    let operation: Promise<unknown> | undefined;
    await act(async () => { operation = h.cad().confirmImport('file'); });
    await vi.waitFor(() => expect(kernel.importSolid).toHaveBeenCalled());
    await act(async () => h.cad().cancelImport());
    await act(async () => { parsed.resolve(solidAnalysis); await expect(operation).rejects.toMatchObject({ name: 'AbortError' }); });
    expect(h.session.getSnapshot().document).toBe(before.document); expect(h.session.getSnapshot().version).toBe(before.version);
    expect(h.session.getSnapshot().workflowOpen).toBe(false); expect(h.cad().errorMessage).toBeNull(); expect(h.cad().storageBusy).toBe(false);
  });
  it('closes a staged import on storage disconnect and aborts its pending file read', async () => {
    const h = await harness(); const before = h.session.getSnapshot(); const originalWorkbench = h.workbench();
    const read = deferred<ArrayBuffer>(); const file = new File(['STL'], 'part.stl');
    Object.defineProperty(file, 'arrayBuffer', { value: () => read.promise });
    await act(async () => { await h.cad().importDocument(file); });
    let operation: Promise<unknown> | undefined;
    await act(async () => { operation = h.cad().confirmImport('mm'); });
    await h.switchWorkbench(null);
    expect(h.cad().importFile).toBeNull(); expect(h.session.getSnapshot().workflowOpen).toBe(false);
    await act(async () => { read.resolve(new ArrayBuffer(3)); await expect(operation).rejects.toMatchObject({ name: 'AbortError' }); });
    expect(h.session.getSnapshot().document).toBe(before.document); expect(kernel.importSolid).not.toHaveBeenCalled();
    await h.switchWorkbench(originalWorkbench);
    expect(h.cad().importFile).toBeNull(); expect(h.session.getSnapshot().document).toBe(before.document);
  });
  it('preserves unsaved content but detaches its save fingerprint across disconnected storage changes', async () => {
    const h = await harness(true);
    await act(async () => { await h.cad().save(); h.cad().edit([{ kind: 'rename-document', name: 'Keep this draft' }]); });
    const edited = h.session.getSnapshot(); expect(edited.savedVersion).not.toBeNull();
    await h.switchWorkbench(null);
    expect(h.session.getSnapshot().document).toBe(edited.document); expect(h.session.getSnapshot().savedVersion).toBe(edited.savedVersion);
    await h.switchWorkbench(await openWorkbench('cad-controller-reconnected'));
    expect(h.session.getSnapshot().document).toBe(edited.document); expect(h.session.getSnapshot().dirty).toBe(true);
    expect(h.session.getSnapshot().savedVersion).toBeNull();
  });
  it('rebuilds retained unsaved solids after reconnecting to another store', async () => {
    const h = await harness(true);
    const result: CadBuildResult = { buildId: 'retained-solid', meshes: [{ featureId: 'pad', name: 'Pad', volume: 1000,
      positions: [], normals: [], indices: [], edges: [], faceGroups: [], edgeGroups: [], bounds: { min: [0, 0, 0], max: [10, 10, 10] } }], diagnostics: [], durationMs: 1 };
    kernel.build.mockResolvedValue(result);
    await act(async () => h.cad().edit([{ kind: 'add-feature', feature: { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false,
      sketchId: 'sketch', distance: 10, symmetric: false, operation: 'new', targetId: null } }]));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 110)); });
    expect(h.cad().buildState).toBe('ready'); const retained = h.session.getSnapshot().document;
    await h.switchWorkbench(null); await h.switchWorkbench(await openWorkbench('cad-solid-reconnected'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 110)); });
    expect(h.session.getSnapshot().document).toBe(retained);
    expect(kernel.build).toHaveBeenCalledTimes(2); expect(h.cad().build).toEqual(result);
    expect(h.cad().buildVersion).toBe(h.session.getSnapshot().version);
  });
  it('exposes exact topology in byte-adaptive pages without losing or repeating descriptors', async () => {
    const h = await harness(true); const version = h.session.getSnapshot().version;
    kernel.build.mockResolvedValue({ buildId: 'topology-build', meshes: [{ featureId: 'pad', name: 'Pad', volume: 1000,
      positions: [], normals: [], indices: [], edges: [], faceGroups: [], edgeGroups: [], bounds: { min: [0, 0, 0], max: [20, 10, 5] } }], diagnostics: [], durationMs: 1 } satisfies CadBuildResult);
    await act(async () => { await h.cad().inspectBuild(version); });
    const descriptors: CadTopologyDescriptor[] = Array.from({ length: 83 }, (_, index) => ({ key: `edge-${index}-${'孔'.repeat(100)}`, kind: 'edge', curveType: 'circle',
      centroid: [12345678.987654321, 23456789.87654321, 34567890.7654321], bounds: { min: [1.123456789012345, 2.123456789012345, 3.123456789012345], max: [1e9, 1e9, 1e9] },
      length: 12345678.123456789, center: [12345678.987654321, 23456789.87654321, 34567890.7654321], axis: [0, 0, 1], radius: 12345678.123456789,
      start: [12345678.987654321, 23456789.87654321, 34567890.7654321], end: [12345678.987654321, 23456789.87654321, 34567890.7654321],
      midpoint: [12345678.987654321, 23456789.87654321, 34567890.7654321], closed: true }));
    kernel.inspectTopology.mockImplementation(async (_document, request: CadTopologyInspectRequest) => {
      if (request.selection.kind !== 'page') throw new Error('Expected page request');
      const { offset, limit } = request.selection;
      return { bodyId: 'pad', buildId: 'topology-build', descriptors: descriptors.slice(offset, offset + limit), total: descriptors.length,
        nextOffset: offset + limit < descriptors.length ? offset + limit : null };
    });
    const tools = cadSiteTools(h.cad); const inspect = tools.find(tool => tool.name === 'cad_inspect_topology');
    if (!inspect) throw new Error('Topology tool missing');
    let offset: number | null = 0; const collected: CadTopologyDescriptor[] = []; let calls = 0;
    while (offset !== null) {
      const reply = await inspect.execute({ expectedVersion: version, expectedBuildId: 'topology-build', bodyId: 'pad', kind: 'edge', offset, limit: 50 }) as {
        ok: boolean; data: { descriptors: CadTopologyDescriptor[]; nextOffset: number | null; total: number }
      };
      expect(reply.ok).toBe(true);
      expect(new TextEncoder().encode(JSON.stringify(reply)).length).toBeLessThan(32 * 1024);
      expect(reply.data.total).toBe(83); collected.push(...reply.data.descriptors); offset = reply.data.nextOffset; calls += 1;
      if (calls > 10) throw new Error('Topology pagination did not advance.');
    }
    expect(calls).toBeGreaterThan(2);
    expect(collected).toEqual(descriptors);
    await act(async () => h.session.setWorkflowOpen(true));
    expect(await inspect.execute({ expectedVersion: version, expectedBuildId: 'topology-build', bodyId: 'pad', kind: 'face' })).toMatchObject({ ok: false, error: { code: 'WORKFLOW_OPEN' } });
  });
  it('bounds context diagnostics so accepted edits still return a truthful success receipt', async () => {
    const h = await harness(true);
    await act(async () => h.session.edit(Array.from({ length: 128 }, (_, index) => ({ kind: 'set-parameter', name: `dimension_${index}_${'x'.repeat(45)}`, value: index }))));
    const diagnostics = Array.from({ length: 256 }, (_, index) => ({ code: 'kernel-failure', message: `Feature ${index}: ${'孔\\\"\n'.repeat(1500)}` }));
    kernel.build.mockResolvedValue({ buildId: 'build-context', meshes: [], diagnostics, durationMs: 1 });
    await act(async () => { await h.cad().inspectBuild(); });
    const tools = cadSiteTools(h.cad);
    const context = tools.find(tool => tool.name === 'cad_get_context');
    const edit = tools.find(tool => tool.name === 'cad_edit_document');
    if (!context || !edit) throw new Error('CAD context/edit tools missing.');
    const summary = await context.execute({}) as { ok: boolean; data: { diagnostics: { message: string; messageTruncated?: boolean }[]; omittedDiagnostics: number } };
    expect(summary.ok).toBe(true);
    expect(summary.data.diagnostics.length).toBeGreaterThan(0);
    expect(summary.data.diagnostics.every(diagnostic => diagnostic.messageTruncated && diagnostics[0].message.length > diagnostic.message.length)).toBe(true);
    expect(summary.data.omittedDiagnostics + summary.data.diagnostics.length).toBe(256);
    expect(new TextEncoder().encode(JSON.stringify(summary)).length).toBeLessThan(32 * 1024);
    let receipt: unknown;
    await act(async () => { receipt = await edit.execute({ expectedVersion: h.session.getSnapshot().version, edits: [{ kind: 'rename-document', name: 'Accepted edit' }] }); });
    expect(receipt).toMatchObject({ ok: true, data: { name: 'Accepted edit' } });
    expect(h.session.getSnapshot().document.name).toBe('Accepted edit');
    expect(new TextEncoder().encode(JSON.stringify(receipt)).length).toBeLessThan(32 * 1024);
  });
  it('captures bounded real-image data with CAD draft provenance and exposes only its local artifact receipt', async () => {
    const h = await harness(true); const snapshot = h.session.getSnapshot();
    let state: CadViewportState = { documentId: snapshot.document.id, documentVersion: snapshot.version, dirty: true,
      selectedFeatureId: null, selectedProfileId: null, sketchId: null, curveId: null, selectedReferencePlane: null, awaitingSketchPlane: false, workflowOpen: false, busy: false, buildVersion: snapshot.version,
      buildState: 'ready', buildId: 'build-preview', pickMode: 'body', topologySelection: null,
      visibleBodyIds: [], view: { mode: 'solid', available: true, view: 'Top', gridVisible: true, zoom: 1, revision: 0 } };
    const capture: CadViewportCapture = { contentSource: 'cad-draft', documentId: snapshot.document.id, documentVersion: snapshot.version, dirty: true,
      sketchId: null, curveId: null, buildVersion: snapshot.version, viewState: state,
      image: { source: '3d', width: 1, height: 1, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDSkAAAAASUVORK5CYII=' } };
    h.cad().setViewportControls({ getState: () => state, apply: vi.fn(), capture: async () => capture });
    let receipt: unknown;
    await act(async () => { receipt = await h.cad().captureViewport(snapshot.version); });
    expect(receipt).toMatchObject({ documentId: snapshot.document.id, draftVersion: snapshot.version, dirty: true, contentSource: 'cad-draft', source: '3d', downloadRequested: false, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(receipt)).not.toContain('base64');
    expect(h.cad().previewArtifact?.previewUrl).toMatch(/^blob:/);
    const acceptedUrl = h.cad().previewArtifact?.previewUrl;
    h.cad().setViewportControls({ getState: () => state, apply: vi.fn(), capture: async () => { state = { ...state, selectedReferencePlane: 'XZ' }; return capture; } });
    await act(async () => { await expect(h.cad().captureViewport(snapshot.version)).rejects.toMatchObject({ code: 'STALE_VIEW' }); });
    expect(h.cad().previewArtifact?.previewUrl).toBe(acceptedUrl);
  });
  it.each(['sketch', 'datum-plane'] as const)('keeps maximum-length %s reference visibility and capture receipts within the public tool budget', async kind => {
    const h = await harness();
    const features: CadFeature[] = Array.from({ length: 256 }, (_, index) => kind === 'datum-plane' ? { id: `s${String(index).padStart(3, '0')}${'x'.repeat(92)}`,
      name: `Datum ${index}`, kind, suppressed: false, definition: { kind: 'world', basePlane: 'XY', origin: [0, 0, index], rotation: [0, 0, 0] } } : ({ id: `s${String(index).padStart(3, '0')}${'x'.repeat(92)}`,
      name: `Section ${index}`, kind: 'sketch', plane: 'XY', offset: index, suppressed: false,
      profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 2 } }] }));
    await act(async () => h.session.replace(parseCadDocument({ ...createCadDocument('Many sections', 'many_sections'), features })));
    const snapshot = h.session.getSnapshot();
    const state: CadViewportState = { documentId: snapshot.document.id, documentVersion: snapshot.version, dirty: true,
      selectedFeatureId: features[0].id, selectedProfileId: null, sketchId: null, curveId: null, selectedReferencePlane: null, awaitingSketchPlane: false, workflowOpen: false, busy: false,
      buildVersion: null, buildState: 'idle', buildId: null, pickMode: 'body', topologySelection: null, visibleBodyIds: [],
      view: { mode: 'solid', available: true, view: 'Isometric', gridVisible: false, zoom: 1, revision: 1,
        referenceVersion: snapshot.version, referenceFeatureIds: Object.freeze(features.map(feature => feature.id).sort()), referencePlanes: cadReferencePlanes(prepareCadViewportReferences(features, {})) } };
    h.cad().setViewportControls({ getState: () => state, apply: vi.fn(), capture: async () => ({ contentSource: 'cad-draft', documentId: snapshot.document.id,
      documentVersion: snapshot.version, dirty: true, sketchId: null, curveId: null, buildVersion: null, viewState: state,
      image: { source: '3d', width: 1, height: 1, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDSkAAAAASUVORK5CYII=' } }) });
    const tools = cadSiteTools(h.cad);
    for (const name of ['cad_get_viewport', 'cad_capture_preview']) {
      const tool = tools.find(entry => entry.name === name); if (!tool) throw new Error(`Missing ${name}`);
      let result: unknown;
      await act(async () => { result = await tool.execute({ expectedVersion: snapshot.version }); });
      expect(result).toMatchObject({ ok: true });
      const text = JSON.stringify(result);
      expect(text).toContain(features[255].id);
      expect(new TextEncoder().encode(text).length).toBeLessThan(32 * 1024);
      expect(text).not.toContain('base64');
    }
    expect(kernel.build).not.toHaveBeenCalled();
    expect(h.session.getSnapshot()).toBe(snapshot);
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
  it.each([
    { cause: 'body', replacement: { ...section, bodyId: 'other' } },
    { cause: 'plane', replacement: { ...section, plane: 'XZ' } },
    { cause: 'offset', replacement: { ...section, offset: 6 } },
    { cause: 'invalid geometry', replacement: { ...section, entities: [{ ...section.entities[0], radius: -4 }] } },
  ])('rejects a substituted $cause section before either CAD or CAM persistence', async ({ replacement }) => {
    const h = await harness(true, true);
    await act(async () => h.session.edit([{ kind: 'set-parameter', name: 'height', value: 10 }]));
    const before = h.session.getSnapshot(); kernel.section.mockResolvedValue(replacement);
    await act(async () => h.session.setWorkflowOpen(true, 'section'));
    await act(async () => {
      await expect(h.cad().sendSectionToCam({ bodyId: 'pad', plane: 'XY', offset: 'height / 2' }, before.version, undefined, 'section'))
        .rejects.toMatchObject({ code: 'INVALID_SECTION_RESULT' });
    });
    expect(h.session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, dirty: true, savedVersion: null, workflowOpen: true });
    expect(h.workbench().manifest.projects).toHaveLength(0);
    await expect(loadCadDocument(h.workbench().adapter, before.document.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(h.cad().isBusy()).toBe(false); expect(h.cad().isOpen()).toBe(true);
  });
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
  it.each(['disconnect', 'another workbench'] as const)('keeps the draft unsaved in its current store when %s occurs after the previous store commits', async change => {
    const h = await harness(true), original = h.workbench(), before = h.session.getSnapshot();
    const next = change === 'disconnect' ? null : await openWorkbench('cad-controller-during-commit');
    const committed = deferred<void>(), finish = deferred<void>(), originalDelete = original.adapter.deleteText.bind(original.adapter);
    vi.spyOn(original.adapter, 'deleteText').mockImplementation(async path => {
      await originalDelete(path);
      if (path === 'transactions/workbench-files.json') { committed.resolve(); await finish.promise; }
    });
    let pending: ReturnType<CadController['save']> | undefined;
    await act(async () => { pending = h.cad().save(before.version); await committed.promise; });
    await h.switchWorkbench(next);
    await act(async () => { finish.resolve(); await expect(pending).resolves.toMatchObject({ saved: true, draftMarkedSaved: false, storageName: original.adapter.name }); });
    expect(h.session.getSnapshot()).toMatchObject({ version: before.version, document: before.document, dirty: true, savedVersion: null });
    expect((await loadCadDocument(original.adapter, before.document.id)).document).toEqual(before.document);
    if (next) {
      await expect(loadCadDocument(next.adapter, before.document.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await act(async () => { await expect(h.cad().save(before.version)).resolves.toMatchObject({ saved: true, draftMarkedSaved: true, storageName: next.adapter.name }); });
      expect(h.session.getSnapshot().dirty).toBe(false);
      expect((await loadCadDocument(next.adapter, before.document.id)).document).toEqual(before.document);
    }
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
    const h = await harness(); const input = deferred<Uint8Array>(), started = deferred<void>();
    const file = new File([], 'import.cad.json');
    let cancelled = false;
    Object.defineProperty(file, 'stream', { value: () => new ReadableStream<Uint8Array>({
      async pull(controller) { started.resolve(); const bytes = await input.promise; if (!cancelled) { controller.enqueue(bytes); controller.close(); } },
      cancel() { cancelled = true; },
    }) });
    const initial = h.session.getSnapshot();
    let operation: Promise<unknown> | undefined;
    let rejection: Promise<void> | undefined;
    await act(async () => {
      operation = h.cad().importDocument(file); rejection = expect(operation).rejects.toMatchObject({ code: 'STALE_STATE' }); await started.promise;
    });
    await h.switchWorkbench(await openWorkbench('cad-controller-b'));
    await act(async () => {
      input.resolve(new TextEncoder().encode(JSON.stringify(createCadDocument('Imported', 'cad_imported'))));
      await rejection;
    });
    expect(cancelled).toBe(true);
    expect(h.session.getSnapshot().document).toBe(initial.document);
  });
  it.each(['cancel', 'unmount'] as const)('releases an active portable JSON read on %s without accepting its late complete data', async change => {
    const h = await harness(true);
    await act(async () => { await h.cad().save(); });
    const before = h.session.getSnapshot(), path = cadDocumentPath(before.document.id);
    const original = await h.workbench().adapter.readExactText?.(path);
    const input = deferred<Uint8Array>(), started = deferred<void>(), cancel = vi.fn();
    let cancelled = false;
    const file = new File([], 'large.cad.json');
    Object.defineProperty(file, 'stream', { value: () => new ReadableStream<Uint8Array>({
      async pull(controller) { started.resolve(); const bytes = await input.promise; if (!cancelled) { controller.enqueue(bytes); controller.close(); } },
      cancel() { cancelled = true; cancel(); },
    }) });
    let rejection: Promise<void> | undefined;
    await act(async () => {
      const pending = h.cad().importDocument(file); rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); await started.promise;
    });
    await act(async () => {
      if (change === 'cancel') h.cad().cancelImport(); else { root?.unmount(); root = undefined; }
      input.resolve(new TextEncoder().encode(JSON.stringify(cadBudgetFixture(CAD_FORMER_DOCUMENT_BYTES + 1))));
      await rejection;
    });
    expect(cancel).toHaveBeenCalled(); expect(cancelled).toBe(true);
    expect(h.session.getSnapshot()).toBe(before);
    expect(await h.workbench().adapter.readExactText?.(path)).toBe(original);
  });
  it('rejects malformed UTF-8 CAD JSON without replacing characters or the draft', async () => {
    const h = await harness(); const initial = h.session.getSnapshot();
    const bytes = new TextEncoder().encode(JSON.stringify(createCadDocument('Invalid byte here', 'cad_source')));
    bytes[bytes.indexOf('I'.charCodeAt(0))] = 0xff;
    const file = new File([bytes], 'broken.wireedm-cad');
    await act(async () => { await expect(h.cad().importDocument(file)).rejects.toMatchObject({ code: 'INVALID_ENCODING' }); });
    expect(h.session.getSnapshot()).toBe(initial);
  });
  it('accepts a UTF-8 BOM on portable CAD JSON without modifying embedded originals', async () => {
    const h = await harness();
    const original = { ...solidSource, data: `\uFEFF${solidSource.data}` };
    const document = { ...createCadDocument('Unicode Ø', 'cad_source'), features: [{ id: 'source', name: 'Original', kind: 'imported', suppressed: false, source: original }] };
    const bytes = new TextEncoder().encode(`\uFEFF${JSON.stringify(document)}`);
    const file = new File([bytes], 'source.wireedm-cad');
    await act(async () => { await h.cad().importDocument(file); });
    expect(h.session.getSnapshot().document).toMatchObject({ name: 'Unicode Ø', features: [{ source: original }] });
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
    await act(async () => { result.resolve({ buildId: 'build-delayed', meshes: [], diagnostics: [], durationMs: 1 }); await expect(operation).rejects.toMatchObject({ code: 'WORKFLOW_OPEN' }); });
    expect(h.cad().build).toBeNull();
  });
  it('does not publish a delayed inspected build after returning to CAM', async () => {
    const h = await harness(true), before = h.session.getSnapshot(), result = deferred<CadBuildResult>();
    kernel.build.mockReturnValue(result.promise);
    const operation = h.cad().inspectBuild(before.version);
    await vi.waitFor(() => expect(kernel.build).toHaveBeenCalled());
    await act(async () => h.cad().back());
    await act(async () => {
      result.resolve({ buildId: 'closed-build', meshes: [], diagnostics: [], durationMs: 1 });
      await expect(operation).rejects.toMatchObject({ code: 'CAD_NOT_OPEN' });
    });
    expect(h.cad().build).toBeNull(); expect(h.session.getSnapshot()).toBe(before);
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
  it.each(['sketch', 'curve'] as const)('rejects a %s DXF tool export when CAD closes during its lazy import', async kind => {
    const h = await harness(true);
    if (kind === 'curve') await act(async () => h.session.edit([{ kind: 'add-feature', feature: {
      kind: 'curve', id: 'rail', name: 'Rail', suppressed: false, plane: 'XY', offset: 0,
      segments: [{ kind: 'line', start: [0, 0], end: [10, 0] }]
    } }]));
    const version = h.session.getSnapshot().version;
    const tool = cadSiteTools(h.cad).find(entry => entry.name === (kind === 'curve' ? 'cad_export_curve_dxf' : 'cad_export_dxf'));
    if (!tool) throw new Error('DXF export tool missing');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await act(async () => {
      const pending = tool.execute({ expectedVersion: version, ...(kind === 'curve' ? { curveId: 'rail' } : { sketchId: 'sketch' }) });
      h.cad().back();
      await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'CAD_NOT_OPEN' } });
    });
    expect(click).not.toHaveBeenCalled();
    expect(h.session.getSnapshot().version).toBe(version);
  });
  it.each([['sketch', 'close'], ['curve', 'close'], ['sketch', 'busy'], ['curve', 'busy']] as const)
    ('rechecks %s measurement after %s changes while its lazy module loads', async (kind, change) => {
      const h = await harness(true);
      if (kind === 'curve') await act(async () => h.session.edit([{ kind: 'add-feature', feature: {
        kind: 'curve', id: 'rail', name: 'Rail', suppressed: false, plane: 'XY', offset: 0,
        segments: [{ kind: 'line', start: [0, 0], end: [10, 0] }]
      } }]));
      const before = h.session.getSnapshot();
      const result = deferred<Blob>(); kernel.export.mockReturnValue(result.promise);
      const abort = new AbortController();
      await act(async () => {
        const pending = kind === 'curve' ? h.cad().measureCurve('rail', before.version) : h.cad().measureSketch('sketch', before.version);
        let competing: Promise<unknown> | undefined;
        if (change === 'close') h.cad().back();
        else competing = h.cad().exportSolid('step', before.version, abort.signal);
        try { await expect(pending).rejects.toMatchObject({ code: change === 'close' ? 'CAD_NOT_OPEN' : 'BUSY' }); }
        finally {
          if (competing) {
            abort.abort(); result.resolve(new Blob(['STEP']));
            await expect(competing).rejects.toMatchObject({ name: 'AbortError' });
          }
        }
      });
      expect(h.session.getSnapshot()).toBe(before);
    });
  it.each(['sketch', 'curve'] as const)('rejects a %s DXF export when another operation acquires the lock during its lazy import', async kind => {
    const h = await harness(true);
    if (kind === 'curve') await act(async () => h.session.edit([{ kind: 'add-feature', feature: {
      kind: 'curve', id: 'rail', name: 'Rail', suppressed: false, plane: 'XY', offset: 0,
      segments: [{ kind: 'line', start: [0, 0], end: [10, 0] }]
    } }]));
    const version = h.session.getSnapshot().version;
    const result = deferred<Blob>(); kernel.export.mockReturnValue(result.promise);
    const abort = new AbortController();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await act(async () => {
      const pending = kind === 'curve' ? h.cad().exportCurveDxf('rail', version) : h.cad().exportDxf('sketch', version);
      const competing = h.cad().exportSolid('step', version, abort.signal);
      expect(h.cad().isBusy()).toBe(true);
      try { await expect(pending).rejects.toMatchObject({ code: 'BUSY' }); }
      finally {
        abort.abort(); result.resolve(new Blob(['STEP']));
        await expect(competing).rejects.toMatchObject({ name: 'AbortError' });
      }
    });
    expect(click).not.toHaveBeenCalled();
    expect(h.cad().isBusy()).toBe(false);
  });
});
