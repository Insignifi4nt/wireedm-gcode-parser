import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxesHelper, GridHelper, LineDashedMaterial, LineSegments, Mesh, OrthographicCamera, Vector3, type Camera, type Scene } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CadMesh } from '@/domain/cad/cadDocument';
import { CadViewport } from './CadViewport';
import type { CadRenderedViewControls } from './cadViewportControls';
import { prepareCadCurveReferences } from './cadCurveRendering';
import { prepareCadViewportReferences, type CadViewportReference } from './cadViewportReferences';

interface MockRenderer {
  readonly domElement: HTMLCanvasElement;
  lost: boolean;
  readonly render: ReturnType<typeof vi.fn<(scene: Scene, camera: Camera) => void>>;
  readonly dispose: ReturnType<typeof vi.fn>;
  readonly forceContextLoss: ReturnType<typeof vi.fn>;
}
const renderers = vi.hoisted((): MockRenderer[] => []);
const rasterize = vi.hoisted(() => vi.fn());
vi.mock('@/features/editor/captureEditorPreview', () => ({ captureCanvas: rasterize }));
vi.mock('three', async importOriginal => {
  const original = await importOriginal<typeof import('three')>();
  return { ...original, WebGLRenderer: class {
    domElement = document.createElement('canvas');
    lost = false;
    render = vi.fn((_scene: Scene, _camera: Camera) => undefined);
    dispose = vi.fn();
    forceContextLoss = vi.fn(() => { this.lost = true; });
    constructor() { renderers.push(this); }
    setPixelRatio() {}
    setSize(width: number, height: number) { this.domElement.width = width; this.domElement.height = height; }
    getContext() { return { isContextLost: () => this.lost }; }
  } };
});

const mesh: CadMesh = { featureId: 'body', name: 'Body', positions: [0, 0, 0, 10, 0, 0, 0, 10, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  indices: [0, 1, 2], edges: [0, 0, 0, 10, 0, 0], faceGroups: [], edgeGroups: [], volume: 100, bounds: { min: [0, 0, 0], max: [10, 10, 10] } };
let root: Root; let container: HTMLDivElement; let controls: CadRenderedViewControls | null;
let frames: Map<number, FrameRequestCallback>; let nextFrame: number;
function renderer() { const current = renderers.at(-1); if (!current) throw new Error('Renderer unavailable'); return current; }
function currentControls() { if (!controls) throw new Error('Viewport controls unavailable'); return controls; }
function solidViewState() { const state = currentControls().getState(); if (state.mode !== 'solid') throw new Error('World viewport unavailable'); return state; }
beforeEach(() => {
  controls = null; renderers.length = 0; frames = new Map(); nextFrame = 1;
  rasterize.mockReset().mockReturnValue({ dataUrl: 'data:image/png;base64,AA==', width: 800, height: 600, source: '3d' });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => root.render(<CadViewport meshes={[mesh]} selectedId="body" onSelect={vi.fn()} onControlsReady={value => { controls = value; }} />)); }
async function flushFrame() {
  await act(async () => {
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach(callback => callback(performance.now()));
  });
}
async function loseContext() { await act(async () => { renderer().lost = true; renderer().domElement.dispatchEvent(new Event('webglcontextlost')); }); }

describe('datum glyph rendering', () => {
  const datum = { id: 'mount', name: 'Mount', kind: 'datum-plane', suppressed: false, definition: { kind: 'world', basePlane: 'XY', origin: [1e8, 1e8, 1e8], rotation: [30, 0, 0] } } as const;
  it('installs bounded plane resources and capture IDs, excludes glyphs from contour Fit and disposes them once', async () => {
    const references = prepareCadViewportReferences([datum, { id: 'outline', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
      profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 2 } }] }], {});
    const show = async (references: readonly CadViewportReference[], version: string) => {
      await act(async () => root.render(<CadViewport meshes={[]} references={references} referenceVersion={version} selectedId="mount" onSelect={vi.fn()} onControlsReady={value => { controls = value; }} />));
      await currentControls().capture(new AbortController().signal);
    };
    await show(references, 'v1'); expect(solidViewState()).toMatchObject({ zoom: 8.5, referenceVersion: 'v1', referenceFeatureIds: ['mount', 'outline'] });
    const scene = renderer().render.mock.calls.at(-1)![0]; const objects: (Mesh | LineSegments)[] = [];
    scene.traverse(object => { if (object.userData.featureId === 'mount' && (object instanceof Mesh || object instanceof LineSegments)) objects.push(object); });
    expect(objects).toHaveLength(2);
    const patch = objects.find(object => object instanceof Mesh)!; expect(patch.position.toArray().every(value => value > 1e8 - 20 && value < 1e8 + 20)).toBe(true);
    expect(Array.from(patch.geometry.getAttribute('position').array).every(value => Math.abs(value) < 20)).toBe(true);
    const disposed = objects.map(object => vi.spyOn(object.geometry, 'dispose'));
    await show(references, 'v2'); expect(disposed.every(spy => spy.mock.calls.length === 0)).toBe(true);
    await show([], 'v3'); expect(disposed.every(spy => spy.mock.calls.length === 1)).toBe(true);
    expect(solidViewState()).toMatchObject({ referenceVersion: 'v3', referenceFeatureIds: [] });
  });
  it('fits datum-only scenes and prioritizes contours over the plane patch in Body picking', async () => {
    const nearDatum = { ...datum, definition: { ...datum.definition, origin: [0, 0, 0] as const, rotation: [0, 0, 0] as const } };
    const references = prepareCadViewportReferences([nearDatum, { id: 'outline', name: 'Outline', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false,
      profiles: [{ id: 'rectangle', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: -1, y: -1, width: 2, height: 2, cornerRadius: 0 } }] }], {});
    const selected = vi.fn(); const topology = vi.fn();
    const show = async (outlines: readonly CadViewportReference[], mode: 'body' | 'face' = 'body') => {
      await act(async () => root.render(<CadViewport meshes={[]} references={outlines} referenceVersion="current" selectedId={null} onSelect={selected}
        onTopologyPick={topology} pickMode={mode} onControlsReady={value => { controls = value; }} />));
      await currentControls().capture(new AbortController().signal);
    };
    await show(references.filter(reference => reference.featureKind === 'datum-plane'));
    expect(solidViewState()).toMatchObject({ referenceFeatureIds: ['mount'] }); expect(solidViewState().zoom).toBeGreaterThan(1);
    await show(references); await act(async () => currentControls().fit()); await currentControls().capture(new AbortController().signal);
    const camera = renderer().render.mock.calls.at(-1)![1]; camera.updateMatrixWorld();
    const point = new Vector3(1, 0, 0).project(camera);
    const canvas = renderer().domElement;
    canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn();
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) });
    const pick = async () => { await act(async () => {
      for (const type of ['pointerdown', 'pointerup']) renderer().domElement.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: (point.x + 1) * 400, clientY: (1 - point.y) * 300 }));
    }); };
    await pick(); expect(selected).toHaveBeenLastCalledWith('outline');
    selected.mockClear(); await show(references, 'face'); await pick(); expect(selected).not.toHaveBeenCalled(); expect(topology).toHaveBeenCalledWith(null, false);
  });
});

describe('initial reference and solid framing', () => {
  const references = prepareCadViewportReferences([{ id: 'section', name: 'Section', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false,
    profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 2 } }] }], {});
  const longPad: CadMesh = { ...mesh, positions: [-2, -2, 0, 2, -2, 0, -2, 2, 300], edges: [-2, -2, 0, -2, 2, 300], bounds: { min: [-2, -2, 0], max: [2, 2, 300] } };
  const show = async (meshes: readonly CadMesh[], outlines: readonly CadViewportReference[] = references) => {
    await act(async () => root.render(<CadViewport meshes={meshes} references={outlines} referenceVersion="current" selectedId={null}
      onSelect={vi.fn()} onControlsReady={value => { controls = value; }} />));
    await currentControls().capture(new AbortController().signal);
  };
  const camera = () => { const value = renderer().render.mock.calls.at(-1)?.[1]; if (!(value instanceof OrthographicCamera)) throw new Error('CAD camera missing'); return value; };

  it('fits the first solid after reference-only viewing and preserves the camera through later geometry/visibility changes', async () => {
    await show([]); expect(solidViewState().zoom).toBe(8.5);
    await show([longPad], []); expect(solidViewState().zoom).toBeLessThan(.85);
    const firstCamera = camera(); firstCamera.updateMatrixWorld();
    for (const point of [new Vector3(-2, -2, 0), new Vector3(-2, 2, 300)]) {
      point.project(firstCamera); expect(Math.abs(point.x)).toBeLessThan(1); expect(Math.abs(point.y)).toBeLessThan(1);
    }
    const position = firstCamera.position.toArray(); const zoom = firstCamera.zoom;
    await show([{ ...longPad, positions: longPad.positions.map((value, index) => index % 3 === 2 ? value * 2 : value), bounds: { min: [-2, -2, 0], max: [2, 2, 600] } }]);
    expect(camera().position.distanceTo(new Vector3(...position))).toBeLessThan(1e-8); expect(solidViewState().zoom).toBe(zoom);
    await show([]); await show([longPad], []); expect(camera().position.distanceTo(new Vector3(...position))).toBeLessThan(1e-8); expect(solidViewState().zoom).toBe(zoom);
  });

  it.each(['wheel', 'view', 'fit'] as const)('keeps explicit %s framing before the first solid rather than overriding user camera intent', async action => {
    await show([]);
    await act(async () => {
      if (action === 'wheel') renderer().domElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
      else if (action === 'view') currentControls().setView?.('Front');
      else currentControls().fit();
    });
    await currentControls().capture(new AbortController().signal); const before = camera().position.toArray(); const zoom = solidViewState().zoom;
    await show([longPad], []); expect(camera().position.distanceTo(new Vector3(...before))).toBeLessThan(1e-8); expect(solidViewState().zoom).toBe(zoom);
  });
});

describe('named CAD camera views with real OrbitControls', () => {
  it.each([0, 100000000])('preserves Top through fit/capture and other named views at world coordinate %s', async origin => {
    const moved: CadMesh = { ...mesh, positions: mesh.positions.map((value, index) => index % 3 === 2 ? value : value + origin),
      edges: mesh.edges.map((value, index) => index % 3 === 2 ? value : value + origin),
      bounds: { min: [origin, origin, 0], max: [origin + 10, origin + 10, 10] } };
    const disposed = vi.spyOn(OrbitControls.prototype, 'dispose');
    await act(async () => root.render(<CadViewport meshes={[moved]} selectedId="body" onSelect={vi.fn()} onControlsReady={value => { controls = value; }} />));
    const capture = async () => { await act(async () => { await currentControls().capture(new AbortController().signal); }); };
    const renderedCamera = () => { const camera = renderer().render.mock.calls.at(-1)?.[1]; if (!(camera instanceof OrthographicCamera)) throw new Error('CAD camera missing'); return camera; };
    await capture(); const originalZoom = solidViewState().zoom;
    await act(async () => currentControls().setView?.('Top'));
    expect(solidViewState().zoom).toBe(originalZoom);
    await act(async () => currentControls().fit()); await capture();
    expect(solidViewState().view).toBe('Top');
    expect(renderedCamera().getWorldDirection(new Vector3()).distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-10);
    expect(renderedCamera().position.x).toBeCloseTo(origin + 5, 6); expect(renderedCamera().position.y).toBeCloseTo(origin + 5, 6);
    for (const name of ['Front', 'Right', 'Isometric', 'Top'] as const) {
      const zoom = solidViewState().zoom;
      await act(async () => currentControls().setView?.(name)); await capture();
      expect(solidViewState().view).toBe(name); expect(solidViewState().zoom).toBe(zoom);
      await act(async () => currentControls().fit()); await capture(); expect(solidViewState().view).toBe(name);
      const expectedDirection = name === 'Top' ? new Vector3(0, 0, -1) : name === 'Front' ? new Vector3(0, 1, 0)
        : name === 'Right' ? new Vector3(-1, 0, 0) : new Vector3(-1, 1.2, -0.9).normalize();
      expect(renderedCamera().getWorldDirection(new Vector3()).distanceTo(expectedDirection)).toBeLessThan(1e-9);
    }
    expect(disposed).toHaveBeenCalledTimes(3);
    const revision = currentControls().getState().revision;
    for (const old of disposed.mock.contexts) { if (!(old instanceof OrbitControls)) throw new Error('Disposed controls missing'); old.dispatchEvent({ type: 'change' }); }
    expect(currentControls().getState().revision).toBe(revision);
    const camera = renderedCamera(); camera.position.x += 20;
    await capture(); expect(solidViewState().view).toBe('Custom');
  });

  it('keeps recreated controls locked, then allows orbiting after unlocking', async () => {
    const render = async (interactionLocked: boolean) => { await act(async () => root.render(<CadViewport meshes={[mesh]} selectedId="body" onSelect={vi.fn()}
      interactionLocked={interactionLocked} onControlsReady={value => { controls = value; }} />)); };
    await render(true); await act(async () => currentControls().setView?.('Top'));
    const canvas = renderer().domElement; canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn();
    const drag = async () => { await act(async () => {
      canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, clientX: 400, clientY: 300 }));
      canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, button: 0, buttons: 1, clientX: 450, clientY: 320 }));
      canvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 450, clientY: 320 }));
    }); };
    const revision = currentControls().getState().revision; await drag();
    expect(currentControls().getState()).toMatchObject({ view: 'Top', revision });
    await render(false); await drag(); expect(solidViewState().view).toBe('Custom');
  });
});

describe('CAD WebGL context lifecycle', () => {
  it('shows only the supplied empty-scene action, respects locks, and gives graphics recovery precedence', async () => {
    const onAction = vi.fn(); const emptyAction = { label: 'Edit sketch', description: 'Open Outline to draw a profile', onAction };
    const render = async (interactionLocked: boolean) => { await act(async () => root.render(<CadViewport meshes={[]} selectedId={null} onSelect={vi.fn()}
      emptyAction={emptyAction} interactionLocked={interactionLocked} onControlsReady={value => { controls = value; }} />)); };
    await render(false); const button = container.querySelector<HTMLButtonElement>('.cad-view-message button');
    if (!button) throw new Error('Empty scene action missing'); expect(button.textContent).toBe('Edit sketch'); expect(button.title).toContain('Outline');
    await act(async () => button.click()); expect(onAction).toHaveBeenCalledTimes(1);
    await render(true); expect(button.disabled).toBe(true); await act(async () => button.click()); expect(onAction).toHaveBeenCalledTimes(1);
    await loseContext(); expect(container.querySelector('.cad-view-message button')?.textContent).toBe('Retry 3D view');
  });
  it('marks lost graphics unavailable, cancels pending rendering and refuses an empty PNG capture', async () => {
    await mount(); const previous = currentControls().getState().revision;
    await loseContext();
    expect(currentControls().getState()).toMatchObject({ available: false, revision: previous + 1 }); expect(frames.size).toBe(0);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('graphics context was interrupted');
    await expect(currentControls().capture(new AbortController().signal)).rejects.toMatchObject({ code: 'CAPTURE_UNAVAILABLE' });
    expect(rasterize).not.toHaveBeenCalled(); expect(renderer().render).not.toHaveBeenCalled();
  });
  it('rejects context loss during rendering and during image copying rather than returning a transparent artifact', async () => {
    await mount(); renderer().render.mockImplementationOnce(() => { renderer().lost = true; });
    await expect(currentControls().capture(new AbortController().signal)).rejects.toMatchObject({ code: 'CAPTURE_UNAVAILABLE' });
    expect(rasterize).not.toHaveBeenCalled();
    renderer().lost = false; rasterize.mockImplementationOnce(() => { renderer().lost = true; return { dataUrl: 'data:image/png;base64,AA==', width: 800, height: 600, source: '3d' }; });
    await expect(currentControls().capture(new AbortController().signal)).rejects.toMatchObject({ code: 'CAPTURE_UNAVAILABLE' });
    expect(rasterize).toHaveBeenCalledTimes(1);
  });
  it('automatically redraws the retained scene after restoration without requiring another pointer event', async () => {
    await mount(); await flushFrame(); const scene = renderer().render.mock.calls[0][0];
    await loseContext(); const lostRevision = currentControls().getState().revision; renderer().render.mockClear();
    await act(async () => { renderer().lost = false; renderer().domElement.dispatchEvent(new Event('webglcontextrestored')); });
    expect(currentControls().getState()).toMatchObject({ available: true, revision: lostRevision + 1 }); expect(container.querySelector('[role="status"]')).toBeNull();
    expect(frames.size).toBe(1); await flushFrame(); expect(renderer().render).toHaveBeenCalledTimes(1); expect(renderer().render.mock.calls[0][0]).toBe(scene);
    await expect(currentControls().capture(new AbortController().signal)).resolves.toMatchObject({ source: '3d' });
  });
  it('retries with a new context, preserves source meshes and releases the old context and event handlers', async () => {
    await mount(); const old = renderer(); const oldControls = currentControls(); await loseContext();
    const retry = [...container.querySelectorAll('button')].find(button => button.textContent === 'Retry 3D view'); if (!retry) throw new Error('Retry missing');
    await act(async () => retry.click());
    expect(renderers).toHaveLength(2); expect(old.dispose).toHaveBeenCalledTimes(1); expect(old.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(oldControls.getState().available).toBe(false); await expect(oldControls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'CAPTURE_UNAVAILABLE' });
    expect(currentControls().getState().available).toBe(true); await flushFrame();
    const scene = renderer().render.mock.calls[0][0]; let uploaded = false;
    scene.traverse(object => { if (object.userData.featureId === 'body') uploaded = true; }); expect(uploaded).toBe(true);
    const currentRevision = currentControls().getState().revision;
    await act(async () => old.domElement.dispatchEvent(new Event('webglcontextrestored')));
    expect(currentControls().getState().revision).toBe(currentRevision);
  });
});

describe('versioned Curve reference rendering', () => {
  it('installs sorted Sketch/Curve IDs, keeps unchanged GPU resources, styles construction and clears removed batches', async () => {
    const prepared = prepareCadViewportReferences([{ id: 'rail', name: 'Rail', kind: 'curve', plane: 'XY', offset: 0, suppressed: false,
      segments: [{ kind: 'line', start: [0, 0], end: [20, 0] }] }, { id: 'sketch', name: 'Sketch', kind: 'sketch', plane: 'XZ', offset: 4, suppressed: false,
      profiles: [{ id: 'profile', name: 'Profile', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 2 } },
        { id: 'guide', name: 'Guide', construction: true, geometry: { kind: 'circle', x: 0, y: 0, radius: 1 } }] }], {});
    const curve = prepared.find(reference => reference.featureKind === 'curve'); if (!curve) throw new Error('Curve missing');
    const render = async (references: readonly CadViewportReference[], version = 'v1') => { await act(async () => root.render(<CadViewport meshes={[]} references={references}
      referenceVersion={version} selectedId="sketch" onSelect={vi.fn()} onControlsReady={value => { controls = value; }} />)); };
    const getLine = (scene: Scene, id: string) => { const lines: LineSegments[] = []; scene.traverse(object => { if (object instanceof LineSegments && object.userData.referenceId === id) lines.push(object); }); if (lines.length !== 1) throw new Error(`Missing reference ${id}`); return lines[0]; };
    await render([curve]); await currentControls().capture(new AbortController().signal); const scene = renderer().render.mock.calls.at(-1)![0];
    const original = getLine(scene, 'rail'); const disposed = vi.spyOn(original.geometry, 'dispose');
    await render(prepared); await currentControls().capture(new AbortController().signal); expect(getLine(scene, 'rail')).toBe(original); expect(disposed).not.toHaveBeenCalled();
    const state = currentControls().getState(); if (state.mode !== 'solid') throw new Error('World viewport missing');
    expect(state).toMatchObject({ referenceVersion: 'v1', referenceFeatureIds: ['rail', 'sketch'] }); expect(Object.isFrozen(state.referenceFeatureIds)).toBe(true);
    const guide = getLine(scene, 'sketch/guide'); if (!(guide.material instanceof LineDashedMaterial)) throw new Error('Construction dashes missing');
    expect(guide.material.depthTest).toBe(true); expect(guide.geometry.getAttribute('lineDistance')).toBeDefined();
    const dashSize = guide.material.dashSize; const camera = renderer().render.mock.calls.at(-1)![1]; if (!(camera instanceof OrthographicCamera)) throw new Error('CAD camera missing'); camera.zoom *= 2; camera.updateProjectionMatrix();
    await currentControls().capture(new AbortController().signal); expect(guide.material.dashSize).toBeCloseTo(dashSize / 2);
    const guideDisposed = vi.spyOn(guide.geometry, 'dispose'); const guideMaterialDisposed = vi.spyOn(guide.material, 'dispose');
    await render([curve]); expect(guideDisposed).toHaveBeenCalledTimes(1); expect(guideMaterialDisposed).toHaveBeenCalledTimes(1); expect(disposed).not.toHaveBeenCalled();
    await render([], 'v2'); expect(disposed).toHaveBeenCalledTimes(1); expect(currentControls().getState()).toMatchObject({ referenceVersion: 'v2', referenceFeatureIds: [] });
  });

  it('retains visible small far-origin Sketch outlines and disposes their installed resources on unmount', async () => {
    const references = prepareCadViewportReferences([{ id: 'far_sketch', name: 'Far sketch', kind: 'sketch', plane: 'XY', offset: 7, suppressed: false,
      profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 100000000, y: 100000000, radius: 1 } }] }], {});
    await act(async () => root.render(<CadViewport meshes={[]} references={references} referenceVersion="far1" selectedId="far_sketch" onSelect={vi.fn()} onControlsReady={value => { controls = value; }} />));
    await currentControls().capture(new AbortController().signal); const scene = renderer().render.mock.calls.at(-1)![0]; const lines: LineSegments[] = [];
    scene.traverse(object => { if (object instanceof LineSegments && object.userData.referenceId === 'far_sketch/circle') lines.push(object); }); expect(lines).toHaveLength(1);
    const line = lines[0]; const position = line.geometry.getAttribute('position'); const local = Array.from({ length: position.count }, (_, index) => new Vector3().fromBufferAttribute(position, index));
    expect(new Set(local.map(point => point.toArray().join(','))).size).toBeGreaterThan(100); expect(Math.max(...local.flatMap(point => point.toArray().map(Math.abs)))).toBeLessThan(2);
    expect(local[0].clone().applyMatrix4(line.matrixWorld).distanceTo(new Vector3(100000001, 100000000, 7))).toBeLessThan(1e-6);
    const geometryDisposed = vi.spyOn(line.geometry, 'dispose'); const material = Array.isArray(line.material) ? line.material[0] : line.material; const materialDisposed = vi.spyOn(material, 'dispose');
    await act(async () => root.render(null)); expect(geometryDisposed).toHaveBeenCalledTimes(1); expect(materialDisposed).toHaveBeenCalledTimes(1);
  });
  it('selects world Sketch references in Body mode without intercepting Face or Edge picks', async () => {
    const references = prepareCadViewportReferences([{ id: 'sketch', name: 'Sketch', kind: 'sketch', plane: 'XY', offset: 5, suppressed: false,
      profiles: [{ id: 'profile', name: 'Profile', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } }] }], {});
    const onSelect = vi.fn(); const onTopologyPick = vi.fn();
    const render = async (pickMode: 'body' | 'face' | 'edge') => {
      await act(async () => root.render(<CadViewport meshes={[mesh]} references={references} referenceVersion="v1" selectedId={null}
        pickMode={pickMode} onSelect={onSelect} onTopologyPick={onTopologyPick} onControlsReady={value => { controls = value; }} />));
    };
    await render('body'); await currentControls().capture(new AbortController().signal);
    const camera = renderer().render.mock.calls.at(-1)![1]; const point = new Vector3(10, 0, 5).project(camera);
    const canvas = renderer().domElement;
    canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn();
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) });
    const pick = async () => {
      await act(async () => {
        for (const type of ['pointerdown', 'pointerup']) canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: (point.x + 1) * 400, clientY: (1 - point.y) * 300 }));
      });
    };
    await pick(); expect(onSelect).toHaveBeenLastCalledWith('sketch'); onSelect.mockClear();
    await render('face'); await pick(); await render('edge'); await pick();
    expect(onSelect).not.toHaveBeenCalled(); expect(onTopologyPick).toHaveBeenCalledTimes(2);
  });
  it('renders and captures references without meshes, advances installed version and releases replaced geometry', async () => {
    const references = prepareCadCurveReferences([{ id: 'rail', name: 'Rail', kind: 'curve', plane: 'XZ', offset: 4, suppressed: false,
      segments: [{ kind: 'line', start: [0, 0], end: [20, 0] }] }], {});
    const publish = (value: CadRenderedViewControls | null) => { controls = value; };
    await act(async () => root.render(<CadViewport meshes={[]} references={references} referenceVersion="v1" selectedId="rail" onSelect={vi.fn()} onControlsReady={publish} pickingEnabled={false} />));
    expect(currentControls().getState()).toMatchObject({ mode: 'solid', available: true, referenceVersion: 'v1' });
    await currentControls().capture(new AbortController().signal); const scene = renderer().render.mock.calls.at(-1)![0];
    let line: LineSegments | null = null; let bodies = 0;
    scene.traverse(object => { if (object instanceof LineSegments && object.userData.featureId === 'rail') line = object; if (object instanceof Mesh) bodies++; });
    expect(bodies).toBe(0); if (!line) throw new Error('Curve reference not uploaded');
    const original: LineSegments = line; const disposed = vi.spyOn(original.geometry, 'dispose');
    const guides = scene.children.filter(object => object instanceof GridHelper || object instanceof AxesHelper);
    expect(guides).toHaveLength(2);
    for (const guide of guides) {
      if (!(guide instanceof LineSegments)) throw new Error('Guide geometry missing');
      for (const material of Array.isArray(guide.material) ? guide.material : [guide.material]) expect(material.depthWrite).toBe(false);
      expect(guide.renderOrder).toBeLessThan(original.renderOrder);
    }
    for (const material of Array.isArray(original.material) ? original.material : [original.material]) expect(material.depthTest).toBe(true);
    await act(async () => root.render(<CadViewport meshes={[]} references={references} referenceVersion="v1" selectedId={null} onSelect={vi.fn()} onControlsReady={publish} pickingEnabled={false} />));
    expect(disposed).not.toHaveBeenCalled();
    const moved = references.map(reference => ({ ...reference, positions: [0, -8, 0, 20, -8, 0] }));
    const beforeRevision = currentControls().getState().revision;
    await act(async () => root.render(<CadViewport meshes={[]} references={moved} referenceVersion="v2" selectedId="rail" onSelect={vi.fn()} onControlsReady={publish} pickingEnabled={false} />));
    expect(disposed).toHaveBeenCalledTimes(1); expect(currentControls().getState()).toMatchObject({ referenceVersion: 'v2' }); expect(currentControls().getState().revision).toBeGreaterThan(beforeRevision);
    await currentControls().capture(new AbortController().signal); let coordinates: readonly number[] = [];
    renderer().render.mock.calls.at(-1)![0].traverse(object => {
      if (object instanceof LineSegments && object.userData.featureId === 'rail') {
        const position=object.geometry.getAttribute('position');
        coordinates=Array.from({length:position.count},(_,index)=>new Vector3().fromBufferAttribute(position,index).applyMatrix4(object.matrixWorld).toArray()).flat();
      }
    });
    expect(coordinates).toEqual([0, -8, 0, 20, -8, 0]);
    await act(async () => root.render(<CadViewport meshes={[]} references={[]} referenceVersion="v3" selectedId={null} onSelect={vi.fn()} onControlsReady={publish} pickingEnabled={false} />));
    expect(currentControls().getState()).toMatchObject({ referenceVersion: 'v3', referenceFeatureIds: [] });
  });
  it('keeps small far-origin curves distinct in GPU coordinates and restores their world placement',async()=>{
    const references=prepareCadCurveReferences([{id:'far_rail',name:'Far rail',kind:'curve',plane:'XY',offset:7,suppressed:false,
      segments:[{kind:'arc',center:[100000000,100000000],radius:1,startAngle:0,sweep:180}]}],{});
    await act(async()=>root.render(<CadViewport meshes={[]} references={references} referenceVersion="far1" selectedId={null} onSelect={vi.fn()} onControlsReady={value=>{controls=value;}} pickingEnabled={false}/>));
    await currentControls().capture(new AbortController().signal);const scene=renderer().render.mock.calls.at(-1)![0];
    const lines:LineSegments[]=[];scene.traverse(object=>{if(object instanceof LineSegments&&object.userData.featureId==='far_rail') lines.push(object);});
    expect(lines).toHaveLength(1);const line=lines[0];const position=line.geometry.getAttribute('position');
    const localPoints=Array.from({length:position.count},(_,index)=>new Vector3().fromBufferAttribute(position,index));
    expect(new Set(localPoints.map(point=>point.toArray().join(','))).size).toBeGreaterThan(50);
    expect(Math.max(...localPoints.flatMap(point=>point.toArray().map(Math.abs)))).toBeLessThan(2);
    expect(line.position.x).toBeCloseTo(100000000,6);expect(line.position.y).toBeCloseTo(100000000.5,6);expect(line.position.z).toBe(7);
    for(let index=0;index<localPoints.length;index++) {
      const world=localPoints[index].clone().applyMatrix4(line.matrixWorld);
      expect(world.distanceTo(new Vector3(...references[0].positions.slice(index*3,index*3+3)))).toBeLessThan(1e-6);
    }
    expect(currentControls().getState()).toMatchObject({referenceVersion:'far1',available:true});
  });
});
