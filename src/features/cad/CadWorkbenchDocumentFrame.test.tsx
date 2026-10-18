import { act, useState, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Box3, Mesh, OrthographicCamera, Vector3, type Camera, type Scene } from 'three';
import type { CadBuildResult, CadDocument, CadMesh } from '@/domain/cad/cadDocument';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { CadWorkbench, type CadWorkbenchProps } from './CadWorkbench';
import { CadSession } from './cadSession';
import { cadFeatureCandidateKey, type CadFeaturePreviewState } from './cadFeaturePreview';
import type { CadWorkbenchViewportControls } from './cadViewportControls';

// Only the unavailable GPU/raster adapters are replaced. Workbench, real Three
// camera, OrbitControls, scene upload, domain/history and capture guards run.
interface Renderer {
  domElement: HTMLCanvasElement;
  render: ReturnType<typeof vi.fn<(scene: Scene, camera: Camera) => void>>;
}
const renderers = vi.hoisted((): Renderer[] => []);
vi.mock('@/features/editor/captureEditorPreview', () => ({ captureCanvas: () => ({ dataUrl: 'data:image/png;base64,AA==', width: 800, height: 600, source: '3d' }) }));
vi.mock('three', async original => ({ ...await original<typeof import('three')>(), WebGLRenderer: class {
  domElement = document.createElement('canvas');
  render = vi.fn((_scene: Scene, _camera: Camera) => undefined);
  constructor() { renderers.push(this); }
  setPixelRatio() {} setSize(width: number, height: number) { this.domElement.width = width; this.domElement.height = height; }
  getContext() { return { isContextLost: () => false }; } dispose() {} forceContextLoss() {}
} }));

let root: Root, container: HTMLDivElement, session: CadSession;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
let viewport: CadWorkbenchViewportControls | null;
let openDocument: (document: CadDocument) => void;
let publishBuild: () => void;
let editDepth: (depth: number) => void;
let publishPreview: (preview: CadFeaturePreviewState) => void;
const preview = vi.fn<NonNullable<CadWorkbenchProps['onFeaturePreview']>>();

beforeEach(() => {
  renderers.length = 0; viewport = null; preview.mockReset(); frames = new Map(); nextFrame = 1;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const box = this.hasAttribute('data-cad-model-tree') ? { left: 0, top: 0, width: 190, height: 600 }
      : this.hasAttribute('data-cad-command-dock') ? { left: 190, top: 550, width: 610, height: 50 }
        : this.hasAttribute('data-cad-properties') ? { left: 190, top: 20, width: 240, height: 400 }
          : { left: 0, top: 0, width: 800, height: 600 };
    return { ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => box };
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function part(id: string, x: number, y: number, width: number, height: number) {
  return applyCadEdits(createCadDocument(id, id), [
    { kind: 'add-feature', feature: { id: 'outline', name: 'Outline', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false,
      profiles: [{ id: 'rectangle', name: 'Plate', construction: false, geometry: { kind: 'rectangle', x, y, width, height, cornerRadius: 0 } }] } },
    { kind: 'add-feature', feature: { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'outline', distance: 4, symmetric: false, operation: 'new', targetId: null } },
  ]);
}
function meshFor(document: CadDocument): CadMesh {
  const sketch = document.features[0], pad = document.features[1];
  if (sketch.kind !== 'sketch' || pad.kind !== 'extrude' || typeof pad.distance !== 'number') throw new Error('Expected numeric Pad fixture.');
  const geometry = sketch.profiles[0].geometry;
  if (geometry.kind !== 'rectangle' || typeof geometry.x !== 'number' || typeof geometry.y !== 'number' || typeof geometry.width !== 'number' || typeof geometry.height !== 'number') throw new Error('Expected numeric rectangle fixture.');
  const { x, y, width: w, height: h } = geometry, d = pad.distance;
  return { featureId: 'pad', name: 'Pad', positions: [x, y, 0, x + w, y, 0, x + w, y + h, 0, x, y + h, 0, x, y, d, x + w, y, d, x + w, y + h, d, x, y + h, d],
    normals: Array.from({ length: 8 }, () => [0, 0, 1]).flat(), indices: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7],
    edges: [x, y, 0, x + w, y, 0], faceGroups: [], edgeGroups: [], volume: w * h * d, bounds: { min: [x, y, 0], max: [x + w, y + h, d] } };
}
function buildFor(document: CadDocument, buildId: string): CadBuildResult { return { buildId, meshes: [meshFor(document)], diagnostics: [], durationMs: 1 }; }
function controls() { if (!viewport) throw new Error('Missing public viewport controls.'); return viewport; }
function rendered() {
  const call = renderers.at(-1)?.render.mock.calls.at(-1); if (!call || !(call[1] instanceof OrthographicCamera)) throw new Error('Missing rendered orthographic camera.');
  return { scene: call[0], camera: call[1] };
}
function cameraFrame() {
  const { camera } = rendered(); return { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), zoom: camera.zoom,
    left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom };
}
function displayedDepth() {
  const { scene } = rendered(); let body: Mesh | undefined;
  scene.traverse(object => { if (object instanceof Mesh && object.userData.featureId === 'pad') body = object; });
  if (!body) throw new Error('Missing displayed Pad.');
  const bounds = new Box3().setFromObject(body); return bounds.max.z - bounds.min.z;
}
async function flushFrame() {
  await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(performance.now())); });
}
async function mount(initial: CadDocument) {
  session = new CadSession(initial);
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
    const [accepted, setAccepted] = useState<{ build: CadBuildResult | null; version: string | null }>({ build: buildFor(initial, 'initial'), version: snapshot.version });
    const [featurePreview, setPreview] = useState<CadFeaturePreviewState>({ kind: 'idle' }); publishPreview = setPreview;
    // This matches the existing controller replacement contract: opening clears
    // the old accepted build; only the new exact-version result is published.
    openDocument = replacement => { session.replace(replacement); setAccepted({ build: null, version: null }); };
    publishBuild = () => { const current = session.getSnapshot(); setAccepted({ build: buildFor(current.document, 'current'), version: current.version }); };
    editDepth = depth => { const pad = session.getSnapshot().document.features[1]; if (pad.kind !== 'extrude') throw new Error('Expected Pad.');
      session.edit([{ kind: 'update-feature', feature: { ...pad, distance: depth } }]); publishBuild(); };
    return <CadWorkbench document={snapshot.document} documentVersion={snapshot.version} build={accepted.build} buildVersion={accepted.version}
      buildState={accepted.build ? 'ready' : 'building'} dirty={snapshot.dirty} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo}
      onEdit={edit => session.edit([edit])} onEditMany={edits => session.edit(edits)} onUndo={() => session.undo()} onRedo={() => session.redo()}
      onWorkflowChange={open => session.setWorkflowOpen(open)} onBack={() => undefined} onSave={async () => undefined} onSendToCam={async () => undefined}
      onNewDocument={() => undefined} onOpenDocument={() => undefined} onImportDocument={async () => undefined} onExportDocument={() => undefined}
      onExportSolid={async () => undefined} featurePreview={featurePreview} onFeaturePreview={preview} onViewportControlsReady={value => { viewport = value; }} />;
  }
  await act(async () => root.render(<Harness />)); await flushFrame();
}
function expectPartInClearPixels(document: CadDocument) {
  const { camera } = rendered(); camera.updateMatrixWorld();
  const positions = meshFor(document).positions;
  for (let index = 0; index < positions.length; index += 3) {
    const projected = new Vector3(positions[index], positions[index + 1], positions[index + 2]).project(camera);
    const x = (projected.x + 1) * 400, y = (1 - projected.y) * 300;
    expect(x).toBeGreaterThanOrEqual(190); expect(x).toBeLessThanOrEqual(800);
    expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(550);
  }
}

it('initially frames each opened document after its own mesh arrives instead of retaining another part camera', async () => {
  const small = part('small_part', 0, 0, 8, 6), large = part('large_part', 200, -100, 80, 50);
  await mount(small); expectPartInClearPixels(small);
  await act(async () => controls().apply({ kind: 'set-view', view: 'Front' })); await flushFrame();
  for (const document of [large, small]) {
    await act(async () => openDocument(document)); await flushFrame();
    let bodies = 0; rendered().scene.traverse(object => { if (object instanceof Mesh && object.userData.featureId === 'pad') bodies++; });
    expect(bodies).toBe(0); // A retained mesh cannot consume the new initial fit.
    await act(async () => publishBuild()); await flushFrame();
    expectPartInClearPixels(document);
    const state = controls().getState(); expect(state).toMatchObject({ documentId: document.id, buildId: 'current', buildState: 'ready', selectedFeatureId: null });
    expect(state.buildVersion).toBe(session.getSnapshot().version);
    await expect(controls().capture(new AbortController().signal)).resolves.toMatchObject({ documentId: document.id, documentVersion: session.getSnapshot().version,
      viewState: { documentId: document.id, selectedFeatureId: null, buildId: 'current', view: { mode: 'solid', view: 'Isometric' } } });
  }
});

it('preserves a human camera through same-document edits, inspector changes and preview cancellation', async () => {
  await mount(part('edited_part', 0, 0, 8, 6));
  const canvas = renderers.at(-1)!.domElement, initialZoom = rendered().camera.zoom;
  await act(async () => canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }))); await flushFrame();
  expect(rendered().camera.zoom).not.toBe(initialZoom); const chosen = cameraFrame();
  await act(async () => editDepth(18)); await flushFrame(); expect(cameraFrame()).toEqual(chosen); expect(displayedDepth()).toBe(18);
  await act(async () => controls().apply({ kind: 'select-feature', featureId: 'pad' })); await flushFrame();
  await act(async () => container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))); await flushFrame();
  expect(container.querySelector('[data-cad-properties]')).not.toBeNull(); expect(cameraFrame()).toEqual(chosen);
  const before = session.getSnapshot(), length = [...container.querySelectorAll('label')].find(label => label.querySelector('span')?.childNodes[0]?.textContent === 'Length')?.querySelector('input');
  if (!length) throw new Error('Missing real Pad length field.');
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(length, '40'); length.dispatchEvent(new Event('input', { bubbles: true })); });
  const command = preview.mock.calls.map(([entry]) => entry).filter(entry => entry.kind === 'candidate').at(-1);
  if (!command || command.kind !== 'candidate') throw new Error('Missing real preview command.');
  const candidate = applyCadEdits(before.document, command.edits);
  await act(async () => publishPreview({ kind: 'ready', owner: command.owner, featureId: 'pad', baseVersion: before.version, candidateId: 'depth_preview',
    definitionKey: cadFeatureCandidateKey(command.edits), document: candidate, result: buildFor(candidate, 'preview') })); await flushFrame();
  expect(cameraFrame()).toEqual(chosen); expect(displayedDepth()).toBe(40); expect(session.getSnapshot().document).toBe(before.document);
  const cancel = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Cancel'); if (!cancel) throw new Error('Missing real Cancel.');
  await act(async () => cancel.click()); await flushFrame();
  expect(session.getSnapshot()).toEqual(before); expect(cameraFrame()).toEqual(chosen); expect(displayedDepth()).toBe(18);
  expect(controls().getState()).toMatchObject({ documentId: before.document.id, selectedFeatureId: 'pad', buildId: 'current', buildState: 'ready' });
  await expect(controls().capture(new AbortController().signal)).resolves.toMatchObject({ documentId: before.document.id, documentVersion: before.version, buildVersion: before.version });
});
