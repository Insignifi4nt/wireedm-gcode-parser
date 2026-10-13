import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { initializeWorkbenchCatalog, type ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import type { CadBuildResult, CadFeature } from '@/domain/cad/cadDocument';
import type { CadSectionResult } from '@/domain/cad/cadSection';
import type { CadTopologyDescriptor, CadTopologyInspectRequest } from '@/domain/cad/cadTopology';
import { loadCadDocument } from '@/domain/cad/cadStorage';
import { CadSession } from './cadSession';
import { useCadController, type CadController } from './useCadController';
import { cadSiteTools } from './cadSiteTools';
import type { CadViewportCapture, CadViewportState } from './cadViewportControls';
import { loadEditorProgram } from '@/domain/editor/loadEditorProgram';
import { importCadDxfSketch, type CadDxfImportInput, type CadDxfImportResult } from '@/domain/cad/cadDxfImport';
import { importCadDxfCurve, type CadDxfCurveImportInput, type CadDxfCurveImportResult } from '@/domain/cad/cadCurveDxf';

const kernel = vi.hoisted(() => ({ build: vi.fn(), section: vi.fn(), export: vi.fn(), importSolid: vi.fn(), importDxf: vi.fn(), importDxfCurve: vi.fn(), inspectTopology: vi.fn(), resolveTopologyPicks: vi.fn(), dispose: vi.fn() }));
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
  it('rechecks draft changes and late cancellation after loading the Sweep inspector', async () => {
    const h = await sweepHarness(); const before = h.session.getSnapshot();
    await act(async () => {
      const reading = h.cad().inspectSweep('sketch', 'rail', before.version);
      h.session.edit([{ kind: 'rename-document', name: 'Newer draft' }]);
      await expect(reading).rejects.toMatchObject({ code: 'STALE_STATE' });
    });
    const latest = h.session.getSnapshot(); const abort = new AbortController();
    const reading = h.cad().inspectSweep('sketch', 'rail', latest.version, abort.signal); abort.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.session.getSnapshot()).toBe(latest); expect(kernel.build).not.toHaveBeenCalled();
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
    const file = new File([curveDxf], 'Rail.dxf');
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(curveDxf).buffer });
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
    const bytes = new TextEncoder().encode(solidSource.data); const buffer = new ArrayBuffer(bytes.length); new Uint8Array(buffer).set(bytes);
    const file = new File([solidSource.data], solidSource.fileName);
    Object.defineProperty(file, 'arrayBuffer', { value: async () => buffer });
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
    const state: CadViewportState = { documentId: snapshot.document.id, documentVersion: snapshot.version, dirty: true,
      selectedFeatureId: null, selectedProfileId: null, sketchId: null, curveId: null, workflowOpen: false, busy: false, buildVersion: snapshot.version,
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
  });
  it('keeps maximum-length reference visibility and capture receipts within the public tool budget', async () => {
    const h = await harness();
    const features: CadFeature[] = Array.from({ length: 256 }, (_, index) => ({ id: `s${String(index).padStart(3, '0')}${'x'.repeat(92)}`,
      name: `Section ${index}`, kind: 'sketch', plane: 'XY', offset: index, suppressed: false,
      profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 2 } }] }));
    await act(async () => h.session.replace(parseCadDocument({ ...createCadDocument('Many sections', 'many_sections'), features })));
    const snapshot = h.session.getSnapshot();
    const state: CadViewportState = { documentId: snapshot.document.id, documentVersion: snapshot.version, dirty: true,
      selectedFeatureId: features[0].id, selectedProfileId: null, sketchId: null, curveId: null, workflowOpen: false, busy: false,
      buildVersion: null, buildState: 'idle', buildId: null, pickMode: 'body', topologySelection: null, visibleBodyIds: [],
      view: { mode: 'solid', available: true, view: 'Isometric', gridVisible: false, zoom: 1, revision: 1,
        referenceVersion: snapshot.version, referenceFeatureIds: Object.freeze(features.map(feature => feature.id).sort()) } };
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
    const h = await harness(); const input = deferred<ArrayBuffer>();
    const file = new File([], 'import.cad.json');
    Object.defineProperty(file, 'arrayBuffer', { value: () => input.promise });
    const initial = h.session.getSnapshot();
    let operation: Promise<unknown> | undefined;
    await act(async () => { operation = h.cad().importDocument(file); });
    await h.switchWorkbench(await openWorkbench('cad-controller-b'));
    await act(async () => {
      input.resolve(new TextEncoder().encode(JSON.stringify(createCadDocument('Imported', 'cad_imported'))).buffer);
      await expect(operation).rejects.toMatchObject({ code: 'STALE_STATE' });
    });
    expect(h.session.getSnapshot().document).toBe(initial.document);
  });
  it('rejects malformed UTF-8 CAD JSON without replacing characters or the draft', async () => {
    const h = await harness(); const initial = h.session.getSnapshot();
    const bytes = new TextEncoder().encode(JSON.stringify(createCadDocument('Invalid byte here', 'cad_source')));
    bytes[bytes.indexOf('I'.charCodeAt(0))] = 0xff;
    const file = new File([bytes], 'broken.wireedm-cad');
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    await act(async () => { await expect(h.cad().importDocument(file)).rejects.toMatchObject({ code: 'INVALID_ENCODING' }); });
    expect(h.session.getSnapshot()).toBe(initial);
  });
  it('accepts a UTF-8 BOM on portable CAD JSON without modifying embedded originals', async () => {
    const h = await harness();
    const original = { ...solidSource, data: `\uFEFF${solidSource.data}` };
    const document = { ...createCadDocument('Unicode Ø', 'cad_source'), features: [{ id: 'source', name: 'Original', kind: 'imported', suppressed: false, source: original }] };
    const bytes = new TextEncoder().encode(`\uFEFF${JSON.stringify(document)}`);
    const file = new File([bytes], 'source.wireedm-cad');
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
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
