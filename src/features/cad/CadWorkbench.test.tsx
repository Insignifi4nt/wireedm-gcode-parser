import { act, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppRailProvider, useAppRail } from '@/app/AppRailContext';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadBuildResult, CadDocument, CadSketchPlane } from '@/domain/cad/cadDocument';
import type { CadTopologyDescriptor, CadTopologyResolvePicksResult } from '@/domain/cad/cadTopology';
import { applyCadEdits, type CadEdit } from '@/domain/cad/cadOperations';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { measureCadSketch } from '@/domain/cad/cadMeasurements';
import { prepareCadSketchCells } from '@/domain/cad/cadSketchRegionInspection';
import { CadWorkbench, type CadWorkbenchProps } from './CadWorkbench';
import { closeSketchPolygon, snapSketchPoint, twoPointSketchProfile } from './cadSketchInteraction';
import { CadSession } from './cadSession';
import { getCadPreferences, setCadPreferences } from './cadPreferences';
import { cadFeatureCandidateKey, type CadFeaturePreviewState } from './cadFeaturePreview';
import type { CadRenderedViewControls, CadWorkbenchViewportControls } from './cadViewportControls';
import type { CadViewportContextMenuRequest } from './CadViewport';
import type { CadFeatureRegionPickCommand } from './cadFeatureReferencePicking';
import type { CadExtrudeDepthControl } from './cadExtrudeDepthInteraction';

let requestViewportMenu: ((request: CadViewportContextMenuRequest) => void) | undefined;
let pickViewportFeature: ((id: string | null) => void) | undefined;
let pickViewportPlane: ((plane: CadSketchPlane) => void) | undefined;
let viewportRegions: CadFeatureRegionPickCommand | null = null;
let viewportDepth: CadExtrudeDepthControl | null = null;

// jsdom cannot create a WebGL context. These tests exercise the real UI and domain edits.
vi.mock('./CadViewport', async () => {
  const { useEffect } = await import('react');
  return { CadViewport: ({ onControlsReady, meshes = [], navigationLocked, onContextMenu, onSelect, onSelectPlane, sourceReferencePickIds, regionSelection, depthControl }: { meshes?: CadBuildResult['meshes']; navigationLocked?: boolean; sourceReferencePickIds?: readonly string[]; regionSelection?: CadFeatureRegionPickCommand | null; depthControl?: CadExtrudeDepthControl | null; onSelect(id: string | null): void; onSelectPlane?(plane: CadSketchPlane): void; onContextMenu?(request: CadViewportContextMenuRequest): void; onControlsReady?(controls: CadRenderedViewControls | null, released?: CadRenderedViewControls): void }) => {
    requestViewportMenu = onContextMenu;
    pickViewportFeature = onSelect;
    pickViewportPlane = onSelectPlane;
    viewportRegions = regionSelection ?? null;
    viewportDepth = depthControl ?? null;
    // Match WebGL's passive publication/disposal lifetime, while the real SVG
    // publishes in layout effects. Their order matters when changing modes.
    useEffect(() => {
      const controls: CadRenderedViewControls = { getState: () => ({ mode: 'solid', available: true, view: 'Isometric', gridVisible: true, zoom: 1, revision: 0 }),
        fit: vi.fn(), setGrid: vi.fn(), setView: vi.fn(), capture: async () => { throw new Error('WebGL rasterization is unavailable in jsdom.'); } };
      onControlsReady?.(controls);
      return () => onControlsReady?.(null, controls);
    }, [onControlsReady]);
    return <div aria-label="3D model viewport" data-displayed-volumes={meshes.map(mesh => mesh.volume).join(',')} data-navigation-locked={String(navigationLocked)} data-source-reference-pick-ids={sourceReferencePickIds?.join(',') ?? ''} />;
  } };
});

let container: HTMLDivElement;
let root: Root;
let currentDocument: CadDocument;
let currentSession: CadSession;
let currentViewport: CadWorkbenchViewportControls | null;
let replaceDocument: (document: CadDocument) => void;
let replaceBuild: (build: CadBuildResult | null, state?: CadWorkbenchProps['buildState']) => void;
let replaceFeaturePreview: (preview: CadFeaturePreviewState) => void;
let removeCad: () => void;
let showCad: () => void;
const undo = vi.fn();
const save = vi.fn(async () => undefined);
const sendToCam = vi.fn(async (_sketchId: string) => undefined);
const workflow = vi.fn();
const statusMessage = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  currentViewport = null;
  viewportRegions = null;
  viewportDepth = null;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function PreviousEditorHeader() {
  const { setHeaderContent } = useAppRail();
  useEffect(() => { setHeaderContent(<span>Previous editor</span>); return () => setHeaderContent(null); }, [setHeaderContent]);
  return <div>Previous editor content</div>;
}

async function mount(initial: CadDocument = createCadDocument(), buildProps: Pick<CadWorkbenchProps, 'build' | 'buildState'> & Partial<Pick<CadWorkbenchProps, 'onSectionForCam' | 'onInspectTopology' | 'onResolveSelection' | 'onRebuild' | 'featurePreview' | 'onFeaturePreview' | 'onEdit' | 'onEditMany' | 'onWorkflowChange' | 'sketchEdit'>> = { build: null, buildState: 'idle' }, inShell: boolean | 'previous-header' = false) {
  const session = new CadSession(initial);
  currentSession = session;
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
    const [build, setBuild] = useState(buildProps.build);
    const [buildState, setBuildState] = useState(buildProps.buildState);
    const [featurePreview, setFeaturePreview] = useState<CadFeaturePreviewState>(buildProps.featurePreview ?? { kind: 'idle' });
    replaceFeaturePreview = setFeaturePreview;
    const [headerContent, setHeaderContent] = useState<ReactNode | null>(null);
    const [visible, setVisible] = useState(inShell !== 'previous-header');
    removeCad = () => setVisible(false);
    showCad = () => setVisible(true);
    replaceBuild = (next, state = 'ready') => { setBuild(next); setBuildState(state); };
    const { document } = snapshot;
    currentDocument = document;
    replaceDocument = (replacement) => session.replace(replacement);
    const props: CadWorkbenchProps = {
      document, documentVersion: snapshot.version, buildVersion: buildState === 'ready' ? snapshot.version : null, ...buildProps, build, buildState, featurePreview, dirty: true, canUndo: true, canRedo: true,
      onEdit: buildProps.onEdit ?? (edit => { session.edit([edit]); }),
      onEditMany: buildProps.onEditMany ?? (edits => session.edit(edits)),
      onStatusMessage: statusMessage,
      onUndo: undo, onRedo: vi.fn(), onSave: save, onBack: vi.fn(), onWorkflowChange: buildProps.onWorkflowChange ?? ((open) => { workflow(open); session.setWorkflowOpen(open); }),
      onSendToCam: sendToCam, onOpenDocument: vi.fn(), onNewDocument: vi.fn(),
      onImportDocument: async () => undefined, onExportDocument: vi.fn(), onExportSolid: async () => undefined, onOpenDxfExport: async () => undefined,
      onViewportControlsReady: (controls) => { currentViewport = controls; },
    };
    return inShell ? <><header data-app-header>{headerContent ?? <span>Workbench</span>}</header><AppRailProvider value={{ setHeaderContent,
      openMachineSettings: vi.fn(), closeCompactDrawerWithRailFocus: vi.fn(), compactDrawer: null, compactModalHost: null, compactTransitionOverlay: false,
      isCompactViewport: false, isMiddleViewport: false, setCompactDrawer: vi.fn(), setCompactTransitionOverlay: vi.fn(), setRailCollapsed: vi.fn(), setRailContent: vi.fn() }}>
      {visible ? <CadWorkbench {...props} /> : inShell === 'previous-header' ? <PreviousEditorHeader /> : null}</AppRailProvider></> : <CadWorkbench {...props} />;
  }
  await act(async () => root.render(<Harness />));
}

function button(label: string) {
  const found = [...document.querySelectorAll('button')].find((entry) => entry.getAttribute('aria-label') === label || entry.textContent?.trim() === label);
  if (!found) throw new Error(`Button "${label}" missing.`);
  return found;
}
async function click(label: string) {
  if (label === 'Fillet' || label === 'Chamfer') await act(async () => button('Fillet / Chamfer').click());
  await act(async () => button(label).click());
}
async function startSketch() {
  await act(async () => viewport().apply({ kind: 'select-reference-plane', plane: 'XY' }));
  await click('Sketch');
}
function field(label: string) {
  const host = document.querySelector('.cad-parameter-editor') ?? container;
  const input = [...host.querySelectorAll('label')].find((entry) => entry.querySelector('span')?.childNodes[0]?.textContent === label)?.querySelector('input');
  if (!input) throw new Error(`Field "${label}" missing.`);
  return input;
}
async function input(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Native input setter unavailable.');
  await act(async () => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function relation(label: string, value: string) {
  await click(`Edit ${label} relation`);
  const control = document.querySelector<HTMLInputElement>(`input[aria-label="${label} expression"]`), setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  if (!control) throw new Error('Missing expression field'); await act(async () => { setter.call(control, value); control.dispatchEvent(new Event('input', { bubbles: true })); });
  const keep = [...document.querySelectorAll('button')].find(entry => entry.textContent?.trim() === 'Keep relation'), close = document.querySelector<HTMLButtonElement>(`button[aria-label="Close ${label} relation help"]`);
  if (!keep || !close) throw new Error('Missing relation actions'); await act(async () => keep.click()); await act(async () => close.click());
}
function dimensionValue() {
  const value = container.querySelector<HTMLInputElement>('input[aria-label="Dimension value"]'); if (!value) throw new Error('Missing dimension value'); return value;
}
async function canvasClick(x: number, y: number) {
  const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]');
  if (!canvas) throw new Error('Sketch canvas missing.');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
  await act(async () => canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y })));
}
async function canvasKey(key: string, shiftKey = false) {
  const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]');
  if (!canvas) throw new Error('Sketch canvas missing.');
  await act(async () => { canvas.focus(); canvas.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })); });
}
async function openLegacyRectangle(parameters: Readonly<Record<string, number>> = {}) {
  const original = solidDocument();
  await mount({ ...original, parameters, features: [original.features[0]] });
  await act(async () => { viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }); viewport().apply({ kind: 'select-profile', profileId: 'rectangle' }); });
}
function viewport() {
  if (!currentViewport) throw new Error('Viewport controls unavailable.');
  return currentViewport;
}

const topologyBuild: CadBuildResult = { buildId: 'build-1', meshes: [{ featureId: 'pad', name: 'Pad 1', positions: [0, 0, 10, 50, 0, 10, 50, 40, 10], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2],
  edges: [0, 0, 10, 50, 0, 10], faceGroups: [{ start: 0, count: 3, key: 'face-1' }], edgeGroups: [{ start: 0, count: 2, key: 'edge-1' }], volume: 20_000,
  bounds: { min: [0, 0, 0], max: [50, 40, 10] } }], diagnostics: [], durationMs: 1 };
const selectedEdgeQuery = { queries: [{ kind: 'edges', predicates: [{ kind: 'line-endpoints', start: [0, 0, 10], end: [50, 0, 10] }], expectedCount: 1 }], expectedCount: 1 } satisfies Extract<CadTopologyResolvePicksResult, { purpose: 'fillet' | 'chamfer' }>['selection'];
const shellOpening = { kind: 'faces', predicates: [{ kind: 'plane', normal: [0, 0, 1], offset: 10 }, { kind: 'area', value: 2000 }, { kind: 'centroid', point: [25, 20, 10] }], expectedCount: 1 } satisfies Extract<CadTopologyResolvePicksResult, { purpose: 'shell' }>['opening'];
const inspectTopology: NonNullable<CadWorkbenchProps['onInspectTopology']> = async (request) => {
  const descriptors: CadTopologyDescriptor[] = [
    { kind: 'edge', key: 'edge-1', curveType: 'line', length: 50, start: [0, 0, 10], end: [50, 0, 10], centroid: [25, 0, 10], bounds: { min: [0, 0, 10], max: [50, 0, 10] } },
    { kind: 'face', key: 'face-1', surfaceType: 'plane', area: 2000, normal: [0, 0, 1], offset: 10, centroid: [25, 20, 10], bounds: { min: [0, 0, 10], max: [50, 40, 10] } },
  ];
  const selection = request.selection;
  return { bodyId: request.bodyId, buildId: request.expectedBuildId, descriptors: descriptors.filter((descriptor) => selection.kind === 'picks'
    ? selection.picks.some((pick) => pick.key === descriptor.key) : descriptor.kind === selection.topology), total: 1, nextOffset: null };
};
const resolveTopology: NonNullable<CadWorkbenchProps['onResolveSelection']> = async (request) => request.purpose === 'shell'
  ? { bodyId: request.bodyId, buildId: request.expectedBuildId, purpose: 'shell', opening: shellOpening }
  : { bodyId: request.bodyId, buildId: request.expectedBuildId, purpose: request.purpose, selection: selectedEdgeQuery };
function solidDocument() {
  return applyCadEdits(createCadDocument(), [
    { kind: 'add-feature', feature: { id: 'sketch', name: 'Outline', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [{ id: 'rectangle', name: 'Plate', construction: false, role: 'outer', geometry: { kind: 'rectangle', x: 0, y: 0, width: 50, height: 40, cornerRadius: 0 } }] } },
    { kind: 'add-feature', feature: { id: 'pad', name: 'Pad 1', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 10, symmetric: false, operation: 'new', targetId: null } },
  ]);
}
async function selectTopology(kind: 'edge' | 'face') {
  await act(async () => viewport().apply({ kind: 'select-topology', additive: false, selection: { documentVersion: currentSession.getSnapshot().version,
    buildId: topologyBuild.buildId, bodyId: 'pad', picks: [{ kind, key: kind === 'edge' ? 'edge-1' : 'face-1' }] } }));
}

describe('CAD sketch interaction', () => {
  it('reports an unchanged authoritative point move without inferring permanent mobility, and ignores cancelled receipts', async () => {
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Constrained points', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
      points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [40, 0] }, { id: 'c', position: [50, 20] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
      relations: [{ id: 'h', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'd', kind: 'distance', pointIds: ['a', 'b'], value: 40 }]
    } }] });
    const edit = vi.fn<NonNullable<CadWorkbenchProps['onEditMany']>>(() => currentSession.getSnapshot());
    await mount(source, { build: null, buildState: 'idle', onEditMany: edit });
    await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    const point = container.querySelector<SVGGElement>('[data-cad-sketch-point="b"]'); if (!point) throw new Error('Missing point.');
    await act(async () => point.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    expect(edit).toHaveBeenCalledOnce(); expect(statusMessage).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('constrained'), 'info');
    expect(currentSession.getSnapshot()).toMatchObject({ document: source, canUndo: false, workflowOpen: false });
    let accept: (value: ReturnType<CadSession['getSnapshot']>) => void = () => { throw new Error('No pending move.'); };
    edit.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
    await act(async () => point.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })));
    const signal = edit.mock.calls[1]?.[1]; expect(signal?.aborted).toBe(false);
    await act(async () => point.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(signal?.aborted).toBe(true);
    await act(async () => accept(currentSession.getSnapshot()));
    expect(statusMessage).toHaveBeenCalledOnce(); expect(currentSession.getSnapshot()).toMatchObject({ document: source, canUndo: false, workflowOpen: false });
  });

  it('prunes removed graph targets from selection before a later source can reuse their IDs', async () => {
    const initial = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Source selection', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: []
    } }] });
    await mount(initial);
    await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry-set', selections: [{ kind: 'point', id: 'a' }, { kind: 'point', id: 'b' }] }));
    await act(async () => currentSession.edit([{ kind: 'delete-sketch-elements', sketchId: 'sketch', pointIds: ['b'], entityIds: [], relationIds: [], cascade: true }]));
    const afterRemoval = currentSession.getSnapshot();
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'point', id: 'a' }]);
    expect(currentSession.getSnapshot()).toBe(afterRemoval);
    const sketch = currentDocument.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Sketch missing');
    const graph = sketch.graph;
    await act(async () => currentSession.edit([{ kind: 'update-feature', feature: { ...sketch, graph: { ...graph,
      points: [...graph.points, { id: 'b', position: [50, 40] }] } } }]));
    const afterReuse = currentSession.getSnapshot();
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'point', id: 'a' }]);
    expect(currentSession.getSnapshot()).toBe(afterReuse);
    await act(async () => currentSession.undo());
    await act(async () => currentSession.undo());
    expect(currentDocument).toEqual(initial);
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'point', id: 'a' }]);
  });
  it('owns one graph selection set for Shift selection, agent selection, construction and one-step set deletion', async () => {
    const initial = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Set sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'c', position: [20, 10] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'bc', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' }], relations: []
    } }] });
    await mount(initial);
    await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    const target = (id: string) => { const element = container.querySelector(`[data-cad-sketch-point="${id}"]`); if (!element) throw new Error('Point missing'); return element; };
    await act(async () => target('a').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    await act(async () => target('b').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })));
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'point', id: 'a' }, { kind: 'point', id: 'b' }]);
    expect(viewport().getState().selectedSketchGeometry).toBeUndefined();
    expect(currentDocument).toEqual(initial); expect(currentSession.getSnapshot().canUndo).toBe(false);
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry-set', selections: [{ kind: 'entity', id: 'ab' }, { kind: 'entity', id: 'bc' }] }));
    const construction = container.querySelector<HTMLInputElement>('.cad-sketch-options input'); if (!construction) throw new Error('Construction control missing');
    await act(async () => construction.click());
    const converted = currentDocument.features[0]; if (converted.kind !== 'sketch') throw new Error('Sketch missing');
    expect(converted.graph?.entities.map(entity => entity.construction)).toEqual([true, true]);
    await click('Delete selected geometry');
    const deleted = currentDocument.features[0]; if (deleted.kind !== 'sketch') throw new Error('Sketch missing');
    expect(deleted.graph?.entities).toEqual([]); expect(deleted.graph?.points).toEqual(converted.graph?.points);
    await act(async () => currentSession.undo());
    expect(currentDocument.features[0]).toEqual(converted);
  });
  it('changes the selected legacy profile construction through an owned edit without changing drawing defaults', async () => {
    const initial = parseCadDocument({ ...createCadDocument(), parameters: { slotLength: 30 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Slot sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [{
        id: 'slot', name: 'Slot', construction: false, geometry: { kind: 'slot', x: 0, y: 0, length: ' slotLength ', width: 8, angle: 20 }
      }]
    }] });
    let accept: () => void = () => { throw new Error('Missing pending construction edit.'); };
    let reject: (error: Error) => void = () => { throw new Error('Missing pending construction edit.'); };
    const edit = vi.fn<NonNullable<CadWorkbenchProps['onEdit']>>((intent, signal) => new Promise((resolve, decline) => {
      accept = () => { try { signal?.throwIfAborted(); resolve(currentSession.edit([intent])); } catch (error) { decline(error); } };
      reject = decline;
    }));
    await mount(initial, { build: null, buildState: 'idle', onEdit: edit });
    await act(async () => { viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }); viewport().apply({ kind: 'select-profile', profileId: 'slot' }); });
    const control = () => {
      const found = container.querySelector<HTMLInputElement>('.cad-sketch-options input');
      if (!found) throw new Error('Construction control missing.'); return found;
    };
    await act(async () => control().click());
    expect(edit).toHaveBeenCalledOnce(); expect(currentDocument).toBe(initial); expect(control().disabled).toBe(true);
    await act(async () => accept());
    const accepted = currentDocument, sketch = accepted.features[0];
    if (sketch.kind !== 'sketch' || initial.features[0].kind !== 'sketch') throw new Error('Sketch missing.');
    expect(sketch.profiles[0]).toEqual({ ...initial.features[0].profiles[0], construction: true });
    expect(control().checked).toBe(true);
    await act(async () => currentSession.undo()); expect(currentDocument).toEqual(initial);
    await act(async () => currentSession.redo()); expect(currentDocument).toEqual(accepted); expect(control().checked).toBe(true);
    await act(async () => control().click());
    await act(async () => reject(new Error('A downstream feature needs the material.')));
    expect(currentDocument).toEqual(accepted); expect(control().checked).toBe(true); expect(currentSession.getSnapshot().workflowOpen).toBe(false);
    await act(async () => control().click());
    const signal = edit.mock.calls.at(-1)?.[1]; expect(signal?.aborted).toBe(false);
    await canvasKey('Escape'); expect(signal?.aborted).toBe(true);
    await act(async () => accept()); expect(currentDocument).toEqual(accepted);
    await click('Rectangle'); expect(control().checked).toBe(false);
  });
  it('shows only current sketch areas while repairing a consumed boundary, without accepted suffix solids', async () => {
    const prefix = solidDocument(), sourceSketch = prefix.features[0];
    if (sourceSketch.kind !== 'sketch') throw new Error('Sketch fixture missing');
    const edited = { ...sourceSketch, id: 'second-sketch', name: 'Edited outline' };
    const initial = applyCadEdits(prefix, [{ kind: 'add-feature', feature: edited }]);
    const cells = prepareCadSketchCells(edited, initial.parameters);
    const finish = vi.fn();
    const staleConsumer = { ...prefix.features[1], id: 'second-pad', name: 'Dependent pad', sketchId: edited.id };
    if (staleConsumer.kind !== 'extrude') throw new Error('Pad fixture missing');
    const build = { ...topologyBuild, meshes: [...topologyBuild.meshes, { ...topologyBuild.meshes[0], featureId: 'second-pad', volume: 1234 }] };
    await mount(initial, { build, buildState: 'ready', sketchEdit: { sketchId: edited.id, cancel: vi.fn(), finish,
      inspectAreaRepairs: () => ({ sketchId: edited.id, localVersion: currentSession.getSnapshot().version, cells,
        consumers: [{ feature: staleConsumer, issue: 'The selected boundary changed.' }] }) } });
    await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: edited.id }));
    await click('Finish sketch');
    await click('Choose areas for Dependent pad');
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-displayed-volumes')).toBe('');
    expect(viewportRegions?.cells).toBe(cells);
    expect(viewportRegions?.sketchId).toBe(edited.id);
    await act(async () => viewportRegions?.onSelect([cells.cells[0].reference]));
    await click('Finish area selection');
    expect(container.querySelector('form[aria-label="Update dependent sketch areas"]')).not.toBeNull();
    expect(button('Finish sketch').disabled).toBe(false);
    expect(finish).not.toHaveBeenCalled();
    expect(currentDocument).toEqual(initial);
  });
  it('releases a clean command workflow when suppression rejects because a dependent solid still needs its source', async () => {
    const initial = applyCadEdits(solidDocument(), [{ kind: 'add-feature', feature: {
      id: 'rounded', name: 'Rounded plate', kind: 'fillet', targetId: 'pad', radius: 1, suppressed: false
    } }]);
    const onWorkflowChange = (open: boolean) => { workflow(open); currentSession.setWorkflowOpen(open); };
    await mount(initial, { build: null, buildState: 'idle', onWorkflowChange });
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' }));
    const before = currentSession.getSnapshot();
    const suppress = [...container.querySelectorAll('label')].find(label => label.textContent?.trim() === 'Suppress feature')?.querySelector<HTMLInputElement>('input');
    if (!suppress) throw new Error('Suppress control missing.');
    await act(async () => suppress.click());
    expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version, workflowOpen: false, canUndo: false });
    expect(workflow).toHaveBeenLastCalledWith(false);
    expect(suppress.checked).toBe(false);
  });
  it('retains actual name-edit ownership after a synchronous command rejection', async () => {
    const onWorkflowChange = (open: boolean) => { workflow(open); currentSession.setWorkflowOpen(open); };
    await mount(solidDocument(), { build: null, buildState: 'idle', onWorkflowChange });
    const before = currentSession.getSnapshot(), name = container.querySelector<HTMLInputElement>('[aria-label="Part name"]');
    if (!name) throw new Error('Part name missing.');
    await act(async () => name.focus()); await input(name, '   '); await act(async () => name.blur());
    expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version, workflowOpen: true, canUndo: false });
    expect(name.value).toBe('   '); expect(workflow).toHaveBeenLastCalledWith(true);
    await act(async () => name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(currentSession.getSnapshot().workflowOpen).toBe(false);
  });
  it('waits for sketch creation acceptance, preserves a rejected plane, and ignores a cancelled late creation', async () => {
    let rejectFirst: (error: Error) => void = () => { throw new Error('No first edit'); };
    let resolveRetry: () => void = () => { throw new Error('No retry edit'); };
    const first = new Promise<void>((_accept, reject) => { rejectFirst = reject; });
    const retry = new Promise<void>(accept => { resolveRetry = accept; });
    void first.catch(() => undefined);
    const signals: AbortSignal[] = []; let attempts = 0;
    await mount(createCadDocument(), { build: null, buildState: 'idle', onEdit: (edit, signal) => {
      if (signal) signals.push(signal);
      const wait = ++attempts === 1 ? first : attempts === 2 ? retry : null;
      currentSession.setWorkflowOpen(true, 'preparation');
      return currentSession.editPrepared(currentSession.getSnapshot().version, async source => {
        await wait; return applyCadEdits(source, [edit]);
      }, signal).finally(() => currentSession.setWorkflowOpen(false, 'preparation'));
    } });
    await startSketch();
    expect(currentDocument.features).toHaveLength(0);
    expect(container.querySelector('[aria-label="Sketch drawing canvas"]')).toBeNull();
    expect(currentSession.getSnapshot().workflowOpen).toBe(true);
    await act(async () => rejectFirst(new Error('The new sketch conflicts.')));
    expect(viewport().getState().selectedReferencePlane).toBe('XY');
    await click('Sketch');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(signals[1]?.aborted).toBe(true);
    await act(async () => viewport().apply({ kind: 'select-reference-plane', plane: 'XZ' }));
    await click('Sketch');
    const accepted = currentDocument;
    await act(async () => resolveRetry());
    expect(currentDocument).toBe(accepted);
    expect(currentDocument.features).toMatchObject([{ kind: 'sketch', plane: 'XZ' }]);
    expect(viewport().getState()).toMatchObject({ sketchId: currentDocument.features[0].id });
  });

  it.each(['solid', 'sketch'] as const)('keeps the %s context while editing a shared value and navigates only through explicit Inspect', async context => {
    const initial = parseCadDocument({ ...createCadDocument('Tapered outlet', 'parameter_context'), parameters: { height: 20, baseRadius: 10 }, features: [
      { id: 'base', name: 'Base section', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
        profiles: [{ id: 'base_circle', name: 'Base circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 'baseRadius' } }] },
      { id: 'outlet', name: 'Outlet section', kind: 'sketch', suppressed: false, plane: 'XY', offset: 'height',
        profiles: [{ id: 'outlet_circle', name: 'Outlet circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 5 } }] },
      { id: 'loft', name: 'Loft', kind: 'loft', suppressed: false, sketchIds: ['base', 'outlet'], ruled: false, operation: 'new', targetId: null },
    ] });
    const build = { ...topologyBuild, meshes: topologyBuild.meshes.map(mesh => ({ ...mesh, featureId: 'loft', name: 'Loft' })) };
    await mount(initial, { build, buildState: 'ready' });
    if (context === 'solid') await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'loft' }));
    else {
      await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'base' }));
      await act(async () => viewport().apply({ kind: 'select-profile', profileId: 'base_circle' }));
    }
    const expectedContext = context === 'solid' ? { selectedFeatureId: 'loft', sketchId: null, selectedProfileId: null, view: { mode: 'solid' } }
      : { selectedFeatureId: 'base', sketchId: 'base', selectedProfileId: 'base_circle', view: { mode: 'sketch' } };
    expect(viewport().getState()).toMatchObject(expectedContext);
    const canvas = container.querySelector(context === 'solid' ? '[aria-label="3D model viewport"]' : '.cad-sketch-viewport');
    const cancelParameter = async () => {
      const dialog = document.querySelector('.cad-parameter-editor');
      const cancel = [...dialog?.querySelectorAll('button') ?? []].find(button => button.textContent?.trim() === 'Cancel');
      if (!cancel) throw new Error('Missing floating parameter Cancel.'); await act(async () => cancel.click());
    };
    await click('Expand Parameters'); const before = currentSession.getSnapshot();
    await click('Edit parameter height');
    expect(viewport().getState()).toMatchObject(expectedContext);
    expect(container.contains(canvas)).toBe(true);
    expect(document.querySelector('.cad-parameter-editor')?.textContent).toContain('Outlet section');
    await input(field('Value'), '25');
    expect(viewport().getState()).toMatchObject(expectedContext); expect(container.contains(canvas)).toBe(true);
    expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version, workflowOpen: true, canUndo: before.canUndo });
    await cancelParameter();
    expect(currentSession.getSnapshot()).toEqual(before); expect(viewport().getState()).toMatchObject(expectedContext); expect(container.contains(canvas)).toBe(true);
    await click('Edit parameter height'); await click('Inspect Outlet section');
    expect(viewport().getState()).toMatchObject({ selectedFeatureId: 'outlet', sketchId: 'outlet', selectedProfileId: null, view: { mode: 'sketch' } });
    expect(field('Value').value).toBe('20');
    await cancelParameter();
    expect(currentSession.getSnapshot()).toEqual(before); expect(viewport().getState()).toMatchObject({ selectedFeatureId: 'outlet', sketchId: 'outlet', view: { mode: 'sketch' } });
  });

  it('keeps an accepted thin Pad volume visibly positive without changing its exact source or history', async () => {
    const document = parseCadDocument({ ...createCadDocument(), parameters: { width: 4e-7 }, features: [
      { id: 'sketch', name: 'Thin outline', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [{ id: 'rectangle', name: 'Thin plate', construction: false,
        geometry: { kind: 'rectangle', x: 0, y: 0, width: ' width ', height: 20, cornerRadius: 0 } }] },
      { id: 'pad', name: 'Thin Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 10, symmetric: false, operation: 'new', targetId: null }
    ] }), volume = measureCadSketch(document, 'sketch').materialAreaMm2 * 10;
    const build: CadBuildResult = { ...topologyBuild, meshes: [{ ...topologyBuild.meshes[0], name: 'Thin Pad', positions: [0, 0, 10, 4e-7, 0, 10, 4e-7, 20, 10],
      edges: [], faceGroups: [], edgeGroups: [], volume, bounds: { min: [0, 0, 0], max: [4e-7, 20, 10] } }] };
    await mount(document, { build, buildState: 'ready' }); const before = currentSession.getSnapshot();
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' }));
    expect(container.querySelector('.cad-solid-info strong')?.textContent).toBe(`${volume.toLocaleString(undefined, { notation: 'scientific', maximumSignificantDigits: 6, useGrouping: false })} mm³`);
    expect(currentSession.getSnapshot()).toBe(before); expect(viewport().getState().selectedFeatureId).toBe('pad'); expect(build.meshes[0].volume).toBe(volume);
  });

  it.each(['Fillet', 'Chamfer'] as const)('refuses an explicit face for %s without broadening its scope, while deliberate body selection still permits all edges', async command => {
    const resolve = vi.fn(resolveTopology), preview = vi.fn();
    await mount(solidDocument(), { build: topologyBuild, buildState: 'ready', onInspectTopology: inspectTopology, onResolveSelection: resolve, onFeaturePreview: preview });
    await selectTopology('face');
    const before = currentSession.getSnapshot(), selection = viewport().getState().topologySelection;
    preview.mockClear(); await click(command);
    expect(currentSession.getSnapshot()).toBe(before); expect(viewport().getState().topologySelection).toEqual(selection);
    expect(resolve).not.toHaveBeenCalled(); expect(preview.mock.calls.some(([request]) => request.kind === 'candidate')).toBe(false);
    expect(container.querySelector('select[aria-label="Scope"]')).toBeNull();
    expect(statusMessage).toHaveBeenCalledWith(expect.stringContaining('Pick edges'), 'error');
    await click('Select Pad 1 in history'); await click(command);
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Scope"]')?.value).toBe('all');
    expect(resolve).not.toHaveBeenCalled(); await click('Cancel'); expect(currentSession.getSnapshot()).toEqual(before);
  });

  it('opens and selects the last of 257 accepted datum references without changing the document or history', async () => {
    const document = parseCadDocument({ ...createCadDocument('Station references', 'station_references'),
      features: Array.from({ length: 257 }, (_, index) => ({ id: `station_${index}`, name: `Station ${index}`, kind: 'datum-plane', suppressed: false,
        definition: { kind: 'world', basePlane: 'XY', origin: [0, 0, index], rotation: [0, 0, 0] } })) });
    await mount(document);
    const before = currentSession.getSnapshot();
    expect([...container.querySelectorAll<HTMLElement>('.cad-feature-node')].map(node => node.dataset.cadFeatureId)).toEqual(document.features.map(feature => feature.id));
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'station_256' }));
    expect(viewport().getState()).toMatchObject({ selectedFeatureId: 'station_256', selectedReferencePlane: { kind: 'datum-plane', featureId: 'station_256' } });
    expect(currentSession.getSnapshot()).toBe(before);
    expect(currentDocument).toBe(document);
  });
  it('shows the selected native body component count beside volume without inferring a count from older builds or changing history', async () => {
    const counted = { ...topologyBuild, meshes: topologyBuild.meshes.map(mesh => ({ ...mesh, solidCount: 2 })) };
    await mount(solidDocument(), { build: counted, buildState: 'ready' });
    const before = currentSession.getSnapshot(); await click('Pad 1');
    expect(container.querySelector('.cad-solid-info')?.textContent).toContain('20,000 mm³');
    expect(container.querySelector('.cad-solid-info')?.textContent).toContain('2 solids');
    await act(async () => replaceBuild(topologyBuild));
    const unknown = container.querySelector('.cad-solid-info');
    expect(unknown?.textContent).toContain('20,000 mm³');
    expect(unknown?.textContent).not.toMatch(/\d+ solids?/);
    expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: before.canUndo });
  });
  it('correlates sketch fillet preview measurements with the visible contour without accepting the draft', async () => {
    await mount(solidDocument()); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' })); await click('Plate profile');
    const before = currentSession.getSnapshot(); await click('Sketch fillet');
    const radius = container.querySelector<HTMLInputElement>('input[aria-label="Fillet radius"]'); if (!radius) throw new Error('Missing radius');
    await input(radius, '5');
    const measurement = container.querySelector('[aria-label="Sketch measurements"]');
    expect(measurement?.textContent).toContain('1,978.54');
    expect(currentSession.getSnapshot().document).toBe(before.document); expect(currentSession.getSnapshot().version).toBe(before.version);
    await click('Cancel'); expect(measurement?.textContent).toContain('2,000');
  });
  it('reports annotation visibility from the actual free or dimensioned contour and preview state', async () => {
    await mount(solidDocument()); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' })); await click('Plate profile');
    expect(viewport().getState().view).toMatchObject({ onPartDimensionsVisible: false });
    await click('Add dimension'); expect(viewport().getState().view).toMatchObject({ onPartDimensionsVisible: false }); await click('Apply');
    expect(viewport().getState().view).toMatchObject({ onPartDimensionsVisible: true });
    await click('Sketch fillet'); const radius = container.querySelector<HTMLInputElement>('input[aria-label="Fillet radius"]'); if (!radius) throw new Error('Missing radius');
    await input(radius, '5'); expect(viewport().getState().view).toMatchObject({ onPartDimensionsVisible: false });
    await click('Cancel'); expect(viewport().getState().view).toMatchObject({ onPartDimensionsVisible: true });
  });
  it('owns a tree profile rename and commits only its name as one undo step', async () => {
    const original = solidDocument(); await mount(original);
    await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    await click('Plate profile');
    const target = button('Plate profile');
    await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true })));
    const name = container.querySelector<HTMLInputElement>('input[aria-label="Profile name"]'); if (!name) throw new Error('Missing tree rename');
    await input(name, 'Mounting plate');
    expect(currentSession.getSnapshot().workflowOpen).toBe(true);
    expect(button('Save').disabled).toBe(true); expect(button('Finish sketch').disabled).toBe(true);
    await click('Apply name');
    const sketch = currentDocument.features[0]; if (sketch.kind !== 'sketch') throw new Error('Missing sketch');
    expect(sketch.profiles[0]).toEqual({ ...original.features[0].kind === 'sketch' ? original.features[0].profiles[0] : {}, name: 'Mounting plate' });
    expect(currentSession.getSnapshot().workflowOpen).toBe(false);
    await act(async () => currentSession.undo()); expect(currentDocument).toEqual(original);
  });

  it('routes the contextual dimension command to the selected free contour and retains one-step Undo', async () => {
    const original = solidDocument(); await mount(original);
    await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' })); await click('Plate profile');
    const dock = container.querySelector('[aria-label="CAD tools"]'); expect(dock?.getAttribute('data-cad-tool-context')).toBe('sketch');
    const dimension = dock?.querySelector<HTMLButtonElement>('button[aria-label="Dimension"]'); if (!dimension) throw new Error('Missing dimension command');
    await act(async () => dimension.click());
    const value = container.querySelector<HTMLInputElement>('input[aria-label="Dimension value"]'); if (!value) throw new Error('Missing dimension value');
    await input(value, '60'); expect(button('Finish sketch').disabled).toBe(true);
    await click('Apply');
    const sketch = currentDocument.features[0]; if (sketch.kind !== 'sketch') throw new Error('Missing sketch');
    expect(sketch.profiles[0]).toMatchObject({ role: 'outer', constraints: [{ kind: 'dimension', quantity: 'width' }], geometry: { kind: 'rectangle', x: 0, y: 0, width: 60, height: 40, cornerRadius: 0 } });
    expect(currentSession.getSnapshot().workflowOpen).toBe(false);
    const move = dock?.querySelector<HTMLButtonElement>('button[aria-label="Move profile"]'); if (!move) throw new Error('Missing move command');
    await act(async () => move.click());
    expect(container.querySelector('input[aria-label="Move X"]')).not.toBeNull(); await click('Cancel');
    await act(async () => currentSession.undo()); expect(currentDocument).toEqual(original);
  });

  it('routes Move to the exact graph selection and owns the workspace until Cancel even at zero displacement', async () => {
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Movable edges', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }],
      entities: [{ id: 'line', kind: 'line', startPointId: 'a', endPointId: 'b', construction: true }], relations: []
    } }] });
    await mount(source); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    const selections = [{ kind: 'entity' as const, id: 'line' }, { kind: 'point' as const, id: 'a' }];
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry-set', selections }));
    await click('Move selection'); expect(container.querySelector('input[aria-label="Move X"]')).not.toBeNull();
    expect(button('Finish sketch').disabled).toBe(true); expect(button('Save').disabled).toBe(true);
    expect(currentSession.getSnapshot()).toMatchObject({ document: source, workflowOpen: true, canUndo: false });
    await click('Cancel'); expect(currentSession.getSnapshot()).toMatchObject({ document: source, workflowOpen: false, canUndo: false });
    expect(viewport().getState().selectedSketchGeometrySet).toEqual(selections);
  });

  it('finishes the active sketch from its inspector without changing geometry or history', async () => {
    const original = solidDocument();
    await mount(original);
    await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    const inspector = container.querySelector('[aria-label="Feature properties"]');
    const finish = inspector?.querySelector<HTMLButtonElement>('button[aria-label="Finish sketch"]');
    expect(finish).toBeTruthy();
    const before = currentSession.getSnapshot();
    await act(async () => finish?.click());
    expect(viewport().getState().sketchId).toBeNull();
    expect(currentSession.getSnapshot().version).toBe(before.version);
    expect(currentDocument).toEqual(original);
  });

  it('reads current inspector bounds only on Fit and keeps the canvas/camera stable when the panel minimizes', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
    let panelHeight = 600;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-cad-model-tree')) return new DOMRect(110, 60, 180, 200);
      if (this.hasAttribute('data-cad-command-dock')) return new DOMRect(400, 789, 300, 55);
      const panel = this.hasAttribute('data-cad-properties');
      const left = panel ? 700 : 100, top = panel ? 62 : 50, width = panel ? 280 : 900, height = panel ? panelHeight : 800;
      return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) };
    });
    const initial = solidDocument(); await mount(initial);
    await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    const state = viewport().getState().view;
    if (!state || state.mode === 'solid') throw new Error('Expected sketch view.');
    const scale = 800 / state.heightSpanMm;
    expect(450 + (50 - state.centerMm[0]) * scale).toBeLessThanOrEqual(600);
    expect(450 + (0 - state.centerMm[0]) * scale).toBeGreaterThanOrEqual(0);
    panelHeight = 24; await click('Minimize configuration');
    expect(viewport().getState().view).toEqual(state);
    await act(async () => viewport().apply({ kind: 'fit' }));
    const minimized = viewport().getState().view;
    expect(minimized).not.toEqual(state);
    expect(container.querySelector('.cad-center')?.contains(container.querySelector('[data-cad-model-tree]'))).toBe(true);
    expect(currentDocument).toBe(initial);
  });
  it('owns optional depth interaction through the real feature editor and releases one correlated batch to ordinary Apply/Undo', async () => {
    setCadPreferences({ navigationMode: 'mouse', showOnPartDimensions: true, showDepthHandles: true });
    const original = solidDocument(), initial = applyCadEdits(original, [{ kind: 'set-parameter', name: 'depth', value: 10 },
      { kind: 'update-feature', feature: { ...original.features[1], kind: 'extrude', sketchId: 'sketch', distance: ' depth ', symmetric: false, operation: 'new', targetId: null } }]);
    const preview = vi.fn<NonNullable<CadWorkbenchProps['onFeaturePreview']>>();
    await mount(initial, { build: topologyBuild, buildState: 'ready', onFeaturePreview: preview });
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' }));
    const control = viewportDepth;
    if (!control) throw new Error('Expected the current editor depth control.');
    const before = currentSession.getSnapshot(), state = control.getState();
    let token: string | null = null;
    await act(async () => { token = control.begin(state!.definitionKey); });
    if (!token) throw new Error('Expected editable gesture.');
    await act(async () => control.setQuantity(token!, 20));
    expect(viewportDepth).toBe(control); expect(field('Length').value).toBe('20');
    expect(currentDocument).toBe(initial); expect(currentSession.getSnapshot()).toMatchObject({ version: before.version, workflowOpen: true });
    const command = preview.mock.calls.map(([entry]) => entry).filter(entry => entry.kind === 'candidate').at(-1);
    if (!command || command.kind !== 'candidate') throw new Error('Missing provisional depth preview.');
    await act(async () => replaceFeaturePreview({ kind: 'ready', owner: command.owner, baseVersion: command.expectedVersion, featureId: 'pad',
      candidateId: 'depth-preview', definitionKey: cadFeatureCandidateKey(command.edits), document: applyCadEdits(initial, command.edits),
      result: { ...topologyBuild, meshes: topologyBuild.meshes.map(mesh => ({ ...mesh, volume: 40_000 })) } }));
    expect(button('Apply').disabled).toBe(true);
    await act(async () => control.release(token!)); await click('Apply');
    expect(currentDocument.parameters.depth).toBe(20); expect(currentDocument.features).toEqual(initial.features);
    await act(async () => currentSession.undo()); expect(currentDocument).toEqual(initial);
  });

  it('qualifies depth handles by device preference and selection ownership without changing the accepted part', async () => {
    setCadPreferences({ navigationMode: 'trackpad', showOnPartDimensions: false });
    const initial = solidDocument(); await mount(initial, { build: topologyBuild, buildState: 'ready' });
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' }));
    expect(viewportDepth).toBeNull();
    await act(async () => setCadPreferences({ navigationMode: 'trackpad', showOnPartDimensions: false, showDepthHandles: true }));
    const previous = viewportDepth;
    if (!previous) throw new Error('Explicit preference must expose the current editor handle.');
    await click('Pick closed areas from model'); expect(viewportDepth).toBeNull();
    await click('Cancel area selection'); expect(viewportDepth).toBe(previous);
    await act(async () => setCadPreferences({ navigationMode: 'trackpad', showOnPartDimensions: false, showDepthHandles: false }));
    expect(viewportDepth).toBeNull(); expect(currentDocument).toBe(initial);
    await act(async () => replaceDocument({ ...initial, name: 'Another accepted part' }));
    expect(previous.getState()).toBeNull(); expect(viewportDepth).toBeNull(); expect(currentDocument.name).toBe('Another accepted part');
  });

  it('keeps the correlated quantity preview while choosing areas and cancels only that choice before one Apply/Undo', async () => {
    const original = solidDocument();
    const initial = applyCadEdits(original, [{ kind: 'set-parameter', name: 'depth', value: 10 },
      { kind: 'update-feature', feature: { ...original.features[1], kind: 'extrude', sketchId: 'sketch', distance: ' depth ', symmetric: false, operation: 'new', targetId: null } }]);
    const preview = vi.fn<NonNullable<CadWorkbenchProps['onFeaturePreview']>>();
    await mount(initial, { build: topologyBuild, buildState: 'ready', onFeaturePreview: preview });
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' }));
    const version = currentSession.getSnapshot().version;
    await input(field('Length'), '20');
    const candidateCommand = preview.mock.calls.map(([command]) => command).filter(command => command.kind === 'candidate').at(-1);
    if (!candidateCommand || candidateCommand.kind !== 'candidate') throw new Error('Expected correlated preview.');
    const candidate = applyCadEdits(initial, candidateCommand.edits);
    await act(async () => replaceFeaturePreview({ kind: 'ready', owner: candidateCommand.owner, baseVersion: candidateCommand.expectedVersion, featureId: 'pad',
      candidateId: 'candidate', definitionKey: cadFeatureCandidateKey(candidateCommand.edits), document: candidate,
      result: { ...topologyBuild, meshes: topologyBuild.meshes.map(mesh => ({ ...mesh, volume: 40_000 })) } }));
    await click('Pick closed areas from model');
    expect(viewportRegions?.sketchId).toBe('sketch'); expect(viewportRegions?.selection).toBeUndefined();
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-displayed-volumes')).toBe('40000');
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-source-reference-pick-ids')).toBe('sketch');
    expect(requestViewportMenu).toBeUndefined(); expect(currentSession.getSnapshot()).toMatchObject({ version, workflowOpen: true });
    if (!viewportRegions) throw new Error('Missing owned region picker.');
    await act(async () => viewportRegions?.onSelect([]));
    expect(button('Apply').disabled).toBe(true); expect(currentDocument).toBe(initial);
    await click('Cancel area selection');
    expect(viewportRegions).toBeNull(); expect(field('Length').value).toBe('20'); expect(currentDocument).toBe(initial);
    await click('Apply');
    expect(currentDocument.parameters.depth).toBe(20); expect(currentDocument.features[1]).toEqual(initial.features[1]);
    await act(async () => currentSession.undo()); expect(currentDocument).toEqual(initial);
  });

  it('retains source-owned area picking through an accepted native build publication without loosening whole-source picks', async () => {
    const initial = solidDocument(); await mount(initial, { build: topologyBuild, buildState: 'ready' });
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' }));
    await click('Pick closed areas from model'); const command = viewportRegions;
    if (!command) throw new Error('Missing source-owned areas.');
    const before = currentSession.getSnapshot();
    await act(async () => replaceBuild({ ...topologyBuild, buildId: 'republished-native-build' }));
    expect(viewportRegions).toBe(command); expect(currentDocument).toBe(initial);
    expect(currentSession.getSnapshot()).toMatchObject({ version: before.version, workflowOpen: true });
    await act(async () => command.onSelect(command.cells.cells.filter(cell => cell.defaultMaterial).map(cell => cell.reference)));
    expect(viewportRegions?.cells).toBe(command.cells); expect(viewportRegions?.placement).toBe(command.placement);
    await click('Cancel area selection'); expect(viewportRegions).toBeNull();
    await click('Pick profile sketch from model');
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-source-reference-pick-ids')).toBe('sketch');
    await act(async () => replaceBuild({ ...topologyBuild, buildId: 'another-native-build' }));
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-source-reference-pick-ids')).toBe('');
    expect(currentDocument).toBe(initial);
  });

  it('invalidates area-picking callbacks on document replacement without substituting a new source or leaving a picker open', async () => {
    const initial = solidDocument(); await mount(initial, { build: topologyBuild, buildState: 'ready' });
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' }));
    await click('Pick closed areas from model'); const previous = viewportRegions;
    if (!previous) throw new Error('Missing owned region picker.');
    const replacement = { ...initial, name: 'Replacement part' };
    await act(async () => replaceDocument(replacement));
    const acceptedReplacement = currentDocument, replacementVersion = currentSession.getSnapshot().version;
    expect(viewportRegions).toBeNull();
    await act(async () => { previous.onSelect([{ boundaryProfileId: 'rectangle', voidProfileIds: [], ancestorProfileIds: [] }]); previous.onFinish(); previous.onCancel(); });
    expect(currentDocument).toBe(acceptedReplacement); expect(currentDocument).toEqual(replacement);
    expect(currentSession.getSnapshot().version).toBe(replacementVersion);
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-source-reference-pick-ids')).toBe('');
    expect(container.querySelector('[aria-label="Finish area selection"]')).toBeNull();
  });

  it('picks a profile sketch with type guards and invalidates the owned picker on document replacement', async () => {
    const original = solidDocument(), first = original.features[0];
    if (first.kind !== 'sketch') throw new Error('Expected sketch fixture.');
    const initial = applyCadEdits(original, [{ kind: 'add-feature', feature: { ...first, id: 'sketch-b', name: 'Outline B', offset: 5 } }]);
    await mount(initial, { build: topologyBuild, buildState: 'ready' });
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'sketch' }));
    await act(async () => requestViewportMenu?.({ clientX: 100, clientY: 100, trigger: 'pointer', target: { kind: 'feature', featureId: 'sketch-b' } }));
    await click('Pad sketch');
    expect((container.querySelector('[aria-label="Profile sketch"]') as HTMLSelectElement).value).toBe('sketch-b');
    await click('Pick profile sketch from model');
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-source-reference-pick-ids')).toBe('sketch,sketch-b');
    await act(async () => pickViewportFeature?.('pad'));
    expect(container.querySelector('[aria-label="Cancel source selection"]')).not.toBeNull();
    expect((container.querySelector('[aria-label="Profile sketch"]') as HTMLSelectElement).value).toBe('sketch-b');
    await act(async () => pickViewportFeature?.('sketch'));
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-source-reference-pick-ids')).toBe('');
    expect((container.querySelector('[aria-label="Profile sketch"]') as HTMLSelectElement).value).toBe('sketch');
    await click('Pick profile sketch from model');
    await act(async () => replaceDocument({ ...initial, name: 'Replaced part' }));
    expect(container.querySelector('[aria-label="Cancel source selection"]')).toBeNull();
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-source-reference-pick-ids')).toBe('');
    expect(currentDocument.features).toEqual(initial.features);
    expect(currentDocument.name).toBe('Replaced part');
    await click('Cancel');
  });

  it('starts Pad from a usable material sketch and keeps empty or construction-only sketches out of source choices', async () => {
    const original = solidDocument(), material = original.features[0];
    if (material.kind !== 'sketch') throw new Error('Expected material sketch.');
    await mount({ ...createCadDocument('Pad source eligibility'), features: [material,
      { ...material, id: 'empty', name: 'Empty', profiles: [] },
      { ...material, id: 'guides', name: 'Guides', profiles: material.profiles.map(profile => ({ ...profile, construction: true })) }
    ] });
    await click('Pad / Pocket');
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Profile sketch"]');
    expect(select?.value).toBe(material.id);
    expect([...select?.options ?? []].map(option => option.value)).toEqual([material.id]);
    await click('Pick profile sketch from model');
    await act(async () => pickViewportFeature?.('empty'));
    expect(container.querySelector('[aria-label="Cancel source selection"]')).not.toBeNull();
    await act(async () => pickViewportFeature?.('guides'));
    expect(select?.value).toBe(material.id);
    await act(async () => pickViewportFeature?.(material.id));
    expect(container.querySelector('[aria-label="Cancel source selection"]')).toBeNull();
    expect(currentSession.getSnapshot().document.features).toHaveLength(3);
  });

  it('does not advertise Pad when the only material sketch is suppressed', async () => {
    const material = solidDocument().features[0]; if (material.kind !== 'sketch') throw new Error('Expected sketch.');
    await mount({ ...createCadDocument('Suppressed source'), features: [{ ...material, suppressed: true }] });
    expect(button('Pad / Pocket').disabled).toBe(true);
  });

  it.each(['empty', 'guides'])('does not substitute another sketch when the selected %s sketch has no material contours', async selectedId => {
    const material = solidDocument().features[0]; if (material.kind !== 'sketch') throw new Error('Expected material sketch.');
    const initial = { ...createCadDocument('Explicit source selection'), features: [material,
      { ...material, id: 'empty', name: 'Empty', profiles: [] },
      { ...material, id: 'guides', name: 'Guides', profiles: material.profiles.map(profile => ({ ...profile, construction: true })) }
    ] };
    await mount(initial);
    const before = currentSession.getSnapshot();
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: selectedId }));
    await click('Pad / Pocket');
    expect(container.querySelector('select[aria-label="Profile sketch"]')).toBeNull();
    expect(statusMessage).toHaveBeenLastCalledWith(expect.stringContaining(`Selected sketch "${selectedId === 'empty' ? 'Empty' : 'Guides'}" has no closed material contours.`), 'error');
    expect(currentSession.getSnapshot().document).toBe(before.document);
    expect(currentSession.getSnapshot().version).toBe(before.version);
    expect(currentSession.getSnapshot().workflowOpen).toBe(false);
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: null }));
    await click('Pad / Pocket');
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Profile sketch"]')?.value).toBe(material.id);
  });

  it('starts Revolve from the latest active material sketch, including datum sources, and keeps invalid sources out of its picker', async () => {
    const material = solidDocument().features[0]; if (material.kind !== 'sketch') throw new Error('Expected material sketch.');
    const initial = applyCadEdits(createCadDocument('Revolve sources'), [
      { kind: 'add-feature', feature: material },
      { kind: 'add-feature', feature: { id: 'datum', name: 'Datum', kind: 'datum-plane', suppressed: false, definition: { kind: 'world', basePlane: 'XY', origin: [3, 4, 5], rotation: [20, 0, 10] } } },
      { kind: 'add-feature', feature: { ...material, id: 'datum_profile', name: 'Datum profile', plane: { kind: 'datum-plane', featureId: 'datum' } } },
      { kind: 'add-feature', feature: { ...material, id: 'suppressed', name: 'Suppressed', suppressed: true } },
      { kind: 'add-feature', feature: { ...material, id: 'empty', name: 'Empty', profiles: [] } },
      { kind: 'add-feature', feature: { ...material, id: 'guides', name: 'Guides', profiles: material.profiles.map(profile => ({ ...profile, construction: true })) } }
    ]);
    await mount(initial); const before = currentSession.getSnapshot();
    await click('Revolve');
    const sources = container.querySelector<HTMLSelectElement>('select[aria-label="Profile sketch"]');
    expect(sources?.value).toBe('datum_profile');
    expect([...sources?.options ?? []].map(option => option.value)).toEqual(['sketch', 'datum_profile']);
    await input(field('Angle'), '270');
    await click('Pick profile sketch from model');
    await act(async () => pickViewportFeature?.('guides'));
    expect(container.querySelector('[aria-label="Cancel source selection"]')).not.toBeNull();
    await act(async () => pickViewportFeature?.('empty'));
    await act(async () => pickViewportFeature?.('suppressed'));
    expect(sources?.value).toBe('datum_profile');
    await act(async () => pickViewportFeature?.(material.id));
    expect(container.querySelector('[aria-label="Cancel source selection"]')).toBeNull();
    expect(sources?.value).toBe(material.id); expect(field('Angle').value).toBe('270');
    expect(currentSession.getSnapshot().document).toBe(before.document); expect(currentSession.getSnapshot().version).toBe(before.version);
  });

  it.each(['empty', 'guides', 'suppressed'])('rejects an explicitly selected %s Revolve sketch without replacing it', async selectedId => {
    const material = solidDocument().features[0]; if (material.kind !== 'sketch') throw new Error('Expected material sketch.');
    await mount({ ...createCadDocument('Explicit Revolve source'), features: [material,
      { ...material, id: 'empty', name: 'Empty', profiles: [] },
      { ...material, id: 'guides', name: 'Guides', profiles: material.profiles.map(profile => ({ ...profile, construction: true })) },
      { ...material, id: 'suppressed', name: 'Suppressed', suppressed: true }
    ] });
    const before = currentSession.getSnapshot();
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: selectedId }));
    await click('Revolve');
    expect(container.querySelector('select[aria-label="Profile sketch"]')).toBeNull();
    const selectedName = selectedId === 'empty' ? 'Empty' : selectedId === 'guides' ? 'Guides' : 'Suppressed';
    expect(statusMessage).toHaveBeenLastCalledWith(expect.stringContaining(`Selected sketch "${selectedName}" ${selectedId === 'suppressed' ? 'is suppressed' : 'has no closed material contours'}.`), 'error');
    expect(currentSession.getSnapshot().document).toBe(before.document); expect(currentSession.getSnapshot().version).toBe(before.version);
    expect(currentSession.getSnapshot().workflowOpen).toBe(false);
  });

  it('keeps Through-all source picking restricted to principal material sketches and preserves its pending editor', async () => {
    const original = solidDocument(), material = original.features[0]; if (material.kind !== 'sketch') throw new Error('Expected sketch.');
    const initial = applyCadEdits(original, [
      { kind: 'add-feature', feature: { id: 'tilted', name: 'Tilted plane', kind: 'datum-plane', suppressed: false, definition: { kind: 'world', basePlane: 'XY', origin: [0, 0, 0], rotation: [30, 0, 0] } } },
      { kind: 'add-feature', feature: { ...material, id: 'tilted_profile', name: 'Tilted profile', plane: { kind: 'datum-plane', featureId: 'tilted' } } },
      { kind: 'add-feature', feature: { ...material, id: 'bore', name: 'Bore', profiles: [{ id: 'bore_circle', name: 'Bore circle', construction: false, geometry: { kind: 'circle', x: 20, y: 20, radius: 3 } }] } },
      { kind: 'add-feature', feature: { id: 'pocket', name: 'Through pocket', kind: 'pocket', suppressed: false, sketchId: 'bore', targetId: 'pad', extent: { kind: 'through-all', direction: 'both' } } }
    ]);
    await mount(initial, { build: { ...topologyBuild, meshes: topologyBuild.meshes.map(mesh => ({ ...mesh, featureId: 'pocket' })) }, buildState: 'ready' });
    await click('Through pocket');
    const choices = container.querySelector<HTMLSelectElement>('[aria-label="Profile sketch"]');
    expect([...choices?.options ?? []].map(option => option.value)).toEqual(['sketch', 'bore']);
    await click('Pick profile sketch from model');
    await act(async () => pickViewportFeature?.('tilted_profile'));
    expect(container.querySelector('[aria-label="Cancel source selection"]')).not.toBeNull(); expect(choices?.value).toBe('bore');
    await act(async () => pickViewportFeature?.('bore'));
    expect(container.querySelector('[aria-label="Cancel source selection"]')).toBeNull();
    expect(currentDocument).toBe(initial);
  });

  it('shows accepted geometry while picking a source and cancels the picker without discarding the numeric preview draft', async () => {
    const preview = vi.fn<NonNullable<CadWorkbenchProps['onFeaturePreview']>>();
    await mount(solidDocument(), { build: topologyBuild, buildState: 'ready', onFeaturePreview: preview });
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' }));
    await input(field('Length'), '20');
    const command = preview.mock.calls.map(([command]) => command).filter(command => command.kind === 'candidate').at(-1);
    if (!command || command.kind !== 'candidate') throw new Error('Expected preview candidate.');
    const candidate = applyCadEdits(currentDocument, command.edits);
    await act(async () => replaceFeaturePreview({ kind: 'ready', owner: command.owner, baseVersion: command.expectedVersion, featureId: 'pad', candidateId: 'candidate', definitionKey: cadFeatureCandidateKey(command.edits), document: candidate,
      result: { ...topologyBuild, buildId: 'candidate-build', meshes: topologyBuild.meshes.map(mesh => ({ ...mesh, volume: 40_000 })) } }));
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-displayed-volumes')).toBe('40000');
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-source-reference-pick-ids')).toBe('');
    await click('Pick profile sketch from model');
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-displayed-volumes')).toBe('20000');
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-source-reference-pick-ids')).toBe('sketch');
    expect(requestViewportMenu).toBeUndefined();
    expect(preview.mock.calls.at(-1)?.[0]).toEqual({ kind: 'clear', owner: command.owner });
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-source-reference-pick-ids')).toBe('');
    expect(field('Length').value).toBe('20');
    expect(preview.mock.calls.at(-1)?.[0]).toMatchObject({ kind: 'candidate', edits: [{ kind: 'update-feature', feature: { distance: 20 } }] });
    expect(currentDocument.features.find(feature => feature.id === 'pad')).toMatchObject({ distance: 10 });
    await click('Cancel');
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-displayed-volumes')).toBe('20000');
  });

  it('picks only an eligible preceding source into the draft, keeps other fields on Escape and commits one history step', async () => {
    const initial = applyCadEdits(solidDocument(), [
      { kind: 'add-feature', feature: { id: 'pad-b', name: 'Pad B', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null } },
      { kind: 'add-feature', feature: { id: 'move', name: 'Move', kind: 'transform', suppressed: false, sourceId: 'pad', translation: [1, 0, 0], rotation: [0, 0, 0] } },
      { kind: 'add-feature', feature: { id: 'later', name: 'Later pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 2, symmetric: false, operation: 'new', targetId: null } },
    ]);
    await mount(initial, { buildState: 'ready', build: { ...topologyBuild, meshes: ['move', 'pad-b', 'later'].map(featureId => ({ ...topologyBuild.meshes[0], featureId })) } });
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'move' }));
    await input(field('X'), '9');
    await act(async () => button('Pick body from model').focus());
    await click('Pick body from model');
    expect(currentSession.getSnapshot().workflowOpen).toBe(true);
    expect(currentDocument).toBe(initial);
    await act(async () => pickViewportFeature?.('later'));
    expect(container.querySelector('[aria-label="Cancel source selection"]')).not.toBeNull();
    expect((container.querySelector('[aria-label="Body"]') as HTMLSelectElement).value).toBe('pad');
    await act(async () => document.querySelector('[aria-label="Cancel source selection"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(field('X').value).toBe('9');
    expect(container.querySelector('[aria-label="Cancel source selection"]')).toBeNull();
    expect(document.activeElement).toBe(button('Pick body from model'));
    await click('Pick body from model');
    await click('Select Pad B in history');
    expect((container.querySelector('[aria-label="Body"]') as HTMLSelectElement).value).toBe('pad-b');
    expect(viewport().getState().selectedFeatureId).toBe('move');
    expect(currentDocument).toBe(initial);
    await click('Apply');
    expect(currentDocument.features.find(feature => feature.id === 'move')).toMatchObject({ sourceId: 'pad-b', translation: [9, 0, 0] });
    await act(async () => currentSession.undo());
    expect(currentDocument).toEqual(initial);
  });

  it('adds a compatible Loft section by guarded model picking while retaining the ordered draft and one undo step', async () => {
    const original = solidDocument(), sketch = original.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Expected sketch fixture.');
    const initial = applyCadEdits(original, [
      { kind: 'add-feature', feature: { ...sketch, id: 'sketch-b', name: 'Outline B', offset: 10 } },
      { kind: 'add-feature', feature: { ...sketch, id: 'sketch-c', name: 'Outline C', offset: 20 } },
    ]);
    await mount(initial);
    await click('Loft');
    const sections = [...container.querySelectorAll<HTMLSelectElement>('.cad-loft-section-list select')].map(select => select.value);
    const nextId = ['sketch', 'sketch-b', 'sketch-c'].find(id => !sections.includes(id));
    if (!nextId) throw new Error('Expected an unused section.');
    await click('Pick new section from model');
    await act(async () => pickViewportFeature?.(sections[0]));
    expect(container.querySelector('[aria-label="Cancel source selection"]')).not.toBeNull();
    await act(async () => pickViewportFeature?.(nextId));
    expect([...container.querySelectorAll<HTMLSelectElement>('.cad-loft-section-list select')].map(select => select.value)).toEqual([...sections, nextId]);
    expect(currentDocument).toBe(initial);
    await click('Apply');
    expect(currentDocument.features.at(-1)).toMatchObject({ kind: 'loft', sketchIds: [...sections, nextId] });
    await act(async () => currentSession.undo());
    expect(currentDocument).toEqual(initial);
  });

  it('starts a viewport context command from the pointed body instead of the previously selected body', async () => {
    const initial = applyCadEdits(solidDocument(), [{ kind: 'add-feature', feature: { id: 'pad-b', name: 'Pad B', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null } }]);
    await mount(initial, { buildState: 'ready', build: { ...topologyBuild, meshes: [...topologyBuild.meshes, { ...topologyBuild.meshes[0], featureId: 'pad-b', name: 'Pad B', volume: 10_000 }] } });
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' }));
    const accepted = currentSession.getSnapshot();
    await act(async () => requestViewportMenu?.({ clientX: 100, clientY: 100, trigger: 'pointer', target: { kind: 'feature', featureId: 'pad-b' } }));
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(() => viewport().apply({ kind: 'select-feature', featureId: 'pad' })).toThrow('Apply or cancel');
    await click('Move / Rotate');
    expect([...container.querySelectorAll('select')].find(select => [...select.options].some(option => option.value === 'pad-b'))?.value).toBe('pad-b');
    expect(currentSession.getSnapshot().document).toBe(accepted.document);
    await click('Apply');
    expect(currentDocument.features.at(-1)).toMatchObject({ kind: 'transform', sourceId: 'pad-b' });
    await act(async () => currentSession.undo());
    expect(currentDocument).toEqual(initial);
  });

  it('converts the pointed topology hit and dismisses context actions when the accepted build changes', async () => {
    const resolve = vi.fn(resolveTopology);
    const initial = solidDocument();
    await mount(initial, { build: topologyBuild, buildState: 'ready', onResolveSelection: resolve, onInspectTopology: inspectTopology });
    await selectTopology('edge');
    await act(async () => requestViewportMenu?.({ clientX: 100, clientY: 100, trigger: 'pointer', target: { kind: 'topology', hit: { bodyId: 'pad', pick: { kind: 'face', key: 'face-1' } } } }));
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await click('Shell from face');
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'shell', picks: [{ kind: 'face', key: 'face-1' }] }), expect.any(String), expect.any(AbortSignal));
    await click('Cancel');
    await act(async () => requestViewportMenu?.({ clientX: 100, clientY: 100, trigger: 'pointer', target: { kind: 'feature', featureId: 'pad' } }));
    await act(async () => replaceBuild({ ...topologyBuild, buildId: 'replacement-build' }));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(currentDocument).toEqual(initial);
  });

  it('uses a sketch profile context target without deleting the previously selected profile', async () => {
    const original = solidDocument();
    const sketch = original.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Expected sketch fixture.');
    const initial = applyCadEdits(original, [{ kind: 'update-feature', feature: { ...sketch, profiles: [
      { id: 'rectangle', name: 'Plate', construction: false, role: 'outer', geometry: { kind: 'rectangle', x: 0, y: 0, width: 50, height: 40, cornerRadius: 0 } },
      { id: 'circle', name: 'Hole', construction: false, role: 'hole', geometry: { kind: 'circle', x: 10, y: 10, radius: 2 } },
    ] } }]);
    await mount(initial);
    await act(async () => { viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }); viewport().apply({ kind: 'select-profile', profileId: 'circle' }); });
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]')!;
    await act(async () => canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true })));
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await click('Toggle construction');
    expect(currentDocument.features[0]).toMatchObject({ profiles: [{ id: 'rectangle', construction: false }, { id: 'circle', construction: true }] });
    await act(async () => currentSession.undo());
    expect(currentDocument).toEqual(initial);
  });

  it('renders an existing feature candidate while preserving accepted geometry and restores the original model on Cancel', async () => {
    const preview = vi.fn<NonNullable<CadWorkbenchProps['onFeaturePreview']>>();
    await mount(solidDocument(), { build: topologyBuild, buildState: 'ready', onFeaturePreview: preview });
    await click('Pad 1'); const before = currentSession.getSnapshot();
    await input(field('Length'), '20');
    const command = preview.mock.calls.map(([entry]) => entry).filter(entry => entry.kind === 'candidate').at(-1);
    if (!command || command.kind !== 'candidate') throw new Error('Missing provisional feature command');
    const candidate = applyCadEdits(before.document, command.edits);
    const result: CadBuildResult = { ...topologyBuild, buildId: 'candidate-build', meshes: topologyBuild.meshes.map(mesh => ({ ...mesh, volume: 40_000, bounds: { min: [0, 0, 0], max: [50, 40, 20] } })) };
    const ready: Extract<CadFeaturePreviewState, { kind: 'ready' }> = { kind: 'ready', owner: command.owner, featureId: 'pad', baseVersion: before.version, candidateId: 'candidate_1', definitionKey: cadFeatureCandidateKey(command.edits), document: candidate, result };
    await act(async () => replaceFeaturePreview(ready));
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-displayed-volumes')).toBe('40000');
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-navigation-locked')).toBe('false');
    expect(currentSession.getSnapshot()).toMatchObject({ version: before.version, document: before.document, canUndo: false, workflowOpen: true });
    await input(field('Length'), '21');
    const nextCommand = preview.mock.calls.at(-1)?.[0]; if (!nextCommand || nextCommand.kind !== 'candidate') throw new Error('Missing latest candidate');
    const pendingKind: 'waiting' = 'waiting', pendingPreview = { kind: pendingKind, owner: command.owner, featureId: 'pad', baseVersion: before.version, candidateId: 'candidate_2', definitionKey: cadFeatureCandidateKey(nextCommand.edits), lastValid: ready };
    await act(async () => replaceFeaturePreview(pendingPreview));
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-displayed-volumes')).toBe('40000');
    expect(button('Apply').disabled).toBe(true); expect(currentSession.getSnapshot().document).toBe(before.document);
    await click('Cancel');
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-displayed-volumes')).toBe('20000');
    expect(currentSession.getSnapshot()).toEqual(before);
    await input(field('Length'), '20');
    const retry = preview.mock.calls.map(([entry]) => entry).filter(entry => entry.kind === 'candidate').at(-1);
    if (!retry || retry.kind !== 'candidate') throw new Error('Missing retried preview');
    await act(async () => replaceFeaturePreview({ ...ready, owner: retry.owner, candidateId: 'retry', definitionKey: cadFeatureCandidateKey(retry.edits), document: applyCadEdits(before.document, retry.edits) }));
    await click('Apply');
    expect(currentSession.getSnapshot()).toMatchObject({ canUndo: true, workflowOpen: false, document: { features: [expect.anything(), { distance: 20 }] } });
    await act(async () => currentSession.undo()); expect(currentSession.getSnapshot().document).toEqual(before.document);
  });
  it('updates device dimension visibility and viewport identity without editing geometry or history', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
    setCadPreferences({ navigationMode: 'mouse', showOnPartDimensions: true });
    await mount({ ...createCadDocument(), features: [{ id: 'outline', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
      profiles: [{ id: 'circle', name: 'Circle', construction: false, constraints: [{ id: 'diameter', kind: 'dimension', quantity: 'diameter' }], geometry: { kind: 'circle', x: 0, y: 0, radius: 5 } }] }] });
    await click('Outline'); await click('Circle profile');
    const before = currentSession.getSnapshot(); expect(container.querySelector('.cad-sketch-dimension-controls')).not.toBeNull();
    await act(async () => setCadPreferences({ navigationMode: 'trackpad', showOnPartDimensions: false }));
    expect(container.querySelector('.cad-sketch-dimension-controls')).toBeNull();
    expect(viewport().getState().view).toMatchObject({ navigationMode: 'trackpad', onPartDimensionsVisible: false });
    expect(currentSession.getSnapshot()).toBe(before);
    await act(async () => setCadPreferences({ ...getCadPreferences(), showOnPartDimensions: true }));
    expect(container.querySelector('.cad-sketch-dimension-controls')).not.toBeNull();
    expect(viewport().getState().view).toMatchObject({ onPartDimensionsVisible: true });
    expect(currentSession.getSnapshot()).toBe(before);
    await act(async () => setCadPreferences({ navigationMode: 'mouse', showOnPartDimensions: true }));
  });
  it('owns the workflow while a history context menu is open and suppresses its actual feature as one undoable edit', async () => {
    await mount({ ...createCadDocument(), features: [{ id: 'outline', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [] }] });
    const before = currentSession.getSnapshot(), target = button('Select Outline in history');
    await act(async () => target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 })));
    expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version, workflowOpen: true });
    await click('Suppress feature');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(currentSession.getSnapshot()).toMatchObject({ workflowOpen: false, canUndo: true, document: { features: [{ id: 'outline', suppressed: true }] } });
    await act(async () => currentSession.undo()); expect(currentSession.getSnapshot().document).toEqual(before.document);
  });
  it('discards an edited part name on focused Escape without changing document, version or undo/redo history', async () => {
    await mount(solidDocument());
    await act(async () => {
      currentSession.edit([{ kind: 'rename-document', name: 'Reviewed part' }]);
      currentSession.edit([{ kind: 'set-parameter', name: 'width', value: 50 }]); currentSession.undo();
    });
    const before = currentSession.getSnapshot(); expect(before.canUndo).toBe(true); expect(before.canRedo).toBe(true);
    const name = container.querySelector<HTMLInputElement>('[aria-label="Part name"]'); if (!name) throw new Error('Part name missing');
    await act(async () => name.focus()); await input(name, 'Discard this rename'); expect(currentSession.getSnapshot().workflowOpen).toBe(true);
    await act(async () => name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(name.value).toBe('Reviewed part'); expect(document.activeElement).toBe(name);
    expect(currentSession.getSnapshot()).toEqual(before); expect(currentDocument).toBe(before.document);
    await act(async () => name.blur());
    expect(currentSession.getSnapshot()).toEqual(before); expect(currentSession.getSnapshot().workflowOpen).toBe(false);
  });
  it('leaves composing Enter and Escape to the part-name input method', async () => {
    await mount(solidDocument()); const before = currentSession.getSnapshot();
    const name = container.querySelector<HTMLInputElement>('[aria-label="Part name"]'); if (!name) throw new Error('Part name missing');
    await act(async () => name.focus()); await input(name, '部品');
    for (const key of ['Enter', 'Escape']) {
      const composing = new KeyboardEvent('keydown', { key, isComposing: true, bubbles: true, cancelable: true });
      await act(async () => name.dispatchEvent(composing));
      expect(composing.defaultPrevented).toBe(false); expect(name.value).toBe('部品'); expect(document.activeElement).toBe(name);
      expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version, workflowOpen: true });
    }
    await act(async () => name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(currentSession.getSnapshot()).toEqual(before);
  });
  it('keeps the specification tree over the canvas and preserves the view through inspector selection and collapse', async () => {
    await mount(solidDocument()); const before = currentSession.getSnapshot(); const controls = viewport();
    const area = container.querySelector('.cad-center'); const canvas = container.querySelector('[aria-label="3D model viewport"]');
    expect(area?.contains(container.querySelector('[data-cad-model-tree]'))).toBe(true);
    await click('Collapse Model'); await click('Expand Model');
    await act(async () => controls.apply({ kind: 'select-feature', featureId: 'pad' }));
    await click('Minimize configuration'); await click('Expand configuration');
    expect(field('Length').value).toBe('10'); expect(container.querySelector('[aria-label="3D model viewport"]')).toBe(canvas);
    expect(viewport()).toBe(controls); expect(currentSession.getSnapshot()).toBe(before);
  });

  it('retains pending edits and blocks tree branch changes until cancellation', async () => {
    await mount(solidDocument()); await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' }));
    const before = currentSession.getSnapshot(); const length = field('Length');
    await act(async () => length.focus()); await input(length, '25');
    expect(button('Collapse Model').disabled).toBe(true); expect(button('Expand Parameters').disabled).toBe(true);
    expect(field('Length')).toBe(length); expect(length.value).toBe('25');
    await click('Cancel'); expect(field('Length').value).toBe('10');
    expect(button('Collapse Model').disabled).toBe(false); expect(currentSession.getSnapshot()).toEqual(before);
  });

  it('reclaims empty property space and restores the editor on selection without changing geometry or history', async () => {
    await mount(solidDocument(), { build: topologyBuild, buildState: 'ready' });
    const before = currentDocument; const version = currentSession.getSnapshot().version; const controls = viewport();
    expect(container.querySelector('[aria-label="Feature properties"]')).toBeNull();
    expect(container.querySelector('.cad-center')?.contains(container.querySelector('[data-cad-model-tree]'))).toBe(true);
    await act(async () => controls.apply({ kind: 'select-feature', featureId: 'pad' }));
    expect(container.querySelector('[aria-label="Feature properties"]')).not.toBeNull(); expect(field('Length').value).toBe('10');
    expect(container.querySelector('.cad-center')?.contains(container.querySelector('[data-cad-model-tree]'))).toBe(true);
    await act(async () => controls.apply({ kind: 'select-feature', featureId: null }));
    expect(container.querySelector('[aria-label="Feature properties"]')).toBeNull();
    await click('Sketch'); expect(viewport().getState()).toMatchObject({ awaitingSketchPlane: true, workflowOpen: true });
    expect(button('Save').disabled).toBe(true);
    await click('Cancel plane selection'); expect(viewport().getState()).toMatchObject({ awaitingSketchPlane: false, workflowOpen: false });
    expect(viewport()).toBe(controls); expect(currentDocument).toBe(before); expect(currentSession.getSnapshot().version).toBe(version);
  });
  it('keeps a restored inspector mounted while a pending profile edit prevents selection changes', async () => {
    await mount(solidDocument());
    await act(async () => { viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }); viewport().apply({ kind: 'select-profile', profileId: 'rectangle' }); });
    await click('Add dimension'); await input(dimensionValue(), '60');
    expect(() => viewport().apply({ kind: 'select-feature', featureId: null })).toThrow('Apply or cancel');
    expect(container.querySelector('[aria-label="Feature properties"]')).not.toBeNull(); expect(dimensionValue().value).toBe('60');
    await click('Cancel'); await click('Add dimension'); expect(dimensionValue().value).toBe('50'); await click('Cancel');
  });
  it('navigates File commands by keyboard and restores toolbar focus without changing the draft', async () => {
    await mount();
    const before = currentSession.getSnapshot(), trigger = button('File');
    await act(async () => trigger.focus());
    await click('File');
    expect(document.activeElement).toBe(button('New part'));
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(button('Open saved part'));
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(document.querySelector('[role="menu"][aria-label="CAD document commands"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await click('File');
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.querySelector('[role="menu"][aria-label="CAD document commands"]')).toBeNull();
    expect(document.activeElement).toBe(button('Undo'));
    expect(currentSession.getSnapshot()).toBe(before);
  });
  it('offers model rebuild recovery from File without editing the draft', async () => {
    const rebuild = vi.fn(async () => undefined);
    await mount(solidDocument(), { build: null, buildState: 'error', onRebuild: rebuild });
    const before = currentDocument; const version = currentSession.getSnapshot().version;
    await click('File'); expect(button('Rebuild model').disabled).toBe(false);
    await click('Rebuild model');
    expect(rebuild).toHaveBeenCalledTimes(1); expect(currentDocument).toBe(before); expect(currentSession.getSnapshot().version).toBe(version);
  });
  it('normalizes reverse rectangle drawing and refuses degenerate geometry', () => {
    expect(twoPointSketchProfile('rectangle', [40, 30], [0, -10])).toEqual({ kind: 'rectangle', x: 0, y: -10, width: 40, height: 40, cornerRadius: 0 });
    expect(() => twoPointSketchProfile('rectangle', [0, 0], [0, 30])).toThrow('nonzero');
    expect(twoPointSketchProfile('circle', [5, 5], [8, 9])).toEqual({ kind: 'circle', x: 5, y: 5, radius: 5 });
    expect(twoPointSketchProfile('slot', [0, 0], [0, 20])).toEqual({ kind: 'slot', x: 0, y: 0, length: 40, width: 10, angle: 90 });
    expect(() => closeSketchPolygon([[0, 0], [20, 0]])).toThrow('three');
  });

  it('snaps both signs and preserves precision when snapping is disabled', () => {
    expect(snapSketchPoint([-12, 18], 5, true)).toEqual([-10, 20]);
    expect(snapSketchPoint([1.125, -2.375], 5, false)).toEqual([1.125, -2.375]);
    expect(() => snapSketchPoint([1, 1], 0, true)).toThrow('positive');
  });

  it('creates a real sketch, commits a drawn rectangle and sends that exact sketch to CAM', async () => {
    await mount();
    await click('Sketch');
    expect(workflow).toHaveBeenLastCalledWith(true);
    expect(button('Save').disabled).toBe(true);
    await act(async () => pickViewportPlane?.('XY'));
    expect(currentDocument.features[0]?.kind).toBe('sketch');
    await canvasClick(300, 200);
    expect(workflow).toHaveBeenLastCalledWith(true);
    expect(() => currentSession.assertWorkflowClosed()).toThrow('Finish or cancel');
    await canvasClick(450, 100);
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Expected sketch.');
    expect(sketch.profiles).toEqual([]);
    expect(sketch.graph?.points.map(point => point.position)).toEqual([[0, 0], [50, 0], [50, 40], [0, 40]]);
    expect(sketch.graph?.entities.map(entity => entity.kind)).toEqual(['line', 'line', 'line', 'line']);
    expect(sketch.graph?.relations.map(relation => relation.kind)).toEqual(['horizontal', 'vertical', 'horizontal', 'vertical']);
    expect(currentDocument.schemaVersion).toBe(2);
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: sketch.graph?.entities[0].id }]);
    expect(workflow).toHaveBeenLastCalledWith(false);
    expect(container.querySelector('[aria-label="Sketch measurements"]')?.textContent).toContain('2,000 mm²');
    expect(container.querySelector('[aria-label="Sketch measurements"]')?.textContent).toContain('180 mm');
    await click('File'); await click('Send sketch to CAM');
    expect(sendToCam).toHaveBeenCalledWith(sketch.id);
  });

  it('retains a new graph edge selection when deferred drawing acceptance publishes its source', async () => {
    let accept: (() => void) | undefined;
    await mount(createCadDocument(), { build: null, buildState: 'idle', onEdit: (edit, signal) => {
      if (edit.kind !== 'append-sketch-entities') { currentSession.edit([edit]); return; }
      return new Promise<void>(resolve => { accept = () => { signal?.throwIfAborted(); currentSession.edit([edit]); resolve(); }; });
    } });
    await startSketch(); await canvasClick(300, 200); await canvasClick(450, 100);
    expect(currentSession.getSnapshot().workflowOpen).toBe(true);
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([]);
    if (!accept) throw new Error('Drawing acceptance missing');
    await act(async () => accept?.());
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph?.entities.length) throw new Error('Accepted graph missing');
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: sketch.graph.entities[0].id }]);
    expect(currentSession.getSnapshot().workflowOpen).toBe(false);
    await click('Select');
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: sketch.graph.entities[0].id }]);
  });

  it('appends a fresh inferred circle atomically after acceptance and aborts a cancelled attachment without clearing redo', async () => {
    const original = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, parameters: { anchorX: 0 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Anchored sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [],
      graph: { points: [{ id: 'anchor', position: [' anchorX ', ' 0 '] }], entities: [], relations: [] }
    }] });
    const pending: { edit: Extract<CadEdit, { kind: 'append-sketch-entities' }>; signal?: AbortSignal; accept(): void }[] = [];
    await mount(original, { build: null, buildState: 'idle', onEdit: (edit, signal) => {
      if (edit.kind !== 'append-sketch-entities') { currentSession.edit([edit]); return; }
      return new Promise<void>((resolve, reject) => pending.push({ edit, signal, accept: () => {
        if (signal?.aborted) { reject(signal.reason); return; }
        currentSession.edit([edit]); resolve();
      } }));
    } });
    await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' })); await click('Circle');
    const infer = container.querySelector<HTMLInputElement>('input[aria-label="Create coincident relations"]');
    if (!infer) throw new Error('Coincident drawing control missing.');
    expect(infer.checked).toBe(false); await act(async () => infer.click());
    await canvasClick(300, 200); await canvasClick(450, 200);
    expect(pending).toHaveLength(1); expect(currentDocument).toBe(original);
    expect(currentSession.getSnapshot().workflowOpen).toBe(true);
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([]);
    const payload = pending[0].edit.geometry, center = payload.points[0], entity = payload.entities[0];
    expect(payload.points).toHaveLength(1); expect(center.id).not.toBe('anchor');
    expect(center.position).toEqual([0, 0]);
    expect(payload.relations).toEqual([{ id: expect.any(String), kind: 'coincident', pointIds: [center.id, 'anchor'] }]);
    await act(async () => pending[0].accept());
    const accepted = currentDocument;
    expect(currentDocument.features[0]).toMatchObject({ graph: { points: [{ id: 'anchor', position: [' anchorX ', ' 0 '] }, center], relations: payload.relations } });
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: entity.id }]);
    await act(async () => currentSession.undo()); expect(currentDocument).toBe(original);
    await act(async () => currentSession.redo()); expect(currentDocument).toBe(accepted);
    await act(async () => currentSession.undo()); const before = currentSession.getSnapshot();
    await canvasClick(300, 200); await canvasClick(390, 200);
    expect(pending).toHaveLength(2); expect(pending[1].edit.geometry.relations[0]).toMatchObject({ kind: 'coincident', pointIds: [expect.any(String), 'anchor'] });
    await canvasKey('Escape'); expect(pending[1].signal?.aborted).toBe(true);
    await act(async () => pending[1].accept());
    expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: before.canUndo, canRedo: true, workflowOpen: false });
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([]);
  });

  it('keeps a multi-click polygon provisional and Escape cancels it without changing saved geometry', async () => {
    await mount(); await startSketch(); await click('Polyline');
    await canvasClick(300, 200); await canvasClick(450, 200);
    expect(button('Finish sketch').disabled).toBe(true);
    expect(button('Undo').disabled).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    const sketch = currentDocument.features[0];
    expect(sketch.kind === 'sketch' && sketch.profiles).toEqual([]);
    expect(button('Finish sketch').disabled).toBe(false);
    expect(workflow).toHaveBeenLastCalledWith(false);
  });

  it('closes a free polygon into shared point identities and changes only a selected edge to construction', async () => {
    await mount(); await startSketch(); await click('Polyline');
    await canvasClick(300, 200); await canvasClick(450, 200); await canvasClick(375, 100); await canvasKey('Enter');
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Graph sketch missing.');
    expect(sketch.profiles).toEqual([]);
    expect(sketch.graph.points.map(point => point.position)).toEqual([[0, 0], [50, 0], [25, 40]]);
    expect(sketch.graph.entities).toHaveLength(3); expect(sketch.graph.relations).toEqual([]);
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: sketch.graph.entities[0].id }]);
    await click('Select');
    const edge = sketch.graph.entities[1];
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'entity', id: edge.id } }));
    const construction = container.querySelector<HTMLInputElement>('.cad-sketch-options input');
    if (!construction) throw new Error('Construction control missing.');
    await act(async () => construction.click());
    expect(currentDocument.features[0]).toMatchObject({ graph: { points: sketch.graph.points, entities: sketch.graph.entities.map(item => ({ ...item, construction: item.id === edge.id })) } });
    expect(viewport().getState().selectedSketchGeometry).toEqual({ kind: 'entity', id: edge.id });
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  it('authors a circle diameter from the toolbar and reopens that exact driver from its native annotation', async () => {
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Round plate',
      suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: { points: [{ id: 'center', position: [' 0 ', '0'] }],
        entities: [{ id: 'circle', kind: 'circle', centerPointId: 'center', radius: 5, construction: false }], relations: [] } }] });
    setCadPreferences({ ...getCadPreferences(), showOnPartDimensions: true });
    await mount(source); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'entity', id: 'circle' } }));
    expect(button('Dimension').disabled).toBe(false); await click('Dimension');
    expect(field('Diameter').value).toBe('10'); await click('Cancel'); expect(currentDocument).toBe(source);
    await click('Dimension'); await click('Apply');
    const sketch = currentDocument.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing radial sketch.');
    const relation = sketch.graph.relations[0]; expect(relation).toMatchObject({ kind: 'radial-size', entityId: 'circle', quantity: 'diameter', value: 10 });
    const label = container.querySelector('[data-cad-sketch-dimension] [role="button"]'); if (!label) throw new Error('Missing radial annotation.');
    await act(async () => label.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true })));
    expect(field('Diameter').value).toBe('10'); expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: 'circle' }]);
    expect(currentDocument.features[0]).toBe(sketch);
  });

  it('opens a fresh edge dimension from the toolbar, cancels it and applies a linked length without losing structural relations', async () => {
    await mount({ ...createCadDocument(), parameters: { plateWidth: 50 } }); await startSketch();
    await canvasClick(300, 200); await canvasClick(450, 100); await click('Select');
    await click('Dimension');
    expect(field('Length').value).toBe('50');
    expect(() => currentSession.assertWorkflowClosed()).toThrow('Finish or cancel');
    await click('Cancel');
    expect(currentDocument.features[0]).toMatchObject({ graph: { relations: Array.from({ length: 4 }, () => expect.any(Object)) } });
    await click('Dimension'); await relation('Length', 'plateWidth'); await click('Apply');
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Graph sketch missing.');
    expect(sketch.graph.relations.map(item => item.kind)).toEqual(['horizontal', 'vertical', 'horizontal', 'vertical', 'distance']);
    expect(sketch.graph.relations.at(-1)).toMatchObject({ kind: 'distance', value: 'plateWidth' });
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  it.each(['name', 'parameter'] as const)('blocks a new path while a %s edit is pending without losing either field or history', async editor => {
    await mount(); await startSketch(); await click('Path');
    const before = currentSession.getSnapshot();
    let pendingField: HTMLInputElement;
    if (editor === 'name') {
      const name = container.querySelector<HTMLInputElement>('[aria-label="Part name"]');
      if (!name) throw new Error('Part name missing'); pendingField = name; await input(name, 'Pending rename');
    } else {
      await click('Parameters'); await click('Add parameter'); pendingField = field('Name'); await input(pendingField, 'wall'); await input(field('Value'), '3');
    }
    const pendingValue = pendingField.value;
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]');
    if (!canvas) throw new Error('Sketch canvas missing');
    expect(canvas.getAttribute('tabindex')).toBe('-1');
    await canvasClick(300, 200); await canvasKey(' '); await canvasKey('ArrowRight'); await canvasKey(' ');
    expect(container.querySelector('[data-cad-path-segments]')).toBeNull(); expect(pendingField.value).toBe(pendingValue);
    expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: before.canUndo, workflowOpen: true });
    if (editor === 'name') await act(async () => pendingField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    else await click('Cancel');
    expect(currentSession.getSnapshot()).toEqual(before); expect(button('Line').disabled).toBe(false);
    await canvasKey(' '); await canvasKey('ArrowRight'); await canvasKey(' ');
    expect(container.querySelector('[data-cad-path-segments]')).not.toBeNull(); expect(button('Undo last').disabled).toBe(false);
    await click('Cancel drawing'); expect(currentSession.getSnapshot()).toEqual(before);
  });

  it('locks shared actions during a mixed path and cancels it without a document or history change', async () => {
    await mount(); await startSketch(); await click('Path');
    const before = currentSession.getSnapshot();
    await click('3-point Arc'); await canvasKey(' '); await canvasKey('ArrowUp'); await canvasKey('ArrowUp'); await canvasKey(' ');
    expect(currentSession.getSnapshot().workflowOpen).toBe(true);
    for (const label of ['Finish sketch', 'Undo', 'Save', 'Rectangle', 'Polyline']) expect(button(label).disabled).toBe(true);
    await canvasKey('z');
    const controlUndo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => container.querySelector('[aria-label="Sketch drawing canvas"]')!.dispatchEvent(controlUndo));
    expect(controlUndo.defaultPrevented).toBe(true); expect(undo).not.toHaveBeenCalled();
    await click('Undo last'); expect(button('Line').disabled).toBe(false); expect(button('Finish sketch').disabled).toBe(true);
    await canvasKey('Escape'); expect(currentSession.getSnapshot()).toEqual(before);
    expect(button('Finish sketch').disabled).toBe(false); expect(button('Rectangle').disabled).toBe(false);
  });

  it('finishes an open path without inventing material and edits one of its shared joints', async () => {
    await mount(); await startSketch(); await click('Path');
    await canvasClick(300, 200); await canvasClick(450, 200); await canvasClick(450, 100);
    await click('Finish path');
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Graph path missing.');
    expect(sketch.profiles).toEqual([]); expect(sketch.graph.points.map(point => point.position)).toEqual([[0, 0], [50, 0], [50, 40]]);
    expect(sketch.graph.entities).toHaveLength(2); expect(measureCadSketch(currentDocument, sketch.id).materialAreaMm2).toBe(0);
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
    await click('Select');
    const joint = container.querySelector<SVGGElement>(`[data-cad-sketch-point="${sketch.graph.points[1].id}"]`);
    if (!joint) throw new Error('Path joint missing.');
    await act(async () => joint.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    expect(currentDocument.features[0]).toMatchObject({ graph: { points: [{ position: [0, 0] }, { position: [55, 0] }, { position: [50, 40] }], entities: sketch.graph.entities } });
    expect(viewport().getState().selectedSketchGeometry).toEqual({ kind: 'point', id: sketch.graph.points[1].id });
  });

  it('closes a freshly drawn mixed path with exact shared arc joints and analytic material', async () => {
    await mount(); await startSketch(); await click('Path');
    await canvasClick(300, 200); await canvasClick(360, 200); await click('3-point Arc');
    await canvasClick(360, 150); await canvasClick(390, 175); await click('Line'); await canvasClick(300, 150);
    await click('Close profile');
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Graph path missing.');
    expect(sketch.profiles).toEqual([]);
    expect(sketch.graph.entities.map(entity => entity.kind)).toEqual(['line', 'arc', 'line', 'line']);
    expect(measureCadSketch(currentDocument, sketch.id).materialAreaMm2).toBeCloseTo(400 + 50 * Math.PI, 8);
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  it('edits a profile with a named expression and leaves Ctrl+Z to focused inputs', async () => {
    await openLegacyRectangle({ plateWidth: 80 });
    await click('Add dimension'); await input(dimensionValue(), 'plateWidth / 2');
    expect(button('Save').disabled).toBe(true);
    expect(workflow).toHaveBeenLastCalledWith(true);
    await act(async () => dimensionValue().dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })));
    expect(undo).not.toHaveBeenCalled();
    await click('Apply');
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Expected sketch.');
    const geometry = sketch.profiles[0].geometry;
    expect(geometry.kind === 'rectangle' && geometry.width).toBe('plateWidth / 2');
    expect(sketch.profiles[0].constraints).toMatchObject([{ kind: 'dimension', quantity: 'width' }]);
    expect(workflow).toHaveBeenLastCalledWith(false);
  });

  it('refreshes selected profile fields when an imported document preserves feature and profile IDs', async () => {
    await openLegacyRectangle();
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Expected sketch.');
    const profile = sketch.profiles[0];
    if (profile.geometry.kind !== 'rectangle') throw new Error('Expected rectangle.');
    const updated = applyCadEdits(currentDocument, [{ kind: 'update-feature', feature: { ...sketch, profiles: [{ ...profile, geometry: { ...profile.geometry, width: 75 } }] } }]);
    await act(async () => replaceDocument(updated));
    expect(workflow).toHaveBeenLastCalledWith(false);
    await click('Add dimension'); expect(dimensionValue().value).toBe('75'); await click('Cancel');
    const cleared = applyCadEdits(updated, [{ kind: 'update-feature', feature: { ...sketch, profiles: [] } }]);
    await act(async () => replaceDocument(cleared));
    expect(viewport().getState().selectedProfileId).toBeNull();
  });

  it('preserves the document when an expression is invalid and Cancel restores the field', async () => {
    await openLegacyRectangle();
    await click('Add dimension'); await input(dimensionValue(), 'missingParameter * 2'); await click('Apply');
    expect(container.querySelector('.cad-sketch-intent-editor [role="alert"]')?.textContent).toContain('Unknown parameter');
    const sketch = currentDocument.features[0];
    expect(sketch.kind === 'sketch' && sketch.profiles[0].geometry.kind === 'rectangle' && sketch.profiles[0].geometry.width).toBe(50);
    expect(button('Save').disabled).toBe(true);
    await click('Cancel');
    expect(workflow).toHaveBeenLastCalledWith(false);
    await click('Add dimension'); expect(dimensionValue().value).toBe('50'); await click('Cancel');
  });

  it('owns Save while editing and cancels scalar drafts with Escape without intercepting native text undo', async () => {
    await mount(solidDocument(), { build: topologyBuild, buildState: 'ready' });
    await click('Select Pad 1 in history');
    const before = currentSession.getSnapshot();
    await input(field('Length'), 'invalid + 2');
    await act(async () => field('Length').focus());
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    const nativeUndo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => field('Length').dispatchEvent(nativeUndo));
    expect(nativeUndo.defaultPrevented).toBe(false); expect(undo).not.toHaveBeenCalled();
    for (const modifier of ['ctrlKey', 'metaKey']) {
      const saveKey = new KeyboardEvent('keydown', { key: 's', [modifier]: true, bubbles: true, cancelable: true });
      await act(async () => field('Length').dispatchEvent(saveKey));
      expect(saveKey.defaultPrevented).toBe(true);
    }
    expect(save).not.toHaveBeenCalled(); expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version, workflowOpen: true });
    const composingEscape = new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true });
    await act(async () => field('Length').dispatchEvent(composingEscape));
    expect(field('Length').value).toBe('invalid + 2'); expect(composingEscape.defaultPrevented).toBe(false);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => field('Length').dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true); expect(field('Length').value).toBe('10');
    expect(currentSession.getSnapshot()).toEqual(before);
    const saveKey = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => field('Length').dispatchEvent(saveKey));
    expect(saveKey.defaultPrevented).toBe(true); expect(save).toHaveBeenCalledTimes(1);
  });

  it('cancels the scalar draft on the first Escape while focused contextual help is open', async () => {
    await mount(solidDocument(), { build: topologyBuild, buildState: 'ready' });
    await click('Select Pad 1 in history');
    const before = currentSession.getSnapshot();
    await input(field('Length'), 'invalid + 2');
    await act(async () => field('Length').focus());
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => field('Length').dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(field('Length').value).toBe('10');
    expect(currentSession.getSnapshot()).toEqual(before);
  });

  it('cancels pending parameter fields from the focused input without changing geometry or history', async () => {
    await mount(solidDocument()); await click('Parameters');
    const before = currentSession.getSnapshot(); await click('Add parameter');
    await input(field('Name'), 'wall'); await input(field('Value'), '3');
    expect(currentSession.getSnapshot().workflowOpen).toBe(true);
    await act(async () => field('Value').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(document.querySelector('.cad-parameter-editor')).toBeNull();
    expect(currentSession.getSnapshot()).toEqual(before);
  });

  it('uses the current body when starting a modification from a consumed historical feature', async () => {
    const initial = applyCadEdits(createCadDocument(), [
      { kind: 'add-feature', feature: { id: 'sketch', name: 'Outline', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [{ id: 'rectangle', name: 'Plate', construction: false, role: 'outer', geometry: { kind: 'rectangle', x: 0, y: 0, width: 50, height: 40, cornerRadius: 0 } }] } },
      { kind: 'add-feature', feature: { id: 'pad', name: 'Pad 1', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 10, symmetric: false, operation: 'new', targetId: null } },
      { kind: 'add-feature', feature: { id: 'fillet', name: 'Fillet 1', kind: 'fillet', suppressed: false, targetId: 'pad', radius: 1 } },
    ]);
    const section = vi.fn();
    await mount(initial, { onSectionForCam: section, buildState: 'ready', build: { buildId: 'build-1', meshes: [{ featureId: 'fillet', name: 'Fillet 1', positions: [], normals: [], indices: [], edges: [], faceGroups: [], edgeGroups: [], volume: 100, bounds: { min: [0, 0, 0], max: [50, 40, 10] } }], diagnostics: [], durationMs: 1 } });
    await click('Select Pad 1 in history'); await click('File'); await click('Section for CAM');
    expect(section).toHaveBeenCalledWith('fillet');
    await click('Move');
    expect(button('File').disabled).toBe(true);
    const sourceSelect = [...container.querySelectorAll('label')].find((label) => label.querySelector('span')?.textContent === 'Body')?.querySelector('select');
    expect(sourceSelect?.value).toBe('fillet');
    expect([...sourceSelect?.options ?? []].map((option) => option.value)).toEqual(['fillet']);
    await click('Apply');
    expect(currentDocument.features.at(-1)).toMatchObject({ kind: 'transform', sourceId: 'fillet' });
  });

  it('draws snapped geometry with the keyboard and guards the real shared session', async () => {
    await mount(); await startSketch();
    await canvasKey('Enter');
    expect(() => currentSession.assertWorkflowClosed()).toThrow('Finish or cancel');
    await canvasKey('ArrowRight', true); await canvasKey('ArrowUp', true); await canvasKey('Enter');
    const sketch = currentDocument.features[0];
    expect(sketch.kind === 'sketch' && sketch.graph?.points.map(point => point.position)).toEqual([[0, 0], [50, 0], [50, 50], [0, 50]]);
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  it('ignores right-button clicks and leaves browser zoom gestures to the browser', async () => {
    await mount(); await startSketch();
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]');
    if (!canvas) throw new Error('Sketch canvas missing.');
    const originalView = canvas.getAttribute('viewBox');
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent('click', { button: 2, bubbles: true, clientX: 200, clientY: 100 }));
      canvas.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: 100, bubbles: true }));
    });
    expect(currentSession.getSnapshot().workflowOpen).toBe(false);
    expect(canvas.getAttribute('viewBox')).toBe(originalView);
    expect(container.querySelector('.cad-sketch-vertex')).toBeNull();
  });

  it('focuses the safe delete action, traps keyboard focus and restores focus on Escape', async () => {
    await mount(); await startSketch(); await click('Finish sketch');
    const trigger = button('Delete selected feature or profile');
    await act(async () => trigger.focus()); await click('Delete selected feature or profile');
    const dialog = container.querySelector<HTMLDivElement>('[role="dialog"]');
    if (!dialog) throw new Error('Delete dialog missing.');
    const buttons = dialog.querySelectorAll('button');
    expect(window.document.activeElement).toBe(buttons[0]);
    await act(async () => { buttons[1].focus(); buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); });
    expect(window.document.activeElement).toBe(buttons[0]);
    await act(async () => buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(currentDocument.features).toHaveLength(1);
    expect(window.document.activeElement).toBe(trigger);
    expect(currentSession.getSnapshot().workflowOpen).toBe(false);
  });

  it('publishes stable viewport controls and applies fit/grid/profile selection without editing the draft', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(650);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
    await mount(); await startSketch();
    const controls = viewport();
    await canvasClick(300, 200);
    expect(() => controls.apply({ kind: 'fit' })).toThrow('Apply or cancel');
    await canvasClick(450, 100);
    expect(viewport()).toBe(controls);
    const version = currentSession.getSnapshot().version;
    await act(async () => controls.apply({ kind: 'fit' }));
    expect(controls.getState()).toMatchObject({ documentVersion: version, view: { mode: 'sketch', centerMm: [25, 20], heightSpanMm: 50 } });
    await act(async () => controls.apply({ kind: 'set-grid', visible: false }));
    expect(button('Toggle sketch grid').getAttribute('aria-pressed')).toBe('false');
    await act(async () => controls.apply({ kind: 'select-profile', profileId: null }));
    expect(controls.getState().selectedProfileId).toBeNull();
    expect(currentSession.getSnapshot().version).toBe(version);
    expect(Object.isFrozen(controls.getState().view)).toBe(true);
  });

  it('keeps the newly mounted sketch controls when the old solid renderer disposes later', async () => {
    await mount();
    expect(viewport().getState().view).toMatchObject({ mode: 'solid', available: true });
    await startSketch();
    const controls = viewport();
    expect(controls.getState().view).toMatchObject({ mode: 'sketch', available: true });
    const sketchId = currentDocument.features[0].id;
    await click('Finish sketch');
    expect(controls.getState().view).toMatchObject({ mode: 'solid', available: true });
    await act(async () => controls.apply({ kind: 'edit-sketch', sketchId }));
    expect(controls.getState().view).toMatchObject({ mode: 'sketch', available: true });
    expect(currentSession.getSnapshot().workflowOpen).toBe(false);
  });

  it('selects exact topology through keyboard-accessible rows and persists only verified geometric selectors', async () => {
    const resolve = vi.fn(resolveTopology);
    await mount(solidDocument(), { build: topologyBuild, buildState: 'ready', onInspectTopology: inspectTopology, onResolveSelection: resolve });
    await click('Select Pad 1 in history'); await click('Inspect topology'); await click('Browse edges'); await click('1. Straight edge50 mm');
    expect(viewport().getState().topologySelection?.picks).toEqual([{ kind: 'edge', key: 'edge-1' }]);
    expect(container.querySelector('.cad-topology-summary')?.textContent).toContain('Straight edge');
    await click('Fillet');
    expect(resolve).toHaveBeenCalledWith({ bodyId: 'pad', expectedBuildId: 'build-1', purpose: 'fillet', picks: [{ kind: 'edge', key: 'edge-1' }] }, currentSession.getSnapshot().version, expect.any(AbortSignal));
    expect(currentSession.getSnapshot().workflowOpen).toBe(true);
    expect(() => currentSession.assertWorkflowClosed()).toThrow('Finish or cancel');
    const scope = [...container.querySelectorAll('label')].find((label) => label.querySelector('span')?.textContent === 'Scope')?.querySelector('select');
    expect(scope?.value).toBe('selected');
    if (!scope) throw new Error('Scope control missing.');
    await act(async () => { scope.value = 'all'; scope.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(scope.value).toBe('all'); expect(scope.selectedOptions[0]?.textContent).toBe('All edges of the body');
    await act(async () => { scope.value = 'selected'; scope.dispatchEvent(new Event('change', { bubbles: true })); });
    await relation('Radius', '1 / 2'); await click('Apply');
    const feature = currentDocument.features.at(-1);
    expect(feature).toMatchObject({ kind: 'fillet', targetId: 'pad', radius: '1 / 2', selection: selectedEdgeQuery });
    expect(JSON.stringify(feature)).not.toContain('edge-1');
    expect(viewport().getState().topologySelection).toBeNull();
    expect(currentSession.getSnapshot().workflowOpen).toBe(false);
  });

  it('creates an inward shell from one planar face with an expression thickness', async () => {
    await mount(solidDocument(), { build: topologyBuild, buildState: 'ready', onInspectTopology: inspectTopology, onResolveSelection: resolveTopology });
    expect(button('Shell').disabled).toBe(true);
    await selectTopology('face');
    expect(button('Shell').disabled).toBe(false);
    expect(container.querySelector('.cad-topology-summary')?.textContent).toContain('Planar face');
    await click('Shell'); await relation('Wall thickness', '2 / 4'); await click('Apply');
    expect(currentDocument.features.at(-1)).toMatchObject({ kind: 'shell', targetId: 'pad', thickness: '2 / 4', opening: shellOpening });
    expect(currentSession.getSnapshot().workflowOpen).toBe(false);
  });

  it('aborts conversion on Cancel and ignores a late response after a newer operation starts', async () => {
    let finish: ((result: CadTopologyResolvePicksResult) => void) | undefined;
    let signal: AbortSignal | undefined;
    const resolve: NonNullable<CadWorkbenchProps['onResolveSelection']> = (_request, _version, abort) => { signal = abort; return new Promise((done) => { finish = done; }); };
    await mount(solidDocument(), { build: topologyBuild, buildState: 'ready', onInspectTopology: inspectTopology, onResolveSelection: resolve });
    await selectTopology('edge'); await click('Fillet');
    expect(currentSession.getSnapshot().workflowOpen).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Part name"]')?.disabled).toBe(true);
    await click('Cancel');
    expect(signal?.aborted).toBe(true); expect(currentSession.getSnapshot().workflowOpen).toBe(false);
    await click('Chamfer');
    await act(async () => finish?.({ bodyId: 'pad', buildId: 'build-1', purpose: 'fillet', selection: selectedEdgeQuery }));
    expect(container.querySelector('.cad-property-title')?.textContent).toBe('Create Chamfer');
    await click('Apply');
    expect(currentDocument.features.at(-1)?.kind).toBe('chamfer');
  });

  it('invalidates picks and pending conversion when the worker creates a new build of the same document', async () => {
    let finish: ((result: CadTopologyResolvePicksResult) => void) | undefined;
    let signal: AbortSignal | undefined;
    const resolve: NonNullable<CadWorkbenchProps['onResolveSelection']> = (_request, _version, abort) => { signal = abort; return new Promise((done) => { finish = done; }); };
    await mount(solidDocument(), { build: topologyBuild, buildState: 'ready', onInspectTopology: inspectTopology, onResolveSelection: resolve });
    await selectTopology('edge');
    const selected = viewport().getState().topologySelection;
    await click('Fillet');
    const version = currentSession.getSnapshot().version;
    await act(async () => replaceBuild({ ...topologyBuild, buildId: 'rebuilt-2' }));
    expect(signal?.aborted).toBe(true); expect(viewport().getState().topologySelection).toBeNull();
    expect(currentSession.getSnapshot().version).toBe(version);
    expect(currentSession.getSnapshot().workflowOpen).toBe(false);
    await act(async () => finish?.({ bodyId: 'pad', buildId: 'build-1', purpose: 'fillet', selection: selectedEdgeQuery }));
    expect(currentDocument.features).toHaveLength(2);
    expect(statusMessage).toHaveBeenCalledWith(expect.stringContaining('solid changed during selection conversion'), 'error');
    if (!selected) throw new Error('Topology selection missing.');
    expect(() => viewport().apply({ kind: 'select-topology', selection: { ...selected, picks: [...selected.picks] }, additive: false })).toThrow('solid build changed');
  });

  it('uses one live shell header, retains its input while editing and restores the shell on CAD exit', async () => {
    await mount(createCadDocument(), { build: null, buildState: 'idle' }, true);
    const header = container.querySelector('[data-app-header]');
    const name = header?.querySelector<HTMLInputElement>('[aria-label="Part name"]');
    if (!name) throw new Error('CAD header was not published into the shell.');
    expect(container.querySelectorAll('.cad-header')).toHaveLength(1);
    expect(header?.contains(button('Save'))).toBe(true);
    await input(name, 'Edited part');
    expect(header?.querySelector('[aria-label="Part name"]')).toBe(name);
    expect(button('Save').disabled).toBe(true);
    await act(async () => name.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(currentDocument.name).toBe('Edited part');
    expect(button('Save').disabled).toBe(false);
    await click('File'); expect(header?.contains(button('Import file'))).toBe(true);
    expect(header?.querySelector<HTMLInputElement>('input[type="file"]')?.accept.split(',')).toEqual(['.wireedm-cad', '.json', '.step', '.stp', '.stl', '.dxf']);
    await act(async () => removeCad());
    expect(header?.textContent).toBe('Workbench');
    expect(container.querySelector('main')).toBeNull();
  });

  it('draws nested closed profiles without role input and measures the automatic opening', async () => {
    await mount(); await startSketch(); await canvasClick(300, 200); await canvasClick(450, 100);
    await click('Circle'); await canvasClick(375, 150); await canvasClick(390, 150);
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Sketch missing.');
    expect(sketch.profiles.every((profile) => profile.role === undefined)).toBe(true);
    expect(sketch.profiles).toEqual([]);
    expect(sketch.graph?.entities).toHaveLength(5);
    const circle = sketch.graph?.entities[4];
    if (!circle || circle.kind !== 'circle' || typeof circle.radius !== 'number') throw new Error('Numeric circle missing.');
    expect(measureCadSketch(currentDocument, sketch.id).materialAreaMm2).toBeCloseTo(2000 - Math.PI * circle.radius * circle.radius, 5);
    await click('Finish sketch'); await click('File'); await click('Send sketch to CAM');
    expect(sendToCam).toHaveBeenCalledWith(sketch.id);
  });

  it('retains legacy material intent when adding a size constraint', async () => {
    const initial = solidDocument();
    await mount(initial);
    expect(currentDocument.features[0]).toMatchObject({ profiles: [{ role: 'outer' }] });
    await act(async () => { viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }); viewport().apply({ kind: 'select-profile', profileId: 'rectangle' }); });
    await click('Add dimension'); await input(dimensionValue(), '51'); await click('Apply');
    const sketch = currentDocument.features[0];
    expect(sketch.kind === 'sketch' && sketch.profiles[0]).toMatchObject({ role: 'outer', constraints: [{ kind: 'dimension', quantity: 'width' }], geometry: { width: 51 } });
    expect(initial.features[0]).toMatchObject({ profiles: [{ role: 'outer', geometry: { width: 50 } }] });
  });

  it('shows imported source metadata without exposing or editing original source contents', async () => {
    const source = { format: 'step', encoding: 'utf8', fileName: 'source.step', data: 'ISO-10303-21;\nEND-ISO-10303-21;' } satisfies Extract<CadDocument['features'][number], { kind: 'imported' }>['source'];
    const initial = applyCadEdits(createCadDocument(), [{ kind: 'add-feature', feature: { id: 'imported', kind: 'imported', name: 'Imported solid', suppressed: false, source } }]);
    await mount(initial); await click('Select Imported solid in history');
    expect(container.querySelector('.cad-topology-details')?.textContent).toContain('source.step');
    await act(async () => button('Select Imported solid in history').dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true })));
    const name = container.querySelector<HTMLInputElement>('input[aria-label="Feature name"]'); if (!name) throw new Error('Missing tree rename');
    await input(name, 'Renamed solid'); await click('Apply name');
    expect(currentDocument.features[0]).toMatchObject({ name: 'Renamed solid', source });
    expect(container.textContent).not.toContain('ISO-10303-21');
  });

  it('keeps CAD header commands when a previous editor cleans up its shell header', async () => {
    await mount(createCadDocument(), { build: null, buildState: 'idle' }, 'previous-header');
    expect(container.querySelector('[data-app-header]')?.textContent).toBe('Previous editor');
    await act(async () => showCad());
    expect(container.querySelectorAll('.cad-header')).toHaveLength(1);
    expect(container.querySelector('[data-app-header]')?.contains(button('File'))).toBe(true);
    await startSketch();
    expect(container.querySelector('[data-app-header]')?.contains(button('Save'))).toBe(true);
  });

  it('renders imported analytic line/arc paths, fits their exact bounds and preserves segment geometry on metadata edits', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(650);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
    const geometry = { kind: 'path', segments: [{ kind: 'line', start: [0, 0], end: [20, 0] }, { kind: 'arc', center: [10, 0], radius: 10, startAngle: 0, sweep: 180 }] } satisfies Extract<CadDocument['features'][number], { kind: 'sketch' }>['profiles'][number]['geometry'];
    const initial = applyCadEdits(createCadDocument(), [{ kind: 'add-feature', feature: { id: 'path-sketch', name: 'Imported sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [{ id: 'path-profile', name: 'Contour', construction: false, geometry }] } }]);
    await mount(initial);
    await act(async () => { viewport().apply({ kind: 'edit-sketch', sketchId: 'path-sketch' }); viewport().apply({ kind: 'select-profile', profileId: 'path-profile' }); });
    const profile = container.querySelector('[aria-label="Select Contour profile"]');
    expect(profile?.querySelectorAll('path')).toHaveLength(1);
    const boundary = profile?.querySelector('path')?.getAttribute('d');
    const line = boundary?.match(/^M ([^ ]+) ([^ ]+) L ([^ ]+) ([^ ]+) A 10 10 0 0 1 /);
    if (!line) throw new Error('Expected a line joined to an exact minor CCW radius-10 arc');
    expect(Number(line[3]) - Number(line[1])).toBe(20);
    expect(Number(line[4]) - Number(line[2])).toBe(0);
    expect(boundary?.endsWith(' Z')).toBe(true);
    await click('Fit sketch');
    const view = viewport().getState().view;
    if (view?.mode !== 'sketch') throw new Error('Sketch view missing.');
    expect(view.centerMm[0]).toBeCloseTo(10, 6); expect(view.centerMm[1]).toBeCloseTo(5, 6);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Path segment"]')?.value).toBe('1');
    expect(field('End X').value).toBe('20');
    await input(field('Name'), 'Renamed contour'); await click('Apply');
    const sketch = currentDocument.features[0];
    expect(sketch.kind === 'sketch' && sketch.profiles[0]).toMatchObject({ name: 'Renamed contour', geometry });
    expect(measureCadSketch(currentDocument, 'path-sketch').materialAreaMm2).toBeCloseTo(Math.PI * 50, 6);
  });
});
