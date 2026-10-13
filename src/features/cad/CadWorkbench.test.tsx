import { act, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppRailProvider, useAppRail } from '@/app/AppRailContext';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadBuildResult, CadDocument } from '@/domain/cad/cadDocument';
import type { CadTopologyDescriptor, CadTopologyResolvePicksResult } from '@/domain/cad/cadTopology';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { measureCadSketch } from '@/domain/cad/cadMeasurements';
import { CadWorkbench, type CadWorkbenchProps } from './CadWorkbench';
import { closeSketchPolygon, snapSketchPoint, twoPointSketchProfile } from './cadSketchInteraction';
import { CadSession } from './cadSession';
import type { CadRenderedViewControls, CadWorkbenchViewportControls } from './cadViewportControls';

// jsdom cannot create a WebGL context. These tests exercise the real UI and domain edits.
vi.mock('./CadViewport', async () => {
  const { useEffect } = await import('react');
  return { CadViewport: ({ onControlsReady }: { onControlsReady?(controls: CadRenderedViewControls | null, released?: CadRenderedViewControls): void }) => {
    // Match WebGL's passive publication/disposal lifetime, while the real SVG
    // publishes in layout effects. Their order matters when changing modes.
    useEffect(() => {
      const controls: CadRenderedViewControls = { getState: () => ({ mode: 'solid', available: true, view: 'Isometric', gridVisible: true, zoom: 1, revision: 0 }),
        fit: vi.fn(), setGrid: vi.fn(), setView: vi.fn(), capture: async () => { throw new Error('WebGL rasterization is unavailable in jsdom.'); } };
      onControlsReady?.(controls);
      return () => onControlsReady?.(null, controls);
    }, [onControlsReady]);
    return <div aria-label="3D model viewport" />;
  } };
});

let container: HTMLDivElement;
let root: Root;
let currentDocument: CadDocument;
let currentSession: CadSession;
let currentViewport: CadWorkbenchViewportControls | null;
let replaceDocument: (document: CadDocument) => void;
let replaceBuild: (build: CadBuildResult | null, state?: CadWorkbenchProps['buildState']) => void;
let removeCad: () => void;
let showCad: () => void;
const undo = vi.fn();
const save = vi.fn(async () => undefined);
const sendToCam = vi.fn(async (_sketchId: string) => undefined);
const workflow = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  currentViewport = null;
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

async function mount(initial: CadDocument = createCadDocument(), buildProps: Pick<CadWorkbenchProps, 'build' | 'buildState'> & Partial<Pick<CadWorkbenchProps, 'onSectionForCam' | 'onInspectTopology' | 'onResolveSelection' | 'onRebuild'>> = { build: null, buildState: 'idle' }, inShell: boolean | 'previous-header' = false) {
  const session = new CadSession(initial);
  currentSession = session;
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
    const [build, setBuild] = useState(buildProps.build);
    const [buildState, setBuildState] = useState(buildProps.buildState);
    const [headerContent, setHeaderContent] = useState<ReactNode | null>(null);
    const [visible, setVisible] = useState(inShell !== 'previous-header');
    removeCad = () => setVisible(false);
    showCad = () => setVisible(true);
    replaceBuild = (next, state = 'ready') => { setBuild(next); setBuildState(state); };
    const { document } = snapshot;
    currentDocument = document;
    replaceDocument = (replacement) => session.replace(replacement);
    const props: CadWorkbenchProps = {
      document, documentVersion: snapshot.version, buildVersion: buildState === 'ready' ? snapshot.version : null, ...buildProps, build, buildState, dirty: true, canUndo: true, canRedo: true,
      onEdit(edit) { session.edit([edit]); },
      onUndo: undo, onRedo: vi.fn(), onSave: save, onBack: vi.fn(), onWorkflowChange: (open) => { workflow(open); session.setWorkflowOpen(open); },
      onSendToCam: sendToCam, onOpenDocument: vi.fn(), onNewDocument: vi.fn(),
      onImportDocument: async () => undefined, onExportDocument: vi.fn(), onExportSolid: async () => undefined, onExportDxf: async () => undefined,
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
  const found = [...container.querySelectorAll('button')].find((entry) => entry.getAttribute('aria-label') === label || entry.textContent?.trim() === label);
  if (!found) throw new Error(`Button "${label}" missing.`);
  return found;
}
async function click(label: string) { await act(async () => button(label).click()); }
function field(label: string) {
  const input = [...container.querySelectorAll('label')].find((entry) => entry.querySelector('span')?.childNodes[0]?.textContent === label)?.querySelector('input');
  if (!input) throw new Error(`Field "${label}" missing.`);
  return input;
}
async function input(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Native input setter unavailable.');
  await act(async () => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
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
function viewport() {
  if (!currentViewport) throw new Error('Viewport controls unavailable.');
  return currentViewport;
}
function panelResizeFixture(initialWidth = 1440) {
  let measuredWidth = initialWidth;
  const observers = new Map<Element, () => void>();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('cad-body') ? measuredWidth : 0; });
  vi.stubGlobal('ResizeObserver', class {
    private elements = new Set<Element>();
    constructor(private callback: () => void) {}
    observe(element: Element) { this.elements.add(element); observers.set(element, this.callback); }
    disconnect() { for (const element of this.elements) observers.delete(element); }
  });
  return async (width: number) => {
    measuredWidth = width;
    const body = container.querySelector('.cad-body');
    if (!body) throw new Error('CAD body missing');
    await act(async () => observers.get(body)?.());
  };
}
function resizeHandle(label: string) {
  const element = [...container.querySelectorAll<HTMLElement>('[role="separator"]')].find(element => element.getAttribute('aria-label') === label);
  if (!element) throw new Error(`Resize handle ${label} missing`);
  return element;
}
async function resizeKey(label: string, key: string, shiftKey = false) {
  await act(async () => resizeHandle(label).dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })));
}
function resizePointer(type: string, clientX: number, pointerId = 17) {
  const event = new MouseEvent(type, { clientX, button: 0, buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
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
  it('discards an edited part name on focused Escape without changing document, version or undo/redo history', async () => {
    await mount(solidDocument());
    await act(async () => {
      currentSession.edit([{ kind: 'rename-document', name: 'Reviewed part' }]);
      currentSession.edit([{ kind: 'set-parameter', name: 'width', value: 50 }]); currentSession.undo();
    });
    const before = currentSession.getSnapshot(); expect(before.canUndo).toBe(true); expect(before.canRedo).toBe(true);
    const name = container.querySelector<HTMLInputElement>('[aria-label="Part name"]'); if (!name) throw new Error('Part name missing');
    name.focus(); await input(name, 'Discard this rename'); expect(currentSession.getSnapshot().workflowOpen).toBe(true);
    await act(async () => name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(name.value).toBe('Reviewed part'); expect(document.activeElement).toBe(name);
    expect(currentSession.getSnapshot()).toEqual(before); expect(currentDocument).toBe(before.document);
    await act(async () => name.blur());
    expect(currentSession.getSnapshot()).toEqual(before); expect(currentSession.getSnapshot().workflowOpen).toBe(false);
  });
  it('leaves composing Enter and Escape to the part-name input method', async () => {
    await mount(solidDocument()); const before = currentSession.getSnapshot();
    const name = container.querySelector<HTMLInputElement>('[aria-label="Part name"]'); if (!name) throw new Error('Part name missing');
    name.focus(); await input(name, '部品');
    for (const key of ['Enter', 'Escape']) {
      const composing = new KeyboardEvent('keydown', { key, isComposing: true, bubbles: true, cancelable: true });
      await act(async () => name.dispatchEvent(composing));
      expect(composing.defaultPrevented).toBe(false); expect(name.value).toBe('部品'); expect(document.activeElement).toBe(name);
      expect(currentSession.getSnapshot()).toMatchObject({ document: before.document, version: before.version, workflowOpen: true });
    }
    await act(async () => name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(currentSession.getSnapshot()).toEqual(before);
  });
  it('preserves rail preferences through inspector collapse and compact/desktop transitions', async () => {
    const resizeWorkspace = panelResizeFixture();
    await mount(solidDocument()); const before = currentDocument; const version = currentSession.getSnapshot().version;
    expect(resizeHandle('Resize CAD model tree').getAttribute('aria-valuenow')).toBe('220');
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' }));
    await resizeKey('Resize CAD model tree', 'ArrowRight'); await resizeKey('Resize CAD properties', 'ArrowLeft');
    expect(resizeHandle('Resize CAD model tree').getAttribute('aria-valuenow')).toBe('230');
    expect(resizeHandle('Resize CAD properties').getAttribute('aria-valuenow')).toBe('282');
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: null }));
    expect(container.querySelector('[aria-label="Resize CAD properties"]')).toBeNull();
    await resizeWorkspace(1023); expect(container.querySelector('[role="separator"]')).toBeNull();
    await resizeWorkspace(1440); expect(resizeHandle('Resize CAD model tree').getAttribute('aria-valuenow')).toBe('230');
    await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' }));
    expect(resizeHandle('Resize CAD properties').getAttribute('aria-valuenow')).toBe('282');
    expect(currentDocument).toBe(before); expect(currentSession.getSnapshot().version).toBe(version);
  });
  it('constrains oversized rails to usable canvas then restores their preferred widths on expansion', async () => {
    const resizeWorkspace = panelResizeFixture();
    await mount(solidDocument()); await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' }));
    await resizeKey('Resize CAD model tree', 'End'); await resizeKey('Resize CAD properties', 'End');
    expect(resizeHandle('Resize CAD model tree').getAttribute('aria-valuenow')).toBe('420');
    expect(resizeHandle('Resize CAD properties').getAttribute('aria-valuenow')).toBe('520');
    await resizeWorkspace(1024);
    expect(resizeHandle('Resize CAD model tree').getAttribute('aria-valuenow')).toBe('180');
    expect(resizeHandle('Resize CAD properties').getAttribute('aria-valuenow')).toBe('356');
    expect(container.querySelector<HTMLElement>('.cad-body')?.style.gridTemplateColumns).toBe('180px 4px minmax(480px, 1fr) 4px 356px');
    await resizeKey('Resize CAD model tree', 'ArrowRight');
    expect(resizeHandle('Resize CAD model tree').getAttribute('aria-valuenow')).toBe('180');
    await resizeWorkspace(1440);
    expect(resizeHandle('Resize CAD model tree').getAttribute('aria-valuenow')).toBe('420');
    expect(resizeHandle('Resize CAD properties').getAttribute('aria-valuenow')).toBe('520');
  });
  it('resizes with the pointer and keyboard without committing or remounting pending numeric/name fields', async () => {
    panelResizeFixture(); await mount(solidDocument()); await act(async () => viewport().apply({ kind: 'select-feature', featureId: 'pad' }));
    const before = currentDocument; const version = currentSession.getSnapshot().version; const length = field('Length');
    length.focus(); await input(length, '25');
    await act(async () => {
      resizeHandle('Resize CAD model tree').dispatchEvent(resizePointer('pointerdown', 100));
      window.dispatchEvent(resizePointer('pointermove', 210)); window.dispatchEvent(resizePointer('pointercancel', 210));
    });
    expect(resizeHandle('Resize CAD model tree').getAttribute('aria-valuenow')).toBe('330');
    await act(async () => window.dispatchEvent(resizePointer('pointermove', 500)));
    expect(resizeHandle('Resize CAD model tree').getAttribute('aria-valuenow')).toBe('330');
    expect(field('Length')).toBe(length); expect(length.value).toBe('25'); expect(currentSession.getSnapshot().workflowOpen).toBe(true);
    expect(currentDocument).toBe(before); expect(currentSession.getSnapshot().version).toBe(version);
    await click('Cancel');
    const name = container.querySelector<HTMLInputElement>('[aria-label="Part name"]'); if (!name) throw new Error('Part name missing');
    name.focus(); await input(name, 'Pending rename');
    await act(async () => resizeHandle('Resize CAD model tree').focus()); await resizeKey('Resize CAD model tree', 'ArrowRight', true);
    expect(name.value).toBe('Pending rename'); expect(currentDocument).toBe(before); expect(currentSession.getSnapshot().version).toBe(version);
    expect(currentSession.getSnapshot().workflowOpen).toBe(true); expect(resizeHandle('Resize CAD model tree').getAttribute('aria-valuenow')).toBe('331');
    await resizeKey('Resize CAD model tree', 'Escape');
    expect(name.value).toBe(before.name); expect(currentSession.getSnapshot().workflowOpen).toBe(false); expect(currentSession.getSnapshot().canUndo).toBe(false);
  });
  it('reclaims empty property space and restores the editor on selection without changing geometry or history', async () => {
    await mount(solidDocument(), { build: topologyBuild, buildState: 'ready' });
    const before = currentDocument; const version = currentSession.getSnapshot().version; const controls = viewport();
    expect(container.querySelector('[aria-label="Feature properties"]')).toBeNull();
    expect(container.querySelector('.cad-body')?.classList.contains('is-properties-collapsed')).toBe(true);
    await act(async () => controls.apply({ kind: 'select-feature', featureId: 'pad' }));
    expect(container.querySelector('[aria-label="Feature properties"]')).not.toBeNull(); expect(field('Length').value).toBe('10');
    expect(container.querySelector('.cad-body')?.classList.contains('is-properties-collapsed')).toBe(false);
    await act(async () => controls.apply({ kind: 'select-feature', featureId: null }));
    expect(container.querySelector('[aria-label="Feature properties"]')).toBeNull();
    await click('Sketch'); expect(container.querySelector('[aria-label="Feature properties"]')).not.toBeNull();
    await click('Cancel'); expect(container.querySelector('[aria-label="Feature properties"]')).toBeNull();
    expect(viewport()).toBe(controls); expect(currentDocument).toBe(before); expect(currentSession.getSnapshot().version).toBe(version);
  });
  it('keeps a restored inspector mounted while a pending profile edit prevents selection changes', async () => {
    await mount(solidDocument());
    await act(async () => { viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }); viewport().apply({ kind: 'select-profile', profileId: 'rectangle' }); });
    await input(field('Width'), '60');
    expect(() => viewport().apply({ kind: 'select-feature', featureId: null })).toThrow('Apply or cancel');
    expect(container.querySelector('[aria-label="Feature properties"]')).not.toBeNull(); expect(field('Width').value).toBe('60');
    await click('Cancel'); expect(field('Width').value).toBe('50');
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
    await click('Apply');
    expect(currentDocument.features[0]?.kind).toBe('sketch');
    await canvasClick(300, 200);
    expect(workflow).toHaveBeenLastCalledWith(true);
    expect(() => currentSession.assertWorkflowClosed()).toThrow('Finish or cancel');
    await canvasClick(450, 100);
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Expected sketch.');
    expect(sketch.profiles[0].geometry).toEqual({ kind: 'rectangle', x: 0, y: 0, width: 50, height: 40, cornerRadius: 0 });
    expect(workflow).toHaveBeenLastCalledWith(false);
    expect(container.querySelector('[aria-label="Sketch measurements"]')?.textContent).toContain('2,000 mm²');
    expect(container.querySelector('[aria-label="Sketch measurements"]')?.textContent).toContain('180 mm');
    await click('File'); await click('Send sketch to CAM');
    expect(sendToCam).toHaveBeenCalledWith(sketch.id);
  });

  it('keeps a multi-click polygon provisional and Escape cancels it without changing saved geometry', async () => {
    await mount(); await click('Sketch'); await click('Apply'); await click('Polyline');
    await canvasClick(300, 200); await canvasClick(450, 200);
    expect(button('Finish sketch').disabled).toBe(true);
    expect(button('Undo').disabled).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    const sketch = currentDocument.features[0];
    expect(sketch.kind === 'sketch' && sketch.profiles).toEqual([]);
    expect(button('Finish sketch').disabled).toBe(false);
    expect(workflow).toHaveBeenLastCalledWith(false);
  });

  it.each(['name', 'parameter'] as const)('blocks a new path while a %s edit is pending without losing either field or history', async editor => {
    await mount(); await click('Sketch'); await click('Apply'); await click('Path');
    const before = currentSession.getSnapshot();
    let pendingField: HTMLInputElement;
    if (editor === 'name') {
      const name = container.querySelector<HTMLInputElement>('[aria-label="Part name"]');
      if (!name) throw new Error('Part name missing'); pendingField = name; await input(name, 'Pending rename');
    } else {
      await click('Parameters'); pendingField = field('Name'); await input(pendingField, 'wall'); await input(field('Value'), '3');
    }
    const pendingValue = pendingField.value;
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]');
    if (!canvas) throw new Error('Sketch canvas missing');
    expect(canvas.getAttribute('tabindex')).toBe('-1'); expect(button('Line').disabled).toBe(true);
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
    await mount(); await click('Sketch'); await click('Apply'); await click('Path');
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

  it('edits a profile with a named expression and leaves Ctrl+Z to focused inputs', async () => {
    await mount({ ...createCadDocument(), parameters: { plateWidth: 80 } });
    await click('Sketch'); await click('Apply'); await canvasClick(300, 200); await canvasClick(450, 100);
    await input(field('Width'), 'plateWidth / 2');
    expect(button('Save').disabled).toBe(true);
    expect(workflow).toHaveBeenLastCalledWith(true);
    await act(async () => field('Width').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })));
    expect(undo).not.toHaveBeenCalled();
    await click('Apply');
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Expected sketch.');
    const geometry = sketch.profiles[0].geometry;
    expect(geometry.kind === 'rectangle' && geometry.width).toBe('plateWidth / 2');
    expect(container.querySelector('.cad-field-hint')?.textContent).toContain('mm');
    expect(workflow).toHaveBeenLastCalledWith(false);
  });

  it('refreshes selected profile fields when an imported document preserves feature and profile IDs', async () => {
    await mount(); await click('Sketch'); await click('Apply'); await canvasClick(300, 200); await canvasClick(450, 100);
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Expected sketch.');
    const profile = sketch.profiles[0];
    if (profile.geometry.kind !== 'rectangle') throw new Error('Expected rectangle.');
    const updated = applyCadEdits(currentDocument, [{ kind: 'update-feature', feature: { ...sketch, profiles: [{ ...profile, geometry: { ...profile.geometry, width: 75 } }] } }]);
    await act(async () => replaceDocument(updated));
    expect(field('Width').value).toBe('75');
    expect(workflow).toHaveBeenLastCalledWith(false);
    const cleared = applyCadEdits(updated, [{ kind: 'update-feature', feature: { ...sketch, profiles: [] } }]);
    await act(async () => replaceDocument(cleared));
    expect(viewport().getState().selectedProfileId).toBeNull();
  });

  it('preserves the document when an expression is invalid and Cancel restores the field', async () => {
    await mount(); await click('Sketch'); await click('Apply'); await canvasClick(300, 200); await canvasClick(450, 100);
    await input(field('Width'), 'missingParameter * 2'); await click('Apply');
    expect(container.querySelector('.cad-property-form [role="alert"]')?.textContent).toContain('Unknown parameter');
    const sketch = currentDocument.features[0];
    expect(sketch.kind === 'sketch' && sketch.profiles[0].geometry.kind === 'rectangle' && sketch.profiles[0].geometry.width).toBe(50);
    expect(button('Save').disabled).toBe(true);
    await click('Cancel');
    expect(field('Width').value).toBe('50');
    expect(workflow).toHaveBeenLastCalledWith(false);
  });

  it('owns Save while editing and cancels scalar drafts with Escape without intercepting native text undo', async () => {
    await mount(solidDocument(), { build: topologyBuild, buildState: 'ready' });
    await click('Select Pad 1 in history');
    const before = currentSession.getSnapshot();
    await input(field('Length'), 'invalid + 2');
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

  it('cancels pending parameter fields from the focused input without changing geometry or history', async () => {
    await mount(solidDocument()); await click('Parameters');
    const before = currentSession.getSnapshot();
    await input(field('Name'), 'wall'); await input(field('Value'), '3');
    expect(currentSession.getSnapshot().workflowOpen).toBe(true);
    await act(async () => field('Value').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(field('Name').value).toBe(''); expect(field('Value').value).toBe('');
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
    await mount(); await click('Sketch'); await click('Apply');
    await canvasKey('Enter');
    expect(() => currentSession.assertWorkflowClosed()).toThrow('Finish or cancel');
    await canvasKey('ArrowRight', true); await canvasKey('ArrowUp', true); await canvasKey('Enter');
    const sketch = currentDocument.features[0];
    expect(sketch.kind === 'sketch' && sketch.profiles[0].geometry).toEqual({ kind: 'rectangle', x: 0, y: 0, width: 50, height: 50, cornerRadius: 0 });
    expect(() => currentSession.assertWorkflowClosed()).not.toThrow();
  });

  it('ignores right-button clicks and leaves browser zoom gestures to the browser', async () => {
    await mount(); await click('Sketch'); await click('Apply');
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
    await mount(); await click('Sketch'); await click('Apply'); await click('Finish sketch');
    const trigger = button('Delete selected feature or profile');
    trigger.focus(); await click('Delete selected feature or profile');
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
    await mount(); await click('Sketch'); await click('Apply');
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
    await click('Sketch'); await click('Apply');
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
    expect(container.querySelector('.cad-topology-details')?.textContent).toContain('Straight edge');
    await click('Fillet');
    expect(resolve).toHaveBeenCalledWith({ bodyId: 'pad', expectedBuildId: 'build-1', purpose: 'fillet', picks: [{ kind: 'edge', key: 'edge-1' }] }, currentSession.getSnapshot().version, expect.any(AbortSignal));
    expect(currentSession.getSnapshot().workflowOpen).toBe(true);
    expect(() => currentSession.assertWorkflowClosed()).toThrow('Finish or cancel');
    const scope = [...container.querySelectorAll('label')].find((label) => label.querySelector('span')?.textContent === 'Scope')?.querySelector('select');
    expect(scope?.value).toBe('selected');
    if (!scope) throw new Error('Scope control missing.');
    await act(async () => { scope.value = 'all'; scope.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.textContent).toContain('Applies to every edge');
    await act(async () => { scope.value = 'selected'; scope.dispatchEvent(new Event('change', { bubbles: true })); });
    await input(field('Radius'), '1 / 2'); await click('Apply');
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
    expect(container.querySelector('.cad-topology-details')?.textContent).toContain('Planar face');
    await click('Shell'); await input(field('Wall thickness'), '2 / 4'); await click('Apply');
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
    expect(container.textContent).toContain('solid changed during selection conversion');
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
    await mount(); await click('Sketch'); await click('Apply'); await canvasClick(300, 200); await canvasClick(450, 100);
    await click('Circle'); await canvasClick(375, 150); await canvasClick(390, 150);
    const sketch = currentDocument.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Sketch missing.');
    expect(sketch.profiles.every((profile) => profile.role === undefined)).toBe(true);
    const circle = sketch.profiles[1].geometry;
    if (circle.kind !== 'circle' || typeof circle.radius !== 'number') throw new Error('Numeric circle missing.');
    expect(measureCadSketch(currentDocument, sketch.id).materialAreaMm2).toBeCloseTo(2000 - Math.PI * circle.radius * circle.radius, 5);
    await click('Finish sketch'); await click('File'); await click('Send sketch to CAM');
    expect(sendToCam).toHaveBeenCalledWith(sketch.id);
  });

  it('retains legacy role constraints on load and opts only an explicitly edited profile into automatic nesting', async () => {
    const initial = solidDocument();
    await mount(initial);
    expect(currentDocument.features[0]).toMatchObject({ profiles: [{ role: 'outer' }] });
    await act(async () => { viewport().apply({ kind: 'edit-sketch', sketchId: 'sketch' }); viewport().apply({ kind: 'select-profile', profileId: 'rectangle' }); });
    await input(field('Width'), '51'); await click('Apply');
    const sketch = currentDocument.features[0];
    expect(sketch.kind === 'sketch' && sketch.profiles[0].role).toBeUndefined();
    expect(initial.features[0]).toMatchObject({ profiles: [{ role: 'outer', geometry: { width: 50 } }] });
  });

  it('shows imported source metadata without exposing or editing original source contents', async () => {
    const source = { format: 'step', encoding: 'utf8', fileName: 'source.step', data: 'ISO-10303-21;\nEND-ISO-10303-21;' } satisfies Extract<CadDocument['features'][number], { kind: 'imported' }>['source'];
    const initial = applyCadEdits(createCadDocument(), [{ kind: 'add-feature', feature: { id: 'imported', kind: 'imported', name: 'Imported solid', suppressed: false, source } }]);
    await mount(initial); await click('Select Imported solid in history');
    expect(container.querySelector('.cad-topology-details')?.textContent).toContain('source.step');
    await input(field('Name'), 'Renamed solid'); await click('Apply');
    expect(currentDocument.features[0]).toMatchObject({ name: 'Renamed solid', source });
    expect(container.textContent).not.toContain('ISO-10303-21');
  });

  it('keeps CAD header commands when a previous editor cleans up its shell header', async () => {
    await mount(createCadDocument(), { build: null, buildState: 'idle' }, 'previous-header');
    expect(container.querySelector('[data-app-header]')?.textContent).toBe('Previous editor');
    await act(async () => showCad());
    expect(container.querySelectorAll('.cad-header')).toHaveLength(1);
    expect(container.querySelector('[data-app-header]')?.contains(button('File'))).toBe(true);
    await click('Sketch'); await click('Apply');
    expect(container.querySelector('[data-app-header]')?.contains(button('Save'))).toBe(true);
  });

  it('renders imported analytic line/arc paths, fits their exact bounds and preserves segment geometry on metadata edits', async () => {
    const geometry = { kind: 'path', segments: [{ kind: 'line', start: [0, 0], end: [20, 0] }, { kind: 'arc', center: [10, 0], radius: 10, startAngle: 0, sweep: 180 }] } satisfies Extract<CadDocument['features'][number], { kind: 'sketch' }>['profiles'][number]['geometry'];
    const initial = applyCadEdits(createCadDocument(), [{ kind: 'add-feature', feature: { id: 'path-sketch', name: 'Imported sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [{ id: 'path-profile', name: 'Contour', construction: false, geometry }] } }]);
    await mount(initial);
    await act(async () => { viewport().apply({ kind: 'edit-sketch', sketchId: 'path-sketch' }); viewport().apply({ kind: 'select-profile', profileId: 'path-profile' }); });
    const profile = container.querySelector('[aria-label="Select Contour profile"]');
    expect(profile?.querySelectorAll('line')).toHaveLength(1);
    expect(profile?.querySelector('path')?.getAttribute('d')).toContain(' A 10 10 0 0 1 ');
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
