import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CadMesh, CadSketchFeature } from '@/domain/cad/cadDocument';
import { prepareCadSketchCells } from '@/domain/cad/cadSketchRegionInspection';
import { cadFramePointToWorld, resolveCadSketchPlacement, resolveCadWorldDatum } from '@/domain/cad/cadDatumPlanes';
import { sketch } from '@/domain/cad/__tests__/cadSketchRegionFixtures';
import { CadViewport } from './CadViewport';
import { prepareCadViewportReferences } from './cadViewportReferences';
import type { CadRenderedViewControls } from './cadViewportControls';
import type { CadFeatureRegionPickCommand } from './cadFeatureReferencePicking';

const rendered = vi.hoisted(() => ({ calls: vi.fn<(scene: THREE.Scene, camera: THREE.Camera) => void>(), canvases: [] as HTMLCanvasElement[], lost: false }));
vi.mock('three', async importOriginal => {
  const original = await importOriginal<typeof import('three')>();
  return { ...original, WebGLRenderer: class {
    domElement = document.createElement('canvas'); render = rendered.calls;
    constructor() { rendered.canvases.push(this.domElement); }
    setPixelRatio() {} setSize() {} dispose() {} forceContextLoss() {}
    getContext() { return { isContextLost: () => rendered.lost }; }
  } };
});
let root: Root, container: HTMLDivElement, controls: CadRenderedViewControls | null;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
async function flushFrame() { await act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(performance.now())); }); }
beforeEach(() => {
  controls = null; rendered.calls.mockClear(); rendered.canvases.length = 0; rendered.lost = false; frames = new Map(); nextFrame = 1;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800); vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function harness(origin = 0) {
  const source: CadSketchFeature = { ...sketch(), offset: 5, profiles: sketch().profiles.map(profile => {
    if (profile.geometry.kind !== 'circle') throw new Error('Expected circle source');
    return { ...profile, geometry: { ...profile.geometry, x: (profile.geometry.x as number) + origin + 20, y: origin + 20 } };
  }) };
  const stock: CadMesh = { featureId: 'stock', name: 'Stock',
    positions: [0, 0, 10, 80, 0, 10, 80, 40, 10, 0, 40, 10].map((value, index) => index % 3 === 2 ? value : value + origin),
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2, 0, 2, 3], edges: [], faceGroups: [], edgeGroups: [], volume: 32000,
    bounds: { min: [origin, origin, 0], max: [origin + 80, origin + 40, 10] } };
  const meshes = [stock], references = prepareCadViewportReferences([source], {}), sourceIds = [source.id];
  const command = { kind: 'pick-regions', owner: 'editor', expectedVersion: 'accepted', label: 'Areas', sketchId: source.id,
    cells: prepareCadSketchCells(source, {}), placement: resolveCadSketchPlacement(source, {}), selection: undefined,
    onSelect: vi.fn(), onFinish: vi.fn(), onCancel: vi.fn() } satisfies CadFeatureRegionPickCommand;
  const select = vi.fn(), menu = vi.fn(), original = JSON.stringify({ source, stock, references });
  const show = async (regionSelection: CadFeatureRegionPickCommand | null, publication = false) => {
    await act(async () => root.render(<CadViewport regionSelection={regionSelection} meshes={publication ? [{ ...stock, volume: 31999 }] : meshes}
      references={regionSelection ? [...references] : references} referenceVersion={publication ? 'candidate-view' : 'accepted'}
      sourceReferencePickIds={regionSelection ? [...sourceIds] : undefined} selectedId="stock" onSelect={select} onContextMenu={menu}
      onControlsReady={value => { controls = value; }} />)); await flushFrame();
  };
  await show(null); if (!controls) throw new Error('Missing viewport controls');
  await act(async () => controls?.setView?.('Top')); await flushFrame();
  const [scene, camera] = rendered.calls.mock.calls.at(-1)!;
  if (!(camera instanceof THREE.OrthographicCamera)) throw new Error('Missing camera');
  scene.updateMatrixWorld(true); camera.updateMatrixWorld();
  const canvas = rendered.canvases[0]; canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn();
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) });
  const pointer = async (type: 'pointerdown' | 'pointerup' | 'pointermove', x = 24, modifiers: MouseEventInit = {}) => {
    const point = new THREE.Vector3(origin + x, origin + 20, 5).project(camera);
    await act(async () => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0,
        clientX: (point.x + 1) * 400, clientY: (1 - point.y) * 300, ...modifiers });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' }, isPrimary: { value: true } }); canvas.dispatchEvent(event);
    }); await flushFrame();
  };
  const click = async (x = 24, modifiers?: MouseEventInit) => { await pointer('pointerdown', x, modifiers); await pointer('pointerup', x, modifiers); };
  const cells = () => {
    const result: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
    scene.traverse(object => { if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial && typeof object.userData.boundaryProfileId === 'string') result.push(object); });
    return result;
  };
  return { command, source, stock, references, original, show, click, pointer, select, menu, cells, camera, scene,
    fit: async () => { await act(async () => controls?.fit()); await flushFrame(); },
    view: async (view: 'Top' | 'Front') => { await act(async () => controls?.setView?.(view)); await flushFrame(); },
    state: () => { if (!controls) throw new Error('Missing controls'); return controls.getState(); } };
}

it.each([0, 100000000])('physically chooses a hole-interior cell above opaque stock at %s and restores normal feature selection/resources on exit', async origin => {
  const h = await harness(origin), position = h.camera.position.toArray(), zoom = h.camera.zoom;
  const bodies: THREE.Mesh[] = []; h.scene.traverse(object => { if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) bodies.push(object); });
  const stockMaterial = bodies[0].material;
  const outlines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>[] = [];
  h.scene.traverse(object => { if (object instanceof THREE.LineSegments && object.material instanceof THREE.LineBasicMaterial && object.userData.featureKind === 'sketch') outlines.push(object); });
  const normalOutlineColors = outlines.map(line => line.material.color.getHex());
  await h.show(h.command); expect(h.cells()).toHaveLength(4);
  for (const line of outlines) expect(line.parent?.visible).toBe(false);
  await h.pointer('pointermove');
  const bore = h.cells().find(cell => cell.userData.boundaryProfileId === 'bore')!;
  expect(bore.material.opacity).toBeGreaterThan(.25);
  await h.click(); expect(h.command.onSelect).toHaveBeenCalledExactlyOnceWith([h.command.cells.cells.find(cell => cell.reference.boundaryProfileId === 'bore')!.reference]);
  expect(h.select).not.toHaveBeenCalled();
  const installed = h.cells(), disposals = installed.map(cell => vi.spyOn(cell.geometry, 'dispose'));
  await h.show({ ...h.command, selection: [h.command.cells.cells.find(cell => cell.reference.boundaryProfileId === 'bore')!.reference] });
  expect(h.cells()).toEqual(installed);
  await h.click(75); expect(h.command.onSelect).toHaveBeenCalledTimes(1); expect(h.select).not.toHaveBeenCalled();
  await h.show(null); expect(h.cells()).toEqual([]); for (const disposal of disposals) expect(disposal).toHaveBeenCalledTimes(1);
  expect(outlines.map(line => line.material.color.getHex())).toEqual(normalOutlineColors);
  for (const line of outlines) { expect(line.parent?.visible).toBe(true); expect(line.material.transparent).toBe(false); expect(line.material.depthTest).toBe(true); expect(line.renderOrder).toBe(1); }
  expect(bodies[0].material).toBe(stockMaterial); expect(stockMaterial).toMatchObject({ transparent: false, opacity: 1, depthWrite: true });
  await h.click(); expect(h.select).toHaveBeenCalledExactlyOnceWith('stock');
  expect(h.camera.position.toArray()).toEqual(position); expect(h.camera.zoom).toBe(zoom); expect(rendered.canvases).toHaveLength(1);
  expect(JSON.stringify({ source: h.source, stock: h.stock, references: h.references })).toBe(h.original);
});

it.each(['shiftKey', 'ctrlKey', 'metaKey'] as const)('toggles the actual cell from legacy/default and explicit selection using %s', async modifier => {
  const h = await harness(); await h.show(h.command); await h.click(28, { [modifier]: true });
  expect(h.command.onSelect).toHaveBeenLastCalledWith(h.command.cells.cells.filter(cell => cell.defaultMaterial && cell.reference.boundaryProfileId !== 'outer').map(cell => cell.reference));
  const bore = h.command.cells.cells.find(cell => cell.reference.boundaryProfileId === 'bore')!.reference;
  await h.show({ ...h.command, selection: [bore] }); await h.click(24, { [modifier]: true });
  expect(h.command.onSelect).toHaveBeenLastCalledWith([]);
});

it('cancels a begun area click on owner/base/source transition, keeps selection-only updates current, and consumes right clicks without menus', async () => {
  const h = await harness(); await h.show(h.command);
  for (const changed of [{ owner: 'other' }, { expectedVersion: 'new' }, { sketchId: 'other-source' }]) {
    await h.pointer('pointerdown'); await h.show({ ...h.command, ...changed }); await h.pointer('pointerup');
    expect(h.command.onSelect).not.toHaveBeenCalled(); await h.show(h.command);
  }
  await h.pointer('pointerdown', 24, { shiftKey: true }); await h.show({ ...h.command, selection: [] }, true); await h.pointer('pointerup', 24, { shiftKey: true });
  expect(h.command.onSelect).toHaveBeenCalledExactlyOnceWith([h.command.cells.cells.find(cell => cell.reference.boundaryProfileId === 'bore')!.reference]);
  await h.click(24, { button: 2 }); expect(h.menu).not.toHaveBeenCalled(); expect(h.command.onSelect).toHaveBeenCalledTimes(1);
  const beforePan = h.camera.position.clone();
  await h.pointer('pointerdown', 24, { button: 2, buttons: 2 }); await h.pointer('pointermove', 30, { button: 2, buttons: 2 }); await h.pointer('pointerup', 24, { button: 2 });
  expect(h.camera.position.distanceTo(beforePan)).toBeGreaterThan(0);
  expect(h.menu).not.toHaveBeenCalled(); expect(h.command.onSelect).toHaveBeenCalledTimes(1);
  await act(async () => rendered.canvases[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })));
  expect(h.menu).not.toHaveBeenCalled();
});

it('clears area hover when navigation changes the view and never guesses a cell in the edge-on view', async () => {
  const h = await harness(); await h.show(h.command); await h.pointer('pointermove');
  const bore = h.cells().find(cell => cell.userData.boundaryProfileId === 'bore')!;
  expect(bore.material.opacity).toBeGreaterThan(.25);
  await h.view('Front'); expect(bore.material.opacity).toBe(.09);
  await h.click(); expect(h.command.onSelect).not.toHaveBeenCalled(); expect(h.select).not.toHaveBeenCalled();
});

it('uses effective datum/cell outlines and explicit Fit bounds while unrelated native publications retain the camera', async () => {
  const h = await harness(), position = h.camera.position.toArray(), zoom = h.camera.zoom;
  const frame = resolveCadWorldDatum({ id: 'datum', name: 'Effective datum', kind: 'datum-plane', suppressed: false,
    definition: { kind: 'world', basePlane: 'XY', origin: [300, 200, 100], rotation: [35, -15, 10] } }, {});
  const command: CadFeatureRegionPickCommand = { ...h.command,
    placement: { plane: { kind: 'datum-plane', featureId: 'datum' }, datumId: 'datum', offsetMm: 7, frame } };
  await h.show(command);
  expect(h.camera.position.toArray()).toEqual(position); expect(h.camera.zoom).toBe(zoom);
  const outlines: THREE.LineLoop[] = [];
  h.scene.traverse(object => { if (object instanceof THREE.LineLoop && object.userData.cadRegionBoundaryId) outlines.push(object); });
  expect(outlines).toHaveLength(4);
  const outer = outlines.find(line => line.userData.cadRegionBoundaryId === 'outer')!;
  h.scene.updateMatrixWorld(true);
  const first = new THREE.Vector3().fromBufferAttribute(outer.geometry.getAttribute('position'), 0).applyMatrix4(outer.matrixWorld);
  expect(first.distanceTo(new THREE.Vector3(...cadFramePointToWorld(frame, 7, [30, 20])))).toBeLessThan(1e-10);
  const installed = h.cells();
  await h.show({ ...command, selection: [] }, true);
  expect(h.camera.position.toArray()).toEqual(position); expect(h.camera.zoom).toBe(zoom); expect(h.cells()).toEqual(installed);
  await h.fit(); h.camera.updateMatrixWorld();
  expect(h.camera.zoom).not.toBe(zoom);
  for (const cell of h.command.cells.cells) for (const x of [cell.boundsMm.minX, cell.boundsMm.maxX]) for (const y of [cell.boundsMm.minY, cell.boundsMm.maxY]) {
    const point = new THREE.Vector3(...cadFramePointToWorld(frame, 7, [x, y])).project(h.camera);
    expect(Math.abs(point.x)).toBeLessThan(1); expect(Math.abs(point.y)).toBeLessThan(1);
  }
});

it('rejects area clicks while graphics are lost and recovers the retained owned cells with fresh rendered metadata', async () => {
  const h = await harness(), before = h.state().revision; await h.show(h.command);
  expect(h.state().revision).toBeGreaterThan(before);
  const cells = h.cells();
  await h.pointer('pointerdown');
  await act(async () => { rendered.lost = true; rendered.canvases[0].dispatchEvent(new Event('webglcontextlost')); });
  await h.pointer('pointerup'); await h.click(); expect(h.command.onSelect).not.toHaveBeenCalled();
  expect(h.state().available).toBe(false); expect(h.cells()).toEqual(cells);
  await act(async () => { rendered.lost = false; rendered.canvases[0].dispatchEvent(new Event('webglcontextrestored')); }); await flushFrame();
  expect(h.state().available).toBe(true); expect(h.cells()).toEqual(cells);
  await h.click(); expect(h.command.onSelect).toHaveBeenCalledExactlyOnceWith([h.command.cells.cells.find(cell => cell.reference.boundaryProfileId === 'bore')!.reference]);
});
