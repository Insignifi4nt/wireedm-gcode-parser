import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { useWorkbenchAppController } from '@/app/useWorkbenchAppController';
import type { CadBuildResult, CadDocument } from '@/domain/cad/cadDocument';
import { cadFeatureProducesBody, createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { listCadDocuments, loadCadDocument, saveCadDocument, MAX_CAD_FILE_BYTES, type CadLibraryEntry } from '@/domain/cad/cadStorage';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { parseCadSectionRequest, type CadSectionRequest } from '@/domain/cad/cadSection';
import type { DraftReadSnapshot } from '@/features/webmcp/workbenchSiteTools';
import { ToolError } from '@/features/webmcp/siteTools';
import { CadSession, hasCadDraftContent } from './cadSession';
import type { CadViewportCommand, CadWorkbenchViewportControls, CadViewportState } from './cadViewportControls';
import { preparePreviewCapture, downloadPreviewCapture, type PreviewCaptureArtifact } from '@/features/webmcp/previewCapture';
import { createCadTopologyActions } from './cadTopologyActions';
import { cadBytesToBase64, cadSolidImportBytes, isCadSolidImportResult, MAX_CAD_IMPORT_BYTES, parseCadSolidImportSource, type CadSolidImportSource } from '@/domain/cad/cadImports';
import { parseCadDxfImportSource, type CadDxfUnits } from '@/domain/cad/cadDxfSource';
import type { DxfUnitDeclaration } from '@/domain/dxf/types';

type App = Pick<ReturnType<typeof useWorkbenchAppController>, 'connectedWorkbench' | 'workbenchInteractionLocked' | 'runAgentWorkbenchOperation'>;
type Kernel = ReturnType<typeof import('./kernel/cadKernelClient').createCadKernelClient>;
export function downloadCadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
const fileBase = (name: string) => name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 100) || 'part';
function importUnitReceipt(declaration: DxfUnitDeclaration) {
  if (declaration.status !== 'malformed' || declaration.rawValue === null || declaration.rawValue.length <= 160) return declaration;
  // The exact declaration remains in the saved original; keep committed tool receipts bounded.
  return { ...declaration, rawValue: declaration.rawValue.slice(0, 160), rawValueTruncated: true, rawValueLength: declaration.rawValue.length };
}
type CadPreviewArtifact = PreviewCaptureArtifact & { documentId: string; viewState: CadViewportState; sketchId: string | null; curveId: string | null };
const viewIdentity = (state: CadViewportState) => JSON.stringify([state.documentVersion, state.buildVersion, state.buildId, state.selectedFeatureId, state.selectedProfileId, state.sketchId, state.curveId, state.pickMode, state.topologySelection, state.view]);

export function useCadController(app: App, session: CadSession, open: boolean, setOpen: (open: boolean) => void,
  getCamDraft: () => DraftReadSnapshot | null) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [build, setBuild] = useState<CadBuildResult | null>(null);
  const [buildVersion, setBuildVersion] = useState<string | null>(null);
  const [buildState, setBuildState] = useState<'idle' | 'building' | 'ready' | 'error'>('idle');
  const liveBuild = useRef({ result: build, version: buildVersion, state: buildState });
  liveBuild.current = { result: build, version: buildVersion, state: buildState };
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [library, setLibrary] = useState<CadLibraryEntry[] | null>(null);
  const [libraryDiagnostic, setLibraryDiagnostic] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<{ file: File; version: string; adapter: NonNullable<App['connectedWorkbench']>['adapter'] } | null>(null);
  const importAbort = useRef<AbortController | null>(null);
  const [previewArtifact, setPreviewArtifact] = useState<CadPreviewArtifact | null>(null);
  const previewUrl = useRef<string | null>(null);
  const viewport = useRef<CadWorkbenchViewportControls | null>(null);
  const setViewportControls = useCallback((controls: CadWorkbenchViewportControls | null) => { viewport.current = controls; }, []);
  const busy = useRef(false);
  const current = useRef({ app, open }); current.current = { app, open };
  const kernel = useRef<Promise<Kernel> | null>(null);
  const buildAbort = useRef<AbortController | null>(null);
  const boundAdapter = useRef(app.connectedWorkbench?.adapter);
  function changeOpen(value: boolean) {
    current.current.open = value;
    setOpen(value);
  }

  function getKernel() {
    kernel.current ??= import('./kernel/cadKernelClient').then(module => module.createCadKernelClient());
    return kernel.current;
  }
  function publishBuild(result: CadBuildResult, version: string) {
    const state = result.diagnostics.length ? 'error' : 'ready';
    liveBuild.current = { result, version, state };
    setBuild(result); setBuildVersion(version); setBuildState(state);
  }
  useLayoutEffect(() => {
    const adapter = app.connectedWorkbench?.adapter;
    const previous = boundAdapter.current;
    if (previous === adapter) return;
    importAbort.current?.abort(); setImportFile(null); session.setWorkflowOpen(false, 'import');
    // Retain the last store through a disconnect so reconnecting elsewhere cannot
    // reuse its saved fingerprint. A disconnect alone preserves the current draft.
    if (!adapter) return;
    boundAdapter.current = adapter;
    if (!previous) return;
    const state = session.getSnapshot();
    // A saved fingerprint belongs to one adapter. Never reuse it in a new store.
    // Unexpected dirty switches preserve the in-memory work as an unsaved copy.
    if (!state.dirty && !state.workflowOpen) session.replace(createCadDocument());
    else if (state.savedVersion !== null) session.detachStorage();
    setLibrary(null); setLibraryDiagnostic(null); setBuild(null); setBuildVersion(null); setErrorMessage(null);
  }, [app.connectedWorkbench?.adapter, session]);
  useEffect(() => () => {
    importAbort.current?.abort();
    buildAbort.current?.abort();
    void kernel.current?.then(value => value.dispose()); kernel.current = null;
    if (previewUrl.current) { const url = previewUrl.current; window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
  }, []);

  useEffect(() => {
    if (!open || !app.connectedWorkbench?.adapter) return;
    const controller = new AbortController();
    buildAbort.current?.abort(); buildAbort.current = controller;
    setBuildVersion(null);
    setBuildState(snapshot.document.features.some(feature => cadFeatureProducesBody(feature) && !feature.suppressed) ? 'building' : 'idle');
    if (!snapshot.document.features.some(feature => cadFeatureProducesBody(feature) && !feature.suppressed)) {
      setBuild(null); return () => controller.abort();
    }
    const timer = setTimeout(() => {
      void getKernel().then(client => client.build(snapshot.document, controller.signal)).then(result => {
        if (controller.signal.aborted || session.getSnapshot().version !== snapshot.version) return;
        publishBuild(result, snapshot.version);
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setBuildState('error'); setErrorMessage(error instanceof Error ? error.message : 'CAD kernel could not build this model.');
      });
    }, 80);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, snapshot.document, app.connectedWorkbench?.adapter]);

  useEffect(() => {
    const meaningful = hasCadDraftContent(snapshot.document);
    if (!snapshot.dirty || !meaningful) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [snapshot.dirty, snapshot.document]);

  function connected() {
    if (busy.current || current.current.app.workbenchInteractionLocked) throw new ToolError('BUSY', 'A workbench operation is running.');
    const workbench = current.current.app.connectedWorkbench;
    if (!workbench) throw new ToolError('WORKBENCH_UNAVAILABLE', 'Wait for the workbench to open.');
    return workbench;
  }
  function assertCanSwitch() {
    const cam = getCamDraft();
    if (cam?.dirty || cam?.workflowOpen) throw new ToolError('DRAFT_IN_USE', 'Save the CAM draft and finish its workflow before opening CAD.');
  }
  function editable(expectedVersion?: string, fromAgent = false) {
    connected();
    if (!current.current.open) throw new ToolError('CAD_NOT_OPEN', 'Open CAD with cad_create_document or cad_open_workspace first.');
    if (expectedVersion) session.assertVersion(expectedVersion);
    if (fromAgent) session.assertWorkflowClosed();
  }
  async function run<T>(action: () => Promise<T>) {
    connected(); busy.current = true; setStorageBusy(true); setErrorMessage(null);
    try { return await action(); }
    catch (error) {
      const aborted = (error instanceof Error || error instanceof DOMException) && error.name === 'AbortError';
      if (!aborted) setErrorMessage(error instanceof Error ? error.message : 'CAD operation failed.');
      throw error;
    }
    finally { busy.current = false; setStorageBusy(false); }
  }
  function enter() { connected(); assertCanSwitch(); changeOpen(true); }
  function edit(edits: readonly CadEdit[], expectedVersion?: string, fromAgent = false) {
    editable(expectedVersion, fromAgent); setErrorMessage(null);
    return session.edit(edits, expectedVersion);
  }
  async function persistReviewed(workbench: NonNullable<App['connectedWorkbench']>, expectedVersion: string, signal?: AbortSignal) {
    const reviewed = session.getSnapshot();
    const saved = await saveCadDocument(workbench.adapter, reviewed.document, {
      expectedSavedVersion: reviewed.savedVersion, signal, beforeWrite: () => {
        session.assertVersion(expectedVersion); session.assertWorkflowClosed();
        if (current.current.app.connectedWorkbench?.adapter !== workbench.adapter) throw new ToolError('STALE_STATE', 'Storage changed.');
      }
    });
    session.markSaved(saved, expectedVersion);
    return { saved: true, documentId: saved.document.id, savedVersion: saved.savedVersion, version: expectedVersion };
  }
  async function save(expectedVersion = session.getSnapshot().version, signal?: AbortSignal) {
    editable(expectedVersion); session.assertWorkflowClosed();
    const workbench = connected();
    return run(() => persistReviewed(workbench, expectedVersion, signal));
  }
  async function list(signal?: AbortSignal) {
    const workbench = connected();
    return listCadDocuments(workbench.adapter, signal);
  }
  async function showLibrary() {
    const result = await list(); setLibrary(result.entries);
    setLibraryDiagnostic([result.truncated ? 'The library listing is incomplete.' : '', ...result.diagnostics.map(d => `${d.path}: ${d.message}`)].filter(Boolean).join(' ') || null);
  }
  function requireCleanReplacement(scope?: 'import') {
    session.assertWorkflowClosed(scope);
    const state = session.getSnapshot();
    if (state.dirty && hasCadDraftContent(state.document)) throw new ToolError('UNSAVED_DRAFT', 'Save the current CAD draft before opening another document.');
  }
  async function openDocument(id: string, expectedVersion = session.getSnapshot().version, signal?: AbortSignal) {
    connected(); assertCanSwitch(); session.assertVersion(expectedVersion); requireCleanReplacement();
    const workbench = connected();
    return run(async () => {
      const saved = await loadCadDocument(workbench.adapter, id, signal);
      signal?.throwIfAborted(); session.assertVersion(expectedVersion); requireCleanReplacement();
      if (current.current.app.connectedWorkbench?.adapter !== workbench.adapter) throw new ToolError('STALE_STATE', 'Storage changed.');
      session.replace(saved.document, saved); setLibrary(null); setBuild(null); changeOpen(true);
      return session.getSnapshot();
    });
  }
  function newDocument(name = 'Untitled part', expectedVersion = session.getSnapshot().version) {
    connected(); assertCanSwitch(); session.assertVersion(expectedVersion); requireCleanReplacement();
    session.replace(createCadDocument(name)); setBuild(null); changeOpen(true);
    return session.getSnapshot();
  }
  async function importDocument(file: File) {
    const workbench = connected(); assertCanSwitch(); requireCleanReplacement();
    if (/\.(step|stp|stl|dxf)$/i.test(file.name)) {
      if (!file.size || file.size > MAX_CAD_IMPORT_BYTES) throw new ToolError('FILE_TOO_LARGE', 'CAD geometry files must be nonempty and at most 2 MiB.');
      setImportFile({ file, version: session.getSnapshot().version, adapter: workbench.adapter }); session.setWorkflowOpen(true, 'import');
      return;
    }
    if (file.size > MAX_CAD_FILE_BYTES) throw new ToolError('FILE_TOO_LARGE', 'CAD imports must be 4 MiB or smaller.');
    const expected = session.getSnapshot().version;
    return run(async () => {
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength > MAX_CAD_FILE_BYTES) throw new ToolError('FILE_TOO_LARGE', 'CAD imports must be 4 MiB or smaller.');
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new ToolError('INVALID_ENCODING', 'CAD JSON must contain valid UTF-8. The draft has not changed.'); }
      return acceptImportedDocument(JSON.parse(text), workbench, expected);
    });
  }
  function acceptImportedDocument(value: unknown, workbench: NonNullable<App['connectedWorkbench']>, expectedVersion: string, signal?: AbortSignal) {
    signal?.throwIfAborted(); session.assertVersion(expectedVersion); assertCanSwitch(); requireCleanReplacement();
    if (current.current.app.connectedWorkbench?.adapter !== workbench.adapter) throw new ToolError('STALE_STATE', 'Storage changed during CAD import.');
    const document = parseCadDocument(value);
    if (new TextEncoder().encode(JSON.stringify(document)).length > MAX_CAD_FILE_BYTES) throw new ToolError('FILE_TOO_LARGE', 'CAD imports must be 4 MiB or smaller.');
    // Portable imports always receive a fresh identity; never overwrite an installed save.
    session.replace({ ...document, id: `cad_${crypto.randomUUID()}` }); setBuild(null); changeOpen(true);
    return { imported: true, documentId: session.getSnapshot().document.id, sourceDocumentId: document.id, version: session.getSnapshot().version };
  }
  async function importDocumentValue(value: unknown, expectedVersion = session.getSnapshot().version, signal?: AbortSignal) {
    const workbench = connected(); session.assertVersion(expectedVersion); assertCanSwitch(); requireCleanReplacement();
    return run(async () => acceptImportedDocument(value, workbench, expectedVersion, signal));
  }
  function cancelImport() {
    importAbort.current?.abort(); importAbort.current = null;
    setImportFile(null); session.setWorkflowOpen(false, 'import'); setErrorMessage(null);
  }
  async function importSolidSource(value: unknown, expectedVersion = session.getSnapshot().version, signal?: AbortSignal, scope?: 'import') {
    const workbench = connected(); session.assertVersion(expectedVersion); assertCanSwitch(); requireCleanReplacement(scope);
    const source = parseCadSolidImportSource(value);
    return run(async () => {
      signal?.throwIfAborted();
      const client = await getKernel();
      signal?.throwIfAborted();
      const analysis = await client.importSolid(source, signal);
      signal?.throwIfAborted(); session.assertVersion(expectedVersion); assertCanSwitch(); requireCleanReplacement(scope);
      if (current.current.app.connectedWorkbench?.adapter !== workbench.adapter) throw new ToolError('STALE_STATE', 'Storage changed during CAD import.');
      if (!isCadSolidImportResult(analysis) || analysis.format !== source.format || analysis.fileName !== source.fileName || analysis.sourceBytes !== cadSolidImportBytes(source).length) {
        throw new ToolError('INVALID_IMPORT_RESULT', 'CAD import did not return a matching validated solid.');
      }
      const document = parseCadDocument({ ...createCadDocument(source.fileName.replace(/\.(step|stp|stl)$/i, '')), features: [{
        id: `import_${crypto.randomUUID()}`, name: source.fileName, kind: 'imported', suppressed: false, source
      }] });
      session.replace(document); setBuild(null); setBuildVersion(null); setBuildState('idle'); changeOpen(true);
      setImportFile(null);
      return { imported: true, documentId: document.id, version: session.getSnapshot().version, ...analysis };
    });
  }
  async function importDxfSource(value: unknown, expectedVersion = session.getSnapshot().version, signal?: AbortSignal, scope?: 'import') {
    const workbench = connected(); session.assertVersion(expectedVersion); assertCanSwitch(); requireCleanReplacement(scope);
    const source = parseCadDxfImportSource(value);
    return run(async () => {
      signal?.throwIfAborted(); const client = await getKernel(); signal?.throwIfAborted();
      const result = await client.importDxf({ fileName: source.fileName, text: source.text, ...(source.units ? { units: source.units } : {}) }, signal);
      signal?.throwIfAborted(); session.assertVersion(expectedVersion); assertCanSwitch(); requireCleanReplacement(scope);
      if (current.current.app.connectedWorkbench?.adapter !== workbench.adapter) throw new ToolError('STALE_STATE', 'Storage changed during CAD import.');
      const original = result.sketch.source;
      if (!original || original.format !== 'dxf' || original.fileName !== source.fileName || original.text !== source.text || original.units !== source.units) {
        throw new ToolError('INVALID_IMPORT_RESULT', 'DXF import did not preserve the supplied original.');
      }
      const document = parseCadDocument({ ...createCadDocument(result.sketch.name), features: [result.sketch] });
      session.replace(document); setBuild(null); setBuildVersion(null); setBuildState('idle'); changeOpen(true); setImportFile(null);
      return { imported: true, documentId: document.id, version: session.getSnapshot().version, sketchId: result.sketch.id,
        unitDeclaration: importUnitReceipt(result.unitDeclaration), scaleToMillimeters: result.scaleToMillimeters, sourceEntityCount: result.sourceEntityCount, contourCount: result.contourCount };
    });
  }
  async function importDxfCurveSource(value: unknown, expectedVersion = session.getSnapshot().version, signal?: AbortSignal, scope?: 'import') {
    const workbench = connected(); session.assertVersion(expectedVersion); assertCanSwitch(); requireCleanReplacement(scope);
    const source = parseCadDxfImportSource(value);
    return run(async () => {
      signal?.throwIfAborted(); const client = await getKernel(); signal?.throwIfAborted();
      const result = await client.importDxfCurve({ fileName: source.fileName, text: source.text, ...(source.units ? { units: source.units } : {}) }, signal);
      signal?.throwIfAborted(); session.assertVersion(expectedVersion); assertCanSwitch(); requireCleanReplacement(scope);
      if (current.current.app.connectedWorkbench?.adapter !== workbench.adapter) throw new ToolError('STALE_STATE', 'Storage changed during CAD import.');
      const original = result.curve.source;
      if (!original || original.format !== 'dxf' || original.fileName !== source.fileName || original.text !== source.text || original.units !== source.units) {
        throw new ToolError('INVALID_IMPORT_RESULT', 'DXF import did not preserve the supplied original.');
      }
      const document = parseCadDocument({ ...createCadDocument(result.curve.name), features: [result.curve] });
      session.replace(document); setBuild(null); setBuildVersion(null); setBuildState('idle'); changeOpen(true); setImportFile(null);
      return { imported: true, documentId: document.id, version: session.getSnapshot().version, curveId: result.curve.id,
        unitDeclaration: importUnitReceipt(result.unitDeclaration), scaleToMillimeters: result.scaleToMillimeters, sourceEntityCount: result.sourceEntityCount };
    });
  }
  async function confirmImport(units: CadDxfUnits | 'file', dxfKind: 'sketch' | 'curve' = 'sketch') {
    const pending = importFile;
    if (!pending) throw new ToolError('IMPORT_UNAVAILABLE', 'Choose a CAD file first.');
    connected(); session.assertVersion(pending.version); requireCleanReplacement('import');
    const controller = new AbortController(); importAbort.current = controller;
    try {
      const bytes = new Uint8Array(await pending.file.arrayBuffer());
      controller.signal.throwIfAborted();
      if (current.current.app.connectedWorkbench?.adapter !== pending.adapter) throw new ToolError('STALE_STATE', 'Storage changed during CAD import.');
      if (/\.dxf$/i.test(pending.file.name)) return await (dxfKind === 'curve' ? importDxfCurveSource : importDxfSource)({ format: 'dxf', fileName: pending.file.name,
        text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), ...(units === 'file' ? {} : { units }) }, pending.version, controller.signal, 'import');
      if (dxfKind !== 'sketch') throw new ToolError('INVALID_IMPORT_KIND', 'Curve import requires a DXF file.');
      if (/\.stl$/i.test(pending.file.name) && units !== 'mm' && units !== 'inch') throw new ToolError('INVALID_UNITS', 'Choose millimeters or inches for STL.');
      const source: CadSolidImportSource = /\.stl$/i.test(pending.file.name)
        ? { format: 'stl', fileName: pending.file.name, encoding: 'base64', data: cadBytesToBase64(bytes), units: units === 'inch' ? 'inch' : 'mm' }
        : { format: 'step', fileName: pending.file.name, encoding: 'utf8', data: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) };
      return await importSolidSource(source, pending.version, controller.signal, 'import');
    } finally { if (importAbort.current === controller) importAbort.current = null; }
  }
  async function measureSketch(sketchId: string, expectedVersion = session.getSnapshot().version, signal?: AbortSignal) {
    editable(expectedVersion); session.assertWorkflowClosed(); signal?.throwIfAborted();
    const { measureCadSketch } = await import('@/domain/cad/cadMeasurements');
    signal?.throwIfAborted(); editable(expectedVersion); session.assertWorkflowClosed();
    return measureCadSketch(session.getSnapshot().document, sketchId);
  }
  async function measureCurve(curveId: string, expectedVersion = session.getSnapshot().version, signal?: AbortSignal) {
    editable(expectedVersion); session.assertWorkflowClosed(); signal?.throwIfAborted();
    const { measureCadCurve } = await import('@/domain/cad/cadCurveMeasurements');
    signal?.throwIfAborted(); editable(expectedVersion); session.assertWorkflowClosed();
    return measureCadCurve(session.getSnapshot().document, curveId);
  }
  async function inspectPlane(featureId: string, expectedVersion = session.getSnapshot().version, signal?: AbortSignal) {
    editable(expectedVersion); session.assertWorkflowClosed(); signal?.throwIfAborted();
    const { inspectCadPlane } = await import('@/domain/cad/cadPlaneInspection');
    signal?.throwIfAborted(); editable(expectedVersion); session.assertWorkflowClosed();
    return { version: expectedVersion, ...inspectCadPlane(session.getSnapshot().document, featureId), persisted: false };
  }
  async function inspectLoft(sketchIds: readonly string[], expectedVersion = session.getSnapshot().version, signal?: AbortSignal) {
    editable(expectedVersion); session.assertWorkflowClosed(); signal?.throwIfAborted();
    const { inspectCadLoft } = await import('@/domain/cad/cadLoftInspection');
    signal?.throwIfAborted(); editable(expectedVersion); session.assertWorkflowClosed();
    return { version: expectedVersion, ...inspectCadLoft(session.getSnapshot().document, sketchIds), persisted: false };
  }
  async function inspectSweep(sketchId: string, curveId: string, expectedVersion = session.getSnapshot().version, signal?: AbortSignal) {
    editable(expectedVersion); session.assertWorkflowClosed(); signal?.throwIfAborted();
    const { inspectCadSweepInputs, MAX_CAD_SWEEP_SEGMENTS, MAX_CAD_SWEEP_WORK } = await import('@/domain/cad/cadSweep');
    signal?.throwIfAborted(); editable(expectedVersion); session.assertWorkflowClosed();
    const document = session.getSnapshot().document;
    const inspection = inspectCadSweepInputs({ kind: 'sweep', id: 'inspection_sweep', name: 'Sweep', suppressed: false,
      sketchId, curveId, operation: 'new', targetId: null }, new Map(document.features.map(feature => [feature.id, feature])), document.parameters);
    const receipt = { version: expectedVersion, sketchId, curveId, scope: 'new-feature-at-end' as const,
      limits: { curveSegments: MAX_CAD_SWEEP_SEGMENTS, sectionEdgesTimesCurveSegments: MAX_CAD_SWEEP_WORK }, persisted: false };
    if (!inspection.eligible) return { ...receipt, eligible: false as const, code: inspection.code, message: inspection.message };
    const { section, curve, clearance, sectionEdgeCount, nativeWork } = inspection.inputs;
    // Never return original imports or unbounded profile/curve geometry in a receipt.
    return { ...receipt, eligible: true as const, nativeBuildRequired: true, transport: 'fixed-binormal' as const,
      section: { plane: section.plane, offsetMm: section.offset, edgeCount: sectionEdgeCount },
      curve: { plane: curve.plane, offsetMm: curve.offset, segmentCount: curve.segments.length,
        lengthMm: curve.length, startWorldMm: curve.startWorld, startTangentWorld: curve.startTangentWorld },
      clearance, nativeWork };
  }
  function getViewport(expectedVersion = session.getSnapshot().version) {
    editable(expectedVersion);
    const controls = viewport.current;
    if (!controls || controls.getState().documentVersion !== expectedVersion) throw new ToolError('VIEWPORT_UNAVAILABLE', 'Wait for the CAD viewport to display the current document.');
    return controls;
  }
  function changeViewport(command: CadViewportCommand, expectedVersion: string) {
    session.assertWorkflowClosed();
    const controls = getViewport(expectedVersion);
    controls.apply(command);
    return { version: expectedVersion, applied: true, command };
  }
  async function captureViewport(expectedVersion = session.getSnapshot().version, download = false, signal = new AbortController().signal) {
    session.assertWorkflowClosed();
    const controls = getViewport(expectedVersion);
    return run(async () => {
      const captured = await controls.capture(signal);
      signal.throwIfAborted(); session.assertVersion(expectedVersion); session.assertWorkflowClosed();
      if (captured.documentVersion !== expectedVersion || captured.documentId !== session.getSnapshot().document.id) throw new ToolError('STALE_STATE', 'The CAD preview changed. Capture the current view again.');
      const prepared = await preparePreviewCapture(captured.image, { projectId: null, draftVersion: expectedVersion, dirty: captured.dirty, contentSource: 'cad-draft' }, signal);
      try {
        signal.throwIfAborted(); session.assertVersion(expectedVersion); session.assertWorkflowClosed();
        if (viewport.current !== controls || viewIdentity(controls.getState()) !== viewIdentity(captured.viewState)) throw new ToolError('STALE_VIEW', 'The CAD view changed during capture. Capture the current view again.');
      } catch (error) { URL.revokeObjectURL(prepared.previewUrl); throw error; }
      const artifact: CadPreviewArtifact = { ...prepared, fileName: `cad-preview-${captured.image.source}.png`, documentId: captured.documentId, sketchId: captured.sketchId, curveId: captured.curveId, viewState: captured.viewState };
      const previous = previewUrl.current;
      previewUrl.current = artifact.previewUrl; setPreviewArtifact(artifact);
      if (previous) window.setTimeout(() => URL.revokeObjectURL(previous), 60_000);
      if (download) {
        try { downloadPreviewCapture(artifact); }
        catch { return { ...artifact, downloadRequested: false, error: { code: 'DOWNLOAD_FAILED', message: 'The CAD PNG is captured. Use the CAD preview PNG link to download it again.' } }; }
      }
      return { ...artifact, downloadRequested: download };
    });
  }
  function exportDocument(expectedVersion = session.getSnapshot().version) {
    editable(expectedVersion); session.assertWorkflowClosed();
    const document = session.getSnapshot().document;
    downloadCadBlob(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }), `${fileBase(document.name)}.cad.json`);
    return { downloadRequested: true, fileName: `${fileBase(document.name)}.cad.json`, version: expectedVersion };
  }
  async function exportSolid(format: 'step' | 'stl', expectedVersion = session.getSnapshot().version, signal?: AbortSignal) {
    editable(expectedVersion); session.assertWorkflowClosed();
    const document = session.getSnapshot().document;
    return run(async () => {
      const blob = await (await getKernel()).export(document, format, signal);
      signal?.throwIfAborted(); session.assertVersion(expectedVersion); session.assertWorkflowClosed();
      const fileName = `${fileBase(document.name)}.${format}`;
      downloadCadBlob(blob, fileName);
      return { downloadRequested: true, fileName, bytes: blob.size, version: expectedVersion };
    });
  }
  async function inspectBuild(expectedVersion = session.getSnapshot().version, signal?: AbortSignal) {
    editable(expectedVersion); session.assertWorkflowClosed();
    const document = session.getSnapshot().document;
    const result = await (await getKernel()).build(document, signal);
    signal?.throwIfAborted(); session.assertVersion(expectedVersion); session.assertWorkflowClosed();
    publishBuild(result, expectedVersion);
    return result;
  }
  const topology = createCadTopologyActions({
    assertReadable: (expectedVersion, scope) => { editable(expectedVersion); session.assertWorkflowClosed(scope); },
    getDocument: () => session.getSnapshot().document,
    getBuild: () => liveBuild.current,
    getKernel
  });
  async function inspectSection(request: CadSectionRequest, expectedVersion: string, signal?: AbortSignal, scope?: 'section') {
    editable(expectedVersion); session.assertWorkflowClosed(scope);
    const section = { ...parseCadSectionRequest(request) };
    const document = session.getSnapshot().document;
    const result = await (await getKernel()).section(document, section, signal);
    signal?.throwIfAborted(); session.assertVersion(expectedVersion); session.assertWorkflowClosed(scope);
    return result;
  }
  type CamSource = { kind: 'sketch'; sketchId: string } | { kind: 'section'; section: CadSectionRequest };
  async function prepareHandoffGeometry(source: CamSource, document: CadDocument, signal?: AbortSignal) {
    const { cadSketchToCam, cadEntitiesToCam } = await import('@/domain/cad/cadCam');
    if (source.kind === 'sketch') return { path: cadSketchToCam(document, source.sketchId), sourceReceipt: { sketchId: source.sketchId } };
    const section = await (await getKernel()).section(document, source.section, signal);
    return { path: cadEntitiesToCam(section.entities), sourceReceipt: { section: {
      bodyId: section.bodyId, plane: section.plane, offset: section.offset, contourCount: section.contourCount
    } } };
  }
  async function handoffToCam(source: CamSource, expectedVersion: string, signal?: AbortSignal, scope?: 'section') {
    editable(expectedVersion); session.assertWorkflowClosed(scope); assertCanSwitch();
    const workbench = connected();
    const reviewed = session.getSnapshot();
    return run(async () => {
      // Send finishes the section dialog's editing phase. The synchronous shared
      // operation lock stays held until both persistence operations return.
      if (scope) session.setWorkflowOpen(false, scope);
      let committed = false;
      try {
        const [{ path, sourceReceipt }, { importPortableUpidProject }, { loadEditorProgram }] = await Promise.all([
          prepareHandoffGeometry(source, reviewed.document, signal), import('@/domain/upid/portableUpidProject'), import('@/domain/editor/loadEditorProgram')
        ]);
        signal?.throwIfAborted(); session.assertVersion(expectedVersion); session.assertWorkflowClosed();
        if (current.current.app.connectedWorkbench !== workbench) throw new ToolError('STALE_STATE', 'Workbench changed before CAM handoff.');
        if (reviewed.dirty) await persistReviewed(workbench, expectedVersion, signal);
        const savedVersion = session.getSnapshot().savedVersion;
        const value = await current.current.app.runAgentWorkbenchOperation(async latest => {
          signal?.throwIfAborted(); session.assertVersion(expectedVersion);
          const imported = await importPortableUpidProject(latest, {
            fileName: `${fileBase(reviewed.document.name)}.upid.json`,
            text: JSON.stringify({ format: 'upid', schemaVersion: path.schemaVersion, document: path }),
            beforeWrite: () => {
              signal?.throwIfAborted(); session.assertVersion(expectedVersion); session.assertWorkflowClosed();
              if (current.current.app.connectedWorkbench !== workbench) throw new ToolError('STALE_STATE', 'Workbench changed before CAM handoff.');
            }
          });
          if (!imported.ok) throw new ToolError(imported.error.code, imported.error.message);
          const loaded = await loadEditorProgram(imported.workbench, imported.project.id);
          return { workbench: imported.workbench, ...(loaded.ok ? { editorProgram: loaded.editorProgram } : {}),
            value: { projectId: imported.project.id, opened: loaded.ok, sourceDocumentId: reviewed.document.id,
              sourceSavedVersion: savedVersion, ...sourceReceipt, ...(loaded.ok ? {} : { error: loaded.error.message }) } };
        });
        committed = true;
        if (value.opened) changeOpen(false);
        else setErrorMessage(`CAM project "${value.projectId}" was created, but could not open. Return to Workbench and open it from Projects. ${value.error ?? ''}`.trim());
        return value;
      } finally { if (scope && !committed) session.setWorkflowOpen(true, scope); }
    });
  }
  function sendToCam(sketchId: string, expectedVersion = session.getSnapshot().version, signal?: AbortSignal) {
    return handoffToCam({ kind: 'sketch', sketchId }, expectedVersion, signal);
  }
  function sendSectionToCam(request: CadSectionRequest, expectedVersion: string, signal?: AbortSignal, scope?: 'section') {
    return handoffToCam({ kind: 'section', section: { ...parseCadSectionRequest(request) } }, expectedVersion, signal, scope);
  }
  async function exportDxf(sketchId: string, expectedVersion = session.getSnapshot().version, signal?: AbortSignal) {
    editable(expectedVersion); session.assertWorkflowClosed();
    const { cadSketchToDxf } = await import('@/domain/cad/cadCam');
    signal?.throwIfAborted(); editable(expectedVersion); session.assertWorkflowClosed();
    const document = session.getSnapshot().document;
    const text = cadSketchToDxf(document, sketchId);
    const fileName = `${fileBase(document.name)}.dxf`;
    downloadCadBlob(new Blob([text], { type: 'application/dxf' }), fileName);
    return { fileName, downloadRequested: true };
  }
  async function exportCurveDxf(curveId: string, expectedVersion = session.getSnapshot().version, signal?: AbortSignal) {
    editable(expectedVersion); session.assertWorkflowClosed();
    const { cadCurveToDxf } = await import('@/domain/cad/cadCurveDxf');
    signal?.throwIfAborted(); editable(expectedVersion); session.assertWorkflowClosed();
    const document = session.getSnapshot().document;
    const text = cadCurveToDxf(document, curveId);
    const fileName = `${fileBase(document.name)}.dxf`;
    downloadCadBlob(new Blob([text], { type: 'application/dxf' }), fileName);
    return { fileName, downloadRequested: true, curveId, version: expectedVersion };
  }
  function back() { connected(); session.assertWorkflowClosed(); changeOpen(false); }
  const isBusy = () => busy.current;
  return { session, snapshot, open, enter, edit, save, list, showLibrary, library, libraryDiagnostic, closeLibrary: () => setLibrary(null),
    openDocument, newDocument, importDocument, importDocumentValue, importSolidSource, importDxfSource, importDxfCurveSource, importFile, confirmImport, cancelImport, measureSketch, measureCurve, inspectPlane, inspectLoft, inspectSweep, exportDocument, exportSolid, exportDxf, exportCurveDxf, inspectBuild, inspectSection, sendSectionToCam, sendToCam, back,
    setViewportControls, readViewport: (expectedVersion: string) => getViewport(expectedVersion).getState(), changeViewport, captureViewport, previewArtifact,
    inspectTopology: topology.inspect, resolveTopologyPicks: topology.resolve,
    build, buildVersion, buildState, errorMessage, setErrorMessage, storageBusy, isBusy, isOpen: () => current.current.open,
    undo: (expected?: string) => { editable(expected); session.undo(expected); },
    redo: (expected?: string) => { editable(expected); session.redo(expected); }
  };
}
export type CadController = ReturnType<typeof useCadController>;
