import { circleRowPart, rowSketch } from '@/domain/cad/__tests__/cadSketchLinearPatternFixtures';
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
import { slotSketchProfile, slotSketchWidth, snapSketchPoint, twoPointSketchProfile } from './cadSketchInteraction';
import { CadSession } from './cadSession';
import { getCadPreferences, setCadPreferences } from './cadPreferences';
import { cadFeatureCandidateKey, type CadFeaturePreviewState } from './cadFeaturePreview';
import type { CadRenderedViewControls, CadWorkbenchViewportControls } from './cadViewportControls';
import type { CadViewportContextMenuRequest } from './CadViewport';
import type { CadFeatureRegionPickCommand } from './cadFeatureReferencePicking';
import type { CadExtrudeDepthControl } from './cadExtrudeDepthInteraction';
import type { CadSketchConstraintInspection } from './cadSketchConstraintInspection';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { useCadSketchEditing } from './useCadSketchEditing';
import { pairedBoreMirrorPart } from '@/domain/cad/__tests__/cadSketchMirrorFixtures';
import { cadSketchSourceAvailability, cadSketchSourceIssue } from '@/domain/cad/cadSketchSources';

let requestViewportMenu: ((request: CadViewportContextMenuRequest) => void) | undefined;
let pickViewportFeature: ((id: string | null) => void) | undefined;
let pickViewportPlane: ((plane: CadSketchPlane) => void) | undefined;
let viewportRegions: CadFeatureRegionPickCommand | null = null;
let viewportDepth: CadExtrudeDepthControl | null = null;
let workbenchRenders = 0;

// jsdom cannot create a WebGL context. These tests exercise the real UI and domain edits.
vi.mock('./CadViewport', async () => {
  const { useEffect } = await import('react');
  return { CadViewport: ({ hidden = false, onControlsReady, meshes = [], navigationLocked, onContextMenu, onSelect, onSelectPlane, sourceReferencePickIds, regionSelection, depthControl }: { hidden?: boolean; meshes?: CadBuildResult['meshes']; navigationLocked?: boolean; sourceReferencePickIds?: readonly string[]; regionSelection?: CadFeatureRegionPickCommand | null; depthControl?: CadExtrudeDepthControl | null; onSelect(id: string | null): void; onSelectPlane?(plane: CadSketchPlane): void; onContextMenu?(request: CadViewportContextMenuRequest): void; onControlsReady?(controls: CadRenderedViewControls | null, released?: CadRenderedViewControls): void }) => {
    // The workbench renders its viewport, hidden or not, every time it renders.
    workbenchRenders += 1;
    requestViewportMenu = onContextMenu;
    pickViewportFeature = onSelect;
    pickViewportPlane = onSelectPlane;
    viewportRegions = regionSelection ?? null;
    viewportDepth = depthControl ?? null;
    // Match WebGL's passive publication/disposal lifetime, while the real SVG
    // publishes in layout effects. Their order matters when changing modes.
    // Like the real view, a hidden viewport stays mounted but publishes no controls.
    useEffect(() => {
      if (hidden) return;
      const controls: CadRenderedViewControls = { getState: () => ({ mode: 'solid', available: true, view: 'Isometric', gridVisible: true, zoom: 1, revision: 0 }),
        fit: vi.fn(), setGrid: vi.fn(), setView: vi.fn(), capture: async () => { throw new Error('WebGL rasterization is unavailable in jsdom.'); } };
      onControlsReady?.(controls);
      return () => onControlsReady?.(null, controls);
    }, [onControlsReady, hidden]);
    if (hidden) return <div className="cad-viewport" hidden />;
    return <div aria-label="3D model viewport" data-displayed-volumes={meshes.map(mesh => mesh.volume).join(',')} data-navigation-locked={String(navigationLocked)} data-source-reference-pick-ids={sourceReferencePickIds?.join(',') ?? ''} />;
  } };
});

// The source checks keep their behavior; tests count how often the workbench runs them.
vi.mock('@/domain/cad/cadSketchSources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/cad/cadSketchSources')>();
  return { ...actual, cadSketchSourceAvailability: vi.fn(actual.cadSketchSourceAvailability), cadSketchSourceIssue: vi.fn(actual.cadSketchSourceIssue) };
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

async function mount(initial: CadDocument = createCadDocument(), buildProps: Pick<CadWorkbenchProps, 'build' | 'buildState'> & Partial<Pick<CadWorkbenchProps, 'onSectionForCam' | 'onInspectTopology' | 'onResolveSelection' | 'onRebuild' | 'featurePreview' | 'onFeaturePreview' | 'onEdit' | 'onEditMany' | 'onWorkflowChange' | 'onBeginSketchEdit' | 'sketchEdit'>> = { build: null, buildState: 'idle' }, inShell: boolean | 'previous-header' = false) {
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

/** The part name lives in the part's Properties, opened from the part row at the top of the tree. */
async function partName() {
  const field = () => container.querySelector<HTMLInputElement>('[aria-label="Part name"]');
  if (!field()) await act(async () => container.querySelector<HTMLButtonElement>('.cad-tree-document')?.click());
  const name = field(); if (!name) throw new Error('Part name missing.');
  return name;
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
/** Double-click the selected history row, which opens its sketch, curve or feature editor. */
async function openSelected() { await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }); }
/** Right-click a history row and run one of its menu commands. */
async function rowMenu(row: string, command: string) {
  await act(async () => button(`Select ${row} in history`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 })));
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(entry => entry.textContent?.trim() === command);
  if (!item) throw new Error(`Menu command "${command}" missing.`);
  await act(async () => item.click());
}
/** Right-click the Parameters branch and run one of its menu commands. */
async function parameterMenu(command: string) {
  const branch = [...document.querySelectorAll('button')].find(entry => /^(Expand|Collapse) Parameters$/.test(entry.getAttribute('aria-label') ?? ''));
  if (!branch) throw new Error('Parameters branch missing.');
  await act(async () => branch.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 })));
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(entry => entry.textContent?.trim() === command);
  if (!item) throw new Error(`Menu command "${command}" missing.`);
  await act(async () => item.click());
}
function property(label: string) {
  return [...container.querySelectorAll('.cad-properties-list > div')].find(row => row.querySelector('dt')?.textContent === label)?.querySelector('dd')?.textContent;
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
// Sketching is free by default; these flows draw on grid nodes.
async function snapToGrid() {
  const toggle = container.querySelector<HTMLInputElement>('input[aria-label="Snap to grid"]'); if (!toggle) throw new Error('Grid snap toggle missing.');
  await act(async () => toggle.click());
}
/** Sets Create relations, which starts on, to the state a flow needs. */
async function drawingRelations(enabled: boolean) {
  const toggle = container.querySelector<HTMLInputElement>('input[aria-label="Create relations"]'); if (!toggle) throw new Error('Relation drawing control missing.');
  if (toggle.checked !== enabled) await act(async () => toggle.click());
  expect(toggle.checked).toBe(enabled);
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
  it('copies an accepted consumed profile without opening its source, then releases its workflow before editing the new sketch', async () => {
    const source = solidDocument(), begin = vi.fn((id: string) => { currentSession.assertWorkflowClosed(); return id; });
    await mount(source, { build: null, buildState: 'idle', onBeginSketchEdit: begin });
    await click('Expand Pad 1'); await click('Expand Outline');
    const openCopy = async () => {
      await act(async () => button('Plate profile').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 })));
      const action = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === 'Copy outline to editable sketch');
      if (!action) throw new Error('Profile copy action missing.'); await act(async () => action.click());
    };
    await openCopy(); expect(currentDocument).toBe(source); expect(begin).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Sketch drawing canvas"]')).not.toBeNull();
    expect(button('Apply').disabled).toBe(false); await click('Cancel');
    expect(currentDocument).toBe(source); expect(viewport().getState().workflowOpen).toBe(false);
    await openCopy(); await click('Apply');
    expect(currentDocument.features.slice(0, source.features.length)).toEqual(source.features);
    const copy = currentDocument.features.at(-1); if (copy?.kind !== 'sketch' || !copy.graph) throw new Error('Copied sketch missing.');
    expect(copy.profiles).toEqual([]); expect(copy.graph.entities).toHaveLength(4);
    expect(begin).toHaveBeenCalledExactlyOnceWith(copy.id); expect(viewport().getState().workflowOpen).toBe(false);
    expect(viewport().getState().sketchId).toBe(copy.id);
  });
  it('keeps its mirror axis chooser alive through an owned keyboard menu without replacing the copied source selection', async () => {
    const source = pairedBoreMirrorPart(); await mount(source);
    await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'entity', id: 'bore' } }));
    await click('Mirror copy');
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]');
    const axis = container.querySelector<SVGGElement>('[data-cad-sketch-entity="axis"]');
    if (!canvas || !axis) throw new Error('Mirror axis canvas missing.');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
    await act(async () => { axis.focus(); axis.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })); });
    const choice = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === 'Use as mirror line');
    expect(choice).toBeDefined(); expect(viewport().getState().workflowOpen).toBe(true);
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: 'bore' }]); expect(currentDocument).toBe(source);
    await act(async () => choice?.click()); expect(button('Apply').disabled).toBe(false);
    await click('Apply');
    const accepted = currentDocument.features[0]; if (accepted.kind !== 'sketch' || !accepted.graph) throw new Error('Copied bore missing.');
    expect(accepted.graph.points.at(-1)?.position).toEqual([45, 15]);
    expect(accepted.graph.entities.at(-1)).toMatchObject({ kind: 'circle', radius: 3 });
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: accepted.graph.entities.at(-1)?.id }]);
    expect(viewport().getState().workflowOpen).toBe(false);
  });
  it('offsets the complete selected graph loop as one detached copy and selects its new geometry', async () => {
    const source = parseCadDocument({ ...createCadDocument('Plate', 'offset-plate'), schemaVersion: 2, features: [{
      id: 'sketch', kind: 'sketch', name: 'Plate', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
        points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [40, 0] }, { id: 'c', position: ['40.0000', '20.00'] }, { id: 'd', position: [0, 20] }],
        entities: ['ab', 'bc', 'cd', 'da'].map((id, index) => ({ id, kind: 'line', construction: false, startPointId: ['a', 'b', 'c', 'd'][index], endPointId: ['b', 'c', 'd', 'a'][index] })), relations: []
      }
    }] });
    await mount(source);
    await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    expect(button('Offset loop').disabled).toBe(true);
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'point', id: 'a' } }));
    expect(button('Offset loop').disabled).toBe(true);
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'entity', id: 'ab' } }));
    await click('Offset loop');
    expect(currentDocument).toBe(source); expect(viewport().getState().workflowOpen).toBe(true);
    await input(field('Offset distance'), '2'); await click('Inside');
    const sourceSketch = source.features[0]; if (sourceSketch.kind !== 'sketch' || !sourceSketch.graph) throw new Error('Plate missing.');
    for (const entity of sourceSketch.graph.entities) expect(container.querySelector(`[data-cad-sketch-entity="${entity.id}"]`)?.classList.contains('is-relation-highlighted')).toBe(true);
    expect(currentDocument).toBe(source); await click('Apply');
    const accepted = currentDocument.features[0]; if (accepted.kind !== 'sketch' || !accepted.graph) throw new Error('Offset missing.');
    expect(accepted.graph.points.slice(0, 4)).toEqual(sourceSketch.graph.points);
    expect(accepted.graph.points.slice(4).map(point => point.position)).toEqual([[2, 2], [38, 2], [38, 18], [2, 18]]);
    expect(accepted.graph.entities).toHaveLength(8);
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: accepted.graph.entities[4].id }]);
    expect(viewport().getState().workflowOpen).toBe(false);
  });

  it('opens the same offset editor for a legacy profile, cancels its preview, then accepts a detached graph copy', async () => {
    const source = parseCadDocument({ ...createCadDocument(), features: [{ id: 'sketch', kind: 'sketch', name: 'Bore', plane: 'XY', offset: 0, suppressed: false,
      profiles: [{ id: 'bore', name: 'Bore', construction: false, geometry: { kind: 'circle', x: ' 0 ', y: '0.0', radius: '10.000' } }] }] });
    await mount(source); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    await act(async () => viewport().apply({ kind: 'select-profile', profileId: 'bore' })); await click('Offset loop');
    expect(viewport().getState().workflowOpen).toBe(true);
    expect(button('Rectangle').disabled).toBe(true); expect(button('Finish sketch').disabled).toBe(true);
    expect(container.querySelectorAll('[data-cad-sketch-entity]')).toHaveLength(1);
    await input(field('Offset distance'), '2'); expect(currentDocument).toBe(source);
    expect(container.querySelector('[data-cad-sketch-entity] circle')?.getAttribute('r')).toBe('12');
    await click('Cancel'); expect(currentDocument).toBe(source); expect(viewport().getState().selectedProfileId).toBe('bore');
    expect(viewport().getState().workflowOpen).toBe(false); await click('Offset loop');
    await input(field('Offset distance'), '2'); await click('Apply');
    const accepted = currentDocument.features[0]; if (accepted.kind !== 'sketch' || !accepted.graph) throw new Error('Offset missing.');
    expect(accepted.profiles).toEqual(source.features[0].kind === 'sketch' ? source.features[0].profiles : []);
    expect(accepted.graph.entities[0]).toMatchObject({ kind: 'circle', radius: 12 });
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: accepted.graph.entities[0].id }]);
    expect(viewport().getState().selectedProfileId).toBeNull(); expect(viewport().getState().workflowOpen).toBe(false);
  });
  it('selects the accepted Split joint in the real owned sketch workspace after private publication', async () => {
    const initial = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Outline',
      suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'c', position: [20, 10] }, { id: 'd', position: [0, 10] }],
        entities: ['a', 'b', 'c', 'd'].map((id, index) => ({ id: `${id}-edge`, kind: 'line', construction: false, startPointId: id, endPointId: ['b', 'c', 'd', 'a'][index] })), relations: []
      } }, { id: 'pad', kind: 'extrude', name: 'Pad', suppressed: false, sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null }] });
    const main = new CadSession(initial), base = main.getSnapshot(), storage = {};
    function Harness() {
      useSyncExternalStore(main.subscribe, main.getSnapshot);
      const editing = useCadSketchEditing({ session: main, storage, open: true, locked: false,
        prepare: async (document, edits, signal) => { await Promise.resolve(); signal?.throwIfAborted(); return applyCadEdits(document, edits); },
        inspect: async () => undefined, commit: (edits, version, signal) => main.editPrepared(version, async document => applyCadEdits(document, edits), signal) });
      const snapshot = editing.snapshot; currentDocument = snapshot.document;
      return <CadWorkbench document={snapshot.document} documentVersion={snapshot.version} build={null} buildVersion={null} buildState="idle" dirty={snapshot.dirty}
        canUndo={snapshot.canUndo} canRedo={snapshot.canRedo} onEdit={(edit, signal) => editing.sketchId ? editing.edit([edit], signal) : main.edit([edit])}
        onEditMany={(edits, signal) => editing.sketchId ? editing.edit(edits, signal) : main.edit(edits)} onBeginSketchEdit={editing.begin}
        sketchEdit={editing.sketchId ? { sketchId: editing.sketchId, finish: editing.finish, cancel: editing.cancel, inspectAreaRepairs: editing.inspectAreaRepairs } : undefined}
        onWorkflowChange={editing.setWorkflowOpen} onUndo={editing.undo} onRedo={editing.redo} onSave={save} onBack={vi.fn()} onSendToCam={sendToCam}
        onOpenDocument={vi.fn()} onNewDocument={vi.fn()} onImportDocument={async () => undefined} onExportDocument={vi.fn()}
        onExportSolid={async () => undefined} onOpenDxfExport={async () => undefined} onViewportControlsReady={controls => { currentViewport = controls; }} />;
    }
    await act(async () => root.render(<Harness />));
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'sketch' })); await openSelected();
    expect(currentDocument.features).toHaveLength(1); expect(main.getSnapshot().document).toBe(base.document);
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]'); if (!canvas) throw new Error('Sketch canvas missing.');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
    let captured = false;
    Object.assign(canvas, { setPointerCapture: () => { captured = true; }, hasPointerCapture: () => captured, releasePointerCapture: () => { captured = false; } });
    const state = viewport().getState().view; if (!state || state.mode === 'solid') throw new Error('Sketch frame missing.');
    const viewWidth = Number(canvas.getAttribute('viewBox')?.split(' ')[2]);
    const pointer = async (type: string) => {
      const event = new MouseEvent(type, { button: 2, buttons: type === 'pointerup' ? 0 : 2, bubbles: true, cancelable: true,
        clientX: 300 + (5 - state.centerMm[0]) / viewWidth * 600, clientY: 200 + state.centerMm[1] / state.heightSpanMm * 400 });
      Object.defineProperties(event, { pointerId: { value: 11 }, isPrimary: { value: true } });
      await act(async () => canvas.dispatchEvent(event));
    };
    await pointer('pointerdown'); await pointer('pointerup');
    const id = container.querySelector('[data-cad-sketch-split-point]')?.getAttribute('data-cad-sketch-split-point'); if (!id) throw new Error('Split preview missing.');
    await click('Split here');
    const localDocument = currentDocument, accepted = localDocument.features[0]; if (accepted.kind !== 'sketch') throw new Error('Accepted sketch missing.');
    expect(accepted.graph?.entities).toHaveLength(5);
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'point', id }]);
    expect(container.querySelector(`[data-cad-sketch-point="${id}"]`)?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Move selection').disabled).toBe(false); expect(main.getSnapshot().document).toBe(base.document);
    expect(currentDocument).toBe(localDocument); expect(viewport().getState().workflowOpen).toBe(false);
    expect(main.getSnapshot().document).toBe(base.document);
  });

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
      inspectAreaRepairs: () => ({ sketchId: edited.id, localVersion: currentSession.getSnapshot().version,
        consumers: [{ feature: staleConsumer, issue: 'The selected boundary changed.', cells }] }) } });
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
    await rowMenu('Pad 1', 'Suppress feature');
    expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version, workflowOpen: false, canUndo: false });
    expect(workflow).toHaveBeenLastCalledWith(false);
    expect(currentDocument.features.find(feature => feature.id === 'pad')?.suppressed).toBe(false);
  });
  it('retains actual name-edit ownership after a synchronous command rejection', async () => {
    const onWorkflowChange = (open: boolean) => { workflow(open); currentSession.setWorkflowOpen(open); };
    await mount(solidDocument(), { build: null, buildState: 'idle', onWorkflowChange });
    const before = currentSession.getSnapshot(), name = await partName();
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
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' })); await rowMenu('Thin Pad', 'Properties');
    expect(property('Volume')).toBe(`${volume.toLocaleString(undefined, { notation: 'scientific', maximumSignificantDigits: 6, useGrouping: false })} mm³`);
    expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version, workflowOpen: false }); expect(viewport().getState().selectedFeatureId).toBe('pad'); expect(build.meshes[0].volume).toBe(volume);
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
    const before = currentSession.getSnapshot(); await rowMenu('Pad 1', 'Properties');
    expect(property('Volume')).toBe('20,000 mm³');
    expect(property('Solids')).toBe('2');
    await act(async () => replaceBuild(topologyBuild));
    expect(property('Solids')).toBeUndefined();
    const unknown = container.querySelector('.cad-properties-list');
    expect(unknown?.textContent).toContain('20,000 mm³');
    expect(unknown?.textContent).not.toMatch(/\d+ solids?/);
    expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: before.canUndo });
  });
  it('previews a sketch fillet without accepting the draft', async () => {
    await mount(solidDocument()); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' })); await click('Plate profile');
    const before = currentSession.getSnapshot(); await click('Sketch fillet');
    const radius = container.querySelector<HTMLInputElement>('input[aria-label="Fillet radius"]'); if (!radius) throw new Error('Missing radius');
    await input(radius, '5');
    expect(currentSession.getSnapshot().document).toBe(before.document); expect(currentSession.getSnapshot().version).toBe(before.version);
    await click('Cancel'); expect(currentSession.getSnapshot().document).toBe(before.document);
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
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' })); await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
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
    setCadPreferences({ navigationMode: 'trackpad', showOnPartDimensions: false, showDepthHandles: false });
    const initial = solidDocument(); await mount(initial, { build: topologyBuild, buildState: 'ready' });
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' })); await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(viewportDepth).toBeNull();
    await act(async () => setCadPreferences({ navigationMode: 'trackpad', showOnPartDimensions: false }));
    const previous = viewportDepth;
    if (!previous) throw new Error('Depth handles are shown unless the device turned them off.');
    await click('Pick closed areas from model'); expect(viewportDepth).toBeNull();
    await click('Cancel area selection'); expect(viewportDepth).toBe(previous);
    await act(async () => setCadPreferences({ navigationMode: 'trackpad', showOnPartDimensions: false, showDepthHandles: false }));
    expect(viewportDepth).toBeNull(); expect(currentDocument).toBe(initial);
    await act(async () => replaceDocument({ ...initial, name: 'Another accepted part' }));
    expect(previous.getState()).toBeNull(); expect(viewportDepth).toBeNull(); expect(currentDocument.name).toBe('Another accepted part');
  });

  it('drags a selected Pad or its picked end face into one undoable Length edit without a dialog', async () => {
    setCadPreferences({ navigationMode: 'mouse', showOnPartDimensions: true });
    const initial = solidDocument(), preview = vi.fn<NonNullable<CadWorkbenchProps['onFeaturePreview']>>();
    await mount(initial, { build: topologyBuild, buildState: 'ready', onFeaturePreview: preview });
    await selectTopology('edge'); expect(viewportDepth).toBeNull();
    await selectTopology('face');
    const control = viewportDepth; if (!control) throw new Error('A picked end face must expose its Pad depth.');
    expect(control.featureId).toBe('pad'); expect(container.querySelector('[aria-label="Length"]')).toBeNull();
    const token = control.begin(control.getState()?.definitionKey ?? ''); if (!token) throw new Error('Expected a drag.');
    expect(currentSession.getSnapshot().workflowOpen).toBe(false);
    await act(async () => { control.setQuantity(token, 25); });
    expect(currentSession.getSnapshot().workflowOpen).toBe(true); expect(currentDocument).toBe(initial);
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'candidate', owner: control.owner }));
    await act(async () => { control.release(token); });
    expect(currentDocument.features[1]).toEqual({ ...initial.features[1], distance: 25 });
    expect(currentSession.getSnapshot()).toMatchObject({ canUndo: true, workflowOpen: false });
    expect(preview).toHaveBeenLastCalledWith({ kind: 'clear', owner: control.owner });
    expect(viewportDepth?.featureId).toBe('pad'); expect(viewportDepth).not.toBe(control);
    await act(async () => currentSession.undo()); expect(currentDocument).toEqual(initial);
  });

  it('keeps the correlated quantity preview while choosing areas and cancels only that choice before one Apply/Undo', async () => {
    const original = solidDocument();
    const initial = applyCadEdits(original, [{ kind: 'set-parameter', name: 'depth', value: 10 },
      { kind: 'update-feature', feature: { ...original.features[1], kind: 'extrude', sketchId: 'sketch', distance: ' depth ', symmetric: false, operation: 'new', targetId: null } }]);
    const preview = vi.fn<NonNullable<CadWorkbenchProps['onFeaturePreview']>>();
    await mount(initial, { build: topologyBuild, buildState: 'ready', onFeaturePreview: preview });
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' })); await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
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
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' })); await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    await click('Pick closed areas from model'); const command = viewportRegions;
    if (!command) throw new Error('Missing source-owned areas.');
    const before = currentSession.getSnapshot();
    await act(async () => replaceBuild({ ...topologyBuild, buildId: 'republished-native-build' }));
    expect(viewportRegions).toBe(command); expect(currentDocument).toBe(initial);
    expect(currentSession.getSnapshot()).toMatchObject({ version: before.version, workflowOpen: true });
    await act(async () => command.onSelect(command.cells.pack(command.cells.selectedCellIds(undefined))));
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
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' })); await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
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

  it('checks Pad, Revolve and Sweep sources again only for a new document in the model toolbar, and not while a sketch is open', async () => {
    const material = solidDocument().features[0]; if (material.kind !== 'sketch') throw new Error('Expected material sketch.');
    const sourceChecks = () => vi.mocked(cadSketchSourceAvailability).mock.calls.length + vi.mocked(cadSketchSourceIssue).mock.calls.length;
    const clearSourceChecks = () => { vi.mocked(cadSketchSourceAvailability).mockClear(); vi.mocked(cadSketchSourceIssue).mockClear(); };
    const enabled = () => ['Pad / Pocket', 'Revolve', 'Sweep'].map(label => !button(label).disabled);
    await mount({ ...createCadDocument('Source checks'), features: [material,
      { id: 'rail', name: 'Rail', kind: 'curve', suppressed: false, plane: 'XZ', offset: 0, segments: [{ kind: 'line', start: [0, 0], end: [0, 20] }] }] });
    expect(enabled()).toEqual([true, true, true]);
    // Selecting renders the workbench again for the same document.
    clearSourceChecks();
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: material.id }));
    expect(enabled()).toEqual([true, true, true]); expect(sourceChecks()).toBe(0);
    await act(async () => currentSession.edit([{ kind: 'update-feature', feature: { ...material, suppressed: true } }]));
    expect(enabled()).toEqual([false, false, false]);
    await act(async () => currentSession.edit([{ kind: 'update-feature', feature: material }]));
    expect(enabled()).toEqual([true, true, true]);
    clearSourceChecks();
    await act(async () => currentSession.edit([{ kind: 'set-parameter', name: 'width', value: 5 }]));
    expect(sourceChecks()).toBeGreaterThan(0);
    await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: material.id }));
    expect(button('Finish sketch')).toBeDefined();
    clearSourceChecks();
    await act(async () => currentSession.edit([{ kind: 'update-feature', feature: { ...material, suppressed: true } }]));
    expect(sourceChecks()).toBe(0);
    await act(async () => currentSession.edit([{ kind: 'update-feature', feature: material }]));
    await click('Finish sketch');
    expect(enabled()).toEqual([true, true, true]);
  });

  it('lists transitive dependents in history order only while the delete dialog is open, and deletes them together', async () => {
    const solid = solidDocument(), material = solid.features[0]; if (material.kind !== 'sketch') throw new Error('Expected material sketch.');
    await mount(applyCadEdits(solid, [
      { kind: 'add-feature', feature: { ...material, id: 'boss_sketch', name: 'Boss sketch', offset: 10 } },
      { kind: 'add-feature', feature: { id: 'boss', name: 'Boss', kind: 'extrude', suppressed: false, sketchId: 'boss_sketch', distance: 5, symmetric: false, operation: 'join', targetId: 'pad' } },
    ]));
    const pressDelete = async (featureId: string) => {
      await act(async () => viewport().apply({ kind: 'select-feature', featureId }));
      const row = container.querySelector<HTMLButtonElement>('.cad-tree-row[aria-pressed="true"]'); if (!row) throw new Error('Selected history row missing.');
      await act(async () => { row.focus(); row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })); });
      const dialog = container.querySelector<HTMLDivElement>('[role="dialog"]'); if (!dialog) throw new Error('Delete dialog missing.');
      return dialog;
    };
    const outline = await pressDelete('sketch');
    expect(outline.textContent).toContain('This also deletes 2 dependent features.');
    expect([...outline.querySelectorAll('li')].map(item => item.textContent)).toEqual(['Pad 1', 'Boss']);
    await click('Delete with dependents');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(currentSession.getSnapshot().document.features.map(feature => feature.id)).toEqual(['boss_sketch']);
    const boss = await pressDelete('boss_sketch');
    expect(boss.querySelector('li')).toBeNull(); expect(boss.textContent).toContain('You can restore this feature with Undo.');
    await click('Delete');
    expect(currentSession.getSnapshot().document.features).toEqual([]);
  });

  it('renders the workbench again for sketch freedom only when the shown value changes', async () => {
    const source = parseCadDocument({ ...createCadDocument('Plate', 'freedom-plate'), schemaVersion: 2, features: [{
      id: 'sketch', kind: 'sketch', name: 'Plate', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
        points: [{ id: 'center', position: [0, 0] }], entities: [{ id: 'bore', kind: 'circle', centerPointId: 'center', radius: 5, construction: false }], relations: [] } }] });
    const session = new CadSession(source); currentSession = session;
    const answers: { version?: string; resolve(degreesOfFreedom: number): void }[] = [];
    const inspect = vi.fn((sketchId: string, version?: string) => new Promise<CadSketchConstraintInspection>(resolve => answers.push({ version, resolve: degreesOfFreedom => resolve({
      sketchId, pointCount: 1, entityCount: 1, relationCount: 0, legacyProfileCount: 0, legacyDimensionCount: 0, degreesOfFreedomScope: 'graph', graph: null, parameters: {},
      analysis: { kind: 'solved', diagnostics: { status: 'success', degreesOfFreedom, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] } } }) })));
    let setReady: (ready: boolean) => void = () => undefined;
    function Harness() {
      const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
      const [ready, setReadyState] = useState(true); setReady = setReadyState; currentDocument = snapshot.document;
      return <CadWorkbench document={snapshot.document} documentVersion={snapshot.version} build={null} buildVersion={null} buildState="idle" dirty={snapshot.dirty}
        canUndo={snapshot.canUndo} canRedo={snapshot.canRedo} onEdit={edit => { session.edit([edit]); }} onEditMany={edits => session.edit(edits)}
        sketchAnalysisReady={ready} onInspectSketchConstraints={inspect} onWorkflowChange={open => session.setWorkflowOpen(open)} onUndo={undo} onRedo={vi.fn()}
        onSave={save} onBack={vi.fn()} onSendToCam={sendToCam} onOpenDocument={vi.fn()} onNewDocument={vi.fn()} onImportDocument={async () => undefined}
        onExportDocument={vi.fn()} onExportSolid={async () => undefined} onOpenDxfExport={async () => undefined} onViewportControlsReady={controls => { currentViewport = controls; }} />;
    }
    await act(async () => root.render(<Harness />));
    await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'entity', id: 'bore' } }));
    const status = () => container.querySelector('[aria-label="Sketch constraint status"]')?.textContent;
    const radiusLocked = () => container.querySelector('[data-cad-sketch-circle-radius="bore"]')?.getAttribute('aria-disabled') === 'true';
    const renders = async (change: () => void) => { workbenchRenders = 0; await act(async () => change()); return workbenchRenders; };
    expect(answers.map(answer => answer.version)).toEqual([session.getSnapshot().version]);
    expect(await renders(() => answers[0].resolve(0))).toBe(1);
    expect(status()).toBe('Fully constrained'); expect(radiusLocked()).toBe(true);

    // A new document hides the earlier freedom without another render.
    const moved = currentDocument.features[0]; if (moved.kind !== 'sketch' || !moved.graph) throw new Error('Sketch graph missing.');
    const move: CadEdit = { kind: 'update-feature', feature: { ...moved, graph: { ...moved.graph, points: [{ id: 'center', position: [1, 0] }] } } };
    expect(await renders(() => session.edit([move]))).toBe(1);
    expect(status()).toBe('Checking freedom…'); expect(radiusLocked()).toBe(false);
    expect(answers.map(answer => answer.version)).toEqual([expect.any(String), session.getSnapshot().version]);
    // Pausing and resuming the analysis reports no freedom again, which keeps the state.
    expect(await renders(() => setReady(false))).toBe(1); expect(status()).toBe('Editing…');
    expect(await renders(() => setReady(true))).toBe(1); expect(status()).toBe('Checking freedom…');
    expect(answers).toHaveLength(3); expect(answers[2].version).toBe(session.getSnapshot().version);
    expect(await renders(() => answers[2].resolve(0))).toBe(1);
    expect(status()).toBe('Fully constrained'); expect(radiusLocked()).toBe(true);
    expect(await renders(() => answers[1].resolve(4))).toBe(0); expect(radiusLocked()).toBe(true);
    // A pause hides the answer and resuming shows it again, each a render after the status reports it. The same answer
    // from the new analysis keeps it.
    expect(await renders(() => setReady(false))).toBe(2); expect(status()).toBe('Editing…'); expect(radiusLocked()).toBe(false);
    expect(await renders(() => setReady(true))).toBe(2); expect(status()).toBe('Fully constrained'); expect(radiusLocked()).toBe(true);
    expect(answers).toHaveLength(4);
    expect(await renders(() => answers[3].resolve(0))).toBe(0); expect(radiusLocked()).toBe(true);
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
    await click('Through pocket'); await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
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
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' })); await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
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
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'move' })); await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
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
    await click('Move / rotate');
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
    await click('Pad 1'); const before = currentSession.getSnapshot(); await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
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
    const pendingKind = 'waiting' as const, pendingPreview = { kind: pendingKind, owner: command.owner, featureId: 'pad', baseVersion: before.version, candidateId: 'candidate_2', definitionKey: cadFeatureCandidateKey(nextCommand.edits), lastValid: ready };
    await act(async () => replaceFeaturePreview(pendingPreview));
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-displayed-volumes')).toBe('40000');
    expect(button('Apply').disabled).toBe(true); expect(currentSession.getSnapshot().document).toBe(before.document);
    await click('Cancel');
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-displayed-volumes')).toBe('20000');
    expect(currentSession.getSnapshot()).toEqual(before);
    // Cancel closes the editor and keeps the feature selected; reopening starts from the accepted value.
    expect(container.querySelector('[aria-label="Close feature editor"]')).toBeNull(); await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
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
    const name = await partName();
    await act(async () => name.focus()); await input(name, 'Discard this rename'); expect(currentSession.getSnapshot().workflowOpen).toBe(true);
    await act(async () => name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(name.value).toBe('Reviewed part'); expect(document.activeElement).toBe(name);
    expect(currentSession.getSnapshot()).toEqual(before); expect(currentDocument).toBe(before.document);
    await act(async () => name.blur());
    expect(currentSession.getSnapshot()).toEqual(before); expect(currentSession.getSnapshot().workflowOpen).toBe(false);
  });
  it('keeps the part-name field editable while drafting and restores a rejected draft when Properties closes', async () => {
    await mount(solidDocument()); const before = currentSession.getSnapshot();
    const name = await partName();
    await act(async () => name.focus()); await input(name, '   ');
    expect(name.matches(':disabled')).toBe(false); expect(document.activeElement).toBe(name);
    await act(async () => name.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(currentDocument).toBe(before.document); expect(name.matches(':disabled')).toBe(false);
    await click('Close properties');
    expect(container.querySelector('[aria-label="Part name"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('.cad-tree-document')?.disabled).toBe(false);
    expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version, workflowOpen: false });
    expect((await partName()).value).toBe(before.document.name);
  });
  it('leaves composing Enter and Escape to the part-name input method', async () => {
    await mount(solidDocument()); const before = currentSession.getSnapshot();
    const name = await partName();
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
    await click('Collapse Body'); await click('Expand Body');
    await act(async () => controls.apply({ kind: 'select-feature', featureId: 'pad' })); await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    await click('Minimize configuration'); await click('Expand configuration');
    expect(field('Length').value).toBe('10'); expect(container.querySelector('[aria-label="3D model viewport"]')).toBe(canvas);
    expect(viewport()).toBe(controls); expect(currentSession.getSnapshot()).toBe(before);
  });

  it('switches sketch tools from single-letter shortcuts through the visible guarded tools', async () => {
    const original = solidDocument(); await mount({ ...original, features: [original.features[0]] });
    await act(async () => { viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }); });
    const press = (key: string, init: KeyboardEventInit = {}) => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })); });
    await press('c'); expect(button('Circle').getAttribute('aria-pressed')).toBe('true');
    await press('R'); expect(button('Rectangle').getAttribute('aria-pressed')).toBe('true');
    expect(button('Rectangle').getAttribute('aria-keyshortcuts')).toBe('R');
    await press('c', { ctrlKey: true }); expect(button('Rectangle').getAttribute('aria-pressed')).toBe('true');
    await press('m'); expect(button('Mirror copy').disabled).toBe(true); expect(button('Rectangle').getAttribute('aria-pressed')).toBe('true');
    await press('t'); expect(button('Trim').disabled).toBe(true); expect(button('Rectangle').getAttribute('aria-pressed')).toBe('true');
    await press('s'); expect(button('Select').getAttribute('aria-pressed')).toBe('true');
    for (const [key, label] of [['l', 'Line'], ['a', 'Arc'], ['p', 'Polyline'], ['o', 'Slot']] as const) {
      await press(key); expect(button(label).getAttribute('aria-pressed')).toBe('true');
      expect(button(label).getAttribute('aria-keyshortcuts')).toBe(key.toUpperCase());
    }
    const drawingTools = [...container.querySelectorAll('.cad-command-primary-tools button')].map(entry => entry.getAttribute('aria-label'));
    expect(drawingTools.slice(drawingTools.indexOf('Select'), drawingTools.indexOf('Select') + 7)).toEqual(['Select', 'Line', 'Arc', 'Polyline', 'Rectangle', 'Circle', 'Slot']);
    expect(drawingTools).not.toContain('Path');
  });

  it('enters Trim from T on a connected sketch and Escape returns to Select without editing', async () => {
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Lines',
      suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: { points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }],
        entities: [{ id: 'ab', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }], relations: [] } }] });
    await mount(source); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    const press = (key: string) => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
    expect(button('Trim').getAttribute('aria-keyshortcuts')).toBe('T');
    await press('t'); expect(button('Trim').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.cad-sketch-canvas')?.classList.contains('is-trimming')).toBe(true);
    await press('Escape'); expect(button('Select').getAttribute('aria-pressed')).toBe('true'); expect(currentDocument).toBe(source);
  });

  it('selects history rows on click, opens the editor on double-click and closes it with Escape after discarding a draft', async () => {
    await mount(solidDocument()); const before = currentSession.getSnapshot();
    const row = button('Select Pad 1 in history'), escape = () => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    await click('Select Pad 1 in history');
    expect(row.getAttribute('aria-pressed')).toBe('true'); expect([...container.querySelectorAll('label')].some(label => label.querySelector('span')?.childNodes[0]?.textContent === 'Length')).toBe(false);
    await act(async () => { row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    await input(field('Length'), '25');
    await escape(); expect(field('Length').value).toBe('10');
    await escape(); expect(container.querySelector('[aria-label="Close feature editor"]')).toBeNull();
    expect(row.getAttribute('aria-pressed')).toBe('true'); expect(currentSession.getSnapshot()).toEqual(before);
    await act(async () => { row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }); await click('Close feature editor');
    expect(container.querySelector('[aria-label="Close feature editor"]')).toBeNull(); expect(row.getAttribute('aria-pressed')).toBe('true');
  });

  it('retains pending edits and blocks tree branch changes until cancellation', async () => {
    await mount(solidDocument()); await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' })); await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    const before = currentSession.getSnapshot(); const length = field('Length');
    await act(async () => length.focus()); await input(length, '25');
    expect(button('Collapse Body').disabled).toBe(true); expect(button('Expand Parameters').disabled).toBe(true);
    expect(field('Length')).toBe(length); expect(length.value).toBe('25');
    await click('Cancel'); expect(container.querySelector('.cad-tree-row[aria-pressed="true"]')?.textContent).toContain('Pad 1');
    await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }); expect(field('Length').value).toBe('10');
    expect(button('Collapse Body').disabled).toBe(false); expect(currentSession.getSnapshot()).toEqual(before);
  });

  it('reclaims empty property space and restores the editor on selection without changing geometry or history', async () => {
    await mount(solidDocument(), { build: topologyBuild, buildState: 'ready' });
    const before = currentDocument; const version = currentSession.getSnapshot().version; const controls = viewport();
    expect(container.querySelector('[aria-label="Feature properties"]')).toBeNull();
    expect(container.querySelector('.cad-center')?.contains(container.querySelector('[data-cad-model-tree]'))).toBe(true);
    await act(async () => controls.apply({ kind: 'select-feature', featureId: 'pad' })); await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
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
  });

  it('measures a slot width across its center axis and keeps legacy slots centered between both arc centers', () => {
    expect(slotSketchWidth([0, 0], [20, 0], [5, 3])).toBe(6); expect(slotSketchWidth([0, 0], [20, 0], [-40, -3])).toBe(6);
    expect(slotSketchWidth([0, 0], [0, 20], [4, 50])).toBe(8);
    expect(slotSketchProfile([0, 0], [0, 20], 10)).toEqual({ kind: 'slot', x: 0, y: 10, length: 30, width: 10, angle: 90 });
    expect(() => slotSketchWidth([3, 4], [3, 4], [10, 10])).toThrow('different point');
    expect(() => slotSketchProfile([0, 0], [20, 0], 0)).toThrow('Move away');
    expect(() => slotSketchProfile([0, 0], [20, 0], Number.NaN)).toThrow('Move away');
  });

  it('snaps both signs and preserves precision when snapping is disabled', () => {
    expect(snapSketchPoint([-12, 18], 5, true)).toEqual([-10, 20]);
    expect(snapSketchPoint([1.125, -2.375], 5, false)).toEqual([1.125, -2.375]);
    expect(() => snapSketchPoint([1, 1], 0, true)).toThrow('positive');
  });

  it('keeps the open sketch plane offset editable while nothing in it is selected', async () => {
    await mount(); await startSketch();
    await input(field('Plane offset'), '3'); await click('Apply');
    expect(currentDocument.features[0]).toMatchObject({ kind: 'sketch', plane: 'XY', offset: 3 });
  });

  it('hides the sketch plane fields while geometry in the open sketch is selected', async () => {
    const source = parseCadDocument({ ...createCadDocument('Plane fields'), schemaVersion: 2, features: [{
      id: 'sketch', kind: 'sketch', name: 'Plane fields', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'center', position: [0, 0] }], entities: [{ id: 'circle', kind: 'circle', construction: false, centerPointId: 'center', radius: 3 }], relations: []
      }
    }] });
    await mount(source); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    expect(field('Plane offset')).toBeTruthy();
    const center = container.querySelector('[data-cad-sketch-point="center"]'); if (!center) throw new Error('Center missing.');
    await act(async () => center.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'point', id: 'center' }]);
    expect(() => field('Plane offset')).toThrow('missing');
    // Selection alone leaves relations closed; the geometry context menu opens them.
    expect(container.querySelector('form[aria-label="Sketch relations"]')).toBeNull();
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]'); if (!canvas) throw new Error('Canvas missing.');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
    await act(async () => { (center as SVGGElement).focus(); center.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })); });
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(entry => entry.textContent === 'Constraints and dimensions'); if (!item) throw new Error('Missing Constraints and dimensions.');
    await act(async () => item.click());
    expect(container.querySelector('form[aria-label="Sketch relations"]')).not.toBeNull();
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: null }));
    expect(field('Plane offset')).toBeTruthy();
  });

  it('creates a real sketch, commits a drawn rectangle and sends that exact sketch to CAM', async () => {
    await mount();
    await click('Sketch');
    expect(workflow).toHaveBeenLastCalledWith(true);
    expect(button('Save').disabled).toBe(true);
    await act(async () => pickViewportPlane?.('XY')); await snapToGrid();
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
    // The corner drawn on the origin stays fixed there, because Create relations starts on.
    expect(sketch.graph?.relations.map(relation => relation.kind)).toEqual(['horizontal', 'vertical', 'horizontal', 'vertical', 'fixed-axis', 'fixed-axis']);
    expect(sketch.graph?.relations.slice(4)).toEqual([{ id: expect.any(String), kind: 'fixed-axis', pointId: sketch.graph?.points[0].id, axis: 'x', value: 0 },
      { id: expect.any(String), kind: 'fixed-axis', pointId: sketch.graph?.points[0].id, axis: 'y', value: 0 }]);
    expect(currentDocument.schemaVersion).toBe(2);
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: sketch.graph?.entities[0].id }]);
    expect(workflow).toHaveBeenLastCalledWith(false);
    await rowMenu(sketch.name, 'Properties');
    expect(property('Material area')).toBe('2,000 mm²'); expect(property('Boundary length')).toBe('180 mm');
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
    const infer = container.querySelector<HTMLInputElement>('input[aria-label="Create relations"]');
    if (!infer) throw new Error('Coincident drawing control missing.');
    expect(infer.checked).toBe(true);
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

  it('accepts a drawn line once without the horizontal relation the sketch rejects as repeated, and says so', async () => {
    const appended: Extract<CadEdit, { kind: 'append-sketch-entities' }>['geometry'][] = [];
    await mount(createCadDocument(), { build: null, buildState: 'idle', onEdit: async edit => {
      if (edit.kind !== 'append-sketch-entities') { currentSession.edit([edit]); return; }
      appended.push(edit.geometry);
      const inferred = edit.geometry.relations.find(relation => relation.kind === 'horizontal');
      if (inferred) throw new CadSketchPreparationError({ sketchId: edit.sketchId, sketchName: 'Sketch', graph: edit.geometry, rejection: { kind: 'rejected', reason: 'redundant',
        message: 'Repeated relation.', diagnostics: { status: 'success', degreesOfFreedom: 0, conflictingIds: [], redundantIds: [inferred.id], partiallyRedundantIds: [], issues: [] } } });
      currentSession.edit([edit]);
    } });
    await startSketch(); await click('Line'); const empty = currentSession.getSnapshot(); statusMessage.mockClear();
    // The end lands one pixel off the start's horizontal guide, which levels it.
    await canvasClick(330, 260); await canvasClick(420, 261);
    expect(appended).toHaveLength(2);
    const [first, second] = appended;
    expect(first.relations).toEqual([{ id: expect.any(String), kind: 'horizontal', pointIds: first.points.map(point => point.id) }]);
    expect(second).toEqual({ ...first, relations: [] });
    expect(statusMessage).toHaveBeenCalledExactlyOnceWith('Horizontal not added: it repeats existing relations.', 'info');
    const sketch = currentDocument.features[0];
    expect(sketch.kind === 'sketch' && sketch.graph).toMatchObject({ entities: [{ kind: 'line' }], relations: [] });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => currentSession.undo()); expect(currentSession.getSnapshot().document).toBe(empty.document);
  });

  it('closes a free polyline on its start into shared point identities and changes only a selected edge to construction', async () => {
    await mount(); await startSketch(); await snapToGrid(); await click('Polyline');
    // Unticked, the start on the origin only copies its position.
    await drawingRelations(false);
    await canvasClick(300, 200); await canvasClick(450, 200); await canvasClick(375, 100); await canvasClick(300, 200);
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
    expect(currentDocument.features[0]).toBe(sketch); expect(document.activeElement).toBe(field('Diameter'));
    expect([field('Diameter').selectionStart, field('Diameter').selectionEnd]).toEqual([0, 2]);
  });

  it('chooses an axis dimension without adding an aligned driver and reopens its annotation as the same ordered point pair', async () => {
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Point offsets',
      suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: { points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [30, 20] }],
        entities: [{ id: 'reference', kind: 'line', startPointId: 'a', endPointId: 'b', construction: true }], relations: [] } }] });
    setCadPreferences({ ...getCadPreferences(), showOnPartDimensions: true });
    await mount(source); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    const pair = [{ kind: 'point' as const, id: 'b' }, { kind: 'point' as const, id: 'a' }];
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry-set', selections: pair }));
    await click('Dimension'); expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
    expect(currentDocument).toBe(source); await click('Horizontal distance');
    expect(field('Horizontal distance').value).toBe('-30'); await click('Apply');
    const sketch = currentDocument.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Offset sketch missing.');
    expect(sketch.graph.relations).toEqual([expect.objectContaining({ kind: 'axis-distance', axis: 'x', pointIds: ['b', 'a'], value: -30 })]);
    const annotation = container.querySelector(`[data-cad-sketch-dimension="${sketch.graph.relations[0].id}"] [role="button"]`);
    if (!annotation) throw new Error('Axis annotation missing.');
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'entity', id: 'reference' } }));
    await act(async () => annotation.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(viewport().getState().selectedSketchGeometrySet).toEqual(pair);
    expect(field('Horizontal distance').value).toBe('-30'); expect(currentDocument.features[0]).toBe(sketch);
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  it('picks two points after Dimension without moving geometry, restores canceled selection and keeps the exact ordered axis driver', async () => {
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Bore layout',
      suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: { points: [{ id: 'origin', position: [' 0 ', '0'] }, { id: 'center', position: [18, 12] }],
        entities: [{ id: 'outer', kind: 'circle', centerPointId: 'origin', radius: ' 50 ', construction: true },
          { id: 'bore', kind: 'circle', centerPointId: 'center', radius: ' 4 ', construction: false }], relations: [] } }] });
    await mount(source); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    const point = (id: string) => {
      const element = container.querySelector(`[data-cad-sketch-point="${id}"]`); if (!element) throw new Error('Point missing.');
      return element;
    };
    const pick = async (id: string) => act(async () => point(id).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    const accepted = currentSession.getSnapshot(); await click('Polyline'); await click('Dimension');
    expect(button('Finish sketch').disabled).toBe(true); await pick('origin');
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'point', id: 'origin' }]);
    expect(currentDocument).toBe(source); expect(() => currentSession.assertWorkflowClosed()).toThrow('Finish or cancel');
    await pick('origin'); expect(viewport().getState().selectedSketchGeometrySet).toHaveLength(1);
    await act(async () => point('origin').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    expect(currentDocument).toBe(source); await canvasKey('Escape');
    expect(currentSession.getSnapshot()).toEqual(accepted); expect(viewport().getState().selectedSketchGeometrySet).toEqual([]);
    expect(button('Polyline').getAttribute('aria-pressed')).toBe('true');
    await click('Dimension'); await pick('origin'); await pick('center');
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'point', id: 'origin' }, { kind: 'point', id: 'center' }]);
    expect(currentDocument).toBe(source); await click('Horizontal distance'); await input(field('Horizontal distance'), '18'); expect(button('Apply').disabled).toBe(false); await click('Apply');
    expect(container.querySelector('[role=alert]')?.textContent ?? '').toBe('');
    expect(currentDocument.features[0]).toMatchObject({ graph: { points: source.features[0].kind === 'sketch' ? source.features[0].graph?.points : [],
      relations: [{ kind: 'axis-distance', axis: 'x', pointIds: ['origin', 'center'], value: 18 }] } });
    expect(currentSession.getSnapshot().canUndo).toBe(true); expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  it('invalidates a pending Dimension pick on a new source and opens arc sizing through the existing editor', async () => {
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Arc guide',
      suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: { points: [{ id: 'center', position: [' 0 ', '0'] },
        { id: 'start', position: [5, 0] }, { id: 'end', position: [0, 5] }], entities: [
        { id: 'arc', kind: 'arc', centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'ccw', construction: true }], relations: [] } }] });
    await mount(source); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    await click('Dimension'); expect(() => currentSession.assertWorkflowClosed()).toThrow('Finish or cancel');
    const center = container.querySelector('[data-cad-sketch-point="center"]'); if (!center) throw new Error('Center missing.');
    await act(async () => center.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'point', id: 'center' }]);
    const changed = { ...source, parameters: { newDriver: 3 } };
    await act(async () => replaceDocument(changed));
    expect(currentDocument).toEqual(changed); const replaced = currentDocument; expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'point', id: 'center' }]);
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: null }));
    await click('Dimension');
    const arc = container.querySelector('[data-cad-sketch-entity="arc"]'); if (!arc) throw new Error('Arc missing.');
    // An arc waits for a line or a second curve; picking it again sizes it.
    await act(async () => arc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(container.textContent).toContain('Choose a line or another curve for a distance, or empty space for the size');
    await act(async () => arc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(field('Radius').value).toBe('5'); await click('Cancel');
    expect(currentDocument).toBe(replaced); expect(currentSession.getSnapshot().canUndo).toBe(false);
  });

  it('opens graph context Dimension on its actual target and moves the retained selected set through the existing editors', async () => {
    const source = parseCadDocument({ ...createCadDocument('Menu layout'), schemaVersion: 2, features: [{
      id: 'sketch', kind: 'sketch', name: 'Menu layout', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }], entities: [
          { id: 'first', kind: 'circle', construction: false, centerPointId: 'a', radius: 3 },
          { id: 'second', kind: 'circle', construction: false, centerPointId: 'b', radius: 3 }], relations: []
      }
    }] });
    await mount(source); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]'); if (!canvas) throw new Error('Canvas missing.');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
    const edge = (id: string) => { const found = container.querySelector<SVGGElement>(`[data-cad-sketch-entity="${id}"]`); if (!found) throw new Error('Missing graph edge.'); return found; };
    const key = async (id: string, key: string, shiftKey = false) => act(async () => {
      const target = edge(id); target.focus(); target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    });
    const menu = async (label: string) => act(async () => {
      const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === label);
      if (!item) throw new Error(`${label} menu item missing.`); item.click();
    });
    await key('first', 'Enter'); const before = currentSession.getSnapshot();
    await key('second', 'F10', true);
    const dimensionItem = document.querySelector<HTMLButtonElement>('[role="menuitem"]'); if (!dimensionItem) throw new Error('Menu missing.');
    await act(async () => dimensionItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(edge('second')); expect(currentSession.getSnapshot()).toEqual(before);
    await key('second', 'F10', true); await menu('Dimension');
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: 'second' }]);
    expect(field('Diameter').value).toBe('6'); expect(currentDocument).toBe(before.document);
    await click('Cancel'); expect(currentDocument).toBe(before.document);
    await key('second', 'F10', true); await menu('Dimension'); await click('Apply');
    const dimensioned = currentDocument.features[0];
    expect(dimensioned).toMatchObject({ graph: { relations: [{ kind: 'radial-size', entityId: 'second', quantity: 'diameter', value: 6 }] } });
    await key('first', 'Enter', true); const selected = viewport().getState().selectedSketchGeometrySet, original = currentDocument;
    expect(selected).toEqual([{ kind: 'entity', id: 'second' }, { kind: 'entity', id: 'first' }]);
    await key('second', 'F10', true); await menu('Move selection');
    const moveX = container.querySelector<HTMLInputElement>('[aria-label="Move X"]'); if (!moveX) throw new Error('Move field missing.');
    await input(moveX, '5'); await click('Cancel'); expect(currentDocument).toBe(original);
    expect(viewport().getState().selectedSketchGeometrySet).toEqual(selected);
    await key('first', 'F10', true); await menu('Move selection');
    const nextX = container.querySelector<HTMLInputElement>('[aria-label="Move X"]'); if (!nextX) throw new Error('Move field missing.');
    await input(nextX, '5'); await click('Apply');
    expect(currentDocument.features[0]).toEqual({ ...dimensioned, graph: { ...(dimensioned.kind === 'sketch' ? dimensioned.graph : {}),
      points: [{ id: 'a', position: [5, 0] }, { id: 'b', position: [25, 0] }] } });
    await act(async () => currentSession.undo()); expect(currentDocument).toEqual(original);
  });

  it('offers the same angle Dimension from dock and context menu for a linked guide and a free line', async () => {
    const base = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [
      { id: 'layout', kind: 'sketch', name: 'Layout', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
        points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: ['20', '0'] }],
        entities: [{ id: 'guide', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' }], relations: [] } },
      { id: 'target', kind: 'sketch', name: 'Target', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
        points: [{ id: 'u', position: [0, 0] }, { id: 'v', position: [10, 10] }],
        entities: [{ id: 'free', kind: 'line', construction: false, startPointId: 'u', endPointId: 'v' }], relations: [] } },
    ] });
    const source = applyCadEdits(base, [{ kind: 'use-sketch-entity', sketchId: 'target', sourceSketchId: 'layout', sourceEntityId: 'guide', idPrefix: 'ref' }]);
    await mount(source); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'target' }));
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry-set', selections: [{ kind: 'entity', id: 'ref_e0' }, { kind: 'entity', id: 'free' }] }));
    expect(button('Dimension').disabled).toBe(false); await click('Dimension');
    expect(Number(field('Angle').value)).toBe(45); await click('Cancel'); expect(currentDocument).toBe(source);
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]'), free = container.querySelector<SVGGElement>('[data-cad-sketch-entity="free"]');
    if (!canvas || !free) throw new Error('Line canvas missing.');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
    await act(async () => { free.focus(); free.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })); });
    const action = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === 'Dimension');
    if (!action) throw new Error('Dimension action missing.'); expect(action.disabled).toBe(false);
    await act(async () => action.click()); expect(Number(field('Angle').value)).toBe(45); await click('Apply');
    const target = currentDocument.features[1], original = source.features[1];
    if (target.kind !== 'sketch' || original.kind !== 'sketch' || !target.graph || !original.graph) throw new Error('Target missing.');
    expect(currentDocument.features[0]).toEqual(source.features[0]); expect(target.graph.points).toEqual(original.graph.points); expect(target.graph.entities).toEqual(original.graph.entities);
    expect(target.graph.relations).toEqual([...original.graph.relations, expect.objectContaining({ kind: 'line-angle', value: 45 })]);
    await act(async () => currentSession.undo()); expect(currentDocument).toEqual(source);
  });

  it('keeps a chosen constraint tool active, guides its picks and commits one relation per completed pick', async () => {
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Lines', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 2] }, { id: 'c', position: [0, 10] }, { id: 'd', position: [20, 12] }, { id: 'p', position: [5, 30] }, { id: 'q', position: [25, 30] }],
      entities: [{ id: 'first', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'second', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
        { id: 'third', kind: 'line', construction: false, startPointId: 'p', endPointId: 'q' }],
      relations: [] } }] });
    await mount(source); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    const pick = async (selector: string) => {
      const target = container.querySelector(selector); if (!target) throw new Error(`${selector} missing.`);
      await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    };
    const choose = async (label: string) => {
      await click('Constrain');
      const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(entry => entry.textContent?.trim() === label);
      if (!item) throw new Error(`${label} missing.`); await act(async () => item.click());
    };
    await choose('Parallel'); expect(button('Constrain').getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('Parallel · Choose a line');
    await pick('[data-cad-sketch-point="p"]'); expect(viewport().getState().selectedSketchGeometrySet).toEqual([]);
    await pick('[data-cad-sketch-entity="first"]'); expect(currentDocument).toBe(source);
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: 'first' }]);
    await pick('[data-cad-sketch-entity="second"]');
    const sketch = () => { const feature = currentDocument.features[0]; if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Sketch missing.'); return feature.graph; };
    expect(sketch().relations).toEqual([expect.objectContaining({ kind: 'parallel', lineIds: ['first', 'second'] })]);
    expect(button('Constrain').getAttribute('aria-pressed')).toBe('true'); expect(viewport().getState().selectedSketchGeometrySet).toEqual([]);
    // The same pair again is explained instead of duplicated.
    await pick('[data-cad-sketch-entity="first"]'); await pick('[data-cad-sketch-entity="second"]');
    expect(statusMessage).toHaveBeenLastCalledWith(expect.stringContaining('Parallel is already applied here.'), 'error'); expect(sketch().relations).toHaveLength(1);
    await choose('Horizontal'); await pick('[data-cad-sketch-entity="third"]');
    expect(sketch().relations.at(-1)).toMatchObject({ kind: 'horizontal', pointIds: ['p', 'q'] });
    // The plane's own axes and origin take part only while a tool accepts them. The test session applies relations without solving, so the picks already agree.
    await choose('Coincident'); await pick('[data-cad-sketch-point="c"]');
    expect(container.querySelector('[data-cad-sketch-datum="origin"]')?.getAttribute('role')).toBe('button');
    await pick('[data-cad-sketch-datum="y-axis"]');
    expect(sketch().relations.at(-1)).toMatchObject({ kind: 'fixed-axis', pointId: 'c', axis: 'x', value: 0 });
    await pick('[data-cad-sketch-datum="origin"]'); await pick('[data-cad-sketch-point="a"]');
    expect(sketch().relations.slice(-2)).toMatchObject([{ kind: 'fixed-axis', pointId: 'a', axis: 'x', value: 0 }, { kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 }]);
    await choose('Perpendicular'); await pick('[data-cad-sketch-entity="third"]'); await pick('[data-cad-sketch-datum="y-axis"]');
    expect(statusMessage).toHaveBeenLastCalledWith(expect.stringContaining('This line is already horizontal.'), 'error');
    await canvasKey('Escape'); expect(button('Constrain').getAttribute('aria-pressed')).toBe('false');
    // Leaving the tool returns the origin to ordinary selection rather than a command operand.
    expect(container.querySelector('[data-cad-sketch-datum="origin"]')?.getAttribute('aria-label')).toBe('Select origin');
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  it('keeps a point on an arc or circle with Coincident, picked after the tool or from the selection, and removes it from the selection menu', async () => {
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Curves', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'o', position: [0, 0] }, { id: 's', position: [10, 0] }, { id: 'e', position: [0, 10] }, { id: 'c', position: [30, 0] }, { id: 'p', position: [6, 8] }, { id: 'q', position: [34, 3] }],
      entities: [{ id: 'bow', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 's', endPointId: 'e', direction: 'ccw' },
        { id: 'ring', kind: 'circle', construction: false, centerPointId: 'c', radius: 5 }], relations: [] } }] });
    await mount(source); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    const pick = async (selector: string) => {
      const target = container.querySelector(selector); if (!target) throw new Error(`${selector} missing.`);
      await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    };
    const menuItem = async (role: string, label: string) => {
      await click('Constrain');
      const item = [...document.querySelectorAll<HTMLElement>(`[role="${role}"]`)].find(entry => entry.textContent?.trim() === label);
      if (!item) throw new Error(`${label} missing.`); return item;
    };
    const relations = () => { const feature = currentDocument.features[0]; if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Sketch missing.'); return feature.graph.relations; };
    const coincident = await menuItem('menuitem', 'Coincident'); await act(async () => coincident.click());
    await pick('[data-cad-sketch-entity="bow"]'); expect(container.textContent).toContain('Coincident · Choose a point to keep on this arc');
    await pick('[data-cad-sketch-point="p"]');
    expect(relations()).toEqual([{ id: expect.any(String), kind: 'point-on-curve', pointId: 'p', curveId: 'bow' }]);
    await canvasKey('Escape');
    const select = () => act(async () => viewport().apply({ kind: 'select-sketch-geometry-set', selections: [{ kind: 'point', id: 'q' }, { kind: 'entity', id: 'ring' }] }));
    await select(); const offered = await menuItem('menuitemcheckbox', 'Coincident');
    expect(offered.getAttribute('aria-checked')).toBe('false'); await act(async () => offered.click());
    const held = relations()[1];
    expect(held).toEqual({ id: expect.any(String), kind: 'point-on-curve', pointId: 'q', curveId: 'ring' });
    await select(); const applied = await menuItem('menuitemcheckbox', 'Coincident');
    expect(applied.getAttribute('aria-checked')).toBe('true'); await act(async () => applied.click());
    expect(relations()).toEqual([expect.objectContaining({ curveId: 'bow' })]);
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  it('dimensions a point from the sketch origin or an axis in either pick order', async () => {
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Line', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'a', position: [12, -7] }, { id: 'b', position: [30, 5] }], entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: [] } }] });
    await mount(source); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    const pick = async (selector: string) => {
      const target = container.querySelector(selector); if (!target) throw new Error(`${selector} missing.`);
      await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    };
    const relations = () => { const feature = currentDocument.features[0]; if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Sketch missing.'); return feature.graph.relations; };
    await click('Dimension'); expect(container.querySelector('[data-cad-sketch-datum="origin"]')?.getAttribute('role')).toBe('button');
    await pick('[data-cad-sketch-datum="x-axis"]'); expect(container.textContent).toContain('Choose a point to dimension from the x axis');
    await pick('[data-cad-sketch-point="a"]'); expect(field('Y from X axis').value).toBe('-7'); await click('Apply');
    expect(relations()).toMatchObject([{ kind: 'fixed-axis', pointId: 'a', axis: 'y', value: -7 }]);
    // A selected point starts the tool as its first pick.
    await pick('[data-cad-sketch-point="b"]'); await click('Dimension');
    expect(container.textContent).toContain('Choose the second point, a line, the origin or an axis');
    await pick('[data-cad-sketch-datum="origin"]');
    expect(field('X from origin').value).toBe('30'); expect(field('Y from origin').value).toBe('5'); await click('Apply');
    expect(relations().slice(1)).toMatchObject([{ kind: 'fixed-axis', pointId: 'b', axis: 'x', value: 30 }, { kind: 'fixed-axis', pointId: 'b', axis: 'y', value: 5 }]);
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  it('dimensions the center of a lone circle from an axis', async () => {
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Bore', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'c', position: [8, 4] }], entities: [{ id: 'bore', kind: 'circle', construction: false, centerPointId: 'c', radius: 5 }], relations: [] } }] });
    await mount(source); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    const pick = async (selector: string) => {
      const target = container.querySelector(selector); if (!target) throw new Error(`${selector} missing.`);
      await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    };
    await click('Dimension'); await pick('[data-cad-sketch-datum="y-axis"]'); await pick('[data-cad-sketch-point="c"]');
    expect(field('X from Y axis').value).toBe('8'); await click('Apply');
    const feature = currentDocument.features[0]; if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Sketch missing.');
    expect(feature.graph.relations).toMatchObject([{ kind: 'fixed-axis', pointId: 'c', axis: 'x', value: 8 }]);
  });

  it('dimensions parallel lines, a point or curve center from a line, and two curve centers with a distance', async () => {
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Distances', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'c', position: [0, 10] }, { id: 'd', position: [20, 10] }, { id: 'e', position: [30, 0] },
        { id: 'f', position: [40, 10] }, { id: 'p', position: [5, 4] }, { id: 'o', position: [10, -6] }, { id: 'q', position: [40, -6] }],
      entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'top', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
        { id: 'slant', kind: 'line', construction: false, startPointId: 'e', endPointId: 'f' }, { id: 'ring', kind: 'circle', construction: false, centerPointId: 'o', radius: 2 },
        { id: 'disk', kind: 'circle', construction: false, centerPointId: 'q', radius: 3 }], relations: [] } }] });
    await mount(source); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    const pick = async (selector: string) => {
      const target = container.querySelector(selector); if (!target) throw new Error(`${selector} missing.`);
      await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    };
    const line = (id: string) => `[data-cad-sketch-entity="${id}"]`, point = (id: string) => `[data-cad-sketch-point="${id}"]`;
    const restart = async () => { await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: null })); await click('Dimension'); };
    const relations = () => { const feature = currentDocument.features[0]; if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Sketch missing.'); return feature.graph.relations; };
    // Two parallel lines take a distance from the second line to the first, held parallel, as one undoable edit.
    await click('Dimension'); await pick(line('base')); await pick(line('top'));
    expect(field('Point to line distance').value).toBe('10'); expect(container.querySelector('[data-cad-angle-sector]')).toBeNull(); await click('Apply');
    expect(relations()).toEqual([{ id: expect.any(String), kind: 'point-line-distance', pointId: 'c', lineId: 'base', value: 10 },
      { id: expect.any(String), kind: 'parallel', lineIds: ['base', 'top'] }]);
    await act(async () => currentSession.undo()); expect(currentDocument).toEqual(source);
    // Lines that are not parallel still take an angle.
    await restart(); await pick(line('base')); await pick(line('slant')); expect(Number(field('Angle').value)).toBeCloseTo(135, 9); await click('Cancel');
    // A point and a line in either order; a line is not offered with its own endpoints.
    await restart(); await pick(point('p')); expect(container.textContent).toContain('Choose the second point, a line, the origin or an axis');
    await pick(line('base')); expect(field('Point to line distance').value).toBe('4'); await click('Cancel');
    await restart(); await pick(point('a')); await pick(line('base')); expect(container.querySelector('[aria-label="Point to line distance"]')).toBeNull();
    await pick(line('top')); expect(field('Point to line distance').value).toBe('10'); await click('Cancel');
    await restart(); await pick(line('base')); await pick(point('a')); expect(container.querySelector('[aria-label="Point to line distance"]')).toBeNull();
    await pick(point('p')); expect(field('Point to line distance').value).toBe('4'); await click('Cancel');
    // A circle waits for a line, measured from its center, or a second circle, measured center to center.
    await restart(); await pick(line('ring')); await pick(line('base')); expect(field('Point to line distance').value).toBe('6'); await click('Cancel');
    await restart(); await pick(line('ring')); await pick(line('disk')); expect(field('Center distance').value).toBe('30'); await click('Apply');
    expect(relations()).toEqual([{ id: expect.any(String), kind: 'distance', pointIds: ['o', 'q'], value: 30 }]);
    await act(async () => currentSession.undo()); expect(currentDocument).toEqual(source);
    // A selected point and line open the distance from the toolbar and from the context menu.
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry-set', selections: [{ kind: 'point', id: 'p' }, { kind: 'entity', id: 'base' }] }));
    await click('Dimension'); expect(field('Point to line distance').value).toBe('4'); await click('Cancel');
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]'), base = container.querySelector<SVGGElement>(line('base'));
    if (!canvas || !base) throw new Error('Canvas missing.');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry-set', selections: [{ kind: 'point', id: 'p' }, { kind: 'entity', id: 'base' }] }));
    await act(async () => { base.focus(); base.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })); });
    const action = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === 'Dimension');
    if (!action) throw new Error('Dimension action missing.'); expect(action.disabled).toBe(false);
    await act(async () => action.click()); expect(field('Point to line distance').value).toBe('4'); await click('Cancel');
    expect(currentDocument).toEqual(source); expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  it('starts Dimension before picking an edge, cancels cleanly and applies a linked length through the same editor', async () => {
    await mount({ ...createCadDocument(), parameters: { plateWidth: 50 } }); await startSketch(); await snapToGrid();
    await canvasClick(300, 200); await canvasClick(450, 100); await click('Select');
    await click('Expand Parameters');
    const accepted = currentSession.getSnapshot(), created = currentDocument.features[0];
    if (created.kind !== 'sketch' || !created.graph) throw new Error('Fresh rectangle missing.');
    const edgeId = created.graph.entities[0].id;
    await canvasClick(100, 350);
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([]);
    expect(button('Dimension').disabled).toBe(false); await click('Dimension');
    expect(button('Finish sketch').disabled).toBe(true); expect(button('Edit parameter plateWidth').disabled).toBe(true);
    expect(() => currentSession.assertWorkflowClosed()).toThrow('Finish or cancel');
    await click('Cancel');
    expect(currentSession.getSnapshot()).toEqual(accepted); expect(currentDocument).toBe(accepted.document);
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([]);
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
    await click('Dimension');
    const edge = container.querySelector(`[data-cad-sketch-entity="${edgeId}"]`);
    if (!edge) throw new Error('Dimension edge missing.');
    const pickEdge = async (id: string) => {
      const target = container.querySelector(`[data-cad-sketch-entity="${id}"]`); if (!target) throw new Error('Dimension edge missing.');
      await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    };
    // A line alone waits: a second line measures the angle between them.
    await pickEdge(edgeId); expect(container.querySelector('[aria-label="Length"]')).toBeNull();
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: edgeId }]);
    await pickEdge(created.graph.entities[1].id); expect(Number(field('Angle').value)).toBe(90); await click('Cancel');
    // Picking the same line again, or confirming with Enter, measures its length.
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: null }));
    await click('Dimension'); await pickEdge(edgeId); await pickEdge(edgeId);
    expect(field('Length').value).toBe('50');
    expect(() => currentSession.assertWorkflowClosed()).toThrow('Finish or cancel');
    await click('Cancel');
    expect(currentDocument.features[0]).toMatchObject({ graph: { relations: Array.from({ length: 6 }, () => expect.any(Object)) } });
    await click('Dimension'); await canvasKey('Enter'); await relation('Length', 'plateWidth'); await click('Apply');
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Graph sketch missing.');
    expect(sketch.graph.relations.map(item => item.kind)).toEqual(['horizontal', 'vertical', 'horizontal', 'vertical', 'fixed-axis', 'fixed-axis', 'distance']);
    expect(sketch.graph.relations.at(-1)).toMatchObject({ kind: 'distance', value: 'plateWidth' });
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  it('blocks a new path while a parameter edit is pending without losing either field or history', async () => {
    await mount(); await startSketch(); await click('Polyline');
    const before = currentSession.getSnapshot();
    await parameterMenu('New parameter'); const pendingField = field('Name'); await input(pendingField, 'wall'); await input(field('Value'), '3');
    const pendingValue = pendingField.value;
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]');
    if (!canvas) throw new Error('Sketch canvas missing');
    expect(canvas.getAttribute('tabindex')).toBe('-1');
    await canvasClick(300, 200); await canvasKey(' '); await canvasKey('ArrowRight'); await canvasKey(' ');
    expect(container.querySelector('[data-cad-path-segments]')).toBeNull(); expect(pendingField.value).toBe(pendingValue);
    expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: before.canUndo, workflowOpen: true });
    await click('Cancel');
    expect(currentSession.getSnapshot()).toEqual(before); expect(button('Line segment').disabled).toBe(false);
    await canvasKey(' '); await canvasKey('ArrowRight'); await canvasKey(' ');
    expect(container.querySelector('[data-cad-path-segments]')).not.toBeNull(); expect(button('Undo last').disabled).toBe(false);
    await click('Cancel drawing'); expect(currentSession.getSnapshot()).toEqual(before);
  });

  it('locks shared actions during a mixed path and cancels it without a document or history change', async () => {
    await mount(); await startSketch(); await click('Polyline');
    const before = currentSession.getSnapshot();
    await click('3-point Arc'); await canvasKey(' '); await canvasKey('ArrowUp'); await canvasKey('ArrowUp'); await canvasKey(' ');
    expect(currentSession.getSnapshot().workflowOpen).toBe(true);
    for (const label of ['Finish sketch', 'Undo', 'Save', 'Line', 'Arc', 'Rectangle', 'Polyline', 'Slot']) expect(button(label).disabled).toBe(true);
    await canvasKey('z');
    const controlUndo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => container.querySelector('[aria-label="Sketch drawing canvas"]')!.dispatchEvent(controlUndo));
    expect(controlUndo.defaultPrevented).toBe(true); expect(undo).not.toHaveBeenCalled();
    await click('Undo last'); expect(button('Line segment').disabled).toBe(false); expect(button('Finish sketch').disabled).toBe(true);
    await canvasKey('Escape'); expect(currentSession.getSnapshot()).toEqual(before);
    expect(button('Finish sketch').disabled).toBe(false); expect(button('Rectangle').disabled).toBe(false);
  });

  it('finishes an open polyline with Enter without inventing material and edits one of its shared joints', async () => {
    await mount(); await startSketch(); await snapToGrid(); await click('Polyline');
    await canvasClick(300, 200); await canvasClick(450, 200); await canvasClick(450, 100);
    expect(button('Finish polyline').disabled).toBe(false); await canvasKey('Enter');
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

  it('closes a freshly drawn mixed polyline with exact shared arc joints and analytic material', async () => {
    await mount(); await startSketch(); await snapToGrid(); await click('Polyline');
    await canvasClick(300, 200); await canvasClick(360, 200); await click('3-point Arc');
    await canvasClick(360, 150); await canvasClick(390, 175); await click('Line segment'); await canvasClick(300, 150);
    await click('Close profile');
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Graph path missing.');
    expect(sketch.profiles).toEqual([]);
    expect(sketch.graph.entities.map(entity => entity.kind)).toEqual(['line', 'arc', 'line', 'line']);
    expect(measureCadSketch(currentDocument, sketch.id).materialAreaMm2).toBeCloseTo(400 + 50 * Math.PI, 8);
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  it('draws one separate line per two clicks and attaches a three-point arc with its own center to existing ends by default', async () => {
    await mount(); await startSketch(); await snapToGrid(); await click('Line');
    // Clicks away from existing geometry and the axes have nothing to attach to.
    await canvasClick(330, 175); expect(workflow).toHaveBeenLastCalledWith(true);
    await canvasClick(450, 175); await canvasClick(330, 100); await canvasClick(450, 100);
    let sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Graph sketch missing.');
    expect(sketch.graph.entities.map(entity => entity.kind)).toEqual(['line', 'line']);
    expect(sketch.graph.points.map(point => point.position)).toEqual([[10, 10], [50, 10], [10, 40], [50, 40]]);
    expect(sketch.graph.relations).toEqual([]); expect(button('Line').getAttribute('aria-pressed')).toBe('true');
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
    await act(async () => currentSession.undo()); sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Graph sketch missing.');
    const [lineStart, lineEnd] = sketch.graph.points;
    await click('Arc'); await canvasClick(330, 175); await canvasClick(450, 175); expect(workflow).toHaveBeenLastCalledWith(true);
    await canvasClick(390, 100);
    sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Graph sketch missing.');
    const arc = sketch.graph.entities[1];
    if (arc?.kind !== 'arc') throw new Error('Expected the drawn arc.');
    expect(sketch.graph.points).toHaveLength(5); expect(sketch.graph.points.map(point => point.id)).toContain(arc.centerPointId);
    expect([arc.startPointId, arc.endPointId]).not.toContain(lineStart.id);
    expect(sketch.graph.relations).toEqual([{ id: expect.any(String), kind: 'coincident', pointIds: [arc.startPointId, lineStart.id] },
      { id: expect.any(String), kind: 'coincident', pointIds: [arc.endPointId, lineEnd.id] }]);
    // The attached arc and the line close one area together; cadEditPreparation.test.ts checks the arc follows a moved line end.
    expect(measureCadSketch(currentDocument, sketch.id).materialAreaMm2).toBeGreaterThan(0);
    expect(button('Arc').getAttribute('aria-pressed')).toBe('true'); expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  it('draws a slot from both arc centers and a width click as two tangent lines and two equal arcs', async () => {
    await mount(); await startSketch(); await snapToGrid(); await click('Slot');
    await canvasClick(300, 200); await canvasClick(450, 200); expect(currentDocument.features[0]).toMatchObject({ profiles: [] });
    await canvasClick(375, 175);
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Graph sketch missing.');
    expect(sketch.profiles).toEqual([]);
    expect(sketch.graph.entities.map(entity => entity.kind)).toEqual(['line', 'arc', 'line', 'arc']);
    // The first center, drawn on the origin, stays fixed there because Create relations starts on.
    expect(sketch.graph.relations.map(relation => relation.kind)).toEqual(['tangent-joint', 'tangent-joint', 'tangent-joint', 'tangent-joint', 'equal-radius', 'fixed-axis', 'fixed-axis']);
    const [first, second] = sketch.graph.points;
    expect(sketch.graph.relations.slice(5).map(relation => relation.kind === 'fixed-axis' && relation.pointId)).toEqual([first.id, first.id]);
    expect([first.position, second.position]).toEqual([[0, 0], [50, 0]]);
    const width = 2 * Math.abs(Number(sketch.graph.points[2].position[1]));
    expect(width).toBeGreaterThan(0);
    expect(measureCadSketch(currentDocument, sketch.id).materialAreaMm2).toBeCloseTo(50 * width + Math.PI * width * width / 4, 8);
    expect(button('Slot').getAttribute('aria-pressed')).toBe('true'); expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
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
    await click('Select Pad 1 in history'); await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
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
    await click('Select Pad 1 in history'); await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
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
    await mount(solidDocument());
    const before = currentSession.getSnapshot(); await parameterMenu('New parameter');
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
    // Delete on the selected history row asks before deleting, and Escape returns focus to that row.
    const trigger = container.querySelector<HTMLButtonElement>('.cad-tree-row[aria-pressed="true"]'); if (!trigger) throw new Error('Selected sketch row missing.');
    await act(async () => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })); });
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
    await mount(); await startSketch(); await snapToGrid();
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
    await rowMenu('Pad 1', 'Properties'); await click('Inspect topology'); await click('Browse edges'); await click('1. Straight edge50 mm');
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
    await click('Cancel');
    expect(signal?.aborted).toBe(true); expect(currentSession.getSnapshot().workflowOpen).toBe(false);
    await click('Chamfer');
    await act(async () => finish?.({ bodyId: 'pad', buildId: 'build-1', purpose: 'fillet', selection: selectedEdgeQuery }));
    expect(container.querySelector('.cad-inspector-title')?.textContent).toBe('Create chamfer');
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

  it('uses one live shell header, renames the part from its Properties and restores the shell on CAD exit', async () => {
    await mount(createCadDocument(), { build: null, buildState: 'idle' }, true);
    const header = container.querySelector('[data-app-header]');
    expect(container.querySelectorAll('.cad-header')).toHaveLength(1);
    expect(header?.contains(button('Save'))).toBe(true);
    const name = await partName(); expect(header?.contains(name)).toBe(false);
    await input(name, 'Edited part');
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
    await mount(); await startSketch(); await snapToGrid(); await canvasClick(300, 200); await canvasClick(450, 100);
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

  it('shows imported source metadata without exposing or editing original source contents', async () => {
    const source = { format: 'step', encoding: 'utf8', fileName: 'source.step', data: 'ISO-10303-21;\nEND-ISO-10303-21;' } satisfies Extract<CadDocument['features'][number], { kind: 'imported' }>['source'];
    const initial = applyCadEdits(createCadDocument(), [{ kind: 'add-feature', feature: { id: 'imported', kind: 'imported', name: 'Imported solid', suppressed: false, source } }]);
    await mount(initial); await click('Select Imported solid in history'); await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
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


it('owns circle-row preview, Cancel, copy omission and detach through the contextual sketch command', async () => {
  const initial=circleRowPart(true); await mount(initial);
  await act(async()=>viewport().apply({kind:'edit-sketch',sketchId:'sketch'}));
  await act(async()=>viewport().apply({kind:'select-sketch-geometry',selection:{kind:'entity',id:'seed'}}));
  await click('Pattern'); await click('Linear pattern');
  await input(field('Pitch'),'15');
  const occurrence=()=>container.querySelector<SVGGElement>('[data-cad-pattern-instance="2"]')!;
  await act(async()=>occurrence().dispatchEvent(new MouseEvent('click',{bubbles:true})));
  expect(occurrence().getAttribute('aria-checked')).toBe('false'); expect(currentDocument).toBe(initial);
  await click('Cancel'); expect(currentDocument).toBe(initial);
  await click('Pattern'); await click('Linear pattern'); await input(field('Pitch'),'15'); await click('Apply');
  let row=rowSketch(currentDocument),owner=row.graph.relations.find(r=>r.kind==='linear-pattern');
  if(owner?.kind!=='linear-pattern')throw Error('Missing owner');
  expect(owner).toMatchObject({count:4,spacing:15,direction:'+x',omittedInstances:[]});
  const member=owner.idPrefix+'_i2_e0';
  await act(async()=>viewport().apply({kind:'select-sketch-geometry',selection:{kind:'entity',id:member}}));
  expect(button('Move selection').disabled).toBe(true);
  const construction=container.querySelector<HTMLInputElement>('.cad-sketch-options input');expect(construction?.disabled).toBe(true);
  // Edit pattern lives in the geometry context menu (Shift+F10 on the focused seed).
  const canvas=container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]');if(!canvas)throw Error('Canvas missing');
  // The keyboard menu hit-tests the focused geometry at its on-screen position.
  vi.spyOn(canvas,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:600,bottom:400,width:600,height:400,toJSON:()=>({})});
  const editPattern=async()=>{
    await act(async()=>{const seed=container.querySelector<SVGGElement>('[data-cad-sketch-entity="seed"]')!;seed.focus();seed.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}));});
    const item=[...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(entry=>entry.textContent==='Edit pattern');if(!item)throw Error('Missing Edit pattern');await act(async()=>item.click());
  };
  await editPattern(); await act(async()=>occurrence().dispatchEvent(new MouseEvent('click',{bubbles:true}))); await click('Apply');
  row=rowSketch(currentDocument); expect(row.graph.entities.some(e=>e.id===member)).toBe(false);
  await editPattern(); expect(occurrence().getAttribute('aria-checked')).toBe('false');
  await act(async()=>occurrence().dispatchEvent(new MouseEvent('click',{bubbles:true})));await click('Apply');
  row=rowSketch(currentDocument);expect(row.graph.entities.some(e=>e.id===member)).toBe(true);
  const linked=row.graph; await editPattern(); await click('Detach pattern'); expect(field('Pitch').matches(':disabled')).toBe(true);await click('Apply');
  row=rowSketch(currentDocument);expect(row.graph.relations).toEqual([]);expect(row.graph.entities).toEqual(linked.entities);expect(row.graph.points).toEqual(linked.points);
  await act(async()=>viewport().apply({kind:'select-sketch-geometry',selection:{kind:'entity',id:member}})); expect(button('Move selection').disabled).toBe(false);
});


it('keeps a linked Use endpoint available as the first Dimension point and as a fixed point-pair anchor',async()=>{
  const base=parseCadDocument({...createCadDocument(),schemaVersion:2,features:[
    {id:'layout',kind:'sketch',name:'Layout',plane:'XY',offset:0,suppressed:false,profiles:[],graph:{points:[{id:'a',position:['0','0']},{id:'b',position:['20','0']}],entities:[{id:'edge',kind:'line',construction:true,startPointId:'a',endPointId:'b'}],relations:[]}},
    {id:'target',kind:'sketch',name:'Target',plane:'XY',offset:0,suppressed:false,profiles:[],graph:{points:[{id:'o',position:[10,8]}],entities:[{id:'hole',kind:'circle',centerPointId:'o',radius:'2',construction:false}],relations:[]}}]});
  const source=applyCadEdits(base,[{kind:'use-sketch-entity',sketchId:'target',sourceSketchId:'layout',sourceEntityId:'edge',idPrefix:'guide'}]);await mount(source);
  await act(async()=>viewport().apply({kind:'edit-sketch',sketchId:'target'}));await act(async()=>viewport().apply({kind:'select-sketch-geometry',selection:{kind:'point',id:'guide_p0'}}));
  expect(button('Dimension').disabled).toBe(false);await click('Dimension');
  const target=container.querySelector<SVGGElement>('[data-cad-sketch-point="o"]')!;await act(async()=>target.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
  expect(button('Horizontal distance').disabled).toBe(false);expect(button('Vertical distance').disabled).toBe(false);expect(currentDocument).toBe(source);
});
