import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, OrthographicCamera, Vector3, type Camera, type Scene } from 'three';
import type { CadMesh } from '@/domain/cad/cadDocument';
import { CadViewport } from '@/features/cad/CadViewport';
import { prepareCadViewportReferences } from '@/features/cad/cadViewportReferences';
import type { CadRenderedViewControls } from '@/features/cad/cadViewportControls';

const rendered = vi.hoisted(() => ({ calls: vi.fn<(scene: Scene, camera: Camera) => void>(), canvases: [] as HTMLCanvasElement[] }));
vi.mock('three', async importOriginal => {
  const original = await importOriginal<typeof import('three')>();
  return { ...original, WebGLRenderer: class {
    domElement = document.createElement('canvas');
    render = rendered.calls;
    constructor() { rendered.canvases.push(this.domElement); }
    setPixelRatio() {} setSize() {} dispose() {} forceContextLoss() {}
    getContext() { return { isContextLost: () => false }; }
  } };
});

let root: Root, container: HTMLDivElement, controls: CadRenderedViewControls | null;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
async function flushFrame() { await act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(performance.now())); }); }
function contrastRatio(color: number, background: number) {
  const luminance = (hex: number) => [16, 8, 0].reduce((sum, shift, index) => {
    const channel = ((hex >> shift) & 255) / 255;
    const linear = channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    return sum + [.2126, .7152, .0722][index] * linear;
  }, 0);
  const foreground = luminance(color), back = luminance(background);
  return (Math.max(foreground, back) + .05) / (Math.min(foreground, back) + .05);
}
beforeEach(() => {
  controls = null; rendered.calls.mockClear(); rendered.canvases.length = 0;
  frames = new Map(); nextFrame = 1;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function sourcePicker(worldOffset = 0) {
  const stock: CadMesh = { featureId: 'stock', name: 'Stock',
    positions: [0, 0, 10, 80, 0, 10, 80, 40, 10, 0, 40, 10].map((value, i) => i % 3 === 2 ? value : value + worldOffset),
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2, 0, 2, 3],
    edges: [0, 0, 10, 80, 0, 10, 80, 0, 10, 80, 40, 10, 80, 40, 10, 0, 40, 10, 0, 40, 10, 0, 0, 10].map((value, i) => i % 3 === 2 ? value : value + worldOffset),
    faceGroups: [{ key: 'top', start: 0, count: 6 }], edgeGroups: [], volume: 32000,
    bounds: { min: [worldOffset, worldOffset, 0], max: [worldOffset + 80, worldOffset + 40, 10] } };
  const meshes = [stock];
  const references = prepareCadViewportReferences([
    { id: 'regions', name: 'Regions', kind: 'sketch', suppressed: false, plane: 'XY', offset: 5,
      profiles: [{ id: 'separate', name: 'Separate', construction: false, geometry: { kind: 'rectangle', x: worldOffset + 50, y: worldOffset + 5, width: 10, height: 10, cornerRadius: 0 } }] },
    { id: 'rail', name: 'Rail', kind: 'curve', suppressed: false, plane: 'XY', offset: 5,
      segments: [{ kind: 'line', start: [worldOffset + 15, worldOffset + 15], end: [worldOffset + 25, worldOffset + 15] }] },
    { id: 'blocked', name: 'Ineligible nearer source', kind: 'curve', suppressed: false, plane: 'XY', offset: 6,
      segments: [{ kind: 'line', start: [worldOffset + 50, worldOffset + 5], end: [worldOffset + 50, worldOffset + 15] }] }
  ], {});
  const original = JSON.stringify({ meshes, references });
  const select = vi.fn(), topology = vi.fn();
  const eligible = ['regions', 'rail'];
  const show = async (picking = false, pickMode: 'body' | 'face' = 'body', interactionLocked = false, planePickingOnly = false, sourceIds = eligible) => {
    await act(async () => root.render(<CadViewport meshes={meshes} references={references} referenceVersion="accepted"
      selectedId="stock" onSelect={select} onTopologyPick={topology} onControlsReady={value => { controls = value; }}
      sourceReferencePickIds={picking ? sourceIds : undefined} {...{ pickMode, interactionLocked, planePickingOnly }} />));
    await flushFrame();
  };
  await show();
  if (!controls) throw new Error('Missing viewport controls');
  await act(async () => controls?.setView?.('Top'));
  await flushFrame();
  const [scene, camera] = rendered.calls.mock.calls.at(-1)!;
  if (!(camera instanceof OrthographicCamera)) throw new Error('Missing orthographic camera');
  scene.updateMatrixWorld(true); camera.updateMatrixWorld();
  const bodies: Mesh[] = [], lines = new Map<string, LineSegments>();
  scene.traverse(object => {
    if (object instanceof Mesh && object.material instanceof MeshStandardMaterial) bodies.push(object);
    if (object instanceof LineSegments && typeof object.userData.referenceId === 'string') lines.set(object.userData.featureId, object);
  });
  const body = bodies[0], bodyMaterial = body.material;
  if (!(bodyMaterial instanceof MeshStandardMaterial)) throw new Error('Missing stock material');
  const canvas = rendered.canvases[0]; canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn();
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) });
  const pointer = async (type: 'pointerdown' | 'pointerup' | 'pointermove', x = worldOffset + 50, y = worldOffset + 10) => {
    const point = new Vector3(x, y, 5).project(camera);
    await act(async () => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0, clientX: (point.x + 1) * 400, clientY: (1 - point.y) * 300 });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' }, isPrimary: { value: true } });
      canvas.dispatchEvent(event);
    });
  };
  const click = async (x?: number, y?: number) => { await pointer('pointerdown', x, y); await pointer('pointerup', x, y); };
  const material = (id: string) => { const value = lines.get(id)?.material; if (!(value instanceof LineBasicMaterial)) throw new Error(`Missing reference ${id}`); return value; };
  return { show, click, pointer, select, topology, body, bodyMaterial, lines, material, camera, original, meshes, references };
}

it.each([0, 100000000])('reveals and physically picks only owned eligible sources inside opaque stock at world offset %s, restoring normal depth on exit', async origin => {
  const h = await sourcePicker(origin);
  await h.click(); expect(h.select).toHaveBeenLastCalledWith('stock'); h.select.mockClear();
  const position = h.camera.position.toArray(), zoom = h.camera.zoom;
  const geometry = h.lines.get('regions')?.geometry;
  const ordinaryColors = ['regions', 'rail', 'blocked'].map(id => h.material(id).color.getHex());
  await h.show(true);
  expect(h.material('regions').depthTest).toBe(false); expect(h.material('rail').depthTest).toBe(false);
  expect(h.material('blocked').depthTest).toBe(true);
  expect(h.body.material).toBe(h.bodyMaterial);
  expect(h.bodyMaterial.transparent).toBe(false); expect(h.bodyMaterial.opacity).toBe(1);
  expect(h.bodyMaterial.depthWrite).toBe(true);
  const sourceColor = h.material('regions').color.getHex();
  // Internal sources must contrast with both the dark canvas and selected cyan
  // material. This is a bounded palette check; actual lit/raster contrast is QA.
  for (const background of [0x18252e, 0x79c8e6]) expect(contrastRatio(sourceColor, background)).toBeGreaterThanOrEqual(2.5);
  expect(h.material('blocked').color.getHex()).toBe(ordinaryColors[2]);
  await h.pointer('pointermove'); await flushFrame();
  const hoverColor = h.material('regions').color.getHex();
  expect(hoverColor).not.toBe(sourceColor);
  for (const background of [0x18252e, 0x79c8e6]) expect(contrastRatio(hoverColor, background)).toBeGreaterThanOrEqual(2.5);
  expect(h.material('rail').color.getHex()).toBe(sourceColor);
  await h.click(); expect(h.select).toHaveBeenCalledExactlyOnceWith('regions'); h.select.mockClear();
  await h.click(origin + 20, origin + 15); expect(h.select).toHaveBeenCalledExactlyOnceWith('rail'); h.select.mockClear();
  await h.show(false);
  expect(h.material('regions').depthTest).toBe(true); expect(h.material('regions').depthWrite).toBe(true);
  expect(['regions', 'rail', 'blocked'].map(id => h.material(id).color.getHex())).toEqual(ordinaryColors);
  expect(h.bodyMaterial.transparent).toBe(false); expect(h.bodyMaterial.opacity).toBe(1); expect(h.bodyMaterial.depthWrite).toBe(true);
  await h.click(); expect(h.select).toHaveBeenCalledExactlyOnceWith('stock');
  expect(h.camera.position.toArray()).toEqual(position); expect(h.camera.zoom).toBe(zoom);
  expect(h.lines.get('regions')?.geometry).toBe(geometry); expect(rendered.canvases).toHaveLength(1);
  expect(JSON.stringify({ meshes: h.meshes, references: h.references })).toBe(h.original);
});

it('cancels a pointer begun in another source-picking ownership state instead of replaying it, while preserving face picking and workflow locks', async () => {
  const h = await sourcePicker();
  await h.pointer('pointerdown'); await h.show(true); await h.pointer('pointerup'); expect(h.select).not.toHaveBeenCalled();
  await h.click(); expect(h.select).toHaveBeenCalledExactlyOnceWith('regions'); h.select.mockClear();
  await h.pointer('pointerdown'); await h.show(false); await h.pointer('pointerup'); expect(h.select).not.toHaveBeenCalled();
  await h.show(true, 'face');
  expect(h.material('regions').depthTest).toBe(true); expect(h.bodyMaterial.transparent).toBe(false);
  await h.click(); expect(h.topology).toHaveBeenCalledExactlyOnceWith({ bodyId: 'stock', pick: { kind: 'face', key: 'top' } }, false);
  await h.show(true, 'body', false, true); expect(h.material('regions').depthTest).toBe(true); expect(h.bodyMaterial.transparent).toBe(false);
  await h.show(true, 'body', false, false, ['stock']);
  expect(h.material('regions').depthTest).toBe(true); expect(h.material('rail').depthTest).toBe(true);
  await h.click(); expect(h.select).toHaveBeenCalledExactlyOnceWith('stock'); h.select.mockClear();
  await h.show(true, 'body', true); await h.click(); expect(h.select).not.toHaveBeenCalled();
});
