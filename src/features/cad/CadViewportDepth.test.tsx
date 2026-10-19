import { act, useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CadDocument, CadMesh } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { CadFeatureEditor } from './CadFeatureEditor';
import { CadViewport } from './CadViewport';
import { CadSession } from './cadSession';
import { cadFeatureCandidateEdits, cadFeatureCandidateKey, type CadFeaturePreviewCommand, type CadFeaturePreviewState } from './cadFeaturePreview';
import type { CadExtrudeDepthControl } from './cadExtrudeDepthInteraction';
import type { CadRenderedViewControls } from './cadViewportControls';
import { prepareCadViewportReferences } from './cadViewportReferences';
import { createCadDirectDepthControl } from './cadDirectDepthControl';

const rendered = vi.hoisted(() => ({ calls: vi.fn<(scene: THREE.Scene, camera: THREE.Camera) => void>(), canvases: [] as HTMLCanvasElement[], lost: false }));
vi.mock('@/features/editor/captureEditorPreview', () => ({ captureCanvas: () => ({ dataUrl: 'data:image/png;base64,AA==', width: 800, height: 600, source: '3d' }) }));
vi.mock('three', async original => {
  const module = await original<typeof import('three')>();
  return { ...module, WebGLRenderer: class {
    domElement = document.createElement('canvas'); render = rendered.calls;
    constructor() { rendered.canvases.push(this.domElement); }
    setPixelRatio() {} setSize() {} dispose() {} forceContextLoss() {}
    getContext() { return { isContextLost: () => rendered.lost }; }
  } };
});
let root: Root, container: HTMLDivElement, view: CadRenderedViewControls | null;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
async function flushFrame() { await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(performance.now())); }); }
beforeEach(() => {
  view = null; rendered.calls.mockClear(); rendered.canvases.length = 0; rendered.lost = false; frames = new Map(); nextFrame = 1;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800); vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function part(origin = 0): CadDocument {
  return { ...createCadDocument('Viewport depth', 'viewport_depth'), parameters: { depth: 10 }, features: [
    { id: 'outline', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'rect', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: origin, y: origin, width: 20, height: 10, cornerRadius: 0 } }
    ] },
    { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'outline', distance: ' depth ', symmetric: false, operation: 'new', targetId: null }
  ] };
}
async function harness(origin = 0) {
  const session = new CadSession(part(origin)), before = session.getSnapshot();
  const mesh: CadMesh = { featureId: 'pad', name: 'Pad', positions: [origin, origin, 10, origin + 20, origin, 10, origin + 20, origin + 10, 10, origin, origin + 10, 10],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2, 0, 2, 3], edges: [], faceGroups: [], edgeGroups: [], volume: 2000,
    bounds: { min: [origin, origin, 0], max: [origin + 20, origin + 10, 10] } };
  const meshes = [mesh], references = prepareCadViewportReferences(before.document.features, before.document.parameters), preview = vi.fn<(command: CadFeaturePreviewCommand) => void>();
  const select = vi.fn(), menu = vi.fn(), escaped = vi.fn();
  let control: CadExtrudeDepthControl | null = null, publish: ((state: CadFeaturePreviewState) => void) | undefined,
    enable: ((next: boolean) => void) | undefined, lock: ((next: boolean) => void) | undefined, publication: (() => void) | undefined;
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot), [depth, setDepth] = useState<CadExtrudeDepthControl | null>(null),
      [enabled, setEnabled] = useState(true), [navigationLocked, setLocked] = useState(false), [published, setPublished] = useState(false),
      [state, setState] = useState<CadFeaturePreviewState>({ kind: 'idle' });
    const readyControl = useCallback((next: CadExtrudeDepthControl | null, released?: CadExtrudeDepthControl) => {
      setDepth(previous => next || !released || previous === released ? next : previous);
    }, []);
    control = depth; publish = setState; enable = setEnabled; lock = setLocked; publication = () => setPublished(true);
    return <div onKeyDown={event => { if (event.key === 'Escape') escaped(); }}>
      <CadFeatureEditor feature={snapshot.document.features[1]} document={snapshot.document} documentVersion={snapshot.version} isNew={false}
        onPendingChange={session.setWorkflowOpen} onFeaturePreview={preview} featurePreview={state} onDepthInteractionReady={readyControl}
        onCancel={() => session.setWorkflowOpen(false)} onApply={(feature, parameters) => session.edit(cadFeatureCandidateEdits({ feature, isNew: false, parameters }))} />
      <CadViewport meshes={published ? [{ ...mesh, volume: 1999 }] : meshes} references={published ? [...references] : references}
        referenceVersion={published ? 'candidate-publication' : snapshot.version} selectedId="pad" onSelect={select} onContextMenu={menu}
        depthControl={enabled ? depth : null} interactionLocked={snapshot.workflowOpen} navigationLocked={navigationLocked}
        onControlsReady={next => { view = next; }} />
    </div>;
  }
  await act(async () => root.render(<Harness />)); await flushFrame();
  const [scene, camera] = rendered.calls.mock.calls.at(-1)!;
  if (!(camera instanceof THREE.OrthographicCamera)) throw new Error('Missing real camera');
  const canvas = rendered.canvases[0], captured = new Set<number>();
  canvas.setPointerCapture = vi.fn((id: number) => captured.add(id)); canvas.hasPointerCapture = vi.fn((id: number) => captured.has(id));
  canvas.releasePointerCapture = vi.fn((id: number) => captured.delete(id));
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) });
  const getControl = () => { if (!control) throw new Error('Missing actual editor control'); return control; };
  const point = (quantity = 10) => { camera.updateMatrixWorld(); const position = new THREE.Vector3(origin + 10, origin + 5, quantity).project(camera); return { x: (position.x + 1) * 400, y: (1 - position.y) * 300 }; };
  const pointer = async (type: string, position = point(), overrides: MouseEventInit = {}, pointerId = 1) => {
    await act(async () => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: position.x, clientY: position.y, ...overrides });
      Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: 'mouse' }, isPrimary: { value: true } }); canvas.dispatchEvent(event);
    }); await flushFrame();
  };
  const candidate = () => { const command = preview.mock.calls.at(-1)?.[0]; if (!command || command.kind !== 'candidate') throw new Error('Missing candidate'); return command; };
  const ready = async () => { const command = candidate(); await act(async () => publish?.({ kind: 'ready', owner: command.owner, baseVersion: command.expectedVersion,
    featureId: 'pad', candidateId: 'depth_preview', definitionKey: cadFeatureCandidateKey(command.edits), document: applyCadEdits(session.getSnapshot().document, command.edits),
    result: { buildId: 'depth_preview', meshes: [mesh], diagnostics: [], durationMs: 0 } })); await flushFrame(); };
  const length = () => container.querySelector<HTMLInputElement>('[aria-label="Length mm"]')!;
  return { session, before, mesh, references, scene, camera, canvas, captured, select, menu, escaped, control: getControl, pointer, point, candidate, ready, length,
    publish: async () => { await act(async () => publication?.()); await flushFrame(); },
    enable: async (next: boolean) => { await act(async () => enable?.(next)); await flushFrame(); },
    lock: async (next: boolean) => { await act(async () => lock?.(next)); await flushFrame(); } };
}

it.each([0, 100000000])('physically drags the actual editor-owned depth at %s across pending/native publications, then releases for one Apply/Undo', async origin => {
  const h = await harness(origin), position = h.camera.position.toArray(), quaternion = h.camera.quaternion.toArray(), zoom = h.camera.zoom;
  await h.pointer('pointerdown'); expect(h.control().getState()?.gestureActive).toBe(true); expect(h.captured.has(1)).toBe(true);
  expect(h.session.getSnapshot()).toMatchObject({ document: h.before.document, version: h.before.version, canUndo: false, workflowOpen: true });
  await h.pointer('pointermove', h.point(20)); expect(Number(h.length().value)).toBeCloseTo(20, 7);
  expect(h.candidate().edits[0].feature).toEqual(h.before.document.features[1]); expect(h.candidate().edits[1]).toMatchObject({ kind: 'set-parameter', name: 'depth' });
  await h.ready(); await h.publish(); expect(h.control().getState()?.gestureActive).toBe(true);
  await act(async () => h.canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 }))); await flushFrame();
  await h.pointer('pointerleave', h.point(20)); expect(h.control().getState()?.gestureActive).toBe(true);
  expect(h.camera.position.toArray()).toEqual(position); expect(h.camera.quaternion.toArray()).toEqual(quaternion); expect(h.camera.zoom).toBe(zoom);
  expect(h.select).not.toHaveBeenCalled(); expect(h.menu).not.toHaveBeenCalled();
  await h.pointer('pointerup', h.point(20)); expect(h.control().getState()?.gestureActive).toBe(false); expect(h.captured.size).toBe(0);
  const apply = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Apply')!;
  expect(apply.disabled).toBe(false); await act(async () => apply.click());
  expect(h.session.getSnapshot().document.features).toEqual(h.before.document.features); expect(h.session.getSnapshot().document.parameters.depth).toBeCloseTo(20, 7);
  await act(async () => h.session.undo()); expect(h.session.getSnapshot().document).toEqual(h.before.document); expect(h.session.getSnapshot().canUndo).toBe(false);
  expect(rendered.canvases).toHaveLength(1);
});

it('consumes gesture Escape before the feature handler and restores a previous typed provisional depth precisely', async () => {
  const h = await harness();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(h.length(), '20'); h.length().dispatchEvent(new Event('input', { bubbles: true })); });
  await h.ready(); await h.pointer('pointerdown', h.point(20)); await h.pointer('pointermove', h.point(35)); expect(Number(h.length().value)).toBeCloseTo(35, 8);
  await act(async () => h.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))); await flushFrame();
  expect(h.escaped).not.toHaveBeenCalled(); expect(h.length().value).toBe('20'); expect(h.captured.size).toBe(0);
  expect(h.session.getSnapshot()).toMatchObject({ document: h.before.document, version: h.before.version, canUndo: false, workflowOpen: true });
  expect(h.candidate().edits[1]).toEqual({ kind: 'set-parameter', name: 'depth', value: 20 });
});

it('ignores a foreign pointer and an additional right-button release until its captured primary release', async () => {
  const h = await harness(); await h.pointer('pointerdown');
  await h.pointer('pointerup', h.point(), {}, 2); expect(h.control().getState()?.gestureActive).toBe(true);
  await h.pointer('pointerdown', h.point(), { button: 2, buttons: 3 });
  await h.pointer('pointerup', h.point(), { button: 2, buttons: 1 });
  expect(h.control().getState()?.gestureActive).toBe(true); expect(h.captured.has(1)).toBe(true);
  await h.pointer('pointermove', h.point(20)); expect(Number(h.length().value)).toBeCloseTo(20, 8);
  await h.pointer('pointerup', h.point(20)); expect(h.control().getState()?.gestureActive).toBe(false);
  expect(h.select).not.toHaveBeenCalled(); expect(h.menu).not.toHaveBeenCalled();
});

it.each(['pointercancel', 'lostpointercapture', 'blur', 'graphics', 'disabled', 'dialog', 'replacement', 'unmount'])('cancels an owned drag on %s without accepting geometry or continuing a late pointer', async reason => {
  const h = await harness(), control = h.control(); await h.pointer('pointerdown'); await h.pointer('pointermove', h.point(20));
  expect(control.getState()?.gestureActive).toBe(true);
  if (reason === 'disabled') await h.enable(false);
  else if (reason === 'dialog') await h.lock(true);
  else if (reason === 'replacement') await act(async () => h.session.replace({ ...h.before.document, name: 'Replacement' }));
  else if (reason === 'unmount') await act(async () => root.render(null));
  else if (reason === 'blur') await act(async () => window.dispatchEvent(new Event('blur')));
  else if (reason === 'graphics') await act(async () => { rendered.lost = true; h.canvas.dispatchEvent(new Event('webglcontextlost')); });
  else await h.pointer(reason);
  expect(control.getState()?.gestureActive ?? false).toBe(false); expect(h.captured.size).toBe(0);
  await h.pointer('pointermove', h.point(35)); await h.pointer('pointerup', h.point(35));
  expect(h.session.getSnapshot().document.parameters.depth).toBe(10); expect(h.session.getSnapshot().canUndo).toBe(false);
  if (reason !== 'unmount') expect(h.length().value).toBe('10');
  expect(h.select).not.toHaveBeenCalled(); expect(h.menu).not.toHaveBeenCalled();
  if (reason === 'graphics') expect(container.querySelector<HTMLElement>('.cad-depth-label')?.hidden).toBe(true);
});

it('renders a truthful endpoint label/revision and restores ordinary navigation and materials after mode exit', async () => {
  const h = await harness(), before = view!.getState().revision, body: THREE.Mesh[] = [];
  h.scene.traverse(object => { if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) body.push(object); });
  const material = body[0].material;
  await h.pointer('pointermove', h.point(), { buttons: 0 });
  expect(container.querySelector('.cad-depth-label')?.textContent).toBe('Length 10 mm'); expect(view!.getState().revision).toBeGreaterThan(before);
  await h.pointer('pointerdown'); await h.pointer('pointermove', h.point(20)); await h.pointer('pointerup', h.point(20));
  expect(container.querySelector('.cad-depth-label')?.textContent).toBe('Wait for the current preview before dragging.');
  await h.ready(); expect(container.querySelector('.cad-depth-label')?.textContent).toContain('Length');
  await h.enable(false); expect(container.querySelector<HTMLElement>('.cad-depth-label')?.hidden).toBe(true);
  const zoom = h.camera.zoom;
  await act(async () => h.canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 }))); await flushFrame();
  expect(h.camera.zoom).toBeGreaterThan(zoom); expect(body[0].material).toBe(material);
  expect(material).toMatchObject({ opacity: 1, transparent: false, depthWrite: true });
});

it('keeps a settled visible idle depth handle stable across captures while retaining exact source ownership', async () => {
  const h = await harness();
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = view!.getState();
    await act(async () => { await view!.capture(new AbortController().signal); });
    expect(view!.getState()).toEqual(before);
  }
  expect(h.control().getState()?.gestureActive).toBe(false); expect(h.session.getSnapshot()).toEqual(h.before);
});

describe('direct end face drag', () => {
  async function direct() {
    const session = new CadSession(part()), before = session.getSnapshot();
    const mesh: CadMesh = { featureId: 'pad', name: 'Pad', positions: [0, 0, 10, 20, 0, 10, 20, 10, 10, 0, 10, 10],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2, 0, 2, 3], edges: [], faceGroups: [{ key: 'face:top', start: 0, count: 6 }], edgeGroups: [], volume: 2000,
      bounds: { min: [0, 0, 0], max: [20, 10, 10] } };
    const select = vi.fn(), preview = vi.fn<(command: CadFeaturePreviewCommand) => void>(), gesture = vi.fn<(active: boolean) => void>();
    function Direct() {
      const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
      const control = useMemo(() => createCadDirectDepthControl({ featureId: 'pad', baseVersion: snapshot.version, owner: 'direct',
        read: () => ({ document: session.getSnapshot().document, documentVersion: session.getSnapshot().version, enabled: true }),
        preview, commit: edits => { session.edit(edits); }, onGestureChange: gesture }), [snapshot.version]);
      return <CadViewport meshes={[mesh]} references={[]} referenceVersion={snapshot.version} selectedId="pad" onSelect={select}
        depthControl={control} interactionLocked={false} navigationLocked={false} onControlsReady={next => { view = next; }} />;
    }
    await act(async () => root.render(<Direct />)); await flushFrame();
    const camera = rendered.calls.mock.calls.at(-1)![1];
    if (!(camera instanceof THREE.OrthographicCamera)) throw new Error('Missing real camera');
    const canvas = rendered.canvases[0], captured = new Set<number>();
    canvas.setPointerCapture = vi.fn((id: number) => captured.add(id)); canvas.hasPointerCapture = vi.fn((id: number) => captured.has(id));
    canvas.releasePointerCapture = vi.fn((id: number) => captured.delete(id));
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) });
    // Off the arrow, on the end face: the drag must come from the face itself.
    const at = (z: number) => { camera.updateMatrixWorld(); const position = new THREE.Vector3(3, 2, z).project(camera); return { x: (position.x + 1) * 400, y: (1 - position.y) * 300 }; };
    const pointer = async (type: string, position: { x: number; y: number }) => {
      await act(async () => {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: position.x, clientY: position.y });
        Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' }, isPrimary: { value: true } }); canvas.dispatchEvent(event);
      }); await flushFrame();
    };
    return { session, before, select, preview, gesture, captured, at, pointer, camera };
  }

  it('drags a pressed end face into one undoable Length edit without orbiting', async () => {
    const h = await direct(), position = h.camera.position.toArray();
    await h.pointer('pointerdown', h.at(10)); expect(h.gesture).not.toHaveBeenCalled();
    await h.pointer('pointermove', h.at(16));
    expect(h.gesture).toHaveBeenLastCalledWith(true);
    expect(h.preview).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'candidate', owner: 'direct' }));
    expect(h.session.getSnapshot().version).toBe(h.before.version);
    await h.pointer('pointerup', h.at(16));
    expect(h.session.getSnapshot().document.parameters.depth).toBeCloseTo(16, 6);
    expect(h.session.getSnapshot().document.features).toEqual(h.before.document.features);
    expect(h.camera.position.toArray()).toEqual(position); expect(h.select).not.toHaveBeenCalled(); expect(h.captured.size).toBe(0);
    await act(async () => h.session.undo()); expect(h.session.getSnapshot().document).toEqual(h.before.document);
  });

  it.each(['lostpointercapture', 'pointercancel'])('forgets a pending face press on %s', async type => {
    const h = await direct();
    await h.pointer('pointerdown', h.at(10)); await h.pointer(type, h.at(10)); await h.pointer('pointermove', h.at(16));
    expect(h.gesture).not.toHaveBeenCalled(); expect(h.captured.size).toBe(0);
    await h.pointer('pointerdown', h.at(10)); await h.pointer('pointermove', h.at(16)); await h.pointer('pointerup', h.at(16));
    expect(h.session.getSnapshot().document.parameters.depth).toBeCloseTo(16, 6);
  });

  it('keeps a press and release on the face an ordinary pick', async () => {
    const h = await direct();
    await h.pointer('pointerdown', h.at(10)); await h.pointer('pointerup', h.at(10));
    expect(h.select).toHaveBeenCalledWith('pad'); expect(h.gesture).not.toHaveBeenCalled();
    expect(h.session.getSnapshot()).toEqual(h.before); expect(h.captured.size).toBe(0);
  });
});
