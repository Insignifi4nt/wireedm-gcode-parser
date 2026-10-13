import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera, Scene } from 'three';
import type { CadMesh } from '@/domain/cad/cadDocument';
import { CadViewport } from './CadViewport';
import type { CadRenderedViewControls } from './cadViewportControls';

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

describe('CAD WebGL context lifecycle', () => {
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
