import { act, useCallback, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { createCadDocument } from '@/domain/cad/cadSchema';
import type { CadDocument, CadMesh } from '@/domain/cad/cadDocument';
import { CadSession } from '@/features/cad/cadSession';
import { useCadController, type CadController } from '@/features/cad/useCadController';
import { CadWorkbench } from '@/features/cad/CadWorkbench';
import { setCadPreferences } from '@/features/cad/cadPreferences';
import { cadSiteTools } from '@/features/cad/cadSiteTools';
import type { CadWorkbenchViewportControls } from '@/features/cad/cadViewportControls';

const native = vi.hoisted(() => ({ build: vi.fn(), dispose: vi.fn() }));
vi.mock('@/features/cad/kernel/cadKernelClient', () => ({ createCadKernelClient: () => native }));
const pixels = vi.hoisted(() => ({ dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDSkAAAAASUVORK5CYII=' }));
const graphics = vi.hoisted(() => ({ camera: null as THREE.Camera | null, canvas: null as HTMLCanvasElement | null, scene: null as THREE.Scene | null }));
vi.mock('@/features/editor/captureEditorPreview', () => ({ captureCanvas: () => ({ dataUrl: pixels.dataUrl, width: 1, height: 1, source: '3d' }) }));
vi.mock('three', async original => {
  const module = await original<typeof import('three')>();
  return { ...module, WebGLRenderer: class {
    domElement = document.createElement('canvas');
    render(scene: THREE.Scene, camera: THREE.Camera) { graphics.camera = camera; graphics.canvas = this.domElement; graphics.scene = scene; }
    setPixelRatio() {} setSize() {} dispose() {} forceContextLoss() {}
    getContext() { return { isContextLost: () => false }; }
  } };
});

let root: Root | undefined, container: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount()); container?.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear();
});

async function harness(depthEnabled = true, selection: string | null = 'pad') {
  localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:independent-capture') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.stubGlobal('crypto', webcrypto);
  setCadPreferences({ navigationMode: 'mouse', showOnPartDimensions: true, showDepthHandles: depthEnabled });
  const document: CadDocument = { ...createCadDocument('Capture busy', 'capture_busy'), parameters: { depth: 10 }, features: [
    { id: 'outline', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'rect', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } }
    ] },
    { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'outline', distance: ' depth ', symmetric: false, operation: 'new', targetId: null }
  ] };
  const session = new CadSession(document), before = session.getSnapshot();
  const mesh: CadMesh = { featureId: 'pad', name: 'Pad', positions: [0, 0, 10, 20, 0, 10, 20, 10, 10, 0, 10, 10],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2, 0, 2, 3], edges: [], faceGroups: [{ key: 'top', start: 0, count: 6 }], edgeGroups: [], volume: 2000,
    bounds: { min: [0, 0, 0], max: [20, 10, 10] } };
  native.build.mockResolvedValue({ buildId: 'accepted', meshes: [mesh], diagnostics: [], durationMs: 0 });
  const initialized = await initializeWorkbenchCatalog(createBrowserCacheAdapter(localStorage, { namespace: 'independent-capture' }));
  if (!initialized.ok) throw new Error(initialized.error.message);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let current: CadController | undefined, controls: CadWorkbenchViewportControls | null = null;
  let changeBusy: ((busy: boolean) => void) | undefined;
  function Harness() {
    const [open, setOpen] = useState(true), [forcedBusy, setForcedBusy] = useState(false); changeBusy = setForcedBusy;
    const cad = useCadController({ connectedWorkbench: initialized.ok ? initialized.workbench : null, workbenchInteractionLocked: false,
      runAgentWorkbenchOperation: async () => { throw new Error('Unexpected handoff'); } }, session, open, setOpen, () => null);
    current = cad;
    const publish = useCallback((next: CadWorkbenchViewportControls | null) => { controls = next; cad.setViewportControls(next); }, [cad.setViewportControls]);
    return <CadWorkbench document={cad.snapshot.document} documentVersion={cad.snapshot.version} build={cad.build} buildState={cad.buildState}
      buildVersion={cad.buildVersion} dirty={cad.snapshot.dirty} canUndo={cad.snapshot.canUndo} canRedo={cad.snapshot.canRedo}
      storageBusy={cad.storageBusy || forcedBusy} externalWorkflowOpen={false} featurePreview={cad.featurePreview} onFeaturePreview={cad.previewFeature}
      onEdit={edit => cad.edit([edit])} onEditMany={edits => cad.edit(edits)} onUndo={() => cad.undo()} onRedo={() => cad.redo()}
      onBack={() => {}} onWorkflowChange={session.setWorkflowOpen} onSendToCam={async () => {}} onSave={async () => {}}
      onOpenDocument={() => {}} onNewDocument={() => {}} onImportDocument={async () => {}} onExportDocument={() => {}}
      onExportSolid={async () => {}} onViewportControlsReady={publish} />;
  }
  container = window.document.createElement('div'); window.document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<Harness />));
  const cad = () => { if (!current) throw new Error('No controller'); return current; };
  await act(async () => { await vi.advanceTimersByTimeAsync(80); });
  await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(performance.now())); });
  expect(cad().buildState).toBe('ready');
  await act(async () => { cad().changeViewport({ kind: 'select-feature', featureId: selection }, before.version); });
  await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(performance.now())); });
  expect(container.querySelector<HTMLElement>('.cad-depth-label')?.hidden).toBe(!depthEnabled || selection === null);
  if (depthEnabled && selection !== null) expect(container.querySelector('.cad-depth-label')?.textContent).toBe('Length 10 mm');
  expect(session.getSnapshot()).toEqual(before);
  const view = () => { if (!controls) throw new Error('Missing public controls'); return controls; };
  const canvas = graphics.canvas, camera = graphics.camera;
  if (!canvas || !camera) throw new Error('Missing real rendered camera/canvas');
  const captured = new Set<number>();
  canvas.setPointerCapture = vi.fn((id: number) => captured.add(id)); canvas.hasPointerCapture = vi.fn((id: number) => captured.has(id)); canvas.releasePointerCapture = vi.fn((id: number) => captured.delete(id));
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) });
  const point = (quantity = 10) => { camera.updateMatrixWorld(); const p = new THREE.Vector3(10, 5, quantity).project(camera); return { x: (p.x + 1) * 400, y: (1 - p.y) * 300 }; };
  const pointer = async (type: string, quantity = 10) => {
    const p = point(quantity);
    await act(async () => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' || type === 'pointermove' && quantity === 10 ? 0 : 1, clientX: p.x, clientY: p.y });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' }, isPrimary: { value: true } }); canvas.dispatchEvent(event);
    });
    await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(performance.now())); });
  };
  const setBusy = async (busy: boolean) => { await act(async () => changeBusy?.(busy)); };
  const bodyMaterial = () => {
    let material: THREE.MeshStandardMaterial | undefined;
    graphics.scene?.traverse(object => { if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) material = object.material; });
    if (!material) throw new Error('Missing actual body material'); return material;
  };
  return { session, before, cad, view, canvas, camera, pointer, setBusy, captured, bodyMaterial };
}

it('keeps the enabled idle depth visual stable through delayed public PNG hashing while busy pointers and edits remain blocked', async () => {
  const h = await harness(), originalState = h.view().getState();
  const tool = cadSiteTools(h.cad).find(entry => entry.name === 'cad_capture_preview')!;
  const digest = webcrypto.subtle.digest.bind(webcrypto.subtle);
  let releaseDigest: (() => void) | undefined;
  const digestGate = new Promise<void>(resolve => { releaseDigest = resolve; });
  let reachedDigest: (() => void) | undefined;
  const atDigest = new Promise<void>(resolve => { reachedDigest = resolve; });
  vi.spyOn(webcrypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
    const result = await digest(algorithm, data); reachedDigest?.(); await digestGate; return result;
  });
  let operation: Promise<unknown> | undefined;
  await act(async () => { operation = tool.execute({ expectedVersion: h.before.version }); await atDigest; });
  const during = { state: h.view().getState(), labelHidden: container!.querySelector<HTMLElement>('.cad-depth-label')?.hidden, busy: h.cad().storageBusy };
  // Capture's existing Orbit normalization finishes before hashing. Busy input
  // must retain that resulting physical camera exactly, without a tolerance.
  const position = h.camera.position.toArray(), rotation = h.camera.quaternion.toArray();
  await h.pointer('pointerdown'); await h.pointer('pointermove', 20); await h.pointer('pointerup', 20);
  const afterPointer = h.view().getState(), labelAfterPointer = container!.querySelector('.cad-depth-label')?.textContent;
  const edit = cadSiteTools(h.cad).find(entry => entry.name === 'cad_edit_document')!;
  const blockedEdit = await edit.execute({ expectedVersion: h.before.version, edits: [{ kind: 'set-parameter', name: 'depth', value: 30 }] });
  releaseDigest!();
  let result: unknown;
  await act(async () => { result = await operation; });
  expect(result).toMatchObject({ ok: true });
  expect(during.busy).toBe(true);
  expect(during.labelHidden).toBe(false);
  expect({ ...during.state, busy: false }).toEqual(originalState); expect(afterPointer).toEqual(during.state);
  expect(labelAfterPointer).toBe('Length 10 mm'); expect(blockedEdit).toMatchObject({ ok: false, error: { code: 'BUSY' } });
  expect(h.view().getState()).toEqual(originalState); expect(h.captured.size).toBe(0);
  expect(h.camera.position.toArray()).toEqual(position); expect(h.camera.quaternion.toArray()).toEqual(rotation);
  expect(h.session.getSnapshot()).toEqual(h.before);
});

it('cancels an active provisional depth on a newly published busy lock, restores its exact source and refuses a late pointer', async () => {
  const h = await harness(); await h.pointer('pointerdown'); await h.pointer('pointermove', 20);
  expect(h.session.getSnapshot().workflowOpen).toBe(true); expect(h.captured.has(1)).toBe(true);
  expect(Number(container!.querySelector<HTMLInputElement>('[aria-label="Length mm"]')?.value)).toBeCloseTo(20, 8);
  await h.setBusy(true);
  expect(h.captured.size).toBe(0); expect(h.session.getSnapshot()).toEqual(h.before);
  expect(container!.querySelector<HTMLInputElement>('[aria-label="Length mm"]')?.value).toBe('10');
  await h.pointer('pointermove', 35); await h.pointer('pointerup', 35); expect(h.session.getSnapshot()).toEqual(h.before);
  await h.setBusy(false); expect(container!.querySelector('.cad-depth-label')?.textContent).toBe('Length 10 mm');
  expect(h.session.getSnapshot().document.features[1]).toMatchObject({ distance: ' depth ' });
});

it.each(['body', 'face'] as const)('retains real %s hover with depth disabled through delayed public hashing, refusing new busy hover/navigation without losing the exact receipt', async mode => {
  const h = await harness(false, null);
  await act(async () => h.cad().changeViewport({ kind: 'set-pick-mode', mode }, h.before.version));
  await h.pointer('pointermove');
  const material = h.bodyMaterial(), hoveredColor = material.color.getHex();
  if (mode === 'body') expect(hoveredColor).toBe(0xb2d2df);
  else expect(h.view().getState().view).toMatchObject({ hoveredTopology: { bodyId: 'pad', pick: { kind: 'face', key: 'top' } } });
  const before = h.view().getState(), digest = webcrypto.subtle.digest.bind(webcrypto.subtle);
  let reached: (() => void) | undefined, release: (() => void) | undefined;
  const entered = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(webcrypto.subtle, 'digest').mockImplementation(async (algorithm, data) => { const hash = await digest(algorithm, data); reached?.(); await gate; return hash; });
  const tool = cadSiteTools(h.cad).find(entry => entry.name === 'cad_capture_preview')!;
  let pending: Promise<unknown> | undefined;
  await act(async () => { pending = tool.execute({ expectedVersion: h.before.version }); await entered; });
  const during = h.view().getState(), color = material.color.getHex(), position = h.camera.position.toArray(), rotation = h.camera.quaternion.toArray();
  await h.pointer('pointermove', 100); await h.pointer('pointerleave', 100); await h.pointer('pointerdown', 20); await h.pointer('pointerup', 20);
  await act(async () => h.canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 })));
  const afterInputs = h.view().getState(), afterColor = material.color.getHex();
  release!(); let result: unknown; await act(async () => { result = await pending; });
  expect(result).toMatchObject({ ok: true }); expect(during.busy).toBe(true); expect({ ...during, busy: false }).toEqual(before);
  expect(color).toBe(hoveredColor); expect(afterColor).toBe(color); expect(afterInputs).toEqual(during); expect(h.view().getState()).toEqual(before);
  expect(h.camera.position.toArray()).toEqual(position); expect(h.camera.quaternion.toArray()).toEqual(rotation);
  expect(h.session.getSnapshot()).toEqual(h.before);
});
