import { act, useState, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { CadFeatureEditor } from './CadFeatureEditor';
import { CadSession } from './cadSession';
import { createCadExtrudeDepthHandle } from './cadExtrudeDepthHandle';
import type { CadExtrudeDepthControl } from './cadExtrudeDepthInteraction';
import { cadFeatureCandidateEdits, cadFeatureCandidateKey, type CadFeaturePreviewCommand, type CadFeaturePreviewState } from './cadFeaturePreview';

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function part(): CadDocument {
  return { ...createCadDocument('Physical depth', 'physical_depth'), parameters: { depth: 10 }, features: [
    { id: 'sketch', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'rectangle', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: 30, y: 10, width: 'depth', height: 10, cornerRadius: 0 } }
    ] }, { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: ' depth ', symmetric: false, operation: 'new', targetId: null },
    { id: 'move', name: 'Follower', kind: 'transform', suppressed: false, sourceId: 'pad', translation: [0, 0, 'depth'], rotation: [0, 0, 0] }
  ] };
}
async function mount() {
  const session = new CadSession(part()), before = session.getSnapshot(), preview = vi.fn<(command: CadFeaturePreviewCommand) => void>();
  const handle = createCadExtrudeDepthHandle({ requestRender() {}, onInteractionChange() {} });
  const camera = new THREE.OrthographicCamera(-200 / 3, 200 / 3, 50, -50, .01, 10000);
  camera.up.set(0, 0, 1); camera.position.set(35, -185, 10); camera.lookAt(35, 15, 10); camera.updateMatrixWorld(true); camera.updateProjectionMatrix(); handle.setView(camera, 800, 600);
  let control: CadExtrudeDepthControl | null = null, publish: ((state: CadFeaturePreviewState) => void) | undefined;
  const depth = (next: CadExtrudeDepthControl | null, released?: CadExtrudeDepthControl) => { if (next || control === released) { control = next; handle.update(next); } };
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot), [state, setState] = useState<CadFeaturePreviewState>({ kind: 'idle' }); publish = setState;
    return <CadFeatureEditor feature={snapshot.document.features[1]} document={snapshot.document} documentVersion={snapshot.version} isNew={false}
      onPendingChange={session.setWorkflowOpen} onFeaturePreview={preview} featurePreview={state} onDepthInteractionReady={depth}
      onApply={(feature, parameters) => session.edit(cadFeatureCandidateEdits({ feature, isNew: false, parameters }))} onCancel={() => session.setWorkflowOpen(false)} />;
  }
  await act(async () => root.render(<Harness />));
  const ray = (x: number, z: number) => { const p = new THREE.Vector3(x, 15, z).project(camera), raycaster = new THREE.Raycaster(); raycaster.setFromCamera(new THREE.Vector2(p.x, p.y), camera); return raycaster.ray; };
  const begin = async () => act(async () => { const state = handle.getState(); if (!state) throw new Error('Missing handle'); expect(handle.begin(3, ray(state.endpointMm[0], state.endpointMm[2]), state.screenPoint)).toBe(true); });
  const candidate = () => { const command = preview.mock.calls.at(-1)?.[0]; if (!command || command.kind !== 'candidate') throw new Error('Missing candidate'); return command; };
  const ready = async () => { const command = candidate(); await act(async () => publish?.({ kind: 'ready', owner: command.owner, baseVersion: command.expectedVersion, featureId: 'pad', candidateId: 'depth_handle_preview',
    definitionKey: cadFeatureCandidateKey(command.edits), document: applyCadEdits(session.getSnapshot().document, command.edits), result: { buildId: 'depth_handle_build', meshes: [], diagnostics: [], durationMs: 0 } })); };
  return { session, before, handle, camera, ray, begin, candidate, ready, preview };
}
const length = () => { const input = container.querySelector<HTMLInputElement>('[aria-label="Length mm"]'); if (!input) throw new Error('Missing Length'); return input; };
const apply = () => { const button = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Apply'); if (!button) throw new Error('Missing Apply'); return button; };

it('drags the real editor quantity and linked material width, then keeps Apply atomic and one Undo exact', async () => {
  const h = await mount(), view = h.camera.matrixWorld.toArray();
  try {
    await h.begin(); await act(async () => h.handle.move(3, h.ray(35, 20)));
    expect(length().value).toBe('20'); expect(h.handle.getState()?.endpointMm).toEqual([35, 15, 20]);
    expect(h.candidate().edits).toEqual([{ kind: 'update-feature', feature: h.before.document.features[1] }, { kind: 'set-parameter', name: 'depth', value: 20 }]);
    expect(h.session.getSnapshot()).toMatchObject({ document: h.before.document, version: h.before.version, canUndo: false, workflowOpen: true });
    await h.ready(); expect(apply().disabled).toBe(true);
    await act(async () => h.handle.release(3)); expect(h.handle.getState()?.endpointMm).toEqual([40, 15, 20]); expect(apply().disabled).toBe(false);
    await act(async () => apply().click()); expect(h.session.getSnapshot().document.parameters.depth).toBe(20);
    expect(h.session.getSnapshot().document.features).toEqual(h.before.document.features); expect(h.camera.matrixWorld.toArray()).toEqual(view);
    await act(async () => h.session.undo()); expect(h.session.getSnapshot().document).toEqual(h.before.document); expect(h.session.getSnapshot().canUndo).toBe(false);
  } finally { h.handle.dispose(); }
});

it('cancels an actual ray gesture back to a prior typed candidate and ignores later events after accepted replacement', async () => {
  const h = await mount();
  try {
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(length(), '20'); length().dispatchEvent(new Event('input', { bubbles: true })); });
    await h.ready(); await h.begin(); await act(async () => h.handle.move(3, h.ray(40, 35)));
    expect(length().value).toBe('35'); await act(async () => h.handle.cancel()); expect(length().value).toBe('20');
    expect(h.candidate().edits[1]).toEqual({ kind: 'set-parameter', name: 'depth', value: 20 }); expect(h.session.getSnapshot().document).toEqual(h.before.document);
    await h.ready(); await h.begin(); await act(async () => h.session.replace({ ...h.before.document, name: 'Replacement' }));
    expect(h.handle.move(3, h.ray(40, 40))).toBe(false); expect(h.session.getSnapshot().document.name).toBe('Replacement');
    expect(h.session.getSnapshot().document.parameters.depth).toBe(10); expect(h.session.getSnapshot().canUndo).toBe(false);
  } finally { h.handle.dispose(); }
});
