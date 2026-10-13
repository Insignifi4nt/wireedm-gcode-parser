import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxesHelper, GridHelper, LineSegments, Mesh, Vector3, type Camera, type Scene } from 'three';
import type { CadMesh } from '@/domain/cad/cadDocument';
import { CadViewport } from './CadViewport';
import type { CadRenderedViewControls } from './cadViewportControls';
import { prepareCadCurveReferences } from './cadCurveRendering';

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
  it('selects reference curves in Body mode without intercepting Face or Edge picks', async () => {
    const references = prepareCadCurveReferences([{ id: 'rail', name: 'Rail', kind: 'curve', plane: 'XY', offset: 5, suppressed: false,
      segments: [{ kind: 'line', start: [0, 0], end: [20, 0] }] }], {});
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
    await pick(); expect(onSelect).toHaveBeenLastCalledWith('rail'); onSelect.mockClear();
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
    expect(currentControls().getState()).toMatchObject({ referenceVersion: null });
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
