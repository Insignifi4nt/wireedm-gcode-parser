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
import type { CadSketchConstraintAnalysis, CadSketchConstraintInspection } from './cadSketchConstraintInspection';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { cadSketchDimensionSelectionStatus } from './cadSketchDimensionSelection';
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
// The sketch canvas reads its dimension status line once per render in the select tool, so the call count tracks canvas renders.
vi.mock('./cadSketchDimensionSelection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cadSketchDimensionSelection')>();
  return { ...actual, cadSketchDimensionSelectionStatus: vi.fn(actual.cadSketchDimensionSelectionStatus) };
});
const canvasRenders = vi.mocked(cadSketchDimensionSelectionStatus);

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
/** The toolbar's tool button; the Line tool's segment mode also has a button reading Line. */
function toolButton(label: string) {
  const found = document.querySelector<HTMLButtonElement>(`.cad-command-primary-tools button[aria-label="${label}"]`);
  if (!found) throw new Error(`Tool "${label}" missing.`);
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
/** Escape with focus outside the canvas, which the workbench handles. */
async function windowEscape() { await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); }); }
function sketchGraph() {
  const sketch = currentDocument.features[0];
  if (sketch?.kind !== 'sketch') throw new Error('Sketch missing.');
  return sketch.graph ?? { points: [], entities: [], relations: [] };
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
    expect(status()).toBe('Fully defined'); expect(radiusLocked()).toBe(true);

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
    expect(status()).toBe('Fully defined'); expect(radiusLocked()).toBe(true);
    expect(await renders(() => answers[1].resolve(4))).toBe(0); expect(radiusLocked()).toBe(true);
    // A pause hides the answer and resuming shows it again, each a render after the status reports it. The same answer
    // from the new analysis keeps it.
    expect(await renders(() => setReady(false))).toBe(2); expect(status()).toBe('Editing…'); expect(radiusLocked()).toBe(false);
    expect(await renders(() => setReady(true))).toBe(2); expect(status()).toBe('Fully defined'); expect(radiusLocked()).toBe(true);
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
    for (const [key, label] of [['a', 'Arc'], ['o', 'Slot']] as const) {
      await press(key); expect(button(label).getAttribute('aria-pressed')).toBe('true');
      expect(button(label).getAttribute('aria-keyshortcuts')).toBe(key.toUpperCase());
    }
    // P, Polyline's shortcut, selects the chaining Line, as L does.
    for (const key of ['l', 'p']) { await press('s'); await press(key); expect(toolButton('Line').getAttribute('aria-pressed')).toBe('true'); }
    expect(toolButton('Line').getAttribute('aria-keyshortcuts')).toBe('L P');
    const drawingTools = [...container.querySelectorAll('.cad-command-primary-tools button')].map(entry => entry.getAttribute('aria-label'));
    expect(drawingTools.slice(drawingTools.indexOf('Select'), drawingTools.indexOf('Select') + 7)).toEqual(['Select', 'Line', 'Arc', 'Rectangle', 'Circle', 'Slot', 'Trim']);
    expect(drawingTools).not.toContain('Path'); expect(drawingTools).not.toContain('Polyline');
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

  it('keeps a multi-click chain provisional until it is finished, and Cancel drawing discards it without changing saved geometry', async () => {
    await mount(); await startSketch(); await click('Line'); const before = currentSession.getSnapshot();
    await canvasClick(300, 200); await canvasClick(450, 200);
    expect(currentSession.getSnapshot().document).toBe(before.document);
    // Finish sketch would save the chain first; Undo waits for it.
    expect(button('Finish sketch').disabled).toBe(false); expect(button('Undo').disabled).toBe(true);
    await click('Cancel drawing');
    const sketch = currentDocument.features[0];
    expect(sketch.kind === 'sketch' && sketch.profiles).toEqual([]); expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version });
    expect(button('Finish sketch').disabled).toBe(false); expect(toolButton('Line').getAttribute('aria-pressed')).toBe('true');
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
    // The end lands one pixel off the start's horizontal guide, which levels it. Enter finishes the one-line chain.
    await canvasClick(330, 260); await canvasClick(420, 261); expect(appended).toHaveLength(0); await canvasKey('Enter');
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

  it('saves a clicked chain with shared joints on Escape, from the canvas or anywhere, and a second Escape returns to Select', async () => {
    await mount(); await startSketch(); await snapToGrid();
    for (const [escape, at] of [[() => canvasKey('Escape'), 175], [windowEscape, 330]] as const) {
      await click('Line'); const before = currentSession.getSnapshot(), known = sketchGraph().entities.length, points = sketchGraph().points.length;
      await canvasClick(330, at); await canvasClick(450, at); await canvasClick(450, at - 60);
      expect(currentSession.getSnapshot().document).toBe(before.document);
      await escape();
      const added = sketchGraph().entities.slice(known);
      if (added.length !== 2 || added[0].kind !== 'line' || added[1].kind !== 'line') throw new Error('Expected two chained lines.');
      expect(added[0].endPointId).toBe(added[1].startPointId); expect(sketchGraph().points).toHaveLength(points + 3);
      expect(toolButton('Line').getAttribute('aria-pressed')).toBe('true'); expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
      // The chain is one edit, so one undo removes it whole.
      const saved = currentSession.getSnapshot().document;
      await act(async () => currentSession.undo()); expect(currentSession.getSnapshot().document).toEqual(before.document);
      await act(async () => currentSession.redo()); expect(currentSession.getSnapshot().document).toEqual(saved);
      await escape(); expect(toolButton('Select').getAttribute('aria-pressed')).toBe('true');
    }
  });

  it('saves a chain drawn in construction mode as construction edges', async () => {
    await mount(); await startSketch(); await snapToGrid(); await click('Line');
    const construction = container.querySelector<HTMLInputElement>('.cad-sketch-options input'); if (!construction) throw new Error('Construction control missing.');
    await act(async () => construction.click()); expect(construction.checked).toBe(true);
    const known = sketchGraph().entities.length;
    await canvasClick(330, 175); await canvasClick(450, 175); await canvasClick(450, 115);
    // The mode is chosen before drawing, so it stays fixed while the chain is pending.
    expect(construction.disabled).toBe(true);
    await canvasKey('Escape');
    expect(sketchGraph().entities.slice(known).map(entity => [entity.kind, entity.construction])).toEqual([['line', true], ['line', true]]);
  });

  it('discards a lone chain start on the first Escape and returns to Select on the next', async () => {
    await mount(); await startSketch(); await click('Line'); const before = currentSession.getSnapshot();
    await canvasClick(330, 175); expect(workflow).toHaveBeenLastCalledWith(true);
    await windowEscape(); expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version });
    expect(toolButton('Line').getAttribute('aria-pressed')).toBe('true'); expect(workflow).toHaveBeenLastCalledWith(false);
    await windowEscape(); expect(toolButton('Select').getAttribute('aria-pressed')).toBe('true');
  });

  it.each(['Arc', 'Rectangle', 'Circle', 'Slot'])('discards a pending %s on the first Escape from anywhere and returns to Select on the next', async label => {
    await mount(); await startSketch(); await click(label); const before = currentSession.getSnapshot();
    await canvasClick(330, 175); expect(workflow).toHaveBeenLastCalledWith(true);
    await windowEscape(); expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version });
    expect(toolButton(label).getAttribute('aria-pressed')).toBe('true'); expect(workflow).toHaveBeenLastCalledWith(false);
    await windowEscape(); expect(toolButton('Select').getAttribute('aria-pressed')).toBe('true');
  });

  it('builds the same graph whether a chain ends with Enter, Finish or a double-click', async () => {
    await mount(); await startSketch(); await snapToGrid(); await click('Line');
    const canvasDoubleClick = async (x: number, y: number) => { await act(async () => container.querySelector('[aria-label="Sketch drawing canvas"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y, detail: 2 }))); };
    const shapes: unknown[] = [];
    for (const finish of [() => canvasKey('Enter'), () => click('Finish chain'), () => canvasDoubleClick(450, 100)]) {
      const before = currentSession.getSnapshot();
      await canvasClick(330, 175); await canvasClick(450, 175); await canvasClick(450, 100); await finish();
      const { points, entities, relations } = sketchGraph(), index = new Map(points.map((point, at) => [point.id, at]));
      shapes.push({ points: points.map(point => point.position), entities: entities.map(entity => entity.kind === 'line' ? [index.get(entity.startPointId), index.get(entity.endPointId)] : entity.kind),
        relations: relations.map(relation => relation.kind) });
      await act(async () => currentSession.undo()); expect(currentSession.getSnapshot().document).toEqual(before.document);
    }
    expect(shapes[0]).toMatchObject({ entities: [[0, 1], [1, 2]] }); expect(shapes[1]).toEqual(shapes[0]); expect(shapes[2]).toEqual(shapes[0]);
  });

  it('keeps horizontal and vertical guides on chain lines but adds none to the line that closes the chain', async () => {
    await mount(); await startSketch(); await click('Line');
    // Each end lands one pixel off the guide from its line's start, and the last click returns to the chain start.
    await canvasClick(330, 300); await canvasClick(420, 301); await canvasClick(421, 360); await canvasClick(331, 361); await canvasClick(330, 300);
    const { points, entities, relations } = sketchGraph();
    expect(entities).toHaveLength(4); expect(points).toHaveLength(4);
    expect(relations.map(relation => relation.kind)).toEqual(['horizontal', 'vertical', 'horizontal']);
    const closing = entities[3]; if (closing.kind !== 'line') throw new Error('Expected the closing line.');
    expect(relations.some(relation => 'pointIds' in relation && relation.pointIds.includes(closing.startPointId) && relation.pointIds.includes(closing.endPointId))).toBe(false);
  });

  it('saves a pending chain open before a tool switch or Finish sketch, and keeps Line and the drawn chain when that save is rejected', async () => {
    let reject = false;
    await mount(createCadDocument(), { build: null, buildState: 'idle', onEdit: edit => {
      if (reject && edit.kind === 'append-sketch-entities') throw new Error('The sketch is read-only.');
      currentSession.edit([edit]);
    } });
    await startSketch(); await snapToGrid(); await click('Line');
    // A lone start keeps the tools waiting; once a segment is complete the toolbar stays in view and usable.
    await canvasClick(330, 175); expect(toolButton('Arc').disabled).toBe(true);
    await canvasClick(450, 175); await canvasClick(450, 100);
    expect(toolButton('Arc').closest('[hidden], [inert]')).toBeNull(); expect(toolButton('Arc').disabled).toBe(false);
    await click('Arc'); expect(sketchGraph().entities.map(entity => entity.kind)).toEqual(['line', 'line']);
    expect(toolButton('Arc').getAttribute('aria-pressed')).toBe('true');
    // A shortcut switches the same way.
    await click('Line'); await canvasClick(330, 330); await canvasClick(450, 330);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true })); });
    expect(sketchGraph().entities).toHaveLength(3); expect(toolButton('Circle').getAttribute('aria-pressed')).toBe('true');
    reject = true; await click('Line'); const before = currentSession.getSnapshot();
    await canvasClick(150, 50); await canvasClick(250, 50); await click('Select');
    expect(currentSession.getSnapshot().document).toBe(before.document); expect(toolButton('Line').getAttribute('aria-pressed')).toBe('true');
    expect(statusMessage).toHaveBeenLastCalledWith(expect.stringContaining('The sketch is read-only.'), 'error'); expect(button('Finish chain').disabled).toBe(false);
    await click('Finish sketch'); expect(currentSession.getSnapshot().document).toBe(before.document); expect(button('Finish sketch')).toBeDefined();
    reject = false; await click('Finish sketch');
    expect(sketchGraph().entities).toHaveLength(4); expect(container.querySelector('button[aria-label="Finish sketch"]')).toBeNull();
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  it('spends the second click of a double-click on the chain start once its closure is saved, leaving Line idle and the sketch finishable', async () => {
    await mount(); await startSketch(); await snapToGrid(); await click('Line');
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]'); if (!canvas) throw new Error('Sketch canvas missing.');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
    const tap = async (x: number, y: number, detail = 1) => {
      for (const type of ['pointerdown', 'pointerup', 'click']) {
        const event = new MouseEvent(type, { button: 0, buttons: type === 'pointerdown' ? 1 : 0, bubbles: true, cancelable: true, clientX: x, clientY: y, detail });
        Object.defineProperties(event, { pointerId: { value: 12 }, isPrimary: { value: type !== 'click' } });
        await act(async () => canvas.dispatchEvent(event));
      }
    };
    await tap(300, 200); await tap(450, 200); await tap(375, 100);
    // The first click closes the chain and its save is accepted before the second press arrives.
    await tap(300, 200); await tap(300, 200, 2);
    expect(sketchGraph().entities).toHaveLength(3); expect(sketchGraph().points).toHaveLength(3);
    expect(toolButton('Line').getAttribute('aria-pressed')).toBe('true'); expect(workflow).toHaveBeenLastCalledWith(false);
    expect(container.querySelector('button[aria-label="Finish chain"]')).toBeNull(); expect(button('Finish sketch').disabled).toBe(false);
    await click('Select'); expect(toolButton('Select').getAttribute('aria-pressed')).toBe('true');
  });

  it('closes a free line chain on its start into shared point identities and changes only a selected edge to construction', async () => {
    await mount(); await startSketch(); await snapToGrid(); await click('Line');
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
    // A click selects the dimension only; a double-click opens its editor.
    await act(async () => label.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true, detail: 1 })));
    expect(container.querySelector('.cad-parameter-editor')).toBeNull(); expect(viewport().getState().selectedSketchGeometrySet).toEqual([]);
    expect(container.querySelector('[data-cad-dimension-status]')?.textContent).toBe('Diameter selected · Double-click or Enter edits · Delete removes');
    await act(async () => label.dispatchEvent(new MouseEvent('dblclick', { button: 0, bubbles: true, cancelable: true, detail: 2 })));
    expect(field('Diameter').value).toBe('10'); expect(viewport().getState().selectedSketchGeometrySet).toEqual([]); expect(label.getAttribute('aria-pressed')).toBe('true');
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
    // The editor works on the ordered pair without selecting it; the dimension stays the selection.
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([]); expect(annotation.getAttribute('aria-pressed')).toBe('true');
    expect(field('Horizontal distance').value).toBe('-30'); expect(currentDocument.features[0]).toBe(sketch);
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  describe('canvas dimensions', () => {
    const bracket = () => parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Bracket', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [40, 0] }, { id: 'c', position: [40, 30] }, { id: 'o', position: [10, 10] }],
      entities: [{ id: 'base', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }, { id: 'side', kind: 'line', startPointId: 'b', endPointId: 'c', construction: false },
        { id: 'hole', kind: 'circle', centerPointId: 'o', radius: 4, construction: false }],
      relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 40 }, { id: 'diagonal', kind: 'distance', pointIds: ['a', 'c'], value: 50 },
        { id: 'angle', kind: 'line-angle', rays: [{ lineId: 'base', towardPointId: 'a' }, { lineId: 'side', towardPointId: 'c' }], sense: 'cw', value: 90 },
        { id: 'size', kind: 'radial-size', entityId: 'hole', quantity: 'diameter', value: 8 }, { id: 'x', kind: 'fixed-axis', pointId: 'o', axis: 'x', value: 10 },
        { id: 'measured', kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'side' } }] } }] });
    const open = async (props?: Parameters<typeof mount>[1], source = bracket()) => {
      setCadPreferences({ ...getCadPreferences(), showOnPartDimensions: true });
      await mount(source, props); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
      return source;
    };
    const relations = () => { const feature = currentDocument.features[0]; if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Sketch missing.'); return feature.graph.relations; };
    const label = (id: string) => {
      const found = container.querySelector<SVGGElement>(`[data-cad-sketch-dimension="${id}"] [role="button"]`); if (!found) throw new Error(`Dimension ${id} missing.`);
      return found;
    };
    const status = () => container.querySelector('[data-cad-dimension-status]')?.textContent ?? null;
    const selectedDimensions = () => [...container.querySelectorAll('[data-cad-sketch-dimension].is-selected')].map(item => item.getAttribute('data-cad-sketch-dimension'));
    const highlighted = (kind: 'point' | 'entity' | 'datum') => [...container.querySelectorAll(`[data-cad-highlight-${kind}]`)].map(item => item.getAttribute(`data-cad-highlight-${kind}`));
    // React derives enter and leave from pointerout and its related target.
    const hover = async (target: Element, entered = true) => {
      const canvas = container.querySelector('[aria-label="Sketch drawing canvas"]'); if (!canvas) throw new Error('Sketch canvas missing.');
      await act(async () => (entered ? canvas : target).dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: entered ? target : canvas })));
    };
    const pick = async (id: string, shiftKey = false) => act(async () => label(id).dispatchEvent(new MouseEvent('click', { button: 0, shiftKey, detail: 1, bubbles: true, cancelable: true })));
    const press = async (id: string, key: string) => act(async () => { label(id).focus(); label(id).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
    const menuItem = (text: string) => {
      const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(entry => entry.textContent?.trim() === text); if (!item) throw new Error(`${text} missing.`);
      return item;
    };
    type Relation = ReturnType<typeof relations>[number];
    /** An agent edit, undo or redo that rewrites the sketch relations. */
    const replace = (change: (current: readonly Relation[]) => readonly Relation[]) => act(async () => {
      const feature = currentDocument.features[0]; if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Sketch missing.');
      replaceDocument({ ...currentDocument, features: [{ ...feature, graph: { ...feature.graph, relations: change(feature.graph.relations) } }] });
    });
    const swap = (relation: Relation) => replace(current => current.map(item => item.id === relation.id ? relation : item));
    const entities = () => { const feature = currentDocument.features[0]; if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Sketch missing.'); return feature.graph.entities.map(entity => entity.id); };
    const geometry = () => viewport().getState().selectedSketchGeometrySet;
    const relationsPanel = () => container.querySelector('form[aria-label="Sketch relations"]');
    /** A relations panel row, named by the start of its relation label, such as `Angle` or `Distance relation 2`. */
    const relationRow = (name: string) => {
      const rows = [...container.querySelectorAll<HTMLButtonElement>('ul[aria-label="Sketch relations"] > li button[aria-label^="Inspect "]')];
      const found = rows.find(row => row.getAttribute('aria-label')?.startsWith(`Inspect ${name} `)); if (!found) throw new Error(`${name} row missing from ${rows.map(row => row.getAttribute('aria-label')).join(', ')}.`);
      return found;
    };
    const editRow = (name: string) => act(async () => relationRow(name).click());
    /** Opens a sketch edge's context menu from the keyboard and chooses an item. */
    const geometryMenu = async (id: string, item: string) => {
      const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]'); if (!canvas) throw new Error('Canvas missing.');
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
      const target = container.querySelector<SVGGElement>(`[data-cad-sketch-entity="${id}"]`); if (!target) throw new Error(`Edge ${id} missing.`);
      await act(async () => { target.focus(); target.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })); });
      await act(async () => menuItem(item).click());
    };

    it('highlights the measured geometry on hover without changing the document or the selection', async () => {
      const source = await open();
      await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'point', id: 'o' } }));
      for (const [id, points, entities] of [['length', ['a', 'b'], ['base']], ['diagonal', ['a', 'c'], []], ['angle', [], ['base', 'side']], ['size', [], ['hole']], ['measured', [], ['side']]] as const) {
        await hover(label(id).querySelector('rect')!);
        expect([highlighted('point'), highlighted('entity')]).toEqual([points, entities]);
        await hover(label(id).querySelector('rect')!, false);
        expect(container.querySelector('[data-cad-sketch-highlight]')).toBeNull();
      }
      // A datum coordinate has no canvas annotation; its relation row highlights the point and the axis it is measured from.
      const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]')!, point = container.querySelector<SVGGElement>('[data-cad-sketch-point="o"]')!;
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
      await act(async () => { point.focus(); point.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })); });
      await act(async () => menuItem('Constraints and dimensions').click());
      const row = [...container.querySelectorAll('ul[aria-label="Sketch relations"] > li')].find(item => item.textContent?.startsWith('Fix X'));
      if (!row) throw new Error('Datum relation row missing.');
      await act(async () => row.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
      expect([highlighted('point'), highlighted('datum')]).toEqual([['o'], ['y-axis']]);
      await act(async () => row.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
      expect(container.querySelector('[data-cad-sketch-highlight]')).toBeNull();
      expect(currentDocument).toBe(source); expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'point', id: 'o' }]);
    });

    it('selects with a click, toggles with Shift, clears with Escape and opens the editor only on double-click or Enter', async () => {
      const source = await open();
      await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'point', id: 'o' } }));
      await pick('length');
      expect(viewport().getState().selectedSketchGeometrySet).toEqual([]); expect(container.querySelector('.cad-parameter-editor')).toBeNull();
      expect(status()).toBe('Length selected · Double-click or Enter edits · Delete removes'); expect(selectedDimensions()).toEqual(['length']);
      // The selection keeps its geometry highlighted after the pointer leaves.
      expect(highlighted('entity')).toEqual(['base']); expect(label('length').getAttribute('aria-pressed')).toBe('true');
      await pick('size', true); expect(status()).toBe('2 dimensions selected · Delete removes them'); expect(selectedDimensions()).toEqual(['length', 'size']);
      await pick('length', true); expect(selectedDimensions()).toEqual(['size']);
      await press('diagonal', ' '); expect(selectedDimensions()).toEqual(['diagonal']);
      await canvasKey('Escape'); expect(selectedDimensions()).toEqual([]); expect(status()).toBeNull();
      expect(label('length').getAttribute('aria-label')).toBe('Dimension distance 40 mm, press Enter to edit');
      await press('diagonal', 'Enter'); expect(field('Distance').value).toBe('50');
      await act(async () => label('angle').dispatchEvent(new MouseEvent('dblclick', { button: 0, detail: 2, bubbles: true, cancelable: true })));
      expect(field('Angle').value).toBe('90'); expect(currentDocument).toBe(source);
      expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
    });

    it('still applies a selection-first constraint after a dimension was selected', async () => {
      await open(); await pick('size');
      await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'entity', id: 'side' } }));
      expect(selectedDimensions()).toEqual([]); expect(status()).toBeNull();
      await click('Constrain');
      const vertical = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(entry => entry.textContent?.trim() === 'Vertical');
      if (!vertical) throw new Error('Vertical missing.'); await act(async () => vertical.click());
      expect(relations().at(-1)).toEqual({ id: expect.any(String), kind: 'vertical', pointIds: ['b', 'c'] });
    });

    it('deletes the selected dimensions in one undoable edit and refuses while another edit is applying', async () => {
      const onEditMany = vi.fn<CadWorkbenchProps['onEditMany']>(edits => currentSession.edit(edits));
      await open({ build: null, buildState: 'idle', onEditMany });
      await pick('length'); await pick('size', true); await canvasKey('Delete');
      expect(onEditMany).toHaveBeenCalledOnce();
      expect(onEditMany.mock.calls[0][0]).toEqual([{ kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'length' }, { kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'size' }]);
      expect(relations().map(relation => relation.id)).toEqual(['diagonal', 'angle', 'x', 'measured']); expect(status()).toBeNull();
      // Focus never selects: Backspace on an unselected label removes the selection, and with nothing selected the focused label.
      await pick('diagonal'); await press('angle', 'Backspace');
      expect(relations().map(relation => relation.id)).toEqual(['angle', 'x', 'measured']); expect(selectedDimensions()).toEqual([]);
      let finish = () => undefined as void;
      onEditMany.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
      await press('angle', 'Delete'); await press('measured', 'Delete');
      expect(onEditMany).toHaveBeenCalledTimes(3); expect(onEditMany.mock.calls[2][0]).toEqual([{ kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'angle' }]);
      expect(relations().map(relation => relation.id)).toEqual(['angle', 'x', 'measured']);
      await act(async () => finish());
    });

    it('reports a refused removal in the relations list wording and keeps the dimension', async () => {
      await open({ build: null, buildState: 'idle', onEditMany: edits => {
        const graph = bracket().features[0];
        if (edits[0]?.kind === 'remove-sketch-relation' && graph.kind === 'sketch' && graph.graph) throw new CadSketchPreparationError({ sketchId: 'sketch', sketchName: 'Bracket', graph: graph.graph,
          rejection: { kind: 'rejected', reason: 'failed', message: 'Solver gave up.', diagnostics: { status: 'failed', degreesOfFreedom: 1, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] } } });
        currentSession.edit(edits);
      } });
      statusMessage.mockClear(); await pick('size'); await canvasKey('Delete');
      expect(statusMessage).toHaveBeenCalledWith(expect.stringContaining('Bracket: The sketch solver could not solve this edit.'), 'error');
      expect(relations().some(relation => relation.id === 'size')).toBe(true); expect(selectedDimensions()).toEqual(['size']);
    });

    it('lights the geometry from relation and issue rows in the dock without rendering the sketch canvas again', async () => {
      await open({ build: null, buildState: 'idle', onEditMany: () => {
        const feature = currentDocument.features[0]; if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Sketch missing.');
        throw new CadSketchPreparationError({ sketchId: 'sketch', sketchName: 'Bracket', graph: feature.graph, rejection: { kind: 'rejected', reason: 'conflicting', message: 'Over-defined.',
          diagnostics: { status: 'failed', degreesOfFreedom: null, conflictingIds: ['length', 'diagonal'], redundantIds: [], partiallyRedundantIds: [], issues: [] } } });
      } });
      const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]')!, point = container.querySelector<SVGGElement>('[data-cad-sketch-point="o"]')!;
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
      await act(async () => { point.focus(); point.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })); });
      await act(async () => menuItem('Constraints and dimensions').click());
      // A refused apply lists the conflicting relations as issue rows.
      const remove = container.querySelector<HTMLButtonElement>('ul[aria-label="Sketch relations"] > li button[aria-label^="Remove "]'); if (!remove) throw new Error('Remove button missing.');
      await act(async () => remove.click()); await click('Apply');
      const issues = [...container.querySelectorAll('ul[aria-label="Constraint issues"] > li')], rows = [...container.querySelectorAll('ul[aria-label="Sketch relations"] > li'), ...issues];
      expect(issues).toHaveLength(2);
      const panel = rows[0].closest('form')!, lit: (string | null)[][] = [];
      canvasRenders.mockClear();
      for (const row of rows) {
        await act(async () => panel.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: row })));
        for (const offset of [0, 4, 9]) await act(async () => {
          const event = new MouseEvent('pointermove', { bubbles: true, clientX: 700 + offset, clientY: 100 + offset }); Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
          row.dispatchEvent(event);
        });
        lit.push([...highlighted('point'), ...highlighted('entity')]);
        await act(async () => row.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: panel })));
      }
      expect(lit.slice(-2)).toEqual([['a', 'b'], ['a', 'c']]); expect(lit.every(entry => entry.length > 0)).toBe(true);
      expect(container.querySelector('[data-cad-sketch-highlight]')).toBeNull(); expect(canvasRenders).not.toHaveBeenCalled();
      // A move over the canvas itself does render it, so the count is live.
      await act(async () => {
        const event = new MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 200 }); Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
        canvas.dispatchEvent(event);
      });
      expect(canvasRenders).toHaveBeenCalled();
    });

    describe('a dock row highlight after an outside edit, which sends the row no blur or pointer leave', () => {
      const shown = () => [highlighted('point'), highlighted('entity')];
      const enter = async (kind: 'focused' | 'hovered', row: HTMLElement) => act(async () => {
        if (kind === 'focused') row.focus(); else row.closest('form')!.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: row }));
      });

      it.each(['focused', 'hovered'] as const)('hides the highlight of a %s relation row that the edit removes', async kind => {
        await open(); await geometryMenu('base', 'Constraints and dimensions');
        const row = relationRow('Distance relation 1'); await enter(kind, row);
        expect(shown()).toEqual([['a', 'b'], ['base']]);
        let left = 0; for (const name of ['blur', 'focusout', 'pointerout', 'pointerleave']) row.addEventListener(name, () => { left += 1; });
        await replace(current => current.filter(relation => relation.id !== 'length'));
        expect(row.isConnected).toBe(false); expect(left).toBe(0); expect(relationsPanel()).not.toBeNull();
        expect(container.querySelector('[data-cad-sketch-highlight]')).toBeNull();
      });

      // An outside edit resets the panel, which mounts its rows afresh: the pointer stays over the row, while focus goes to the body.
      it.each([['hovered', [['b', 'c'], ['side']]], ['focused', [[], []]]] as const)('follows a %s relation row whose operands the edit changes', async (kind, after) => {
        await open(); await geometryMenu('base', 'Constraints and dimensions');
        const row = relationRow('Distance relation 1'); await enter(kind, row);
        expect(shown()).toEqual([['a', 'b'], ['base']]);
        await swap({ id: 'length', kind: 'distance', pointIds: ['b', 'c'], value: 30 });
        expect(row.isConnected).toBe(false); expect(relationRow('Distance relation 1').getAttribute('aria-label')).toContain('Point 2 and Point 3');
        expect(shown()).toEqual(after);
      });

      it.each(['focused', 'hovered'] as const)('draws the highlight of a %s relation row again when the panel converts its relation in place', async kind => {
        await open(); await geometryMenu('base', 'Constraints and dimensions'); await editRow('Reference dimension relation 6');
        const row = relationRow('Reference dimension relation 6'); await enter(kind, row);
        expect(shown()).toEqual([[], ['side']]);
        // Make driving turns the draft into a driving length between the line's ends, in the same row; the drawn sketch,
        // and with it the selected dimension's own highlight, keeps the reference until Apply.
        await click('Make driving');
        expect(row.isConnected).toBe(true); if (kind === 'focused') expect(document.activeElement).toBe(row);
        expect(row.getAttribute('aria-label')).toMatch(/^Inspect Distance relation 6 /);
        expect(shown()).toEqual([['b', 'c'], ['side']]);
      });

      it('hides the highlight of a hovered issue row that the edit removes', async () => {
        await open({ build: null, buildState: 'idle', onEditMany: () => {
          const feature = currentDocument.features[0]; if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Sketch missing.');
          throw new CadSketchPreparationError({ sketchId: 'sketch', sketchName: 'Bracket', graph: feature.graph, rejection: { kind: 'rejected', reason: 'conflicting', message: 'Over-defined.',
            diagnostics: { status: 'failed', degreesOfFreedom: null, conflictingIds: ['length', 'diagonal'], redundantIds: [], partiallyRedundantIds: [], issues: [] } } });
        } });
        await geometryMenu('base', 'Constraints and dimensions');
        await act(async () => relationsPanel()!.querySelector<HTMLButtonElement>('button[aria-label^="Remove Angle"]')!.click()); await click('Apply');
        const issue = container.querySelector<HTMLElement>('ul[aria-label="Constraint issues"] > li'); if (!issue) throw new Error('Issue row missing.');
        await enter('hovered', issue); expect(shown()).toEqual([['a', 'b'], []]);
        // The unapplied removal keeps the draft, and the issues belong to the document the Apply was refused for.
        await replace(current => [...current, { id: 'ay', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 }]);
        expect(issue.isConnected).toBe(false); expect(relationsPanel()).not.toBeNull();
        expect(container.querySelector('[data-cad-sketch-highlight]')).toBeNull();
      });
    });

    it('never carries the selection or an open menu to a relation that reuses a dimension ID', async () => {
      await open();
      await pick('length');
      // A rewritten relation that measures the same points is the same dimension.
      await swap({ id: 'length', kind: 'distance', pointIds: ['b', 'a'], value: 40 }); expect(selectedDimensions()).toEqual(['length']);
      // An agent edit that reuses the ID for other points is a different dimension, so Delete has nothing to remove.
      await swap({ id: 'length', kind: 'distance', pointIds: ['b', 'c'], value: 30 });
      expect(selectedDimensions()).toEqual([]); expect(status()).toBeNull();
      const before = currentDocument; await canvasKey('Delete'); expect(currentDocument).toBe(before);
      // Undo and redo can remove a selected dimension and bring it back; it returns unselected.
      await pick('size'); const size = relations().find(relation => relation.id === 'size')!;
      await replace(current => current.filter(relation => relation.id !== 'size')); await replace(current => [...current, size]);
      expect(selectedDimensions()).toEqual([]);
      // An open menu closes when its dimension is replaced, and the replacement is neither selected nor removed.
      await press('angle', 'ContextMenu'); expect(document.querySelector('[role="menu"]')).not.toBeNull();
      await swap({ id: 'angle', kind: 'line-angle', rays: [{ lineId: 'base', towardPointId: 'b' }, { lineId: 'side', towardPointId: 'c' }], sense: 'ccw', value: 90 });
      expect(document.querySelector('[role="menu"]')).toBeNull(); expect(selectedDimensions()).toEqual([]);
      expect(relations().some(relation => relation.id === 'angle')).toBe(true);
    });

    it('offers edit, reference or driving and delete from the dimension menu, with reasons for unavailable commands', async () => {
      await open();
      // The menu key on an unselected dimension selects it first.
      await press('angle', 'ContextMenu'); expect(selectedDimensions()).toEqual(['angle']);
      expect(menuItem('Make reference').disabled).toBe(true);
      expect(menuItem('Make reference').getAttribute('aria-description')).toBe('Reference dimensions measure lengths, point distances, point to line distances, radii and diameters.');
      await act(async () => menuItem('Edit value…').click()); expect(field('Angle').value).toBe('90');
      await press('length', 'ContextMenu'); await act(async () => menuItem('Make reference').click());
      expect(relations().find(relation => relation.id === 'length')).toEqual({ id: 'length', kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'base' } });
      // The reference measures the same length, so it stays selected.
      expect(label('length').getAttribute('aria-label')).toMatch(/^Reference dimension /); expect(selectedDimensions()).toEqual(['length']);
      await press('measured', 'ContextMenu');
      expect(menuItem('Edit value…').disabled).toBe(true);
      expect(menuItem('Edit value…').getAttribute('aria-description')).toBe('A reference dimension follows the geometry. Make it driving to set its value.');
      await act(async () => menuItem('Make driving').click());
      expect(relations().find(relation => relation.id === 'measured')).toEqual({ id: 'measured', kind: 'distance', pointIds: ['b', 'c'], value: 30 }); expect(selectedDimensions()).toEqual(['measured']);
      await pick('size'); await pick('diagonal', true); await press('size', 'ContextMenu');
      await act(async () => menuItem('Delete 2 dimensions').click());
      expect(relations().map(relation => relation.id)).toEqual(['length', 'angle', 'x', 'measured']);
      expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
    });

    it.each([
      ['Enter', (id: string) => press(id, 'Enter')],
      ['a double-click', (id: string) => act(async () => label(id).dispatchEvent(new MouseEvent('dblclick', { button: 0, detail: 2, bubbles: true, cancelable: true })))],
      ['Edit value…', async (id: string) => { await press(id, 'ContextMenu'); await act(async () => menuItem('Edit value…').click()); }]
    ] as const)('keeps the dimension, not its geometry, selected after %s opens its editor, so Delete never removes geometry', async (_, edit) => {
      // There is no solver here, so Apply sizes the hole the way the solver would.
      await open({ build: null, buildState: 'idle', onEditMany: edits => currentSession.edit(edits.map((item): CadEdit => {
        const feature = currentDocument.features[0];
        if (item.kind !== 'set-sketch-relation' || item.relation.kind !== 'radial-size' || feature.kind !== 'sketch' || !feature.graph) return item;
        const relation = item.relation, entities = feature.graph.entities.map(entity => entity.id === relation.entityId && entity.kind === 'circle' ? { ...entity, radius: Number(relation.value) / 2 } : entity);
        return { kind: 'update-feature', feature: { ...feature, graph: { ...feature.graph, entities, relations: feature.graph.relations.map(entry => entry.id === relation.id ? relation : entry) } } };
      })) });
      await edit('length'); expect(field('Length').value).toBe('40');
      expect(viewport().getState().selectedSketchGeometrySet).toEqual([]); expect(selectedDimensions()).toEqual(['length']);
      // Delete with the editor open removes the dimension drawn selected, not the line it measures, and closes its editor.
      await canvasKey('Delete');
      expect(relations().map(relation => relation.id)).toEqual(['diagonal', 'angle', 'size', 'x', 'measured']); expect(entities()).toEqual(['base', 'side', 'hole']);
      expect(container.querySelector('ul[aria-label="Sketch relations"]')).toBeNull();
      // Cancel and Apply keep the edited dimension selected.
      await edit('size'); await input(field('Diameter'), '9'); await click('Cancel');
      expect(selectedDimensions()).toEqual(['size']); expect(viewport().getState().selectedSketchGeometrySet).toEqual([]);
      await edit('size'); await input(field('Diameter'), '10'); await click('Apply');
      expect(relations().find(relation => relation.id === 'size')).toMatchObject({ value: 10 });
      expect(selectedDimensions()).toEqual(['size']); expect(viewport().getState().selectedSketchGeometrySet).toEqual([]);
      await canvasKey('Delete');
      expect(relations().map(relation => relation.id)).toEqual(['diagonal', 'angle', 'x', 'measured']); expect(entities()).toEqual(['base', 'side', 'hole']);
    });

    it('never leaves focus, or returns it from a menu, on a label whose dimension was replaced under the same ID', async () => {
      await open();
      const pressFocused = (key: string) => act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
      // Keyboard only: an agent edit reuses the focused label's ID for other points, and Delete has nothing to act on.
      const focused = label('length'); await act(async () => focused.focus());
      await swap({ id: 'length', kind: 'distance', pointIds: ['b', 'c'], value: 30 });
      expect(label('length')).not.toBe(focused); expect(document.activeElement?.closest('[data-cad-sketch-dimension]') ?? null).toBeNull();
      let before = currentDocument; await pressFocused('Delete'); await pressFocused('Backspace'); expect(currentDocument).toBe(before);
      // A menu that the replacement closes does not hand focus to the new label.
      await press('angle', 'ContextMenu'); expect(document.querySelector('[role="menu"]')).not.toBeNull();
      await swap({ id: 'angle', kind: 'line-angle', rays: [{ lineId: 'base', towardPointId: 'b' }, { lineId: 'side', towardPointId: 'c' }], sense: 'ccw', value: 90 });
      expect(document.querySelector('[role="menu"]')).toBeNull(); expect(document.activeElement?.closest('[data-cad-sketch-dimension]') ?? null).toBeNull();
      before = currentDocument; await pressFocused('Delete'); expect(currentDocument).toBe(before);
      // A right press on a label whose dimension is replaced before the release opens no menu for the replacement.
      const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]'); if (!canvas) throw new Error('Sketch canvas missing.');
      let captured = false;
      Object.assign(canvas, { setPointerCapture: () => { captured = true; }, hasPointerCapture: () => captured, releasePointerCapture: () => { captured = false; } });
      const right = (target: Element, type: 'pointerdown' | 'pointerup') => act(async () => {
        const event = new MouseEvent(type, { button: 2, buttons: type === 'pointerup' ? 0 : 2, bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
        Object.defineProperties(event, { pointerId: { value: 12 }, isPrimary: { value: true } }); target.dispatchEvent(event);
      });
      await right(label('size'), 'pointerdown');
      await swap({ id: 'size', kind: 'radial-size', entityId: 'hole', quantity: 'radius', value: 4 });
      await right(canvas, 'pointerup'); expect(document.querySelector('[role="menu"]')).toBeNull(); expect(selectedDimensions()).toEqual([]);
      // A rewrite that measures the same points keeps the label and its focus, and Delete removes that dimension alone.
      const kept = label('diagonal'); await act(async () => kept.focus());
      await swap({ id: 'diagonal', kind: 'distance', pointIds: ['c', 'a'], value: 50 });
      expect(label('diagonal')).toBe(kept); expect(document.activeElement).toBe(kept);
      await pressFocused('Delete');
      expect(relations().map(relation => relation.id)).toEqual(['length', 'angle', 'size', 'x', 'measured']); expect(entities()).toEqual(['base', 'side', 'hole']);
      // The same right press on an unchanged label opens its menu.
      await right(label('size'), 'pointerdown'); await right(canvas, 'pointerup');
      expect(document.querySelector('[role="menu"]')).not.toBeNull(); expect(selectedDimensions()).toEqual(['size']);
    });

    it('moves the selection to the dimension row that the relations panel switches to, so Delete removes the dimension its editor shows', async () => {
      await open();
      await press('length', 'Enter'); expect(field('Length').value).toBe('40'); expect(selectedDimensions()).toEqual(['length']);
      await editRow('Angle'); expect(field('Angle').value).toBe('90');
      expect(relationRow('Angle').getAttribute('aria-pressed')).toBe('true'); expect(selectedDimensions()).toEqual(['angle']); expect(geometry()).toEqual([]);
      await canvasKey('Delete');
      expect(relations().map(relation => relation.id)).toEqual(['length', 'diagonal', 'size', 'x', 'measured']); expect(entities()).toEqual(['base', 'side', 'hole']);
      expect(relationsPanel()).toBeNull();
    });

    it('selects the dimension, not the geometry, that a geometry menu opens for editing', async () => {
      await open();
      await geometryMenu('base', 'Constraints and dimensions');
      expect(geometry()).toEqual([{ kind: 'entity', id: 'base' }]); expect(selectedDimensions()).toEqual([]);
      await editRow('Distance relation 1'); expect(field('Length').value).toBe('40');
      expect(geometry()).toEqual([]); expect(selectedDimensions()).toEqual(['length']);
      await canvasKey('Delete');
      expect(relations().map(relation => relation.id)).toEqual(['diagonal', 'angle', 'size', 'x', 'measured']); expect(entities()).toEqual(['base', 'side', 'hole']);
      // The menu's Dimension on a dimensioned circle opens its existing dimension the same way.
      await geometryMenu('hole', 'Dimension'); expect(field('Diameter').value).toBe('8');
      expect(geometry()).toEqual([]); expect(selectedDimensions()).toEqual(['size']);
      await canvasKey('Delete');
      expect(relations().map(relation => relation.id)).toEqual(['diagonal', 'angle', 'x', 'measured']); expect(entities()).toEqual(['base', 'side', 'hole']);
    });

    it('keeps the selection to the dimension being edited alone, and closes its editor once anything else takes the selection', async () => {
      await open();
      // Opening one of several selected dimensions selects that dimension alone.
      await pick('length'); await pick('diagonal', true); expect(selectedDimensions()).toEqual(['length', 'diagonal']);
      await press('diagonal', 'Enter'); expect(field('Distance').value).toBe('50');
      expect(selectedDimensions()).toEqual(['diagonal']); expect(geometry()).toEqual([]);
      // A row that is not a canvas dimension returns the selection to the geometry the panel works on; a dimension row takes it back.
      await press('size', 'Enter'); expect(selectedDimensions()).toEqual(['size']);
      await editRow('Fix X'); expect(relationsPanel()).not.toBeNull();
      expect(selectedDimensions()).toEqual([]); expect(geometry()).toEqual([{ kind: 'entity', id: 'hole' }]);
      await editRow('Diameter'); expect(field('Diameter').value).toBe('8'); expect(selectedDimensions()).toEqual(['size']); expect(geometry()).toEqual([]);
      // Geometry or another dimension taking the selection closes the editor.
      await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'point', id: 'o' } }));
      expect(relationsPanel()).toBeNull(); expect(selectedDimensions()).toEqual([]);
      await press('length', 'Enter'); expect(relationsPanel()).not.toBeNull();
      await pick('angle'); expect(relationsPanel()).toBeNull(); expect(selectedDimensions()).toEqual(['angle']);
    });

    it('closes a dimension editor when a legacy profile takes the selection', async () => {
      setCadPreferences({ ...getCadPreferences(), showOnPartDimensions: true });
      const source = bracket(), sketch = source.features[0]; if (sketch.kind !== 'sketch') throw new Error('Sketch missing.');
      await mount(parseCadDocument({ ...source, features: [{ ...sketch, profiles: [{ id: 'plate', name: 'Plate', construction: false, role: 'outer',
        geometry: { kind: 'rectangle', x: 0, y: 0, width: 50, height: 40, cornerRadius: 0 } }] }] }));
      await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
      await press('size', 'Enter'); expect(field('Diameter').value).toBe('8');
      await act(async () => viewport().apply({ kind: 'select-profile', profileId: 'plate' }));
      expect(viewport().getState().selectedProfileId).toBe('plate'); expect(relationsPanel()).toBeNull(); expect(selectedDimensions()).toEqual([]);
      expect(container.querySelector('button[aria-label="Add dimension"]')).not.toBeNull();
    });

    it('closes a dimension editor when another document opens under the same sketch and relation IDs', async () => {
      await open();
      await press('size', 'Enter'); expect(field('Diameter').value).toBe('8');
      // The editor never renders against the new document, even before the switch clears the selection, so none of its fields takes focus there.
      let refocused = 0; const record = (event: FocusEvent) => { if (event.target instanceof Element && event.target.closest('form[aria-label="Sketch relations"]')) refocused += 1; };
      container.addEventListener('focusin', record);
      await act(async () => replaceDocument({ ...currentDocument, id: 'other-document' }));
      container.removeEventListener('focusin', record);
      expect(relationsPanel()).toBeNull(); expect(selectedDimensions()).toEqual([]); expect(refocused).toBe(0);
      // The new document's dimension opens its own editor.
      await press('size', 'Enter'); expect(field('Diameter').value).toBe('8'); expect(selectedDimensions()).toEqual(['size']);
      // A row that is not a dimension, open on the geometry the editor measured, never mounts in another part either.
      await editRow('Fix X'); expect(relationRow('Fix X').getAttribute('aria-pressed')).toBe('true'); expect(geometry()).toEqual([{ kind: 'entity', id: 'hole' }]);
      container.addEventListener('focusin', record);
      await act(async () => replaceDocument({ ...currentDocument, id: 'third-document' }));
      container.removeEventListener('focusin', record);
      expect(relationsPanel()).toBeNull(); expect(geometry()).toEqual([]); expect(refocused).toBe(0);
    });

    it('deletes the selection, not a focused label or edge outside it, so Delete removes what is drawn selected', async () => {
      await open();
      const ids = () => relations().map(relation => relation.id);
      const points = () => { const feature = currentDocument.features[0]; return feature.kind === 'sketch' ? feature.graph?.points.map(point => point.id) : undefined; };
      const pressGeometry = (selector: string, key: string) => act(async () => {
        const target = container.querySelector<SVGElement>(selector); if (!target) throw new Error(`${selector} missing.`);
        target.focus(); target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      });
      // Length's editor is open and keyboard focus moves to the unselected Diagonal label: Delete removes Length and closes its editor.
      await press('length', 'Enter'); expect(field('Length').value).toBe('40');
      await press('diagonal', 'Delete');
      expect(ids()).toEqual(['diagonal', 'angle', 'size', 'x', 'measured']); expect(relationsPanel()).toBeNull(); expect(selectedDimensions()).toEqual([]);
      // A focused edge removes the dimension selection, never itself.
      await pick('size'); await pressGeometry('[data-cad-sketch-entity="base"]', 'Delete');
      expect(ids()).toEqual(['diagonal', 'angle', 'x', 'measured']); expect(entities()).toEqual(['base', 'side', 'hole']);
      // Selected geometry goes on Delete from a label and stays on Backspace, which removes only dimensions; the label's dimension stays.
      await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'entity', id: 'hole' } }));
      await press('angle', 'Backspace'); expect(ids()).toEqual(['diagonal', 'angle', 'x', 'measured']); expect(entities()).toEqual(['base', 'side', 'hole']);
      await press('angle', 'Delete'); expect(entities()).toEqual(['base', 'side']); expect(ids()).toEqual(['diagonal', 'angle', 'x', 'measured']);
      // A selected point goes, not the focused edge.
      await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'point', id: 'o' } }));
      await pressGeometry('[data-cad-sketch-entity="side"]', 'Delete'); expect(entities()).toEqual(['base', 'side']); expect(points()).toEqual(['a', 'b', 'c']); expect(ids()).toEqual(['diagonal', 'angle', 'measured']);
      // With nothing selected the focused label or edge is the one removed.
      await press('diagonal', 'Delete'); expect(ids()).toEqual(['angle', 'measured']);
      await pressGeometry('[data-cad-sketch-entity="side"]', 'Delete'); expect(entities()).toEqual(['base']);
    });

    it('selects, edits, converts, highlights and deletes a point to line distance the circle double-pick made from its center', async () => {
      // There is no solver here, so Apply moves the center the way the solver would; the base line lies on the X axis.
      await open({ build: null, buildState: 'idle', onEditMany: edits => currentSession.edit(edits.map((item): CadEdit => {
        const feature = currentDocument.features[0];
        if (item.kind !== 'set-sketch-relation' || item.relation.kind !== 'point-line-distance' || feature.kind !== 'sketch' || !feature.graph) return item;
        const relation = item.relation, existing = feature.graph.relations.some(entry => entry.id === relation.id);
        const points = feature.graph.points.map(point => point.id === relation.pointId ? { ...point, position: [point.position[0], Number(relation.value)] as const } : point);
        const relations = existing ? feature.graph.relations.map(entry => entry.id === relation.id ? relation : entry) : [...feature.graph.relations, relation];
        return { kind: 'update-feature', feature: { ...feature, graph: { ...feature.graph, points, relations } } };
      })) });
      const choose = (selector: string) => act(async () => {
        const target = container.querySelector(selector); if (!target) throw new Error(`${selector} missing.`);
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      });
      // The circle, then the line: the distance runs from the circle's center.
      await click('Dimension'); await choose('[data-cad-sketch-entity="hole"]'); await choose('[data-cad-sketch-entity="base"]');
      expect(field('Point to line distance').value).toBe('10'); await click('Apply');
      const created = relations().find(relation => relation.kind === 'point-line-distance'); if (!created) throw new Error('Point to line distance missing.');
      expect(created).toEqual({ id: expect.any(String), kind: 'point-line-distance', pointId: 'o', lineId: 'base', side: 'left', value: 10 });
      const id = created.id;
      await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: null }));
      // Hover highlights the center and the line; a click selects the dimension alone.
      await hover(label(id).querySelector('rect')!); expect([highlighted('point'), highlighted('entity')]).toEqual([['o'], ['base']]);
      await hover(label(id).querySelector('rect')!, false);
      await pick(id); expect(selectedDimensions()).toEqual([id]); expect(geometry()).toEqual([]);
      expect(status()).toBe('Point to line distance selected · Double-click or Enter edits · Delete removes');
      expect([highlighted('point'), highlighted('entity')]).toEqual([['o'], ['base']]);
      // Enter edits it on its center and line and keeps it selected.
      await press(id, 'Enter'); expect(field('Point to line distance').value).toBe('10');
      expect(selectedDimensions()).toEqual([id]); expect(geometry()).toEqual([]);
      expect(relationsPanel()?.querySelector('.cad-property-title')?.textContent).toBe('2 selected');
      await input(field('Point to line distance'), '12'); await click('Apply');
      expect(relations().find(relation => relation.id === id)).toEqual({ ...created, value: 12 }); expect(selectedDimensions()).toEqual([id]);
      // Make reference measures the same point and line under the same ID, and Make driving restores the distance on the same side.
      await press(id, 'ContextMenu'); await act(async () => menuItem('Make reference').click());
      expect(relations().find(relation => relation.id === id)).toEqual({ id, kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: 'o', lineId: 'base' } });
      expect(selectedDimensions()).toEqual([id]); expect([highlighted('point'), highlighted('entity')]).toEqual([['o'], ['base']]);
      await press(id, 'ContextMenu'); await act(async () => menuItem('Make driving').click());
      expect(relations().find(relation => relation.id === id)).toMatchObject({ id, kind: 'point-line-distance', pointId: 'o', lineId: 'base', side: 'left' });
      expect(selectedDimensions()).toEqual([id]);
      // A focused label elsewhere deletes the selected distance, and only that.
      await press('length', 'Delete');
      expect(relations().map(relation => relation.id)).toEqual(['length', 'diagonal', 'angle', 'size', 'x', 'measured']); expect(selectedDimensions()).toEqual([]);
    });

    it('keeps a dimension selected when its editor converts a driver stored on a coincident alias, and drops one replaced by another measurement', async () => {
      // The base line's length is stored on q, which a Coincident relation joins to a; the clearance runs from r, joined to the center o.
      const aliased = () => { const source = bracket(), feature = source.features[0]; if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Sketch missing.');
        return parseCadDocument({ ...source, features: [{ ...feature, graph: { ...feature.graph, points: [...feature.graph.points, { id: 'q', position: [0, 0] }, { id: 'r', position: [10, 10] }],
          relations: [{ id: 'joint', kind: 'coincident', pointIds: ['q', 'a'] }, { id: 'center', kind: 'coincident', pointIds: ['r', 'o'] },
            ...feature.graph.relations.map(relation => relation.id === 'length' ? { id: 'length', kind: 'distance' as const, pointIds: ['q', 'b'] as const, value: 40 } : relation),
            { id: 'clearance', kind: 'point-line-distance', pointId: 'r', lineId: 'base', side: 'left', value: 10 }] } }] }); };
      await open(undefined, aliased());
      // The line's Dimension editor opens the driver on q, and Reference length stores the reference on the line itself.
      await geometryMenu('base', 'Dimension'); expect(field('Length').value).toBe('40');
      expect(selectedDimensions()).toEqual(['length']); expect(geometry()).toEqual([]);
      await click('Reference length'); await click('Apply');
      expect(relations().find(relation => relation.id === 'length')).toEqual({ id: 'length', kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'base' } });
      expect(selectedDimensions()).toEqual(['length']);
      // Make driving brings it back on the line's endpoints, still selected, so a canvas Delete removes it.
      await press('length', 'ContextMenu'); await act(async () => menuItem('Make driving').click());
      expect(relations().find(relation => relation.id === 'length')).toEqual({ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 40 }); expect(selectedDimensions()).toEqual(['length']);
      await canvasKey('Delete'); expect(relations().some(relation => relation.id === 'length')).toBe(false);
      // The circle double-pick opens the clearance stored on r, and Reference distance stores it on the center it picked.
      const choose = (selector: string) => act(async () => {
        const target = container.querySelector(selector); if (!target) throw new Error(`${selector} missing.`);
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      });
      await click('Dimension'); await choose('[data-cad-sketch-entity="hole"]'); await choose('[data-cad-sketch-entity="base"]');
      expect(field('Point to line distance').value).toBe('10'); expect(selectedDimensions()).toEqual(['clearance']);
      await click('Reference distance'); await click('Apply');
      expect(relations().find(relation => relation.id === 'clearance')).toEqual({ id: 'clearance', kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: 'o', lineId: 'base' } });
      expect(selectedDimensions()).toEqual(['clearance']);
      // A driver from the alias to another line under the same ID is a different dimension and drops the selection.
      await swap({ id: 'clearance', kind: 'point-line-distance', pointId: 'r', lineId: 'side', side: 'left', value: 30 });
      expect(label('clearance').getAttribute('aria-label')).toMatch(/^Dimension /); expect(selectedDimensions()).toEqual([]);
    });

    describe('across one edit that converts the selected dimensions and removes or adds their Coincident joins', () => {
      // The length runs from q and the clearance from r. Joined, q sits on a, the base line's start, and r on the center o; apart, both have moved.
      const variant = (joined: boolean, driving: boolean) => { const source = bracket(), feature = source.features[0]; if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Sketch missing.');
        return parseCadDocument({ ...source, features: [{ ...feature, graph: { ...feature.graph,
          points: [...feature.graph.points, { id: 'q', position: joined ? [0, 0] : [-20, 0] }, { id: 'r', position: joined ? [10, 10] : [30, 25] }],
          relations: [...joined ? [{ id: 'joint', kind: 'coincident', pointIds: ['q', 'a'] }, { id: 'center', kind: 'coincident', pointIds: ['r', 'o'] }] : [],
            ...feature.graph.relations.filter(relation => relation.id !== 'length'),
            ...driving ? [{ id: 'length', kind: 'distance', pointIds: ['q', 'b'], value: joined ? 40 : 60 }, { id: 'clearance', kind: 'point-line-distance', pointId: 'r', lineId: 'base', side: 'left', value: joined ? 10 : 25 }]
              : [{ id: 'length', kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'base' } }, { id: 'clearance', kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: 'o', lineId: 'base' } }]] } }] }); };
      /** One undoable edit that replaces the sketch with another variant. */
      const convert = (next: ReturnType<typeof variant>) => act(async () => { await currentSession.editPrepared(currentSession.getSnapshot().version, async source => ({ ...source, features: next.features })); });
      const both = async () => { await pick('length'); await pick('clearance', true); expect(selectedDimensions()).toEqual(['length', 'clearance']); };
      const measured = () => relations().filter(relation => relation.id === 'length' || relation.id === 'clearance');
      const form = () => relations().find(relation => relation.id === 'length')?.kind;
      const undo = () => act(async () => currentSession.undo()), redo = () => act(async () => currentSession.redo());

      it('drops the selection when the edit removes the joins, so Delete leaves the replacements alone', async () => {
        // The review's repro: the edit moves q and r away and makes each dimension a reference on the line and on o, other measurements now.
        await open(undefined, variant(true, true)); await both();
        await convert(variant(false, false)); expect(form()).toBe('reference-dimension'); expect(selectedDimensions()).toEqual([]);
        const references = measured(); await canvasKey('Delete'); expect(measured()).toEqual(references);
      });
      it('keeps the selection when the edit adds the joins, so Delete removes both', async () => {
        await open(undefined, variant(false, true)); await both();
        await convert(variant(true, false)); expect(form()).toBe('reference-dimension'); expect(selectedDimensions()).toEqual(['length', 'clearance']);
        await canvasKey('Delete'); expect(measured()).toEqual([]);
      });
      it('keeps the selection on undo to the joined sketch and drops it on redo of the edit that removes the joins', async () => {
        await open(undefined, variant(true, true)); await convert(variant(false, false)); await both();
        await undo(); expect(form()).toBe('distance'); expect(selectedDimensions()).toEqual(['length', 'clearance']);
        await redo(); expect(form()).toBe('reference-dimension'); expect(selectedDimensions()).toEqual([]);
      });
      it('drops the selection on undo to the loose sketch and keeps it on redo of the edit that adds the joins', async () => {
        await open(undefined, variant(false, true)); await convert(variant(true, false)); await both();
        await undo(); expect(form()).toBe('distance'); expect(selectedDimensions()).toEqual([]);
        await both(); await redo(); expect(form()).toBe('reference-dimension'); expect(selectedDimensions()).toEqual(['length', 'clearance']);
      });
    });

    it('lets a datum selection and a dimension selection replace each other, and a focused label never deletes past a datum selection', async () => {
      await open();
      const datum = (name: string) => { const found = container.querySelector<SVGElement>(`[data-cad-sketch-datum="${name}"][role="button"]`); if (!found) throw new Error(`${name} missing.`); return found; };
      const chooseDatum = (name: string, shiftKey = false) => act(async () => { datum(name).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true, cancelable: true })); });
      const pressed = () => ['origin', 'x-axis', 'y-axis'].filter(name => container.querySelector(`[data-cad-sketch-datum="${name}"]`)?.getAttribute('aria-pressed') === 'true');
      await pick('length'); expect(selectedDimensions()).toEqual(['length']);
      // An axis replaces the dimension selection, plainly or with Shift.
      await chooseDatum('x-axis'); expect(selectedDimensions()).toEqual([]); expect(pressed()).toEqual(['x-axis']); expect(status()).toBeNull();
      await pick('length'); expect(selectedDimensions()).toEqual(['length']); expect(pressed()).toEqual([]);
      await chooseDatum('y-axis', true); expect(selectedDimensions()).toEqual([]); expect(pressed()).toEqual(['y-axis']);
      // A Shift pick on a label replaces the axes with that dimension.
      await pick('angle', true); expect(selectedDimensions()).toEqual(['angle']); expect(pressed()).toEqual([]);
      // An axis closes an open dimension editor.
      await press('length', 'Enter'); expect(field('Length').value).toBe('40');
      await chooseDatum('x-axis'); expect(relationsPanel()).toBeNull(); expect(selectedDimensions()).toEqual([]); expect(pressed()).toEqual(['x-axis']);
      // With an axis selected, Delete or Backspace on a focused label removes nothing and keeps the axis.
      const before = relations();
      await press('diagonal', 'Delete'); await press('length', 'Backspace');
      expect(relations()).toBe(before); expect(pressed()).toEqual(['x-axis']); expect(selectedDimensions()).toEqual([]);
    });

    describe('a dimension line or arrow, which takes the pointer only where no geometry or datum lies', () => {
      const pointerSetup = () => {
        const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]'); if (!canvas) throw new Error('Sketch canvas missing.');
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
        let captured = false;
        Object.assign(canvas, { setPointerCapture: () => { captured = true; }, hasPointerCapture: () => captured, releasePointerCapture: () => { captured = false; } });
        const view = viewport().getState().view; if (!view || view.mode === 'solid') throw new Error('Sketch frame missing.');
        const viewWidth = Number(canvas.getAttribute('viewBox')?.split(' ')[2]);
        /** The client position of a point drawn in the graph layer, whose coordinates are relative to the view centre. */
        const at = (x: number, y: number) => ({ clientX: 300 + x / viewWidth * 600, clientY: 200 - y / view.heightSpanMm * 400 });
        const hit = (id: string) => {
          const found = container.querySelector<SVGGElement>(`[data-cad-sketch-dimension-hit="${id}"]`); if (!found) throw new Error(`Dimension line ${id} missing.`);
          const line = found.querySelector('line')!, value = (name: string) => Number(line.getAttribute(name));
          return { element: line, start: at(value('x1'), value('y1')), end: at(value('x2'), value('y2')),
            along: (share: number) => at(value('x1') + (value('x2') - value('x1')) * share, value('y1') + (value('y2') - value('y1')) * share) };
        };
        const arrowTip = (id: string) => {
          const [x, y] = container.querySelector(`[data-cad-sketch-dimension="${id}"] .cad-sketch-graph-dimension-arrow`)!.getAttribute('points')!.split(' ')[0].split(',').map(Number);
          return at(x, y);
        };
        const send = (target: Element, type: string, position: { clientX: number; clientY: number }, init: MouseEventInit = {}) => act(async () => {
          const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...position, ...init });
          Object.defineProperties(event, { pointerId: { value: 7 }, isPrimary: { value: true } }); target.dispatchEvent(event);
        });
        // Each press goes to the dimension's line as drawn now. A press the canvas takes captures the pointer, and a box it begins
        // makes the dimensions inert and draws their lines again, so its release and click reach the canvas.
        const released = (target: Element) => target.isConnected ? target : canvas;
        const clickAt = async (id: string, position: { clientX: number; clientY: number }, init: MouseEventInit = {}, detail = 1) => {
          const target = hit(id).element;
          await send(target, 'pointerdown', position, { button: 0, buttons: 1, ...init }); await send(released(target), 'pointerup', position, { button: 0, buttons: 0, ...init });
          await send(released(target), 'click', position, { button: 0, detail, ...init });
        };
        const doubleClickAt = async (id: string, position: { clientX: number; clientY: number }) => {
          await clickAt(id, position); await clickAt(id, position, {}, 2); await send(released(hit(id).element), 'dblclick', position, { button: 0, detail: 2 });
        };
        const rightClickAt = async (id: string, position: { clientX: number; clientY: number }) => {
          await send(hit(id).element, 'pointerdown', position, { button: 2, buttons: 2 }); await send(canvas, 'pointerup', position, { button: 2, buttons: 0 });
        };
        const datumPressed = () => ['origin', 'x-axis', 'y-axis'].filter(name => container.querySelector(`[data-cad-sketch-datum="${name}"]`)?.getAttribute('aria-pressed') === 'true');
        const datumHovered = () => [...container.querySelectorAll('[data-cad-sketch-datum].is-pick-highlighted')].map(item => item.getAttribute('data-cad-sketch-datum'));
        const menuItems = () => [...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent?.trim());
        return { canvas, hit, arrowTip, send, clickAt, doubleClickAt, rightClickAt, datumPressed, datumHovered, menuItems };
      };

      it('lies beneath every sketch point and edge, while the labels lie above them', async () => {
        await open();
        const layer = container.querySelector('.cad-sketch-graph-dimension-hits'), rows = [...container.querySelectorAll('[data-cad-sketch-point], [data-cad-sketch-entity]')];
        expect(layer?.querySelectorAll('[data-cad-sketch-dimension-hit]').length).toBe(container.querySelectorAll('[data-cad-sketch-dimension]').length);
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(layer!.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
          expect(row.compareDocumentPosition(label('length')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
      });

      it('selects, toggles and edits its dimension and opens its menu away from the geometry and datums', async () => {
        await open(); const { hit, clickAt, doubleClickAt, rightClickAt, menuItems } = pointerSetup();
        const middle = hit('length').along(.5);
        await clickAt('length', middle);
        expect(selectedDimensions()).toEqual(['length']); expect(document.activeElement).toBe(label('length'));
        await clickAt('size', hit('size').along(.25), { shiftKey: true }); expect(selectedDimensions()).toEqual(['length', 'size']);
        await canvasKey('Escape'); expect(selectedDimensions()).toEqual([]);
        await rightClickAt('length', middle);
        expect(menuItems()).toEqual(expect.arrayContaining(['Edit value…', 'Make reference'])); expect(selectedDimensions()).toEqual(['length']);
        await act(async () => document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
        expect(document.querySelector('[role="menu"]')).toBeNull();
        await doubleClickAt('diagonal', hit('diagonal').along(.5)); expect(field('Distance').value).toBe('50');
      });

      it('leaves the hover, the press and the right-click on an axis under it to the axis', async () => {
        await open(); const { hit, arrowTip, clickAt, doubleClickAt, send, rightClickAt, datumPressed, datumHovered, menuItems } = pointerSetup();
        // Length runs from a, on the Y axis, along the base; its line and arrow at a lie on that axis.
        const onAxis = hit('length').start, away = hit('length').along(.5);
        expect(arrowTip('length').clientX).toBeCloseTo(onAxis.clientX, 6);
        await send(hit('length').element, 'pointermove', away, { buttons: 0 });
        expect(highlighted('entity')).toEqual(['base']); expect(datumHovered()).toEqual([]);
        expect(container.querySelector('[data-cad-sketch-dimension="length"]')?.classList.contains('is-pointed')).toBe(true);
        await send(hit('length').element, 'pointermove', onAxis, { buttons: 0 });
        expect(datumHovered()).toEqual(['y-axis']); expect(highlighted('entity')).toEqual([]);
        expect(container.querySelector('[data-cad-sketch-dimension="length"]')?.classList.contains('is-pointed')).toBe(false);
        await clickAt('length', onAxis);
        expect(datumPressed()).toEqual(['y-axis']); expect(selectedDimensions()).toEqual([]); expect(document.activeElement).not.toBe(label('length'));
        await clickAt('length', onAxis, { shiftKey: true }); expect(datumPressed()).toEqual([]); expect(selectedDimensions()).toEqual([]);
        await doubleClickAt('length', onAxis);
        expect(datumPressed()).toEqual(['y-axis']); expect(document.querySelector('.cad-parameter-editor')).toBeNull(); expect(selectedDimensions()).toEqual([]);
        await rightClickAt('length', onAxis);
        expect(menuItems()).not.toContain('Make reference'); expect(selectedDimensions()).toEqual([]);
      });

      it('offers the geometry under a right-click before its dimension', async () => {
        await open(); const { arrowTip, rightClickAt, menuItems } = pointerSetup();
        // The diameter line runs out from the hole's centre and crosses the hole where its arrow ends.
        await rightClickAt('size', arrowTip('size'));
        expect(menuItems()).toContain('Select edge'); expect(menuItems()).not.toContain('Make reference'); expect(selectedDimensions()).toEqual([]);
      });
    });

    it('never replays a cancelled dimension editor when Escape later cancels the relations panel', async () => {
      await open();
      let refocused = 0; const record = (event: FocusEvent) => { if (event.target instanceof Element && event.target.closest('form[aria-label="Sketch relations"]')) refocused += 1; };
      const escapeFrom = (target: Element) => act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
      for (const from of ['body', 'dock'] as const) {
        await press('length', 'Enter'); await input(field('Length'), '45'); await click('Cancel');
        expect(relationsPanel()).not.toBeNull(); expect(selectedDimensions()).toEqual(['length']); expect(relationRow('Distance relation 1').getAttribute('aria-pressed')).toBe('false');
        container.addEventListener('focusin', record);
        await escapeFrom(from === 'body' ? document.body : relationRow('Angle'));
        container.removeEventListener('focusin', record);
        expect(refocused).toBe(0); expect(relationsPanel()).toBeNull(); expect(selectedDimensions()).toEqual([]);
        expect(relations().find(relation => relation.id === 'length')).toMatchObject({ value: 40 });
      }
    });

    it('keeps a closed row closed when an edit remounts the relations panel', async () => {
      await open();
      await replace(current => [...current, { id: 'ay', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 }]);
      // On the X axis, opened from the diagonal's editor, selects the two points the diagonal measures; a second press closes the row.
      await press('diagonal', 'Enter'); expect(field('Distance').value).toBe('50');
      await editRow('On the X axis'); expect(geometry()).toEqual([{ kind: 'point', id: 'a' }, { kind: 'point', id: 'c' }]);
      await editRow('On the X axis'); expect(relationRow('On the X axis').getAttribute('aria-pressed')).toBe('false');
      // An agent removes point c with what depends on it, so the selection, and the panel, change to point a alone.
      let refocused = 0; const record = (event: FocusEvent) => { if (event.target instanceof Element && event.target.closest('form[aria-label="Sketch relations"]')) refocused += 1; };
      container.addEventListener('focusin', record);
      await act(async () => {
        const feature = currentDocument.features[0]; if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Sketch missing.');
        replaceDocument({ ...currentDocument, features: [{ ...feature, graph: { ...feature.graph, points: feature.graph.points.filter(point => point.id !== 'c'),
          entities: feature.graph.entities.filter(entity => entity.id !== 'side'), relations: feature.graph.relations.filter(relation => !['diagonal', 'angle', 'measured'].includes(relation.id)) } }] });
      });
      container.removeEventListener('focusin', record);
      expect(geometry()).toEqual([{ kind: 'point', id: 'a' }]); expect(relationsPanel()).not.toBeNull();
      expect(relationRow('On the X axis').getAttribute('aria-pressed')).toBe('false'); expect(refocused).toBe(0);
    });

    it('never replays a cancelled new dimension when Escape later cancels the relations panel', async () => {
      await open();
      await replace(current => current.filter(relation => relation.id !== 'measured'));
      await geometryMenu('side', 'Dimension'); expect(field('Length').value).toBe('30');
      await input(field('Length'), '35'); await click('Cancel');
      expect(relationsPanel()).not.toBeNull();
      let refocused = 0; const record = (event: FocusEvent) => { if (event.target instanceof Element && event.target.closest('form[aria-label="Sketch relations"]')) refocused += 1; };
      container.addEventListener('focusin', record);
      await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
      container.removeEventListener('focusin', record);
      expect(refocused).toBe(0); expect(relationsPanel()).toBeNull();
      expect(relations().map(relation => relation.id)).toEqual(['length', 'diagonal', 'angle', 'size', 'x']);
    });
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
    const accepted = currentSession.getSnapshot(); await click('Line'); await click('Dimension');
    expect(button('Finish sketch').disabled).toBe(true); await pick('origin');
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'point', id: 'origin' }]);
    expect(currentDocument).toBe(source); expect(() => currentSession.assertWorkflowClosed()).toThrow('Finish or cancel');
    await pick('origin'); expect(viewport().getState().selectedSketchGeometrySet).toHaveLength(1);
    await act(async () => point('origin').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    expect(currentDocument).toBe(source); await canvasKey('Escape');
    expect(currentSession.getSnapshot()).toEqual(accepted); expect(viewport().getState().selectedSketchGeometrySet).toEqual([]);
    expect(toolButton('Line').getAttribute('aria-pressed')).toBe('true');
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
    // An arc waits for a point, a line, a second curve or a datum; picking it again sizes it.
    await act(async () => arc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(container.textContent).toContain('Choose a point, a line, another curve, the origin or an axis for a distance, or empty space for the size');
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

  it('takes the origin and axes in every constraint pick that expresses them exactly, from the tool or the selection', async () => {
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Datums', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'a', position: [5, 0] }, { id: 'b', position: [25, 0] }, { id: 'c', position: [-6, 10] }, { id: 'd', position: [-6, 22] }, { id: 'o', position: [0, 0] },
        { id: 'p', position: [-30, 10] }, { id: 'r', position: [-30, 22] }, { id: 'm', position: [-50, 10] }, { id: 'n', position: [-50, 22] },
        { id: 'g', position: [-70, 10] }, { id: 'h', position: [-70, 22] }],
      entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'side', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
        { id: 'ring', kind: 'circle', construction: false, centerPointId: 'o', radius: 4 }, { id: 'post', kind: 'line', construction: false, startPointId: 'p', endPointId: 'r' },
        { id: 'mast', kind: 'line', construction: false, startPointId: 'm', endPointId: 'n' }, { id: 'guide', kind: 'line', construction: false, startPointId: 'g', endPointId: 'h' }],
      relations: [] } }] });
    await mount(source); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    const pick = async (selector: string) => {
      const target = container.querySelector(selector); if (!target) throw new Error(`${selector} missing.`);
      await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    };
    const selectionChoices = async () => { await click('Constrain'); return [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')]; };
    const choose = async (label: string) => {
      await click('Constrain');
      const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(entry => entry.textContent?.trim() === label);
      if (!item) throw new Error(`${label} missing.`); await act(async () => item.click());
    };
    const sketch = () => { const feature = currentDocument.features[0]; if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Sketch missing.'); return feature.graph; };
    // Tool first: a line laid on the H axis keeps both endpoints on it, and the origin centers a circle. The test session applies
    // relations without solving, so the geometry already agrees.
    await choose('Coincident'); await pick('[data-cad-sketch-entity="base"]');
    expect(container.textContent).toContain('Coincident · Choose a point to keep on this line, or an axis to lay it on');
    await pick('[data-cad-sketch-datum="x-axis"]');
    expect(sketch().relations).toMatchObject([{ kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 }, { kind: 'fixed-axis', pointId: 'b', axis: 'y', value: 0 }]);
    await choose('Concentric'); await pick('[data-cad-sketch-datum="origin"]'); await pick('[data-cad-sketch-entity="ring"]');
    expect(sketch().relations.slice(2)).toMatchObject([{ kind: 'fixed-axis', pointId: 'o', axis: 'x', value: 0 }, { kind: 'fixed-axis', pointId: 'o', axis: 'y', value: 0 }]);
    await canvasKey('Escape');

    // Selection first: the V axis clicked far above its arrow joins a Shift-selected line in the Constrain list.
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]'); if (!canvas) throw new Error('Sketch canvas missing.');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
    let captured: number | null = null;
    Object.assign(canvas, { setPointerCapture: (id: number) => { captured = id; }, hasPointerCapture: (id: number) => captured === id, releasePointerCapture: () => { captured = null; } });
    const view = viewport().getState().view; if (!view || view.mode === 'solid') throw new Error('Sketch frame missing.');
    const viewWidth = Number(canvas.getAttribute('viewBox')?.split(' ')[2]);
    const pointer = async (type: string, x: number, y: number, shiftKey = false) => {
      const event = new MouseEvent(type, { button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, shiftKey,
        clientX: 300 + (x - view.centerMm[0]) / viewWidth * 600, clientY: 200 - (y - view.centerMm[1]) / view.heightSpanMm * 400 });
      Object.defineProperties(event, { pointerId: { value: 12 }, isPrimary: { value: true } });
      await act(async () => canvas.dispatchEvent(event));
    };
    const tap = async (x: number, y: number, shiftKey = false) => { await pointer('pointerdown', x, y, shiftKey); await pointer('pointerup', x, y, shiftKey); };
    const pressed = (datum: string) => container.querySelector(`[data-cad-sketch-datum="${datum}"]`)?.getAttribute('aria-pressed');
    const top = view.centerMm[1] + view.heightSpanMm * 0.45;
    await tap(0, top); expect(pressed('y-axis')).toBe('true');
    await tap(-6, 16, true);
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: 'side' }]); expect(pressed('y-axis')).toBe('true');
    const offered = await selectionChoices();
    expect(offered.map(item => item.textContent?.trim())).toEqual(['Coincident', 'Parallel', 'Perpendicular']);
    await act(async () => offered[1].click());
    expect(sketch().relations.at(-1)).toMatchObject({ kind: 'vertical', pointIds: ['c', 'd'] });

    // A Shift box adds geometry and keeps the selected axis; a plain box replaces both.
    await canvasKey('Escape'); await tap(0, top); expect(pressed('y-axis')).toBe('true');
    await pointer('pointerdown', -10, 17, true); await pointer('pointermove', -3, 23, true); await pointer('pointerup', -3, 23, true);
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'point', id: 'd' }]); expect(pressed('y-axis')).toBe('true');
    await pointer('pointerdown', -10, 17); await pointer('pointermove', -3, 23); await pointer('pointerup', -3, 23);
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'point', id: 'd' }]); expect(pressed('y-axis')).toBe('false');

    // Lines upright only through Parallel with a vertical line take one endpoint on the V axis, from the tool or the selection.
    await canvasKey('Escape'); await choose('Vertical'); await pick('[data-cad-sketch-entity="guide"]');
    for (const [line, upright] of [['post', 'side'], ['mast', 'guide']]) { await choose('Parallel'); await pick(`[data-cad-sketch-entity="${line}"]`); await pick(`[data-cad-sketch-entity="${upright}"]`); }
    await choose('Coincident'); await pick('[data-cad-sketch-entity="post"]');
    let count = sketch().relations.length;
    await pick('[data-cad-sketch-datum="y-axis"]');
    expect(sketch().relations.slice(count)).toMatchObject([{ kind: 'fixed-axis', pointId: 'p', axis: 'x', value: 0 }]);
    await canvasKey('Escape'); await tap(0, top); await tap(-50, 16, true);
    expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'entity', id: 'mast' }]);
    count = sketch().relations.length;
    const coincident = (await selectionChoices()).find(item => item.textContent?.trim() === 'Coincident'); if (!coincident) throw new Error('Coincident missing.');
    await act(async () => coincident.click());
    expect(sketch().relations.slice(count)).toMatchObject([{ kind: 'fixed-axis', pointId: 'm', axis: 'x', value: 0 }]);
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
    await pick('[data-cad-sketch-datum="x-axis"]'); expect(container.textContent).toContain('Choose a point, arc or circle to dimension from the x axis');
    await pick('[data-cad-sketch-point="a"]'); expect(field('Y from X axis').value).toBe('-7'); await click('Apply');
    expect(relations()).toMatchObject([{ kind: 'fixed-axis', pointId: 'a', axis: 'y', value: -7 }]);
    // A selected point starts the tool as its first pick.
    await pick('[data-cad-sketch-point="b"]'); await click('Dimension');
    expect(container.textContent).toContain('Choose the second point, a line, a curve, the origin or an axis');
    await pick('[data-cad-sketch-datum="origin"]');
    expect(field('X from origin').value).toBe('30'); expect(field('Y from origin').value).toBe('5'); await click('Apply');
    expect(relations().slice(1)).toMatchObject([{ kind: 'fixed-axis', pointId: 'b', axis: 'x', value: 30 }, { kind: 'fixed-axis', pointId: 'b', axis: 'y', value: 5 }]);
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  it('dimensions the center of a lone circle from an axis, picked by its center or its edge in either order', async () => {
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
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: null }));
    await click('Dimension'); await pick('[data-cad-sketch-datum="x-axis"]'); expect(container.textContent).toContain('Choose a point, arc or circle to dimension from the x axis');
    await pick('[data-cad-sketch-entity="bore"]'); expect(field('Y from X axis').value).toBe('4'); await click('Cancel');
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: null }));
    await click('Dimension'); await pick('[data-cad-sketch-entity="bore"]'); await pick('[data-cad-sketch-datum="origin"]');
    expect(field('X from origin').value).toBe('8'); expect(field('Y from origin').value).toBe('4'); await click('Cancel');
    expect(currentDocument.features[0]).toBe(feature); expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
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
    expect(relations()).toEqual([{ id: expect.any(String), kind: 'point-line-distance', pointId: 'c', lineId: 'base', side: 'left', value: 10 },
      { id: expect.any(String), kind: 'parallel', lineIds: ['base', 'top'] }]);
    await act(async () => currentSession.undo()); expect(currentDocument).toEqual(source);
    // Lines that are not parallel still take an angle.
    await restart(); await pick(line('base')); await pick(line('slant')); expect(Number(field('Angle').value)).toBeCloseTo(135, 9); await click('Cancel');
    // A point and a line in either order; a line is not offered with its own endpoints.
    await restart(); await pick(point('p')); expect(container.textContent).toContain('Choose the second point, a line, a curve, the origin or an axis');
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
    // A point and an arc or circle, picked in either order or selected, take a point-pair distance to its center.
    await restart(); await pick(point('p')); await pick(line('ring')); await click('Horizontal distance'); expect(field('Horizontal distance').value).toBe('5'); await click('Cancel');
    await restart(); await pick(line('disk')); await pick(point('q'));
    expect(container.textContent).toContain('Choose a point, a line, another curve, the origin or an axis for a distance, or empty space for the size');
    await pick(point('p')); await click('Vertical distance'); expect(field('Vertical distance').value).toBe('10'); await click('Cancel');
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry-set', selections: [{ kind: 'point', id: 'p' }, { kind: 'entity', id: 'ring' }] }));
    await click('Dimension'); expect(viewport().getState().selectedSketchGeometrySet).toEqual([{ kind: 'point', id: 'p' }, { kind: 'point', id: 'o' }]);
    await click('Horizontal distance'); expect(field('Horizontal distance').value).toBe('5'); await click('Cancel');
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

  it('measures from the center of a circle whose radius follows an expression, and leaves its size to the expression', async () => {
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, parameters: { boreRadius: 2 }, features: [{ id: 'sketch', kind: 'sketch', name: 'Bores', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'p', position: [5, 4] }, { id: 'o', position: [10, -6] }, { id: 'q', position: [40, -6] }],
      entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'bore', kind: 'circle', construction: false, centerPointId: 'o', radius: 'boreRadius' },
        { id: 'disk', kind: 'circle', construction: false, centerPointId: 'q', radius: 3 }], relations: [] } }] });
    await mount(source); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    const pick = async (selector: string) => {
      const target = container.querySelector(selector); if (!target) throw new Error(`${selector} missing.`);
      await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    };
    const entity = (id: string) => `[data-cad-sketch-entity="${id}"]`, point = (id: string) => `[data-cad-sketch-point="${id}"]`;
    const restart = async () => { await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: null })); await click('Dimension'); };
    const waiting = 'Choose a point, a line, another curve, the origin or an axis for a distance from its center';
    // Picked first, it waits for a partner; picking it again or confirming does not open its size.
    await click('Dimension'); await pick(entity('bore')); expect(container.textContent).toContain(waiting);
    await pick(entity('bore')); await canvasKey('Enter');
    expect(container.textContent).toContain(waiting); expect(container.querySelector('[aria-label="Radius"], [aria-label="Diameter"]')).toBeNull();
    await pick(entity('base')); expect(field('Point to line distance').value).toBe('6'); await click('Cancel');
    // Picked second after a line, a point, a curve or the origin, it measures from its center.
    await restart(); await pick(entity('base')); await pick(entity('bore')); expect(field('Point to line distance').value).toBe('6'); await click('Cancel');
    await restart(); await pick(point('p')); await pick(entity('bore')); await click('Horizontal distance'); expect(field('Horizontal distance').value).toBe('5'); await click('Cancel');
    await restart(); await pick(entity('disk')); await pick(entity('bore')); expect(field('Center distance').value).toBe('30'); await click('Cancel');
    await restart(); await pick('[data-cad-sketch-datum="origin"]'); await pick(entity('bore'));
    expect(field('X from origin').value).toBe('10'); expect(field('Y from origin').value).toBe('-6'); await click('Cancel');
    // Selected alone, Dimension starts the pick from it, from the toolbar and from the context menu.
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'entity', id: 'bore' } }));
    await click('Dimension'); expect(container.textContent).toContain(waiting); await pick(entity('disk')); expect(field('Center distance').value).toBe('30'); await click('Cancel');
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]'), bore = container.querySelector<SVGGElement>(entity('bore'));
    if (!canvas || !bore) throw new Error('Canvas missing.');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'entity', id: 'bore' } }));
    await act(async () => { bore.focus(); bore.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })); });
    const action = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === 'Dimension');
    if (!action) throw new Error('Dimension action missing.'); expect(action.disabled).toBe(false);
    await act(async () => action.click()); expect(container.textContent).toContain(waiting);
    await pick(entity('base')); expect(field('Point to line distance').value).toBe('6'); await click('Apply');
    const feature = currentDocument.features[0]; if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Sketch missing.');
    expect(feature.graph.relations).toEqual([{ id: expect.any(String), kind: 'point-line-distance', pointId: 'o', lineId: 'base', side: 'right', value: 6 }]);
    expect(feature.graph.entities.find(item => item.id === 'bore')).toMatchObject({ radius: 'boreRadius' });
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
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
    await mount(); await startSketch(); await click('Line');
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
    await mount(); await startSketch(); await click('Line');
    const before = currentSession.getSnapshot();
    await click('3-point Arc'); await canvasKey(' '); await canvasKey('ArrowUp'); await canvasKey('ArrowUp'); await canvasKey(' ');
    expect(currentSession.getSnapshot().workflowOpen).toBe(true);
    // No segment is complete yet, so nothing could be saved open and every shared action waits.
    for (const label of ['Finish sketch', 'Undo', 'Save', 'Select', 'Line', 'Arc', 'Rectangle', 'Slot']) expect(button(label).disabled).toBe(true);
    await canvasKey('z');
    const controlUndo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => container.querySelector('[aria-label="Sketch drawing canvas"]')!.dispatchEvent(controlUndo));
    expect(controlUndo.defaultPrevented).toBe(true); expect(undo).not.toHaveBeenCalled();
    await click('Undo last'); expect(button('Line segment').disabled).toBe(false); expect(button('Finish sketch').disabled).toBe(true);
    await canvasKey('Escape'); expect(currentSession.getSnapshot()).toEqual(before);
    expect(button('Finish sketch').disabled).toBe(false); expect(button('Rectangle').disabled).toBe(false);
  });

  it('finishes an open line chain with Enter without inventing material and edits one of its shared joints', async () => {
    await mount(); await startSketch(); await snapToGrid(); await click('Line');
    await canvasClick(300, 200); await canvasClick(450, 200); await canvasClick(450, 100);
    expect(button('Finish chain').disabled).toBe(false); await canvasKey('Enter');
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

  it('closes a freshly drawn mixed line chain with exact shared arc joints and analytic material', async () => {
    await mount(); await startSketch(); await snapToGrid(); await click('Line');
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

  it('draws one separate line per finished pair of clicks and attaches a three-point arc with its own center to existing ends by default', async () => {
    await mount(); await startSketch(); await snapToGrid(); await click('Line');
    // Clicks away from existing geometry and the axes have nothing to attach to.
    await canvasClick(330, 175); expect(workflow).toHaveBeenLastCalledWith(true);
    await canvasClick(450, 175); await canvasKey('Enter'); await canvasClick(330, 100); await canvasClick(450, 100); await canvasKey('Enter');
    let sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Graph sketch missing.');
    expect(sketch.graph.entities.map(entity => entity.kind)).toEqual(['line', 'line']);
    expect(sketch.graph.points.map(point => point.position)).toEqual([[10, 10], [50, 10], [10, 40], [50, 40]]);
    expect(sketch.graph.relations).toEqual([]); expect(toolButton('Line').getAttribute('aria-pressed')).toBe('true');
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

describe('sketch definition colours and locks', () => {
  type Answer = { sketchId: string; version?: string; signal?: AbortSignal; resolve(analysis: CadSketchConstraintAnalysis): void };
  const solved = (degreesOfFreedom: number, defined: { points: string[]; entities: string[] }, under: { points: string[]; entities: string[] } = { points: [], entities: [] }): CadSketchConstraintAnalysis => ({
    kind: 'solved', diagnostics: { status: 'success', degreesOfFreedom, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [],
      definition: { definedPointIds: defined.points, underDefinedPointIds: under.points, definedEntityIds: defined.entities, underDefinedEntityIds: under.entities } } });
  /** Mounts a session whose sketch analyses wait for the test to answer them. */
  async function mountAnalysed(source: CadDocument, onPrepareEdits?: CadWorkbenchProps['onPrepareEdits']) {
    const session = new CadSession(source); currentSession = session;
    const answers: Answer[] = [];
    const inspect = vi.fn((sketchId: string, version?: string, signal?: AbortSignal) => new Promise<CadSketchConstraintInspection>(resolve => answers.push({ sketchId, version, signal, resolve: analysis => resolve({
      sketchId, pointCount: 0, entityCount: 0, relationCount: 0, legacyProfileCount: 0, legacyDimensionCount: 0, degreesOfFreedomScope: 'graph', graph: null, parameters: {}, analysis }) })));
    function Harness() {
      const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot); currentDocument = snapshot.document;
      return <CadWorkbench document={snapshot.document} documentVersion={snapshot.version} build={null} buildVersion={null} buildState="idle" dirty={snapshot.dirty}
        canUndo={snapshot.canUndo} canRedo={snapshot.canRedo} onEdit={edit => { session.edit([edit]); }} onEditMany={edits => session.edit(edits)} onPrepareEdits={onPrepareEdits}
        onInspectSketchConstraints={inspect} onWorkflowChange={open => session.setWorkflowOpen(open)} onUndo={() => session.undo()} onRedo={() => session.redo()} onStatusMessage={statusMessage}
        onSave={save} onBack={vi.fn()} onSendToCam={sendToCam} onOpenDocument={vi.fn()} onNewDocument={vi.fn()} onImportDocument={async () => undefined}
        onExportDocument={vi.fn()} onExportSolid={async () => undefined} onOpenDxfExport={async () => undefined} onViewportControlsReady={controls => { currentViewport = controls; }} />;
    }
    await act(async () => root.render(<Harness />));
    return { session, answers, answer: async (index: number, analysis: CadSketchConstraintAnalysis) => act(async () => answers[index].resolve(analysis)) };
  }
  const status = () => container.querySelector('[aria-label="Sketch constraint status"]')?.textContent;
  const entity = (id: string) => { const found = container.querySelector(`[data-cad-sketch-entity="${id}"]`); if (!found) throw new Error(`Edge ${id} missing.`); return found; };
  const point = (id: string) => { const found = container.querySelector(`[data-cad-sketch-point="${id}"]`); if (!found) throw new Error(`Point ${id} missing.`); return found; };
  const marked = (mark: string) => [...container.querySelectorAll(`.cad-sketch-graph .is-${mark}`)].map(item => item.getAttribute('data-cad-sketch-entity') ?? `point ${item.getAttribute('data-cad-sketch-point')}`).sort();
  const keyDown = async (target: Element, key: string) => act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
  const sketchFeature = (id: string, points: readonly (readonly [string, number, number])[], entities: readonly object[], relations: readonly object[] = [], profiles: readonly object[] = []) => ({
    id, kind: 'sketch', name: id === 'sketch' ? 'Bracket' : 'Second', plane: 'XY', offset: 0, suppressed: false, profiles,
    graph: { points: points.map(([pointId, x, y]) => ({ id: pointId, position: [x, y] })), entities, relations } });
  const bracketPoints = [['a', 0, 0], ['b', 20, 0], ['c', 0, 10], ['d', 20, 12], ['e', 40, 5], ['f', 0, -10], ['g', 20, -10]] as const;
  const bracketEdges = [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'free', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
    { id: 'guide', kind: 'line', construction: true, startPointId: 'f', endPointId: 'g' }, { id: 'bore', kind: 'circle', construction: false, centerPointId: 'e', radius: 5 }];

  it('colours each defined part of a partly defined sketch, keeps legacy profiles and references as they are, and locks only defined points', async () => {
    const plate = { id: 'plate', name: 'Plate', construction: false, role: 'outer', geometry: { kind: 'rectangle', x: 60, y: 0, width: 30, height: 20, cornerRadius: 0 } };
    const source = parseCadDocument({ ...createCadDocument('Bracket', 'definition-bracket'), schemaVersion: 2, features: [sketchFeature('sketch', bracketPoints, bracketEdges, [], [plate])] });
    const h = await mountAnalysed(source);
    await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    expect(marked('defined')).toEqual([]);
    // The base and the construction guide are fully defined, the free line is not, and the bore has no answer.
    await h.answer(0, solved(4, { points: ['a', 'b', 'f', 'g'], entities: ['base', 'guide'] }, { points: ['c', 'd'], entities: ['free'] }));
    expect(status()).toBe('Under defined · 4 DOF');
    expect(marked('defined')).toEqual(['base', 'guide', 'point a', 'point b', 'point f', 'point g']);
    expect(entity('guide').classList.contains('is-construction')).toBe(true);
    const legacy = container.querySelector('[aria-label="Select Plate profile"]'); if (!legacy) throw new Error('Legacy profile missing.');
    expect(legacy.classList.contains('is-defined')).toBe(false);
    expect([...container.querySelectorAll('[data-cad-sketch-datum]')].filter(datum => datum.classList.contains('is-defined'))).toEqual([]);
    expect(point('a').classList.contains('is-locked')).toBe(true); expect(point('a').querySelector('title')?.textContent).toContain('Fully defined by dimensions and relations');
    expect(point('c').classList.contains('is-locked')).toBe(false);
    // Selection draws over the definition colour without dropping it.
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'entity', id: 'base' } }));
    expect(entity('base').classList.contains('is-selected')).toBe(true); expect(entity('base').classList.contains('is-defined')).toBe(true);
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'point', id: 'a' } }));
    expect(point('a').classList.contains('is-active')).toBe(true); expect(point('a').classList.contains('is-defined')).toBe(true);
    // A defined point refuses a nudge; an under-defined one moves.
    await keyDown(point('a'), 'ArrowRight'); expect(currentDocument).toBe(source);
    await keyDown(point('c'), 'ArrowRight'); expect(currentDocument).not.toBe(source);
    const moved = currentDocument.features[0]; if (moved.kind !== 'sketch' || !moved.graph) throw new Error('Sketch graph missing.');
    expect(moved.graph.points.find(item => item.id === 'c')?.position).not.toEqual([0, 10]);
    // The moved sketch waits for its own answer: colours stay, locks go.
    expect(status()).toBe('Checking freedom…'); expect(marked('defined')).toContain('base'); expect(point('a').classList.contains('is-locked')).toBe(false);
  });

  it('keeps dimension selection, focus and Delete working over defined geometry, where a lock refuses only moves', async () => {
    setCadPreferences({ ...getCadPreferences(), showOnPartDimensions: true });
    const source = parseCadDocument({ ...createCadDocument('Bracket', 'definition-dimension'), schemaVersion: 2, features: [
      sketchFeature('sketch', bracketPoints, bracketEdges, [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 20 }])] });
    const h = await mountAnalysed(source);
    await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    const defineBase = () => h.answer(h.answers.length - 1, solved(6, { points: ['a', 'b', 'f', 'g'], entities: ['base', 'guide'] }));
    await defineBase(); expect(point('a').classList.contains('is-locked')).toBe(true);
    const label = () => { const found = container.querySelector<SVGGElement>('[data-cad-sketch-dimension="length"] [role="button"]'); if (!found) throw new Error('Length label missing.'); return found; };
    const selectedDimensions = () => [...container.querySelectorAll('[data-cad-sketch-dimension].is-selected')].map(item => item.getAttribute('data-cad-sketch-dimension'));
    const highlighted = () => [...container.querySelectorAll('[data-cad-highlight-point], [data-cad-highlight-entity]')].map(item => item.getAttribute('data-cad-highlight-point') ?? item.getAttribute('data-cad-highlight-entity')).sort();
    const graph = () => { const feature = currentDocument.features[0]; if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Sketch missing.'); return feature.graph; };
    // The selected dimension's highlight draws above the green rows, which keep their definition.
    await act(async () => label().dispatchEvent(new MouseEvent('click', { button: 0, detail: 1, bubbles: true, cancelable: true })));
    expect(selectedDimensions()).toEqual(['length']); expect(highlighted()).toEqual(['a', 'b', 'base']);
    expect(marked('defined')).toEqual(['base', 'guide', 'point a', 'point b', 'point f', 'point g']);
    expect(entity('base').compareDocumentPosition(container.querySelector('[data-cad-sketch-highlight]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Focus on a defined point leaves the selection, and Delete there removes the selected dimension, not the point.
    await act(async () => (point('a') as SVGGElement).focus()); expect(selectedDimensions()).toEqual(['length']);
    await keyDown(point('a'), 'Delete');
    expect(graph().relations.map(relation => relation.id)).toEqual([]); expect(graph().points.map(item => item.id)).toContain('a');
    // Once the new version is defined too, a press on a defined point still selects it, and Delete on another focused
    // defined point removes that selection; with nothing selected, Delete removes the focused defined point.
    await defineBase(); expect(point('a').classList.contains('is-locked')).toBe(true);
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]'); if (!canvas) throw new Error('Sketch canvas missing.');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
    const view = viewport().getState().view; if (!view || view.mode === 'solid') throw new Error('Sketch frame missing.');
    const viewWidth = Number(canvas.getAttribute('viewBox')?.split(' ')[2]);
    for (const type of ['pointerdown', 'pointerup']) await act(async () => {
      const event = new MouseEvent(type, { button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true,
        clientX: 300 + (0 - view.centerMm[0]) / viewWidth * 600, clientY: 200 - (0 - view.centerMm[1]) / view.heightSpanMm * 400 });
      Object.defineProperties(event, { pointerId: { value: 12 }, isPrimary: { value: true } });
      point('a').dispatchEvent(event);
    });
    expect(point('a').classList.contains('is-active')).toBe(true);
    await act(async () => (point('b') as SVGGElement).focus()); await keyDown(point('b'), 'Delete');
    expect(graph().points.map(item => item.id)).not.toContain('a'); expect(graph().points.map(item => item.id)).toContain('b');
    await defineBase(); expect(point('f').classList.contains('is-locked')).toBe(true);
    await act(async () => (point('f') as SVGGElement).focus()); await keyDown(point('f'), 'Delete');
    expect(graph().points.map(item => item.id)).not.toContain('f');
  });

  it('never applies an older answer to parameter changes, undo or another sketch, and keeps colours until the new answer', async () => {
    const source = parseCadDocument({ ...createCadDocument('Bracket', 'definition-stale'), schemaVersion: 2, parameters: { w: 2 }, features: [
      sketchFeature('sketch', bracketPoints, bracketEdges), sketchFeature('second', bracketPoints, bracketEdges)] });
    const h = await mountAnalysed(source);
    await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    await h.answer(0, solved(6, { points: ['a', 'b'], entities: ['base'] }));
    expect(marked('defined')).toEqual(['base', 'point a', 'point b']); expect(point('a').classList.contains('is-locked')).toBe(true);
    // A parameter change while the new analysis is pending keeps the colours but never the locks.
    await act(async () => h.session.edit([{ kind: 'set-parameter', name: 'w', value: 3 }]));
    expect(status()).toBe('Checking freedom…'); expect(h.answers).toHaveLength(2);
    expect(marked('defined')).toEqual(['base', 'point a', 'point b']); expect(point('a').classList.contains('is-locked')).toBe(false);
    await keyDown(point('a'), 'ArrowRight');
    const nudged = currentDocument; expect(nudged.features[0]).not.toBe(source.features[0]);
    // Undo restores the earlier document object under a new version, so its answer still does not lock.
    await act(async () => h.session.undo());
    expect(currentDocument.parameters).toEqual({ w: 3 }); expect(point('a').classList.contains('is-locked')).toBe(false);
    await act(async () => h.session.undo()); expect(currentDocument).toBe(source);
    expect(point('a').classList.contains('is-locked')).toBe(false); expect(marked('defined')).toEqual(['base', 'point a', 'point b']);
    // Answers for the versions undo left behind change nothing.
    for (const index of h.answers.keys()) if (index > 0 && index < h.answers.length - 1) await h.answer(index, solved(0, { points: bracketPoints.map(([id]) => id), entities: ['base', 'free', 'guide', 'bore'] }));
    expect(point('a').classList.contains('is-locked')).toBe(false); expect(marked('defined')).toEqual(['base', 'point a', 'point b']);
    // The current answer replaces the colours and locks.
    await h.answer(h.answers.length - 1, solved(4, { points: ['c', 'd'], entities: ['free'] }));
    expect(marked('defined')).toEqual(['free', 'point c', 'point d']);
    expect([point('a').classList.contains('is-locked'), point('c').classList.contains('is-locked')]).toEqual([false, true]);
    // Another sketch with the same identities shows nothing until its own answer arrives.
    await click('Finish sketch'); await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'second' }));
    expect(h.answers.at(-1)?.sketchId).toBe('second');
    expect(marked('defined')).toEqual([]); expect(point('c').classList.contains('is-locked')).toBe(false);
    await h.answer(h.answers.length - 1, solved(6, { points: ['a', 'b'], entities: ['base'] }));
    expect(marked('defined')).toEqual(['base', 'point a', 'point b']); expect(point('a').classList.contains('is-locked')).toBe(true);
  });

  it('marks every operand of a rejected preview beyond the eight it lists until the preview ends, over the analysis marks', async () => {
    const rungs = Array.from({ length: 11 }, (_, index) => index);
    const source = parseCadDocument({ ...createCadDocument('Ladder', 'definition-ladder'), schemaVersion: 2, features: [sketchFeature('sketch',
      [...rungs.flatMap(index => [[`l${index}`, 0, index * 5], [`r${index}`, 10, index * 5]] as const), ['t0', 0, -20], ['t1', 30, -15]],
      [...rungs.map(index => ({ id: `rung${index}`, kind: 'line', construction: false, startPointId: `l${index}`, endPointId: `r${index}` })),
        { id: 'target', kind: 'line', construction: false, startPointId: 't0', endPointId: 't1' }],
      rungs.slice(1).map(index => ({ id: `eq${index - 1}`, kind: 'equal-length', lineIds: [`rung${index - 1}`, `rung${index}`] })))] });
    const sketch = source.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Ladder missing.');
    const graph = sketch.graph, equalIds = graph.relations.map(relation => relation.id);
    const prepare = vi.fn<NonNullable<CadWorkbenchProps['onPrepareEdits']>>(async edits => {
      const added = edits.flatMap(edit => edit.kind === 'set-sketch-relation' ? [edit.relation] : []);
      throw new CadSketchPreparationError({ sketchId: 'sketch', sketchName: 'Ladder', graph: { ...graph, relations: [...graph.relations, ...added] }, rejection: { kind: 'rejected', reason: 'conflicting',
        message: 'Conflicting', diagnostics: { status: 'failed', degreesOfFreedom: null, conflictingIds: added.map(relation => relation.id), redundantIds: equalIds, partiallyRedundantIds: [], issues: [] } } });
    });
    const h = await mountAnalysed(source, prepare);
    await act(async () => viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }));
    // An analysis the solver rejects marks its own operands.
    await h.answer(0, { kind: 'rejected', reason: 'redundant', message: 'Redundant.', diagnostics: { status: 'failed', degreesOfFreedom: null, conflictingIds: [], redundantIds: ['eq0'], partiallyRedundantIds: [], issues: [] } });
    expect(status()).toBe('Redundant relations');
    const analysisMarks = ['point l0', 'point l1', 'point r0', 'point r1', 'rung0', 'rung1'];
    expect(marked('redundant')).toEqual(analysisMarks); expect(marked('conflicting')).toEqual([]);
    await act(async () => viewport().apply({ kind: 'select-sketch-geometry', selection: { kind: 'entity', id: 'target' } }));
    await click('Dimension'); await canvasKey('Enter'); const length = container.querySelector<HTMLInputElement>('input[aria-label="Length mm"]'); if (!length) throw new Error('Length field missing.'); await input(length, '40');
    for (let turn = 0; turn < 3; turn++) await act(async () => new Promise(resolve => setTimeout(resolve, 125)));
    expect(prepare).toHaveBeenCalled();
    // All ten redundant relations hold their lines, though the feedback lists eight subjects.
    expect(container.textContent).toContain('more');
    expect(marked('redundant')).toEqual([...rungs.flatMap(index => [`point l${index}`, `point r${index}`]), ...rungs.map(index => `rung${index}`)].sort());
    expect(marked('conflicting')).toEqual(['point t0', 'point t1']);
    expect(point('t0').classList.contains('is-revealed')).toBe(true);
    // Ending the preview returns to the analysis marks.
    await click('Cancel');
    expect(marked('conflicting')).toEqual([]); expect(marked('redundant')).toEqual(analysisMarks);
    expect(currentDocument).toBe(source);
  });
});
