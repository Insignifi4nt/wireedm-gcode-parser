import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LineSegments, Mesh, Vector3, type Camera, type Material, type Object3D, type Scene } from 'three';
import type { CadMesh } from '@/domain/cad/cadDocument';
import { cadPrincipalFrame, type CadResolvedFrame } from '@/domain/cad/cadDatumPlanes';
import { CadViewport, type CadViewportSection } from './CadViewport';
import type { CadRenderedViewControls } from './cadViewportControls';
import { cadOriginReferences, prepareCadViewportReferences, type CadViewportReference } from './cadViewportReferences';
import type { CadSelectionFilter } from './view/cadSelectionFilter';

const renderers = vi.hoisted((): { domElement: HTMLCanvasElement; render: ReturnType<typeof vi.fn<(scene: Scene, camera: Camera) => void>> }[] => []);
vi.mock('@/features/editor/captureEditorPreview', () => ({ captureCanvas: vi.fn(() => ({ dataUrl: 'data:image/png;base64,AA==', width: 800, height: 600, source: '3d' })) }));
vi.mock('three', async importOriginal => {
  const original = await importOriginal<typeof import('three')>();
  return { ...original, WebGLRenderer: class {
    domElement = document.createElement('canvas');
    render = vi.fn((_scene: Scene, _camera: Camera) => undefined);
    dispose = vi.fn(); forceContextLoss = vi.fn(); clearStencil = vi.fn();
    constructor() { renderers.push(this); }
    setPixelRatio() {}
    setSize(width: number, height: number) { this.domElement.width = width; this.domElement.height = height; }
    getContext() { return { isContextLost: () => false }; }
  } };
});

/** A flat square body at height `z`, covering x and y from 0 to 10. */
const slab = (featureId: string, z: number): CadMesh => ({ featureId, name: featureId, positions: [0, 0, z, 10, 0, z, 10, 10, z, 0, 10, z], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  indices: [0, 1, 2, 0, 2, 3], edges: [], faceGroups: [], edgeGroups: [], volume: 0, bounds: { min: [0, 0, z], max: [10, 10, z] } });
const upper = slab('upper', 8), lower = slab('lower', 1);
const at = (frame: CadResolvedFrame, z: number): CadResolvedFrame => Object.freeze({ ...frame, origin: [0, 0, z] as const });
const section = (flip = false, caps = true, height = 4): CadViewportSection => Object.freeze({ frame: at(cadPrincipalFrame('XY'), height), flip, caps });

let root: Root, container: HTMLDivElement, controls: CadRenderedViewControls | null;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
const renderer = () => { const current = renderers.at(-1); if (!current) throw new Error('Renderer unavailable'); return current; };
const currentControls = () => { if (!controls) throw new Error('Viewport controls unavailable'); return controls; };
const solidState = () => { const state = currentControls().getState(); if (state.mode !== 'solid') throw new Error('No model view'); return state; };
beforeEach(() => {
  controls = null; renderers.length = 0; frames = new Map(); nextFrame = 1;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

interface Shown { meshes?: readonly CadMesh[]; references?: readonly CadViewportReference[]; section?: CadViewportSection | null; filter?: CadSelectionFilter; pickMode?: 'auto' | 'body' }
const handlers = { onSelect: vi.fn(), onSelectPlane: vi.fn(), onSelectOrigin: vi.fn(), onTopologyPick: vi.fn() };
async function show({ meshes = [upper, lower], references = [], section = null, filter, pickMode = 'body' }: Shown = {}) {
  await act(async () => root.render(<CadViewport meshes={meshes} references={references} referenceVersion="v1" selectedId={null} pickMode={pickMode}
    section={section} selectionFilter={filter} onSelect={handlers.onSelect} onSelectPlane={handlers.onSelectPlane} onSelectOrigin={handlers.onSelectOrigin}
    onTopologyPick={handlers.onTopologyPick} onControlsReady={value => { controls = value; }} />));
}
async function drawn() { await currentControls().capture(new AbortController().signal); const call = renderer().render.mock.calls.at(-1)!; return { scene: call[0], camera: call[1] }; }
const materials = (object: Object3D): Material[] => object instanceof Mesh || object instanceof LineSegments ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
const find = (scene: Scene, test: (object: Object3D) => boolean) => { let found: Object3D | null = null; scene.traverse(object => { if (!found && test(object)) found = object; }); return found as Object3D | null; };
/** A direction with signed zeros read as zero. */
const direction = (vector: Vector3) => vector.toArray().map(value => value + 0);
const clipOf = (object: Object3D | null) => { if (!object) throw new Error('Object not drawn'); return materials(object)[0]?.clippingPlanes ?? null; };
async function click(point: Vector3) {
  const { camera } = await drawn(); const screen = point.clone().project(camera), canvas = renderer().domElement;
  canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn();
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) });
  await act(async () => {
    for (const type of ['pointerdown', 'pointerup']) canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: (screen.x + 1) * 400, clientY: (1 - screen.y) * 300 }));
  });
}

describe('section view', () => {
  const contour = prepareCadViewportReferences([{ id: 'outline', name: 'Outline', kind: 'sketch', plane: 'XY', offset: 6, suppressed: false,
    profiles: [{ id: 'square', name: 'Square', construction: false, geometry: { kind: 'rectangle', x: 5, y: 5, width: 4, height: 4, cornerRadius: 0 } }] }], {});
  const references = [...cadOriginReferences(null), ...contour];

  it('clips bodies and outlines on the removed side, keeps reference geometry whole, flips, and survives a rebuild', async () => {
    await show({ references, section: section() });
    let { scene } = await drawn();
    const body = () => find(scene, object => object instanceof Mesh && object.userData.featureId === 'upper');
    const outline = () => find(scene, object => object instanceof LineSegments && object.userData.featureId === 'outline');
    const plane = () => find(scene, object => object.userData.referenceId === 'principal:XY');
    const [cut] = clipOf(body()) ?? [];
    // Unflipped, the side the plane normal points to is removed: three.js keeps n · p + c ≥ 0, here z ≤ 4.
    expect(direction(cut.normal)).toEqual([0, 0, -1]); expect(cut.constant).toBeCloseTo(4, 3);
    expect(clipOf(outline())).toEqual([cut]); expect(clipOf(plane())).toBeNull();
    expect(solidState().section).toMatchObject({ caps: true, normal: [0, 0, -1] });

    await show({ references, section: section(true) }); ({ scene } = await drawn());
    expect(direction(clipOf(body())![0].normal)).toEqual([0, 0, 1]); expect(clipOf(body())?.[0].constant).toBeCloseTo(-4, 3);

    // A rebuild uploads new bodies; they take the same cut.
    await show({ meshes: [slab('upper', 8), slab('lower', 1)], references, section: section(true) }); ({ scene } = await drawn());
    expect(direction(clipOf(body())![0].normal)).toEqual([0, 0, 1]);

    await show({ references, section: null }); ({ scene } = await drawn());
    expect(clipOf(body())).toBeNull(); expect(clipOf(outline())).toBeNull(); expect(solidState().section).toBeUndefined();
  });

  it('draws caps only while they are on, and never as a pickable or listed body', async () => {
    const capsShown = (scene: Scene) => find(scene, object => object.name === 'cad-section-caps');
    await show({ section: section(false, true) });
    let { scene } = await drawn();
    const caps = capsShown(scene);
    expect(caps?.visible).toBe(true);
    // One cap on the plane, and a back and a front stencil pass for each body, drawn after the solids.
    const cap = find(scene, object => object.name === 'cad-section-cap') as Mesh;
    expect(cap.position.z).toBeCloseTo(4, 3); expect(cap.renderOrder).toBeGreaterThan(2);
    let counters = 0; caps?.traverse(object => { if (object instanceof Mesh && object !== cap) counters++; });
    expect(counters).toBe(4);
    // Nothing in the caps names a feature, so no pick can land on them.
    caps?.traverse(object => expect(object.userData.featureId).toBeUndefined());

    await show({ section: section(false, false) }); ({ scene } = await drawn());
    expect(capsShown(scene)).toBeNull(); expect(solidState().section).toMatchObject({ caps: false });
    await show({ section: section(false, true) }); ({ scene } = await drawn());
    expect(capsShown(scene)?.visible).toBe(true);
    await show({ section: null }); ({ scene } = await drawn());
    expect(capsShown(scene)).toBeNull();
  });

  it('picks through the cut only the geometry the section keeps', async () => {
    await show(); await act(async () => currentControls().setView?.('Top'));
    const target = new Vector3(6, 4, 1);
    await click(target); expect(handlers.onSelect).toHaveBeenLastCalledWith('upper');
    // The upper slab is removed, so the click reaches the lower one behind it.
    await show({ section: section() }); await click(target); expect(handlers.onSelect).toHaveBeenLastCalledWith('lower');
    // Flipped, the lower slab is removed and the upper one is picked again.
    await show({ section: section(true) }); await click(target); expect(handlers.onSelect).toHaveBeenLastCalledWith('upper');
    // A plane above both keeps nothing in front of the camera except what lies below it.
    await show({ section: section(false, true, 0) }); await click(target); expect(handlers.onSelect).not.toHaveBeenLastCalledWith('upper');
    expect(handlers.onSelect).not.toHaveBeenLastCalledWith('lower');
  });
});

describe('reference geometry and the selection filter', () => {
  const references = cadOriginReferences(null);
  it('selects an origin axis and the origin point, which a filter can turn off', async () => {
    await show({ meshes: [], references, pickMode: 'auto' });
    await click(new Vector3(20, 0, 0)); expect(handlers.onSelectOrigin).toHaveBeenLastCalledWith({ kind: 'axis', axis: 'x' });
    await click(new Vector3(0, 0, 22)); expect(handlers.onSelectOrigin).toHaveBeenLastCalledWith({ kind: 'axis', axis: 'z' });
    await click(new Vector3(0, 0, 0)); expect(handlers.onSelectOrigin).toHaveBeenLastCalledWith({ kind: 'point' });
    handlers.onSelectOrigin.mockClear();
    await show({ meshes: [], references, pickMode: 'auto', filter: { excluded: ['axis', 'point'] } });
    await click(new Vector3(20, 0, 0)); await click(new Vector3(0, 0, 0));
    expect(handlers.onSelectOrigin).not.toHaveBeenCalled();
  });

  it('lets a body in front win over a plane, and the plane win when bodies are filtered out', async () => {
    const plane = references.filter(reference => reference.referenceId === 'principal:XY');
    await show({ meshes: [upper], references: plane });
    await act(async () => currentControls().setView?.('Top'));
    await click(new Vector3(6, 4, 0)); expect(handlers.onSelect).toHaveBeenLastCalledWith('upper'); expect(handlers.onSelectPlane).not.toHaveBeenCalled();
    await show({ meshes: [upper], references: plane, filter: { excluded: ['body'] } });
    await click(new Vector3(6, 4, 0)); expect(handlers.onSelectPlane).toHaveBeenLastCalledWith('XY');
    handlers.onSelectPlane.mockClear(); handlers.onSelect.mockClear();
    await show({ meshes: [upper], references: plane, filter: { excluded: ['body', 'plane'] } });
    await click(new Vector3(6, 4, 0)); expect(handlers.onSelectPlane).not.toHaveBeenCalled(); expect(handlers.onSelect).not.toHaveBeenCalledWith('upper');
  });
});
